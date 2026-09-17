/**
 * Takamol live API client.
 *
 * Routed through the `takamol-proxy` Supabase edge function, which forwards
 * to the live Playwright-MCP noVNC backend (humorous-respect on Railway):
 *   https://takamol-api.up.railway.app
 *
 * Every endpoint returns the envelope:
 *   { success: boolean, data: T, error?: string }
 *
 * Auth-required routes (`/api/auth/profile`, `/api/exam/*`,
 * `/api/takamol/ticket`) return HTTP 401 until the Playwright login has been
 * completed through the noVNC console (POST /api/auth/login launches it).
 * The frontend never talks to the upstream portal directly — everything goes
 * through Supabase, exactly like the rest of the SVP app.
 */

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || "";
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() || "";
const TAKAMOL_ENV_URL =
  (import.meta.env.VITE_TAKAMOL_API_URL as string | undefined)?.trim() || "";

// Used for console links / display.
const TAKAMOL_RAW_URL = TAKAMOL_ENV_URL || "https://takamol-api.up.railway.app";

/**
 * Where requests actually go:
 *  - When VITE_API_BASE_URL is set → use custom domain proxy
 *  - When VITE_TAKAMOL_API_URL is set to an absolute URL → directly there
 *  - Otherwise → the `takamol-proxy` Supabase edge function
 */
const isCustomDomain = typeof window !== "undefined" && !window.location.hostname.includes("supabase.co");
const API_BASE = API_BASE_URL
  ? `${API_BASE_URL}/functions/v1/takamol-proxy`
  : isCustomDomain
    ? `${window.location.origin}/functions/v1/takamol-proxy`
    : (TAKAMOL_ENV_URL || `${SUPABASE_URL}/functions/v1/takamol-proxy`);

export function getTakamolBaseUrl(): string {
  return TAKAMOL_RAW_URL;
}

export interface ApiEnvelope<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

interface FetchOpts {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
}

/**
 * Core fetch helper. Unwraps the `{ success, data }` envelope so callers get
 * `data` directly. Throws an Error (with `status` and `data`) on failures.
 */
export async function takamolFetch<T = any>(path: string, opts: FetchOpts = {}): Promise<T> {
  const method = (opts.method || (opts.body !== undefined ? "POST" : "GET")).toUpperCase();

  let url = isVercelBrowser && path.startsWith("/api/takamol/")
    ? `${API_BASE}?path=${encodeURIComponent(path.slice("/api/takamol/".length))}`
    : `${API_BASE}${path}`;
  if (opts.query) {
    const qs = new URLSearchParams();
    Object.entries(opts.query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && String(value).length > 0) {
        qs.set(key, String(value));
      }
    });
    const str = qs.toString();
    if (str) url += `${url.includes("?") ? "&" : "?"}${str}`;
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: opts.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (err: any) {
    throw Object.assign(new Error(err?.message || "Network error connecting to Takamol backend"), { status: 0 });
  }

  const text = await res.text();
  let payload: any = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }

  if (!res.ok) {
    const message = payload?.message || payload?.error || `Request failed (${res.status})`;
    throw Object.assign(new Error(message), { status: res.status, data: payload });
  }

  return (payload?.data ?? payload) as T;
}
/* ──────────────────────────────────────────────────────────────
 * Types
 * ────────────────────────────────────────────────────────────── */

export interface AuthStatus {
  loggedIn: boolean;
  tokenInfo: Record<string, unknown> | null;
}

export interface TakamolCategory {
  id: number;
  name: string;
}

export interface TakamolCenter {
  id?: string | number;
  name?: string;
  city?: string;
  division?: string;
  site_id?: string | number;
  [key: string]: any;
}

export interface TakamolDatesResult {
  dates: any[];
  cities: string[];
  sessions: any[];
  source: string;
}

export interface TakamolSession {
  id?: string | number;
  category?: TakamolCategory;
  category_id?: number;
  test_center?: Record<string, any>;
  exam_date?: string;
  start_date?: string;
  status?: string;
  available_seats?: number;
  [key: string]: any;
}

/* ──────────────────────────────────────────────────────────────
 * Auth
 * ────────────────────────────────────────────────────────────── */

/** GET /api/auth/status — check whether the Playwright session is logged in. */
export const getAuthStatus = () => takamolFetch<AuthStatus>("/api/auth/status", { method: "GET" });

/** GET /api/auth/profile — logged-in user profile (401 until login). */
export const getProfile = () => takamolFetch<any>("/api/auth/profile", { method: "GET" });

/**
 * POST /api/auth/login — trigger the Playwright login. The request blocks
 * until the browser session starts; the user must complete the login inside
 * the noVNC console. Poll getAuthStatus() afterwards.
 */
export const triggerLogin = (body: Record<string, unknown> = {}) =>
  takamolFetch<any>("/api/auth/login", { method: "POST", body });

/** POST /api/auth/logout — clear the session. */
export const logout = () => takamolFetch<any>("/api/auth/logout", { method: "POST", body: {} });

/* ──────────────────────────────────────────────────────────────
 * Takamol data
 * ────────────────────────────────────────────────────────────── */

/** GET /api/takamol/categories — list exam categories. */
export const getCategories = () =>
  takamolFetch<{ categories: TakamolCategory[] }>("/api/takamol/categories", { method: "GET" });

/** POST /api/takamol/centers — list exam centers (body filters pass through). */
export const getCenters = (body: Record<string, unknown> = {}) =>
  takamolFetch<{ centers: TakamolCenter[] }>("/api/takamol/centers", { method: "POST", body });

/** POST /api/takamol/dates — available exam dates (+ cities + sessions). */
export const getDates = (body: Record<string, unknown>) =>
  takamolFetch<TakamolDatesResult>("/api/takamol/dates", { method: "POST", body });

/** POST /api/takamol/sessions — available exam session slots. */
export const getSessions = (body: Record<string, unknown>) =>
  takamolFetch<{ sessions: TakamolSession[] }>("/api/takamol/sessions", { method: "POST", body });

/** POST /api/takamol/reservation — get or create a reservation. */
export const getReservation = (body: Record<string, unknown>) =>
  takamolFetch<any>("/api/takamol/reservation", { method: "POST", body });

/** POST /api/takamol/ticket — fetch / print the exam ticket (401 until login). */
export const getTicket = (body: Record<string, unknown> = {}) =>
  takamolFetch<any>("/api/takamol/ticket", { method: "POST", body });

/* ──────────────────────────────────────────────────────────────
 * Exam management (auth required)
 * ────────────────────────────────────────────────────────────── */

/** GET /api/exam/sessions — session lookup (alt path). */
export const getExamSessions = (query: Record<string, string | number> = {}) =>
  takamolFetch<any>("/api/exam/sessions", { method: "GET", query });

/** POST /api/exam/reschedule — reschedule an existing booking. */
export const rescheduleExam = (body: Record<string, unknown>) =>
  takamolFetch<any>("/api/exam/reschedule", { method: "POST", body });

/** POST /api/exam/rebook — rebook an exam. */
export const rebookExam = (body: Record<string, unknown>) =>
  takamolFetch<any>("/api/exam/rebook", { method: "POST", body });

/** POST /api/exam/cancel — cancel a booking. */
export const cancelExamBooking = (body: Record<string, unknown>) =>
  takamolFetch<any>("/api/exam/cancel", { method: "POST", body });

/** GET /api/exam/results — fetch exam results. */
export const getExamResults = () => takamolFetch<any>("/api/exam/results", { method: "GET" });

/* ──────────────────────────────────────────────────────────────
 * Search
 * ────────────────────────────────────────────────────────────── */

/** GET /api/search?q= — general search (categories, occupations, etc.). */
export const searchTakamol = (q: string) =>
  takamolFetch<any>("/api/search", { method: "GET", query: { q } });

