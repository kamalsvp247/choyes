import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';

import { prisma } from '../lib/prisma.js';
import { encryptString, randomToken } from '../lib/crypto.js';
import { signAccess } from '../lib/jwt.js';
import { svpMultipartRequest, svpRequest } from '../lib/svpClient.js';

const router = Router();

const MAX_REGISTRATION_BYTES = 20 * 1024 * 1024;

async function readRequestBody(req, maxBytes = MAX_REGISTRATION_BYTES) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      const err = new Error('Registration upload is too large (maximum 20 MB)');
      err.statusCode = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function pickFirst(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

function extractOtpPayload(data) {
  const root = data?.data && typeof data.data === 'object' ? data.data : data;
  const user = root?.user || data?.user || null;

  const token = pickFirst(
    root?.access_payload?.access,
    data?.access_payload?.access,
    root?.access_payload?.token,
    data?.access_payload?.token,
    root?.accessToken,
    data?.accessToken,
    root?.access_token,
    data?.access_token,
    root?.token,
    data?.token,
  );

  const accessExpiresAt = pickFirst(
    root?.access_payload?.access_expires_at,
    data?.access_payload?.access_expires_at,
    root?.access_expires_at,
    data?.access_expires_at,
    root?.expires_at,
    data?.expires_at,
  );

  return { token, accessExpiresAt, user };
}

const LoginInputSchema = z.object({
  login: z.string().min(3),
  password: z.string().min(3),
  requestId: z.string().min(1).optional(),
  request_id: z.string().min(1).optional(),
  otpMethod: z.enum(['email', 'sms']).optional(),
  recaptchaToken: z.string().min(1).optional(),
  recaptchaResponse: z.string().min(1).optional(),
  recaptcha_token: z.string().min(1).optional(),
  recaptcha_response: z.string().min(1).optional(),
  fe_app: z.string().min(1).optional(),
});

const OtpInputSchema = z.object({
  login: z.string().min(3),
  password: z.string().min(3),
  requestId: z.string().min(1).optional(),
  request_id: z.string().min(1).optional(),
  otpAttempt: z.string().min(4).max(10).optional(),
  otp_attempt: z.string().min(4).max(10).optional(),
  otpMethod: z.enum(['email', 'sms']).optional(),
  otp_method: z.enum(['email', 'sms']).optional(),
  recaptchaToken: z.string().min(1).optional(),
  recaptchaResponse: z.string().min(1).optional(),
  recaptcha_token: z.string().min(1).optional(),
  recaptcha_response: z.string().min(1).optional(),
  fe_app: z.string().min(1).optional(),
}).refine((v) => Boolean(v.otpAttempt || v.otp_attempt), {
  message: 'otpAttempt (or otp_attempt) is required',
});

const LoginSchema = z.union([
  LoginInputSchema,
  z.object({ user: LoginInputSchema }),
]);

const OtpSchema = z.union([
  OtpInputSchema,
  z.object({ user: OtpInputSchema }),
]);

function normalizeLoginBody(payload) {
  const input = payload.user ? payload.user : payload;
  return {
    login: input.login,
    password: input.password,
    requestId: input.requestId || input.request_id || randomUUID(),
    otpMethod: input.otpMethod || input.otp_method || 'email',
    feApp: input.fe_app || process.env.SVP_FE_APP || 'legislator',
  };
}

function normalizeOtpBody(payload) {
  const input = payload.user ? payload.user : payload;
  return {
    login: input.login,
    password: input.password,
    requestId: input.requestId || input.request_id || randomUUID(),
    otpAttempt: input.otpAttempt || input.otp_attempt,
    otpMethod: input.otpMethod || input.otp_method || 'email',
    recaptcha: pickFirst(
      input.recaptchaResponse,
      input.recaptcha_response,
      input.recaptchaToken,
      input.recaptcha_token,
    ),
    feApp: input.fe_app || process.env.SVP_FE_APP || 'legislator',
  };
}

const TokenLoginInputSchema = z.object({
  login: z.string().min(3),
  token: z.string().min(10),
});

const TokenLoginSchema = z.union([
  TokenLoginInputSchema,
  z.object({ user: TokenLoginInputSchema }),
]);

function normalizeTokenLoginBody(payload) {
  const input = payload.user ? payload.user : payload;
  return {
    login: input.login,
    token: input.token,
  };
}

router.get('/registration/countries', async (_req, res, next) => {
  try {
    res.json(await svpRequest('/api/v1/visitor_space/countries?per_page=250'));
  } catch (e) {
    next(e);
  }
});

router.get('/registration/occupations', async (req, res, next) => {
  try {
    const { per_page = '1000', page = '1', name = '', arabic_name = '', locale = 'en' } = req.query;
    const qs = new URLSearchParams({ per_page, page, locale });
    if (name) qs.set('name', `contains::${name}`);
    if (arabic_name) qs.set('arabic_name', arabic_name);
    const data = await svpRequest(`/api/v1/visitor_space/occupations?${qs.toString()}`, {
      headers: { 'X-Tenant-Name': 'svp-international' },
    });
    res.json(data);
  } catch (e) {
    next(e);
  }
});

router.get('/registration/labors', async (req, res, next) => {
  try {
    const { passport_number, occupation_key, nationality_id, locale = 'en' } = req.query;
    const qs = new URLSearchParams({ locale });
    if (passport_number) qs.set('passport_number', String(passport_number));
    if (occupation_key) qs.set('occupation_key', String(occupation_key));
    if (nationality_id) qs.set('nationality_id', String(nationality_id));
    const data = await svpRequest(`/api/v1/visitor_space/labors?${qs.toString()}`, {
      headers: { 'X-Tenant-Name': 'svp-international' },
    });
    res.json(data);
  } catch (e) {
    next(e);
  }
});

router.get('/registration/countries/:countryId', async (req, res, next) => {
  try {
    const countryId = encodeURIComponent(String(req.params.countryId));
    res.json(await svpRequest(`/api/v1/visitor_space/countries/${countryId}`));
  } catch (e) {
    next(e);
  }
});

async function forwardRegistration(req, res, next, target) {
  try {
    const contentType = req.headers['content-type'];
    const body = await readRequestBody(req);
    res.json(await svpMultipartRequest(target, { contentType, body }));
  } catch (e) {
    next(e);
  }
}

router.post('/registration/validate', (req, res, next) =>
  forwardRegistration(req, res, next, '/api/v1/individual_labor_space/registrations/validate')
);

router.post('/registration', (req, res, next) =>
  forwardRegistration(req, res, next, '/api/v1/individual_labor_space/registrations')
);

async function createSessionForUser({ login, svpToken, svpExp }) {
  const user = await prisma.user.upsert({
    where: { login },
    update: {
      // Keep the same user record. We do not store raw token on User.
    },
    create: {
      login,
    },
  });

  const refreshRaw = randomToken(32);
  const refreshHash = await bcrypt.hash(refreshRaw, 10);
  const refreshDays = Number(process.env.REFRESH_TOKEN_TTL_DAYS || 14);
  const refreshExpiresAt = new Date(Date.now() + refreshDays * 24 * 60 * 60 * 1000);

  const session = await prisma.session.create({
    data: {
      userId: user.id,
      refreshTokenHash: refreshHash,
      refreshExpiresAt,
      svpAccessEnc: encryptString(svpToken),
      svpAccessExp: svpExp || null,
    },
  });

  const accessToken = signAccess({
    sub: user.id,
    login: user.login,
    sid: session.id,
  });

  return { user, session, refreshRaw, refreshDays, accessToken };
}

router.post('/token-login', async (req, res, next) => {
  try {
    const parsed = TokenLoginSchema.parse(req.body);
    const { login, token: svpToken } = normalizeTokenLoginBody(parsed);

    // Verify token by calling a basic authenticated SVP endpoint.
    await svpRequest('/api/v1/individual_labor_space/permissions', {
      method: 'GET',
      token: svpToken,
    });

    const svpExp = null;
    const { user, session, refreshRaw, refreshDays, accessToken } = await createSessionForUser({
      login,
      svpToken,
      svpExp,
    });

    const secure = String(process.env.COOKIE_SECURE) === 'true';
    const sameSite = process.env.COOKIE_SAMESITE || 'lax';
    res.cookie('svp_rt', refreshRaw, {
      httpOnly: true,
      secure,
      sameSite,
      path: '/api/auth/refresh',
      maxAge: refreshDays * 24 * 60 * 60 * 1000,
    });
    res.cookie('svp_sid', session.id, {
      httpOnly: true,
      secure,
      sameSite,
      path: '/api/auth/refresh',
      maxAge: refreshDays * 24 * 60 * 60 * 1000,
    });

    res.json({
      accessToken,
      user: {
        id: user.id,
        login: user.login,
        svpUserId: user.svpUserId,
        email: user.email,
        fullName: user.fullName,
      },
    });
  } catch (e) {
    next(e);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const parsed = LoginSchema.parse(req.body);
    const { login, password, requestId, otpMethod, feApp } = normalizeLoginBody(parsed);
    const userPayload = {
      login,
      password,
      request_id: requestId,
      otp_method: otpMethod,
      fe_app: feApp,
    };

    await svpRequest('/api/v1/sessions/login', {
      method: 'POST',
      body: {
        user: userPayload,
      },
      headers: { 'X-Request-Id': requestId },
    });

    res.json({ status: 'OTP_SENT', login, otpMethod, requestId });
  } catch (e) {
    next(e);
  }
});

router.post('/otp-verify', async (req, res, next) => {
  try {
    const parsed = OtpSchema.parse(req.body);
    const { login, password, requestId, otpAttempt, otpMethod, recaptcha, feApp } = normalizeOtpBody(parsed);
    if (!otpAttempt) {
      return res.status(400).json({ message: 'otpAttempt (or otp_attempt) is required' });
    }
    const userPayload = {
      login,
      password,
      request_id: requestId,
      otp_attempt: otpAttempt,
      fe_app: feApp,
      otp_method: otpMethod,
      ...(recaptcha ? { recaptcha_response: recaptcha } : {}),
    };

    const data = await svpRequest('/api/v1/sessions/otp', {
      method: 'POST',
      body: {
        user: userPayload,
      },
      headers: { 'X-Request-Id': requestId },
    });

    const otpPayload = extractOtpPayload(data);
    const svpToken = otpPayload.token;
    const svpExp = otpPayload.accessExpiresAt ? new Date(otpPayload.accessExpiresAt) : null;

    if (!svpToken) {
      const err = new Error('SVP OTP verify succeeded but no access token was returned');
      err.statusCode = 502;
      err.details = data;
      throw err;
    }

    const svpUserId = otpPayload.user?.id ?? null;
    const email = otpPayload.user?.email ?? null;
    const fullName = otpPayload.user?.full_name ?? otpPayload.user?.fullName ?? null;

    const user = await prisma.user.upsert({
      where: { login },
      update: {
        svpUserId,
        email,
        fullName,
      },
      create: {
        login,
        svpUserId,
        email,
        fullName,
      },
    });

    const refreshRaw = randomToken(32);
    const refreshHash = await bcrypt.hash(refreshRaw, 10);
    const refreshDays = Number(process.env.REFRESH_TOKEN_TTL_DAYS || 14);
    const refreshExpiresAt = new Date(Date.now() + refreshDays * 24 * 60 * 60 * 1000);

    const session = await prisma.session.create({
      data: {
        userId: user.id,
        refreshTokenHash: refreshHash,
        refreshExpiresAt,
        svpAccessEnc: encryptString(svpToken),
        svpAccessExp: svpExp,
      },
    });

    const accessToken = signAccess({
      sub: user.id,
      login: user.login,
      sid: session.id,
    });

    const secure = String(process.env.COOKIE_SECURE) === 'true';
    const sameSite = process.env.COOKIE_SAMESITE || 'lax';

    res.cookie('svp_rt', refreshRaw, {
      httpOnly: true,
      secure,
      sameSite,
      path: '/api/auth/refresh',
      maxAge: refreshDays * 24 * 60 * 60 * 1000,
    });
    res.cookie('svp_sid', session.id, {
      httpOnly: true,
      secure,
      sameSite,
      path: '/api/auth/refresh',
      maxAge: refreshDays * 24 * 60 * 60 * 1000,
    });

    res.json({
      accessToken,
      user: {
        id: user.id,
        login: user.login,
        svpUserId,
        email,
        fullName,
      },
    });
  } catch (e) {
    next(e);
  }
});

router.post('/refresh', async (req, res, next) => {
  try {
    const sid = req.cookies?.svp_sid;
    const rt = req.cookies?.svp_rt;
    if (!sid || !rt) return res.status(401).json({ message: 'Missing refresh cookies' });

    const session = await prisma.session.findUnique({ where: { id: String(sid) }, include: { user: true } });
    if (!session || session.revokedAt) return res.status(401).json({ message: 'Session revoked' });
    if (session.refreshExpiresAt.getTime() < Date.now()) return res.status(401).json({ message: 'Refresh expired' });

    const ok = await bcrypt.compare(String(rt), session.refreshTokenHash);
    if (!ok) return res.status(401).json({ message: 'Invalid refresh token' });

    const accessToken = signAccess({
      sub: session.user.id,
      login: session.user.login,
      sid: session.id,
    });
    res.json({ accessToken });
  } catch (e) {
    next(e);
  }
});

router.post('/logout', async (req, res, next) => {
  try {
    const sid = req.cookies?.svp_sid;
    if (sid) {
      await prisma.session.update({ where: { id: String(sid) }, data: { revokedAt: new Date() } }).catch(() => {});
    }
    res.clearCookie('svp_rt', { path: '/api/auth/refresh' });
    res.clearCookie('svp_sid', { path: '/api/auth/refresh' });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

export const authRouter = router;
