import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-access-token, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getSupabase() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}

// ── SVP API helper ──────────────────────────────────────────────────
const SVP_BASE = Deno.env.get("SVP_BASE_URL") || "https://svp-international-api.pacc.sa";
const SVP_LOCALE = "en";
const SVP_ORIGIN = "https://svp-international.pacc.sa";
const SVP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";

async function svpRequest(
  path: string,
  opts: { method?: string; token?: string; body?: unknown; headers?: Record<string, string> } = {}
) {
  const url = `${SVP_BASE}${path}${path.includes("?") ? "&" : "?"}locale=${SVP_LOCALE}`;
  const headers: Record<string, string> = {
    Accept: "application/json",
    Origin: SVP_ORIGIN,
    Referer: `${SVP_ORIGIN}/`,
    "User-Agent": SVP_UA,
    "X-Tenant-Name": "svp-international",
    ...(opts.headers || {}),
  };
  if (opts.body) headers["Content-Type"] = "application/json;charset=UTF-8";
  if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`;

  const res = await fetch(url, {
    method: opts.method || "GET",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    throw { statusCode: res.status, message: `SVP request failed: ${res.status}`, details: data };
  }
  return data;
}

async function svpMultipartRequest(path: string, body: FormData) {
  const url = `${SVP_BASE}${path}${path.includes("?") ? "&" : "?"}locale=${SVP_LOCALE}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Accept: "application/json", Origin: SVP_ORIGIN, Referer: `${SVP_ORIGIN}/`, "User-Agent": SVP_UA, "X-Tenant-Name": "svp-international" },
    body,
  });
  const text = await res.text();
  let data: unknown;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) throw { statusCode: res.status, message: `SVP request failed: ${res.status}`, details: data };
  return data;
}

// ── Crypto helpers (AES-256-GCM) ────────────────────────────────────
async function getEncKey(): Promise<Uint8Array> {
  const raw = Deno.env.get("SESSION_ENC_KEY_BASE64") || "";
  if (raw) {
    try {
      const decoded = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
      if (decoded.length === 32) return decoded;
    } catch { /* fall through */ }
    // derive 32 bytes via SHA-256
    const encoder = new TextEncoder();
    return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(raw)));
  }
  // dev fallback
  const fallback = Deno.env.get("JWT_REFRESH_SECRET") || "dev";
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(fallback)));
}

async function encryptString(plain: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", await getEncKey(), "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plain);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded));
  // concat iv + encrypted (tag is appended by WebCrypto)
  const result = new Uint8Array(iv.length + encrypted.length);
  result.set(iv);
  result.set(encrypted, iv.length);
  return btoa(String.fromCharCode(...result));
}

async function decryptString(b64: string): Promise<string> {
  const buf = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const iv = buf.slice(0, 12);
  const data = buf.slice(12);
  const key = await crypto.subtle.importKey("raw", await getEncKey(), "AES-GCM", false, ["decrypt"]);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  return new TextDecoder().decode(decrypted);
}

// ── JWT helpers ─────────────────────────────────────────────────────
async function signJwt(payload: Record<string, unknown>, secret: string, ttlSeconds: number): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const claims = { ...payload, iat: now, exp: now + ttlSeconds };

  const b64 = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

  const headerB64 = b64(header);
  const claimsB64 = b64(claims);
  const input = `${headerB64}.${claimsB64}`;

  const keyData = new TextEncoder().encode(secret);
  const cryptoKey = await crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(input)));
  const sigB64 = btoa(String.fromCharCode(...sig)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

  return `${input}.${sigB64}`;
}

function randomToken(bytes = 32): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...buf)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

// ── Bcrypt-like hash using PBKDF2 ──────────────────────────────────
async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const derived = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, key, 256));
  const saltB64 = btoa(String.fromCharCode(...salt));
  const hashB64 = btoa(String.fromCharCode(...derived));
  return `${saltB64}:${hashB64}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltB64, hashB64] = stored.split(":");
  if (!saltB64 || !hashB64) return false;
  const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const derived = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, key, 256));
  const derivedB64 = btoa(String.fromCharCode(...derived));
  return derivedB64 === hashB64;
}

// ── OTP extraction ──────────────────────────────────────────────────
function pickFirst(...values: unknown[]): unknown {
  for (const v of values) if (v !== undefined && v !== null && v !== "") return v;
  return null;
}

function extractOtpPayload(data: any) {
  const root = data?.data && typeof data.data === "object" ? data.data : data;
  const user = root?.user || data?.user || null;
  const token = pickFirst(
    root?.access_payload?.access, data?.access_payload?.access,
    root?.access_payload?.token, data?.access_payload?.token,
    root?.accessToken, data?.accessToken,
    root?.access_token, data?.access_token,
    root?.token, data?.token
  ) as string | null;
  const accessExpiresAt = pickFirst(
    root?.access_payload?.access_expires_at, data?.access_payload?.access_expires_at,
    root?.access_expires_at, data?.access_expires_at,
    root?.expires_at, data?.expires_at
  ) as string | null;
  return { token, accessExpiresAt, user };
}

// ── Route handler ───────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  // Hosted and local gateways can expose the function as either
  // /svp-auth/* or /functions/v1/svp-auth/*. Normalize both shapes.
  const marker = "/svp-auth";
  const markerIndex = url.pathname.indexOf(marker);
  const path = markerIndex >= 0
    ? url.pathname.slice(markerIndex + marker.length) || "/"
    : url.pathname;

  try {
    // Public registration reference data. No captured/user bearer token is used.
    if (req.method === "GET" && path === "/registration/countries") {
      return json(await svpRequest("/api/v1/visitor_space/countries?per_page=250"));
    }
    const countryMatch = path.match(/^\/registration\/countries\/([^/]+)$/);
    if (req.method === "GET" && countryMatch) {
      return json(await svpRequest(`/api/v1/visitor_space/countries/${encodeURIComponent(countryMatch[1])}`));
    }
    if (req.method === "GET" && path === "/registration/occupations") {
      const u = new URL(req.url);
      const per_page = u.searchParams.get("per_page") || "1000";
      const page = u.searchParams.get("page") || "1";
      const name = u.searchParams.get("name") || "";
      const arabicName = u.searchParams.get("arabic_name") || "";
      const locale = u.searchParams.get("locale") || "en";
      const qs = new URLSearchParams({ per_page, page, locale });
      if (name) qs.set("name", name);
      if (arabicName) qs.set("arabic_name", arabicName);
      return json(await svpRequest(`/api/v1/visitor_space/occupations?${qs.toString()}`));
    }
    if (req.method === "POST" && path === "/result-verification") {
      // Public visitor-space lookup for the SVP /auth/login result-verification panel.
      const input = await req.json().catch(() => ({}));
      const passportNumber = String(input.passportNumber || "").trim().toUpperCase().replace(/\s+/g, "");
      const occupationKey = String(input.occupationKey || "").trim();
      const nationalityId = String(input.nationalityId || "").trim().toUpperCase();
      if (!/^[A-Z0-9]{5,20}$/.test(passportNumber)) throw { statusCode: 400, message: "Enter a valid passport number" };
      if (!/^\d{1,12}$/.test(occupationKey)) throw { statusCode: 400, message: "Select a valid occupation" };
      if (!/^[A-Z]{3}$/.test(nationalityId)) throw { statusCode: 400, message: "Select a valid nationality" };
      const qs = new URLSearchParams({ passport_number: passportNumber, occupation_key: occupationKey, nationality_id: nationalityId, locale: "en" });
      const result = await svpRequest(`/api/v1/visitor_space/labors?${qs.toString()}`);
      return new Response(JSON.stringify({ result }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" } });
    }

    // SVP registration uses multipart/form-data (including passport/image files).
    if (req.method === "POST" && (path === "/registration/validate" || path === "/registration")) {
      const contentType = req.headers.get("content-type") || "";
      if (!contentType.includes("multipart/form-data")) return json({ error: "multipart/form-data required" }, 415);
      const form = await req.formData();
      const target = path === "/registration/validate"
        ? "/api/v1/individual_labor_space/registrations/validate"
        : "/api/v1/individual_labor_space/registrations";
      return json(await svpMultipartRequest(target, form));
    }

    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const body = await req.json().catch(() => ({}));
    const supabase = getSupabase();
    const JWT_SECRET = Deno.env.get("JWT_ACCESS_SECRET")!;

    // ── LOGIN ─────────────────────────────────────────────────
    if (path === "/login") {
      const input = body.user || body;
      const requestId = input.request_id || input.requestId || crypto.randomUUID();
      const { login, password, otp_method, fe_app } = input;
      if (!login || !password) return json({ error: "login and password required" }, 400);

      await svpRequest("/api/v1/sessions/login", {
        method: "POST",
        body: { user: { login, password, request_id: requestId, otp_method: otp_method || "email", fe_app: fe_app || "legislator" } },
        headers: { "X-Request-Id": requestId },
      });

      return json({ status: "OTP_SENT", login, otpMethod: otp_method || "email", requestId });
    }

    // ── OTP VERIFY ────────────────────────────────────────────
    if (path === "/otp-verify") {
      const input = body.user || body;
      const requestId = input.request_id || input.requestId || crypto.randomUUID();
      const { login, password, otp_attempt, otpAttempt, otp_method, otpMethod, fe_app,
        recaptcha_response, recaptchaResponse, recaptcha_token, recaptchaToken } = input;
      const otp = otp_attempt || otpAttempt;
      if (!login || !password || !otp) return json({ error: "login, password, and otp required" }, 400);

      const recaptcha = recaptcha_response || recaptchaResponse || recaptcha_token || recaptchaToken;
      const userPayload: Record<string, unknown> = {
        login, password, otp_attempt: otp,
        request_id: requestId,
        fe_app: fe_app || "legislator",
        otp_method: otp_method || otpMethod || "email",
      };
      if (recaptcha) userPayload.recaptcha_response = recaptcha;

      const data = await svpRequest("/api/v1/sessions/otp", {
        method: "POST",
        body: { user: userPayload },
        headers: { "X-Request-Id": requestId },
      });

      const otpPayload = extractOtpPayload(data);
      const svpToken = otpPayload.token;
      if (!svpToken) throw { statusCode: 502, message: "SVP OTP succeeded but no token returned", details: data };

      const svpExp = otpPayload.accessExpiresAt ? new Date(otpPayload.accessExpiresAt).toISOString() : null;
      const svpUserId = otpPayload.user?.id ?? null;
      const email = otpPayload.user?.email ?? null;
      const fullName = otpPayload.user?.full_name ?? otpPayload.user?.fullName ?? null;

      // Upsert user
      const { data: existingUser } = await supabase.from("svp_users").select("id").eq("login", login).single();
      let userId: string;
      if (existingUser) {
        userId = existingUser.id;
        await supabase.from("svp_users").update({ svp_user_id: svpUserId, email, full_name: fullName }).eq("id", userId);
      } else {
        const { data: newUser, error } = await supabase.from("svp_users").insert({ login, svp_user_id: svpUserId, email, full_name: fullName }).select("id").single();
        if (error) throw { statusCode: 500, message: error.message };
        userId = newUser!.id;
      }

      // Create session
      const refreshRaw = randomToken(32);
      const refreshHash = await hashPassword(refreshRaw);
      const refreshDays = 14;
      const refreshExpiresAt = new Date(Date.now() + refreshDays * 86400000).toISOString();
      const svpAccessEnc = await encryptString(svpToken);

      const { data: session, error: sessErr } = await supabase.from("svp_sessions").insert({
        user_id: userId,
        refresh_token_hash: refreshHash,
        refresh_expires_at: refreshExpiresAt,
        svp_access_enc: svpAccessEnc,
        svp_access_exp: svpExp,
      }).select("id").single();
      if (sessErr) throw { statusCode: 500, message: sessErr.message };

      const accessToken = await signJwt({ sub: userId, login, sid: session!.id }, JWT_SECRET, 900);

      return json({
        accessToken,
        refreshToken: refreshRaw,
        sessionId: session!.id,
        user: { id: userId, login, svpUserId, email, fullName },
      });
    }

    // ── TOKEN LOGIN ───────────────────────────────────────────
    if (path === "/token-login") {
      const input = body.user || body;
      const { login, token: svpToken } = input;
      if (!login || !svpToken) return json({ error: "login and token required" }, 400);

      // Verify token
      await svpRequest("/api/v1/individual_labor_space/permissions", { method: "GET", token: svpToken });

      // Upsert user
      const { data: existingUser } = await supabase.from("svp_users").select("id").eq("login", login).single();
      let userId: string;
      if (existingUser) {
        userId = existingUser.id;
      } else {
        const { data: newUser, error } = await supabase.from("svp_users").insert({ login }).select("id").single();
        if (error) throw { statusCode: 500, message: error.message };
        userId = newUser!.id;
      }

      const refreshRaw = randomToken(32);
      const refreshHash = await hashPassword(refreshRaw);
      const refreshExpiresAt = new Date(Date.now() + 14 * 86400000).toISOString();
      const svpAccessEnc = await encryptString(svpToken);

      const { data: session, error: sessErr } = await supabase.from("svp_sessions").insert({
        user_id: userId,
        refresh_token_hash: refreshHash,
        refresh_expires_at: refreshExpiresAt,
        svp_access_enc: svpAccessEnc,
      }).select("id").single();
      if (sessErr) throw { statusCode: 500, message: sessErr.message };

      const accessToken = await signJwt({ sub: userId, login, sid: session!.id }, JWT_SECRET, 900);

      return json({
        accessToken,
        refreshToken: refreshRaw,
        sessionId: session!.id,
        user: { id: userId, login },
      });
    }

    // ── REFRESH ───────────────────────────────────────────────
    if (path === "/refresh") {
      const { sessionId, refreshToken } = body;
      if (!sessionId || !refreshToken) return json({ error: "Missing sessionId/refreshToken" }, 401);

      const { data: session } = await supabase.from("svp_sessions").select("*, svp_users(*)").eq("id", sessionId).single();
      if (!session || session.revoked_at) return json({ error: "Session revoked" }, 401);
      if (new Date(session.refresh_expires_at).getTime() < Date.now()) return json({ error: "Refresh expired" }, 401);

      const ok = await verifyPassword(refreshToken, session.refresh_token_hash);
      if (!ok) return json({ error: "Invalid refresh token" }, 401);

      const user = (session as any).svp_users;
      const accessToken = await signJwt({ sub: user.id, login: user.login, sid: session.id }, JWT_SECRET, 900);
      return json({ accessToken });
    }

    // ── LOGOUT ────────────────────────────────────────────────
    if (path === "/logout") {
      const { sessionId } = body;
      if (sessionId) {
        await supabase.from("svp_sessions").update({ revoked_at: new Date().toISOString() }).eq("id", sessionId);
      }
      return json({ ok: true });
    }

    return json({ error: "Not found" }, 404);
  } catch (err: any) {
    const status = err?.statusCode || 500;
    return json({ message: err?.message || "Server error", details: err?.details }, status);
  }
});
