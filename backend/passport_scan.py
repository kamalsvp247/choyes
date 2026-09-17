"""
Passport OCR / auto-fill service.

Uses Claude Fable via the Experiential gateway (OpenAI-compatible API) to
extract structured passport fields from an uploaded passport image.

Public entrypoint: `scan_passport_image(image_bytes, mime_type) -> dict`.

Returned shape (always the same keys, empty string when Claude can't read):
    {
        "passport_number": str,
        "first_name": str,
        "last_name": str,
        "date_of_birth": str,             # ISO YYYY-MM-DD (frontend converts to DD/MM/YYYY on submit)
        "passport_expiration_date": str,  # ISO YYYY-MM-DD
        "sex": str,                       # "male" | "female" | ""
        "nationality_code": str,          # 3-letter ISO ("BGD", "SAU", …)
        "country_code": str,              # 2-letter ISO ("BD", "SA", …)
        "issuing_country": str,           # e.g. "BANGLADESH"
        "confidence": str,                # "high" | "medium" | "low"
        "raw": str,                       # raw response text, kept for debug
    }
"""
from __future__ import annotations

import base64
import io
import json
import logging
import os
import re
from typing import Any

from PIL import Image

logger = logging.getLogger(__name__)

# ── Constants ───────────────────────────────────────────────────────────────
EXPERIENTIAL_BASE_URL = "https://api.experientiallabs.ai/v1"
EXPERIENTIAL_MODEL = "claude-fable-5.1"
MAX_IMAGE_DIM = 1800  # px — passports are text-dense but Claude handles up to ~2K well
ACCEPTED_MIME = {"image/jpeg", "image/jpg", "image/png", "image/webp"}
EMPTY_RESULT: dict[str, str] = {
    "passport_number": "",
    "first_name": "",
    "last_name": "",
    "date_of_birth": "",
    "passport_expiration_date": "",
    "sex": "",
    "nationality_code": "",
    "country_code": "",
    "issuing_country": "",
    "confidence": "low",
    "raw": "",
}

SYSTEM_PROMPT = """You are a passport data extractor. You receive a single passport image and return ONLY a JSON object (no markdown, no prose, no code fences) with the fields listed below. If you cannot read a field reliably, use an empty string ""; do NOT invent data.

Return this exact schema:
{
  "passport_number": "string (uppercase, alphanumeric only, e.g. BC1234567)",
  "first_name": "string (given names in UPPERCASE, English/Latin only; if there is no dedicated last-name field, put ALL names here)",
  "last_name": "string (surname in UPPERCASE, English/Latin only; empty string if not separately printed)",
  "date_of_birth": "ISO date YYYY-MM-DD",
  "passport_expiration_date": "ISO date YYYY-MM-DD",
  "sex": "male | female (lowercase; do not use M/F, do not translate)",
  "nationality_code": "3-letter ISO code, uppercase (BGD, SAU, IND, PAK, EGY, …)",
  "country_code": "2-letter ISO code, uppercase (BD, SA, IN, PK, EG, …)",
  "issuing_country": "country name in UPPERCASE English (BANGLADESH, SAUDI ARABIA, …)",
  "confidence": "high | medium | low (your own honest self-rating of the extraction quality)"
}

Rules:
- The MRZ (2 lines at the bottom of the passport photo page) is usually the most reliable source — prefer it when it disagrees with the visual page.
- Dates in the MRZ are YYMMDD; convert them to YYYY-MM-DD. For birth dates, if the 2-digit year is >= current YY, treat it as 19YY; otherwise 20YY. For expiration dates, always treat as 20YY.
- "SEX" field in the MRZ is M or F — convert to "male" or "female".
- Do NOT return markdown or code fences. Return the JSON object and nothing else.
"""


def _pil_normalize(image_bytes: bytes, mime_type: str) -> tuple[bytes, str]:
    """
    Load the image with Pillow, drop EXIF orientation, downscale if huge, and
    re-encode as JPEG. Returns (bytes, "image/jpeg"). Any failure re-raises.
    """
    with Image.open(io.BytesIO(image_bytes)) as img:
        # Extract only the first frame if animated (per image_testing.md rules).
        if getattr(img, "is_animated", False):
            img.seek(0)
        # Fix EXIF orientation & convert to RGB (JPEG can't do RGBA).
        img = img.convert("RGB")
        # Downscale if either dimension exceeds MAX_IMAGE_DIM.
        w, h = img.size
        if max(w, h) > MAX_IMAGE_DIM:
            ratio = MAX_IMAGE_DIM / float(max(w, h))
            img = img.resize((int(w * ratio), int(h * ratio)), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=88, optimize=True)
        return buf.getvalue(), "image/jpeg"


def _parse_json_block(text: str) -> dict[str, Any]:
    """Extract the first {...} JSON object from a text blob. Tolerates code fences."""
    if not text:
        return {}
    stripped = text.strip()
    # Strip common code fences.
    if stripped.startswith("```"):
        stripped = re.sub(r"^```(?:json)?\s*", "", stripped)
        stripped = re.sub(r"\s*```$", "", stripped)
    # Fast path.
    try:
        return json.loads(stripped)
    except Exception:
        pass
    # Fallback: greedy find first balanced {...}.
    match = re.search(r"\{[\s\S]*\}", stripped)
    if not match:
        return {}
    try:
        return json.loads(match.group(0))
    except Exception:
        return {}


def _coerce(data: dict[str, Any]) -> dict[str, str]:
    """Normalize field types + casing. Never raises."""
    def s(key: str, upper: bool = False) -> str:
        v = data.get(key, "")
        if v is None:
            return ""
        out = str(v).strip()
        return out.upper() if upper else out

    out = {
        "passport_number": s("passport_number", upper=True).replace(" ", ""),
        "first_name": s("first_name", upper=True),
        "last_name": s("last_name", upper=True),
        "date_of_birth": s("date_of_birth"),
        "passport_expiration_date": s("passport_expiration_date"),
        "sex": s("sex").lower(),
        "nationality_code": s("nationality_code", upper=True),
        "country_code": s("country_code", upper=True),
        "issuing_country": s("issuing_country", upper=True),
        "confidence": s("confidence").lower() or "low",
    }
    # Guard: only accept ISO YYYY-MM-DD dates; otherwise blank (frontend will show empty and let user fix).
    for key in ("date_of_birth", "passport_expiration_date"):
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", out[key]):
            out[key] = ""
    if out["sex"] not in {"male", "female"}:
        out["sex"] = ""
    if out["confidence"] not in {"high", "medium", "low"}:
        out["confidence"] = "low"
    return out


async def scan_passport_image(image_bytes: bytes, mime_type: str) -> dict[str, Any]:
    """
    Send the passport image to Claude Fable via Experiential gateway and return normalized structured data.

    Raises RuntimeError if EXPLABS_API_KEY is missing or the API call fails —
    the FastAPI route turns that into a 500 with a user-friendly error message.
    """
    if mime_type not in ACCEPTED_MIME:
        raise ValueError(f"Unsupported passport image type: {mime_type}. Use JPEG / PNG / WEBP.")

    api_key = os.environ.get("EXPLABS_API_KEY")
    if not api_key:
        raise RuntimeError("EXPLABS_API_KEY is not configured on the backend.")

    normalized_bytes, normalized_mime = _pil_normalize(image_bytes, mime_type)
    b64 = base64.b64encode(normalized_bytes).decode("ascii")
    data_uri = f"data:{normalized_mime};base64,{b64}"

    import httpx

    payload = {
        "model": EXPERIENTIAL_MODEL,
        "messages": [
            {
                "role": "system",
                "content": SYSTEM_PROMPT,
            },
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": "Extract the passport fields from this image and return the JSON object only.",
                    },
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": data_uri,
                        },
                    },
                ],
            },
        ],
        "temperature": 0.0,
        "max_tokens": 1024,
    }

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                f"{EXPERIENTIAL_BASE_URL}/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        logger.exception("Experiential passport scan failed")
        raise RuntimeError(f"Experiential gateway call failed: {exc}") from exc

    raw_text = data["choices"][0]["message"]["content"]
    parsed = _parse_json_block(raw_text)
    result = _coerce(parsed) if parsed else dict(EMPTY_RESULT)
    result["raw"] = raw_text[:4000]  # cap for the response payload
    return result
