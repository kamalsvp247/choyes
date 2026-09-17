// Utility functions for booking data normalization

export function pickArray(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data?.items)) return payload.data.items;
  if (Array.isArray(payload?.occupations)) return payload.occupations;
  if (Array.isArray(payload?.data?.occupations)) return payload.data.occupations;
  if (Array.isArray(payload?.exam_sessions)) return payload.exam_sessions;
  if (Array.isArray(payload?.data?.exam_sessions)) return payload.data.exam_sessions;
  if (Array.isArray(payload?.sessions)) return payload.sessions;
  if (Array.isArray(payload?.data?.sessions)) return payload.data.sessions;
  if (Array.isArray(payload?.available_dates)) return payload.available_dates;
  if (Array.isArray(payload?.data?.available_dates)) return payload.data.available_dates;
  if (Array.isArray(payload?.prometric_codes)) return payload.prometric_codes;
  if (Array.isArray(payload?.data?.prometric_codes)) return payload.data.prometric_codes;
  if (Array.isArray(payload?.exam_reservations)) return payload.exam_reservations;
  if (Array.isArray(payload?.data?.exam_reservations)) return payload.data.exam_reservations;
  if (Array.isArray(payload?.reservations)) return payload.reservations;
  if (Array.isArray(payload?.data?.reservations)) return payload.data.reservations;
  if (Array.isArray(payload?.result)) return payload.result;
  return [];
}

/** True when SVP rejected a 422 because the selected session is no longer usable. */
export function isNoExamSession422(error: any): boolean {
  const details = error?.data?.details;
  const fragments = [
    error?.message,
    error?.data?.message,
    error?.data?.error,
    typeof details === "string" ? details : JSON.stringify(details || ""),
  ].filter(Boolean).join(" ");
  return Number(error?.status) === 422 && /no\s+exam\s+session|test\s+center.*no.*session|exam\s+session.*(?:not|unavailable|found)/i.test(fragments);
}

// Returns true when the proxy returned the T2HUB_SESSION_MISSING code. The
// booking page is the only place a user sees t2hub session errors today, so
// it owns the user-facing message and shows a single visible banner instead
// of silently leaving every picker empty.
export function isT2HubSessionMissing(error: any): boolean {
  if (!error) return false;
  if (error?.data?.code === "T2HUB_SESSION_MISSING") return true;
  if (error?.data?.error?.code === "T2HUB_SESSION_MISSING") return true;
  if (Number(error?.status) === 503 && /t2hub session has not been bootstrapped/i.test(String(error?.message || ""))) {
    return true;
  }
  return false;
}

export const T2HUB_SESSION_MISSING_MESSAGE =
  "Booking data is temporarily unavailable: the t2hub session has not been bootstrapped on the server. Please contact your administrator.";

export const VERIFIED_DHAKA_CENTER_ROSTER = [
  { siteId: "403", name: "Arkan Al-Taameer for professional classification - Dhaka", city: "Dhaka" },
  { siteId: "223", name: "Manikganj Technical Training Center", city: "Dhaka" },
  { siteId: "220", name: "Kishoreganj Technical Training Centre", city: "Dhaka" },
  { siteId: "218", name: "Narsingdi Technical Training Center", city: "Dhaka" },
  { siteId: "102", name: "Tangail Technical Training Center", city: "Dhaka" },
  { siteId: "45", name: "Bangladesh German TTC", city: "Dhaka" },
  { siteId: "17", name: "Bangladesh Korea TTC Dhaka", city: "Dhaka" },
] as const;

/**
 * Restrict the Dhaka selector to the seven SVP centre IDs verified by the
 * user-provided live response. Missing rows are backfilled with the verified
 * names so an older proxy deployment cannot hide a real centre; date-scoped
 * session checks still decide whether each row is selectable for a date.
 */
export function mergeVerifiedCityCenterRoster<T extends Record<string, any>>(
  centers: T[],
  city: string,
  countryId: string | number = "78",
): T[] {
  const isDhakaBangladesh = String(city || "").trim().toLowerCase() === "dhaka" && String(countryId) === "78";
  if (!isDhakaBangladesh) return centers;

  const bySiteId = new Map<string, T>();
  centers.forEach((center) => {
    const siteId = String(center?.test_center_id ?? center?.id ?? center?.site_id ?? "").trim();
    if (siteId) bySiteId.set(siteId, center);
  });

  return VERIFIED_DHAKA_CENTER_ROSTER.map((verified) => {
    const live = bySiteId.get(verified.siteId);
    if (live) return live;
    return {
      test_center_id: verified.siteId,
      id: Number(verified.siteId),
      test_center_name: verified.name,
      name: verified.name,
      city: verified.city,
      country_id: 78,
    } as T;
  });
}

export function normalizeDateValue(value: string): string {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (isNaN(parsed.getTime())) return "";
  return toLocalIsoDate(parsed);
}

export function toLocalIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export interface NormalizedOccupation {
  raw: any;
  id: string;
  name: string;
  categoryId: string;
  methodology: string;
  languageCodes: { code: string; englishName: string }[];
}

export function formatLanguageCodeName(code: string): string {
  if (!code) return "";
  if (/^[0-9a-f]{8}-[0-9a-f]{4}/.test(code)) return "Unknown Language";
  const suffix = code.slice(-2).toUpperCase();
  const prefix = code.slice(0, -2).toUpperCase();
  if (suffix === "BB") return `Bangla (${prefix})`;
  if (suffix === "BE") return `English (${prefix})`;
  if (suffix === "AB") return `Arabic (${prefix})`;
  return code;
}

export function normalizeOccupation(item: any): NormalizedOccupation {
  // T2Hub rows carry both the category id (`id`) and the actual occupation
  // id (`occupation_id`). The booking/date routes require occupation_id;
  // retaining category id as the categoryId keeps the two identifiers from
  // being mixed.
  const id = item?.occupation_id || item?.id || item?.value || "";
  const categoryId = item?.category_id || item?.category?.id || (item?.occupation_id ? item?.id : id) || "";
  const langSource = item?.prometric_codes || item?.category?.prometric_codes || [];
  let languageCodes = pickArray(langSource).map((c: any) => ({
    code: c?.code || c?.language_code || "",
    englishName: c?.english_name || c?.name || c?.code || "",
  }));
  if (!languageCodes.length && item?.language_code) {
    languageCodes = [{ code: String(item.language_code), englishName: formatLanguageCodeName(String(item.language_code)) }];
  }
  return {
    raw: item,
    id: String(id),
    name: item?.name || item?.english_name || item?.occupation_name || item?.title || `Occupation #${id}`,
    categoryId: String(categoryId),
    methodology: item?.methodology_type || item?.methodology || "in_person",
    languageCodes,
  };
}

export function getSessionId(item: any): string {
  return String(
    item?.encrypted_session_id ||
    item?.id ||
    item?.session_id ||
    item?.exam_session_id ||
    item?.examSessionId ||
    item?.exam_session?.id ||
    item?.exam_session?.session_id ||
    item?.exam_session?.exam_session_id ||
    item?.data?.exam_session?.id ||
    ""
  );
}

export function getSessionSiteId(item: any): string {
  const nested = item?.exam_session || item?.data?.exam_session || {};
  const center = item?.test_center || nested?.test_center || {};
  return String(
    item?.site_id ||
    nested?.site_id ||
    center?.site_id ||
    center?.id ||
    center?.test_center_id ||
    item?.test_center_id ||
    nested?.test_center_id ||
    item?.site?.id ||
    nested?.site?.id ||
    ""
  );
}

/**
 * Verify a selected session's centre without weakening the wrong-centre guard.
 *
 * Some live SVP detail responses contain only a city-level test_center object,
 * while the centre-scoped list response already carries the authoritative
 * site_id/test_center_id. In that specific case, the list row may be used as a
 * fallback only when it is the same session ID and already matches the selected
 * centre. Any explicit conflicting detail centre ID remains a hard failure.
 */
function walkResponseNodes(value: any, depth = 0, seen = new Set<any>()): any[] {
  if (value == null || depth > 5 || typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);
  const children = Array.isArray(value) ? value : Object.values(value);
  return [value, ...children.flatMap((child) => walkResponseNodes(child, depth + 1, seen))];
}

/**
 * Extract explicit site/test-centre IDs from a booking or reservation response.
 * A response that reports any ID other than the selected centre must be treated
 * as unsafe; a response with no explicit ID is allowed only after the selected
 * session has already passed the preflight centre guard.
 */
export function getResponseCenterIds(payload: any): string[] {
  return Array.from(new Set(
    walkResponseNodes(payload)
      .map((node) => String(getSessionSiteId(node) || "").trim())
      .filter(Boolean),
  ));
}

export function getResponseCenterName(payload: any): string {
  for (const node of walkResponseNodes(payload)) {
    const name = getExplicitSessionCenterName(node);
    if (name) return name;
  }
  return "";
}

export function resolveVerifiedResponseCenterId(payload: any, expectedCenterId: string | number): string {
  const expected = String(expectedCenterId || "").trim();
  if (!expected) return "";
  const ids = getResponseCenterIds(payload);
  if (ids.some((id) => id !== expected)) return "";
  return ids.length ? expected : "";
}

export function resolveVerifiedSessionCenterId(args: {
  detail: any;
  selectedSession: any;
  expectedSessionId: string | number;
  expectedCenterId: string | number;
}): string {
  const expectedSessionId = String(args.expectedSessionId || "").trim();
  const expectedCenterId = String(args.expectedCenterId || "").trim();
  if (!expectedSessionId || !expectedCenterId) return "";

  const detailCandidates = [
    args.detail,
    args.detail?.exam_session,
    args.detail?.data,
    args.detail?.data?.exam_session,
  ].filter(Boolean);
  const detailCenterIds = Array.from(new Set(
    detailCandidates
      .map((candidate) => String(getSessionSiteId(candidate) || "").trim())
      .filter(Boolean)
  ));

  if (detailCenterIds.length === 1) {
    return detailCenterIds[0] === expectedCenterId ? expectedCenterId : "";
  }
  if (detailCenterIds.length > 1) return "";

  const selectedSessionId = String(getSessionId(args.selectedSession) || "").trim();
  const selectedCenterId = String(getSessionSiteId(args.selectedSession) || "").trim();
  if (
    selectedSessionId === expectedSessionId &&
    selectedCenterId === expectedCenterId
  ) {
    return expectedCenterId;
  }

  return "";
}

export function getSessionSiteCity(item: any): string {
  const nested = item?.exam_session || item?.data?.exam_session || {};
  const sc = item?.site_city ?? nested?.site_city;
  const tc = item?.test_center || nested?.test_center;
  // Support both legacy SVP shape (test_center.city) and new SVP shape (test_center.test_center_city)
  return String(
    (typeof sc === "object" ? sc?.name || sc?.city || sc?.english_name : sc) ||
    tc?.test_center_city || tc?.city ||
    item?.city || nested?.city || item?.site_city_name || item?.test_center_city || ""
  );
}

export function getSessionPayloadId(value: string | number): number | string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && String(numeric) === raw) {
    return numeric > 0 ? numeric : null;
  }
  return raw;
}

export function filterSessionsForCenter(sessions: any[], centerId: string | number): any[] {
  const expected = String(centerId || "").trim();
  if (!expected) return [];
  return sessions.filter((session: any) => {
    const actual = String(getSessionSiteId(session) || "").trim();
    return actual !== "" && actual === expected;
  });
}

/**
 * Build the new-booking body used by the official SVP confirm step.
 *
 * The encrypted exam_session_id is the authoritative center binding. The
 * selected center and temporary hold remain client-side gates, but sending
 * them as overrides lets stale center state redirect a booking within a city.
 */
export function buildExamReservationPayload(args: {
  examSessionId: string | number | null;
  occupationId: string | number;
  methodology: string;
  languageCode: string;
}) {
  return {
    exam_session_id: args.examSessionId,
    occupation_id: Number(args.occupationId),
    methodology: args.methodology || "in_person",
    language_code: args.languageCode,
    site_id: null,
    site_city: null,
    hold_id: null,
  };
}

export function getSessionCenterName(item: any): string {
  return String(
    getExplicitSessionCenterName(item) ||
    `${getSessionSiteCity(item) || "Center"}${getSessionSiteId(item) ? ` (#${getSessionSiteId(item)})` : ""}`
  );
}

export function getExplicitSessionCenterName(item: any): string {
  return String(item?.test_center_name || item?.test_center?.name || item?.test_center?.test_center_name || "").trim();
}

export function getSessionSection(item: any): string {
  return String(
    item?.section ||
    item?.section_name ||
    item?.section_code ||
    item?.exam_section ||
    item?.session?.section ||
    ""
  ).trim();
}

export function getSessionCategoryId(item: any): string {
  return String(
    item?.category_id ||
    item?.category?.id ||
    item?.occupation?.category_id ||
    item?.occupation?.category?.id ||
    // Confirmed from live SVP /exam_sessions responses: the occupation object's
    // own `id` IS the category identifier (e.g. occupation.id === 159, matching
    // the category_id used everywhere else in this app) — there is no separate
    // occupation.category_id field in the real payload. Without this fallback,
    // admin section rules that filter by category_id never match anything.
    item?.occupation?.id ||
    ""
  ).trim();
}

export interface SectionCenterRule {
  id: string;
  city: string | null;
  category_id: string | null;
  section: string | null;
  site_id: number;
  priority: number;
}

/** Picks the highest-priority, most-specific rule that matches the session. */
export function findMatchingSectionRule(item: any, rules: SectionCenterRule[]): SectionCenterRule | null {
  if (!rules?.length) return null;
  const sCity = getSessionSiteCity(item).trim().toLowerCase();
  const sCat = getSessionCategoryId(item).toLowerCase();
  const sSection = getSessionSection(item).toLowerCase();
  const matches = rules.filter((r) => {
    if (r.city && r.city.trim().toLowerCase() !== sCity) return false;
    if (r.category_id && r.category_id.trim().toLowerCase() !== sCat) return false;
    if (r.section && r.section.trim().toLowerCase() !== sSection) return false;
    return r.city || r.category_id || r.section;
  });
  if (!matches.length) return null;
  const specificity = (r: SectionCenterRule) => (r.city ? 1 : 0) + (r.category_id ? 1 : 0) + (r.section ? 1 : 0);
  matches.sort((a, b) => (b.priority - a.priority) || (specificity(b) - specificity(a)));
  return matches[0];
}

/**
 * Resolves the test center name and site_id for a session, stamping them onto the session.
 *
 * Priority (UPDATED):
 *   0. If SVP returned an explicit test_center_name AND a test_center_id (the new
 *      SVP shape: `test_center.test_center_name` + `test_center.test_center_id`),
 *      ALWAYS trust SVP. Each exam_session keeps its own real center identity.
 *      This is critical when one city has multiple test centers — admin overrides
 *      / section rules would otherwise collapse them all to the same name.
 *   1. `sessionIdToSiteId` admin exact mapping (exam_session_id -> site_id)
 *   2. Section rule (city + category + section)
 *   3. Existing `site_id` already on the session (from SVP)
 *   4. Name-based lookup via `centerNameToSiteId`
 */
export function resolveSessionCenter(
  item: any,
  testCenterMap: Map<string, string>,
  centerNameToSiteId: Map<string, string>,
  sessionIdToSiteId?: Map<string, string>,
  sectionRules?: SectionCenterRule[]
): any {
  const sessionId = getSessionId(item);
  const explicit = getExplicitSessionCenterName(item);
  const explicitSiteId = getSessionSiteId(item);
  const svpAuthoritative = !!explicit && !!explicitSiteId;

  const adminSiteId = sessionIdToSiteId?.get(String(sessionId)) || "";
  const ruleMatch =
    !svpAuthoritative && !adminSiteId && sectionRules?.length
      ? findMatchingSectionRule(item, sectionRules)
      : null;
  const ruleSiteId = ruleMatch ? String(ruleMatch.site_id) : "";
  const mappedName = testCenterMap.get(`session:${sessionId}`);
  const adminName = adminSiteId ? testCenterMap.get(`site:${adminSiteId}`) : "";
  const ruleName = ruleSiteId ? testCenterMap.get(`site:${ruleSiteId}`) : "";

  // SVP-first: if SVP has a real name+id pair, use that (no admin/rule override).
  // Otherwise fall back to the legacy resolution chain.
  const resolvedName = svpAuthoritative
    ? explicit
    : (adminName || ruleName || explicit || mappedName || "");
  const resolvedSiteId = svpAuthoritative
    ? explicitSiteId
    : (adminSiteId ||
        ruleSiteId ||
        explicitSiteId ||
        (resolvedName ? centerNameToSiteId.get(resolvedName.trim().toLowerCase()) : "") ||
        "");

  if (!resolvedName && !resolvedSiteId) return item;
  return {
    ...item,
    ...(resolvedSiteId ? { site_id: resolvedSiteId } : {}),
    test_center: {
      ...(item?.test_center || {}),
      ...(resolvedName ? { name: resolvedName } : {}),
      ...(resolvedSiteId
        ? { site_id: resolvedSiteId, id: item?.test_center?.id ?? resolvedSiteId }
        : {}),
    },
  };
}

export function getCenterKey(item: any): string {
  const sid = getSessionSiteId(item);
  if (sid) return String(sid);
  const explicitName = getExplicitSessionCenterName(item);
  if (explicitName) return `name:${String(getSessionSiteCity(item)).trim().toLowerCase()}:${explicitName.toLowerCase()}`;
  // When SVP returns sessions with site_id=null and no test_center_id,
  // and no real center name yet, group them by city until detail fetch fills it.
  const city = getSessionSiteCity(item);
  if (city) return `city:${String(city).trim().toLowerCase()}`;
  return String(getSessionId(item) || "");
}

export function getPrometricCodes(item: any): any[] {
  const candidates = [
    item?.prometric_codes,
    item?.languages,
    item?.language_codes,
    item?.category?.prometric_codes,
    item?.category?.languages,
    item?.category?.language_codes,
    item?.occupation?.prometric_codes,
    item?.occupation?.languages,
    item?.occupation?.language_codes,
    item?.exam_session?.prometric_codes,
    item?.exam_session?.category?.prometric_codes,
    item?.data?.prometric_codes,
    item?.data?.category?.prometric_codes,
  ];
  for (const candidate of candidates) {
    const codes = pickArray(candidate);
    if (codes.length) return codes;
  }
  return [];
}

function getAvailableDateCity(item: any): string {
  if (!item || typeof item === "string") return "";
  const sc = item.site_city;
  const nsc = typeof sc === "object" ? (sc?.name || sc?.city || sc?.english_name || "") : sc;
  const tc = item?.test_center?.city;
  const ntc = typeof tc === "object" ? (tc?.name || tc?.city || tc?.english_name || "") : tc;
  // Support new SVP shape (test_center.test_center_city) alongside legacy fields.
  return String(
    item.city || nsc || item.site_city_name || item.test_center_city ||
    item?.test_center?.test_center_city || ntc || item.site?.city || ""
  ).trim();
}

function getAvailableDateIso(item: any): string {
  if (typeof item === "string") return normalizeDateValue(item);
  return normalizeDateValue(
    item?.date || item?.available_date || item?.exam_date ||
    item?.start_date_in_browser_time_zone || item?.start_date_in_tc_time_zone ||
    item?.start_at_date || item?.start_at || item?.scheduled_at || ""
  );
}

export interface DateEntry { city: string; date: string; }

export function normalizeAvailableDateEntries(items: any[]): DateEntry[] {
  const map = new Map<string, DateEntry>();
  items.forEach((item) => {
    const date = getAvailableDateIso(item);
    if (!date) return;
    const city = getAvailableDateCity(item);
    const key = `${city || "_none_"}__${date}`;
    if (!map.has(key)) map.set(key, { city: city || "", date });
  });
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date) || a.city.localeCompare(b.city));
}

export function buildCityOptions(entries: DateEntry[]): string[] {
  return Array.from(new Set(entries.map((e) => e.city).filter(Boolean))).sort();
}

export function buildDateOptions(entries: DateEntry[], city: string): string[] {
  return Array.from(
    new Set(entries.filter((e) => (city ? e.city === city : true)).map((e) => e.date).filter(Boolean))
  ).sort();
}

export interface CenterOption { siteId: string; name: string; city: string; }

export function buildCenterOptions(items: any[]): CenterOption[] {
  const map = new Map<string, CenterOption>();
  items.forEach((item) => {
    const sid = getCenterKey(item);
    if (!sid || map.has(sid)) return;
    map.set(sid, { siteId: sid, name: getSessionCenterName(item), city: getSessionSiteCity(item) });
  });
  return Array.from(map.values());
}

/**
 * Keep only centres that have a positive live session count for the selected
 * date. A missing count means the centre endpoint was loaded without a date
 * scope, so it is retained until date-scoped availability is known.
 */
export function filterCentersWithAvailableSessions<T extends { sessionCount?: number | null }>(items: T[]): T[] {
  return items.filter((item) => item.sessionCount == null || Number(item.sessionCount) > 0);
}

export interface FallbackCenter {
  siteId: string;
  name: string;
  city: string;
}

/** Extract unique test centers from SVP session data when T2Hub is down. */
export function extractCentersFromSessions(sessions: any[]): FallbackCenter[] {
  const map = new Map<string, FallbackCenter>();
  sessions.forEach((item) => {
    const city = getSessionSiteCity(item);
    const sid = getSessionSiteId(item);
    const explicitName = getExplicitSessionCenterName(item);
    const key = sid || `city:${city}`;
    if (map.has(key)) return;
    map.set(key, { siteId: key, name: explicitName || (sid ? `Center #${sid}` : city), city });
  });
  return Array.from(map.values());
}

/** Returns no hard-coded centers; callers derive them from session data. */
export function fallbackCentersForCity(_city: string): FallbackCenter[] {
  return [];
}

export function readNumeric(payload: any, keys: string[]): number {
  for (const key of keys) {
    const v = payload?.[key] ?? payload?.balance?.[key] ?? payload?.data?.[key] ?? payload?.data?.balance?.[key];
    if (v !== undefined && v !== null && v !== "") {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return 0;
}

export function detectBookingMode(balance: any) {
  const rc = readNumeric(balance, ["reservation_credits", "reservationCredits"]);
  const fc = readNumeric(balance, ["free_certificates_total", "freeCertificatesTotal"]);
  if (rc > 0) return { type: "reservation_credit", label: "Reservation Credit", reservationCredits: rc, freeCertificates: fc };
  if (fc > 0) return { type: "free_certificate", label: "Free Certificate", reservationCredits: rc, freeCertificates: fc };
  return { type: "paid", label: "Paid Booking", reservationCredits: rc, freeCertificates: fc };
}

export function extractId(payload: any, keys: string[]): string {
  for (const key of keys) {
    const v = payload?.[key] || payload?.data?.[key] || payload?.result?.[key];
    if (v) return String(v);
  }
  return "";
}

export function formatDateLabel(value: string): string {
  if (!value) return "-";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-");
    return `${month}/${day}/${year}`;
  }
  const parsed = new Date(value);
  if (isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
}

export interface CalendarDay {
  key: string;
  empty?: boolean;
  iso?: string;
  day?: number;
  available?: boolean;
}

export function buildCalendarDays(activeMonth: string, availableDates: string[]): CalendarDay[] {
  const md = activeMonth ? new Date(`${activeMonth}-01T00:00:00`) : new Date();
  const year = md.getFullYear();
  const month = md.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const leading = firstDay.getDay();
  const total = lastDay.getDate();
  const set = new Set(availableDates);
  const items: CalendarDay[] = [];

  for (let i = 0; i < leading; i++) items.push({ key: `e-s-${i}`, empty: true });
  for (let d = 1; d <= total; d++) {
    const iso = toLocalIsoDate(new Date(year, month, d));
    items.push({ key: iso, iso, day: d, available: set.has(iso) });
  }
  while (items.length % 7 !== 0) items.push({ key: `e-e-${items.length}`, empty: true });
  return items;
}
