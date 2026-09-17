import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const SESSION_FILE = path.join(ROOT, 'captured', 't2hub-session', 'session.json');
const ENV_FILE = path.join(ROOT, '.env.t2hub');

function loadEnv() {
  const env = {};
  if (fs.existsSync(ENV_FILE)) {
    for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq > 0) {
        const key = trimmed.substring(0, eq).trim();
        const val = trimmed.substring(eq + 1).trim().replace(/^["']|["']$/g, '');
        env[key] = val;
      }
    }
  }
  return env;
}

function ensureDir() {
  const dir = path.dirname(SESSION_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function saveSession(session) {
  ensureDir();
  fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2));
}

export function loadSession() {
  if (!fs.existsSync(SESSION_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
  } catch {
    return null;
  }
}

export async function login({ interactive = false } = {}) {
  const env = loadEnv();
  const previousSession = loadSession();
  const email = env.T2HUB_EMAIL;
  const password = env.T2HUB_PASSWORD;
  const loginUrl = env.T2HUB_LOGIN_URL || env.T2HUB_URL || 'https://takamol.t2hub.app/takamol/agent/login';
  const baseUrl = env.T2HUB_URL || 'https://takamol.t2hub.app';

  if (!email || !password) {
    return { ok: false, error: 'T2HUB_EMAIL and T2HUB_PASSWORD are required in .env.t2hub' };
  }

  const browser = await chromium.launch({
    headless: !interactive,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  });
  const page = await context.newPage();

  try {
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2000);

    const emailSelectors = 'input[type="email"], input[type="text"][name="email"], input[name="email"], input[name="username"], input[name="login"], input[name="number"], input[placeholder*="email"], input[placeholder*="Email"], input[placeholder*="user"], input[placeholder*="login"], input[placeholder*="number"]';
    const emailFilled = await page.fill(emailSelectors, email).catch(() => null);
    if (emailFilled === null) {
      await page.type(emailSelectors, email, { delay: 50 });
    }
    await page.waitForTimeout(500);

    await page.fill('input[type="password"], input[name="password"]', password);
    await page.waitForTimeout(500);

    await Promise.race([
      page.click('button[type="submit"], button:has-text("Log in"), button:has-text("Login"), input[type="submit"]'),
      page.keyboard.press('Enter'),
    ]);

    await page.waitForTimeout(5000);

    const cookies = await context.cookies();
    let encryptionKey = await page.evaluate(() => {
      try {
        return window.__sk || null;
      } catch {
        return null;
      }
    }).catch(() => null);

    if (!encryptionKey) {
      for (const url of ['https://t2hub.app/takamol/', 'https://takamol.t2hub.app/']) {
        try {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
          await page.waitForTimeout(2000);
          encryptionKey = await page.evaluate(() => {
            try {
              return window.__sk || null;
            } catch {
              return null;
            }
          }).catch(() => null);
          if (encryptionKey) break;
        } catch {}
      }
    }

    // Some T2Hub responses omit window.__sk after login. Keep the last
    // known key rather than overwriting a working key with an empty value.
    if (!encryptionKey && previousSession?.encryptionKey) {
      encryptionKey = previousSession.encryptionKey;
    }

    const session = {
      cookies,
      encryptionKey: encryptionKey,
      loginUrl,
      baseUrl,
      loggedAt: new Date().toISOString(),
    };

    saveSession(session);
    await browser.close();

    return { ok: true, session };
  } catch (e) {
    await browser.close();
    return { ok: false, error: e.message };
  }
}

export async function validateSession({ force = false } = {}) {
  const session = loadSession();
  if (!session) {
    return { ok: false, error: 'No saved session found' };
  }

  if (!force && session.cookies && session.cookies.length > 0) {
    const expired = session.cookies.some(c => c.expires && c.expires * 1000 < Date.now());
    if (!expired) {
      return { ok: true, session };
    }
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  });

  try {
    await context.addCookies(session.cookies);
    const page = await context.newPage();
    const resp = await page.goto(session.loginUrl || session.baseUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    const status = resp ? resp.status() : 0;
    const ok = status >= 200 && status < 400;
    await browser.close();
    return { ok, status, session };
  } catch (e) {
    await browser.close();
    return { ok: false, error: e.message, session };
  }
}

export function getSessionStatus() {
  const session = loadSession();
  if (!session) {
    return { loggedIn: false, hasCookies: false, hasKey: false, age: null };
  }
  const age = session.loggedAt ? Date.now() - new Date(session.loggedAt).getTime() : null;
  return {
    loggedIn: !!(session.cookies && session.cookies.length > 0),
    hasCookies: !!(session.cookies && session.cookies.length > 0),
    hasKey: !!session.encryptionKey,
    age,
    url: session.loginUrl || session.baseUrl,
    loggedAt: session.loggedAt,
  };
}

/**
 * Return the cookie header string suitable for passing to svp-proxy
 * via the x-client-session request header.
 */
export function getCookieHeader() {
  const session = loadSession();
  if (!session?.cookies?.length) return '';
  return session.cookies
    .filter(c => c.domain === 't2hub.app' || c.domain.endsWith('.t2hub.app'))
    .map(c => `${c.name}=${c.value}`)
    .join('; ');
}

/**
 * Return the full set of headers needed for t2hub API calls.
 * Pass these as x-client-session and x-client-proof to svp-proxy.
 */
export function getHeaders() {
  const session = loadSession();
  if (!session) return null;
  return {
    'x-client-session': getCookieHeader(),
    'x-client-proof': session.encryptionKey || '',
  };
}

/**
 * Check if the captured session is still valid (not expired).
 * Returns true if cookies exist and the most recent cookie expiry is in the future.
 */
export function isSessionValid() {
  const session = loadSession();
  if (!session?.cookies?.length) return false;
  const now = Date.now();
  return session.cookies.some(c => {
    if (!c.expires) return true;
    return c.expires * 1000 > now;
  });
}

/**
 * Update the session.json with fresh cookies from a set-cookie header string.
 * Merges new cookies with existing ones, updating values for matching names.
 */
export function updateSessionCookies(setCookieHeader) {
  const session = loadSession();
  if (!session || !setCookieHeader) return false;

  const newCookies = parseSetCookieHeader(setCookieHeader);
  if (!newCookies.length) return false;

  for (const nc of newCookies) {
    const existing = session.cookies.find(c => c.name === nc.name);
    if (existing) {
      existing.value = nc.value;
      if (nc.expires) existing.expires = nc.expires;
    } else {
      session.cookies.push({
        name: nc.name,
        value: nc.value,
        domain: 't2hub.app',
        path: '/',
        expires: nc.expires || undefined,
      });
    }
  }

  session.lastRefreshed = new Date().toISOString();
  saveSession(session);
  return true;
}

/**
 * Export the session as env vars suitable for Supabase edge function.
 * Returns { T2HUB_SESSION_KEY, T2HUB_SESSION_COOKIE, T2HUB_SESSION_CSRF }
 * that can be set via `supabase secrets set` or Vercel env vars.
 */
export function exportSessionAsEnvVars() {
  const session = loadSession();
  if (!session) return null;

  const cookieHeader = getCookieHeader();
  const csrf = session.cookies?.find(c => c.name === 'XSRF-TOKEN')?.value || '';

  return {
    T2HUB_SESSION_KEY: session.encryptionKey || '',
    T2HUB_SESSION_COOKIE: cookieHeader,
    T2HUB_SESSION_CSRF: csrf,
  };
}

function parseSetCookieHeader(header) {
  const cookies = [];
  if (!header) return cookies;
  for (const part of header.split(/,(?=\s*[^;,]+=)/)) {
    const [raw] = part.split(';');
    const eq = raw.indexOf('=');
    if (eq < 0) continue;
    const name = raw.slice(0, eq).trim();
    const value = raw.slice(eq + 1).trim();
    if (!name || !value) continue;

    let expires = null;
    const expiryMatch = part.match(/expires=([^;]+)/i);
    if (expiryMatch) {
      expires = new Date(expiryMatch[1].trim()).getTime() / 1000;
    }
    cookies.push({ name, value, expires });
  }
  return cookies;
}
