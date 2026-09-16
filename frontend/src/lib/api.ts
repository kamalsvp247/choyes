const SUPABASE_PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;
const SVP_PROXY_URL = import.meta.env.VITE_SVP_PROXY_URL?.replace(/\/$/, "");
const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ||
  SVP_PROXY_URL?.replace(/\/functions\/v1\/svp-proxy$/, "");

// Two possible backends:
//  - Supabase edge functions (primary; used whenever VITE_SUPABASE_URL is set)
//  - The Railway Express backend (frontend/backend/src) as a fallback otherwise.
// Their route shapes differ:
//   Supabase : /functions/v1/svp-proxy  /functions/v1/svp-auth
//   Railway  : /api/svp                 /api/auth
// Both the base URL and path prefixes are resolved together, so switching
// backends never silently hits wrong routes.
//
// Set VITE_BACKEND_URL in your .env (or Vercel env vars) to point at the
// Railway backend. The hardcoded string below is the documented default only —
// change the env var, never the source.
const RAILWAY_URL =
  import.meta.env.VITE_BACKEND_URL?.replace(/\/$/, "") ||
  "https://choyes-production.up.railway.app";
type FunctionKind = "proxy" | "testCenter";

function resolveBackend() {
  if (SUPABASE_URL) {
    const useRailwayRegistration = Boolean(import.meta.env.VITE_BACKEND_URL);
    return {
      // The proxy verifies the JWT issued by svp-auth.  Never use Railway for
      // authentication while using the Supabase proxy: the two deployments can
      // have different JWT_ACCESS_SECRET values, which makes every proxy call
      // fail with "Invalid signature".
      authUsesCookies: false,
      authBase: `${SUPABASE_URL}/functions/v1`,
      base: `${SUPABASE_URL}/functions/v1`,
      proxyBase: SVP_PROXY_URL || `${SUPABASE_URL}/functions/v1`,
      authPrefix: "/svp-auth",
      // Registration is public and does not create a local application
      // session.  When Railway is configured, send its multipart requests
      // there: SVP rejects the Supabase Edge runtime's HTTP/2 connection for
      // this endpoint with a stream/protocol error.
      registrationUsesCookies: useRailwayRegistration,
      registrationBase: useRailwayRegistration ? RAILWAY_URL : `${SUPABASE_URL}/functions/v1`,
      registrationPrefix: useRailwayRegistration ? "/api/auth" : "/svp-auth",
      proxyPrefix: (kind: FunctionKind) =>
        kind === "proxy" ? (SVP_PROXY_URL ? "" : "/svp-proxy") : "/test-center-owner",
    };
  }
  return {
    authUsesCookies: true,
    authBase: RAILWAY_URL,
    base: RAILWAY_URL,
    proxyBase: RAILWAY_URL,
    authPrefix: "/api/auth",
    registrationUsesCookies: true,
    registrationBase: RAILWAY_URL,
    registrationPrefix: "/api/auth",
    // test-center-owner is a Supabase-only feature (see
    // supabase/functions/test-center-owner) — no Railway equivalent exists yet.
    proxyPrefix: (kind: FunctionKind) => (kind === "proxy" ? "/api/svp" : null),
  };
}

const {
  authUsesCookies: AUTH_USES_COOKIES,
  authBase: AUTH_BASE,
  base: BASE,
  proxyBase: PROXY_BASE,
  authPrefix: AUTH_PREFIX,
  registrationUsesCookies: REGISTRATION_USES_COOKIES,
  registrationBase: REGISTRATION_BASE,
  registrationPrefix: REGISTRATION_PREFIX,
  proxyPrefix: PROXY_PREFIX,
} = resolveBackend();

function getSession() {
  const accessToken = localStorage.getItem("accessToken");
  const refreshToken = localStorage.getItem("refreshToken");
  const sessionId = localStorage.getItem("sessionId");
  return { accessToken, refreshToken, sessionId };
}

function saveSession(data: { accessToken?: string; refreshToken?: string; sessionId?: string }) {
  if (data.accessToken) {
    // accessToken is the candidate SVP session. The access-portal token is
    // owned by access-api.ts and remains in the separate access_token key.
    localStorage.setItem("accessToken", data.accessToken);
  }
  if (data.refreshToken) localStorage.setItem("refreshToken", data.refreshToken);
  if (data.sessionId) localStorage.setItem("sessionId", data.sessionId);
}

function clearSession() {
  localStorage.removeItem("accessToken");
  localStorage.removeItem("refreshToken");
  localStorage.removeItem("sessionId");
}

async function doFetch(url: string, opts: RequestInit) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { res, data };
}

export async function apiAuth<T = any>(
  action: string,
  body: any
): Promise<T> {
  const { res, data } = await doFetch(`${AUTH_BASE}${AUTH_PREFIX}${action}`, {
    method: "POST",
    credentials: AUTH_USES_COOKIES ? "include" : "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(localStorage.getItem("access_token") ? { "X-Access-Token": localStorage.getItem("access_token")! } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw Object.assign(new Error(data?.message || "Request failed"), { status: res.status, data });

  // Save session tokens if returned
  if (data?.accessToken) saveSession(data);

  return data as T;
}

export async function apiAuthGet<T = any>(action: string): Promise<T> {
  const { res, data } = await doFetch(`${REGISTRATION_BASE}${REGISTRATION_PREFIX}${action}`, {
    method: "GET",
    credentials: REGISTRATION_USES_COOKIES ? "include" : "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw Object.assign(new Error(data?.message || data?.error || "Request failed"), { status: res.status, data });
  return data as T;
}

export async function apiAuthForm<T = any>(action: string, form: FormData): Promise<T> {
  const res = await fetch(`${REGISTRATION_BASE}${REGISTRATION_PREFIX}${action}`, {
    method: "POST",
    credentials: REGISTRATION_USES_COOKIES ? "include" : "same-origin",
    body: form,
  });
  const text = await res.text();
  let data: any;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) throw Object.assign(new Error(data?.message || data?.error || "Request failed"), { status: res.status, data });
  return data as T;
}

async function callFunction<T = any>(
  kind: FunctionKind,
  path: string,
  { method = "GET", body, token }: { method?: string; body?: any; token?: string } = {}
): Promise<T> {
  const prefix = PROXY_PREFIX(kind);
  if (!prefix) {
    throw new Error(
      `The "${kind}" API isn't available on the active backend (no Supabase URL configured, ` +
      `and the Railway fallback doesn't implement it yet).`
    );
  }

  const session = getSession();
  let access = token || session.accessToken;
  const requestId = crypto.randomUUID();

  const makeOpts = (candidateToken: string | null): RequestInit => {
    const accessPortalToken = localStorage.getItem("access_token");
    return {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(candidateToken ? { Authorization: `Bearer ${candidateToken}` } : {}),
        ...(accessPortalToken ? { "X-Access-Token": accessPortalToken } : {}),
        ...(method !== "GET" ? { "X-Request-Id": requestId } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    };
  };

  const shouldRefresh = (status: number, payload: any) => {
    const message = String(payload?.message || payload?.error || "").toLowerCase();
    return status === 401 || (status === 500 && message.includes("token expired"));
  };

  const requestBase = kind === "proxy" ? PROXY_BASE : BASE;
  let { res, data } = await doFetch(`${requestBase}${prefix}${path}`, makeOpts(access));

  const canRefresh = AUTH_USES_COOKIES || Boolean(session.refreshToken && session.sessionId);
  if (shouldRefresh(res.status, data) && canRefresh) {
    try {
      const refreshRes = await doFetch(`${AUTH_BASE}${AUTH_PREFIX}/refresh`, {
        method: "POST",
        credentials: AUTH_USES_COOKIES ? "include" : "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.sessionId, refreshToken: session.refreshToken }),
      });

      if (refreshRes.res.ok && refreshRes.data?.accessToken) {
        access = refreshRes.data.accessToken;
        saveSession({ accessToken: access });
        ({ res, data } = await doFetch(`${requestBase}${prefix}${path}`, makeOpts(access)));
      } else if (refreshRes.res.status === 401) {
        clearSession();
      }
    } catch {
      // refresh failed, proceed with original error
    }
  }

  if (!res.ok) {
    const message = data?.message || data?.error || "Request failed";
    throw Object.assign(new Error(message), { status: res.status, data });
  }

  return data as T;
}

export async function api<T = any>(
  path: string,
  opts: { method?: string; body?: any; token?: string } = {}
): Promise<T> {
  return callFunction<T>("proxy", path, opts);
}

// Real calls to the test-center-owner edge function (validate_access, owner-status,
// test center detail) — backed by the public.test_center_owners table, using the
// same SVP session/JWT auth as the rest of the app. See supabase/functions/test-center-owner.
export async function apiTestCenter<T = any>(
  path: string,
  opts: { method?: string; body?: any; token?: string } = {}
): Promise<T> {
  return callFunction<T>("testCenter", path, opts);
}

export { saveSession, clearSession, getSession };

export function getBackendUrl() {
  return PROXY_BASE;
}

// The correct path prefix to append to getBackendUrl() for direct/raw fetches
// (e.g. streaming a ticket PDF) that bypass api()/callFunction(). Using a
// hardcoded "/svp-proxy" here previously broke the Railway fallback the same
// way api() did.
export function getProxyPrefix(): string {
  const prefix = PROXY_PREFIX("proxy");
  if (!prefix) throw new Error("No proxy backend is configured.");
  return prefix;
}
