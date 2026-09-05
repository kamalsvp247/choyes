import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import * as bcrypt from "https://deno.land/x/bcrypt@v0.4.1/mod.ts";
import { verify } from "https://deno.land/x/djwt@v3.0.2/mod.ts";
import {
  buildAgencyDashboard,
  extractSvpCollection,
  normalizePayment,
  normalizeReservation,
  type SvpIdentity,
} from "./dashboard-utils.ts";
import { FULL_PHONE_ERROR, normalizeFullPhone } from "../_shared/phone.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const JWT_SECRET_RAW = Deno.env.get("JWT_ACCESS_SECRET");
if (!JWT_SECRET_RAW) throw new Error("JWT_ACCESS_SECRET is required");
const PERMISSION_KEYS = ["booking.create", "reservation.manage", "payment.create", "wallet.deposit", "users.create"];
const SVP_BASE = Deno.env.get("SVP_BASE_URL") || "https://svp-international-api.pacc.sa";
const SVP_ORIGIN = "https://svp-international.pacc.sa";
const SVP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";
const DASHBOARD_SYNC_LIMIT = 50;

function verificationInput(body: any) {
  const passportNumber = String(body?.passportNumber || "").trim().toUpperCase().replace(/\s+/g, "");
  const occupationKey = String(body?.occupationKey || "").trim();
  const nationalityId = String(body?.nationalityId || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{5,20}$/.test(passportNumber)) {
    throw { statusCode: 400, message: "Enter a valid passport number" };
  }
  if (!/^\d{1,12}$/.test(occupationKey)) {
    throw { statusCode: 400, message: "Enter a valid occupation key" };
  }
  if (!/^[A-Z]{3}$/.test(nationalityId)) {
    throw { statusCode: 400, message: "Nationality must be a 3-letter country code" };
  }
  return { passportNumber, occupationKey, nationalityId };
}

async function verifyLaborResult(input: { passportNumber: string; occupationKey: string; nationalityId: string }) {
  const params = new URLSearchParams({
    passport_number: input.passportNumber,
    occupation_key: input.occupationKey,
    nationality_id: input.nationalityId,
    locale: "en",
  });
  const response = await fetch(`${SVP_BASE}/api/v1/visitor_space/labors?${params.toString()}`, {
    headers: {
      Accept: "application/json, text/plain, */*",
      Origin: SVP_ORIGIN,
      Referer: `${SVP_ORIGIN}/`,
      "User-Agent": SVP_UA,
      "X-Tenant-Name": "svp-international",
    },
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  let data: unknown;
  try { data = text ? JSON.parse(text) : null; }
  catch { data = { raw: "The verification provider returned an unreadable response." }; }
  if (!response.ok) {
    throw { statusCode: response.status === 429 ? 429 : 502, message: "Verification provider could not complete the request", details: data };
  }
  return data;
}

async function getJwtKey() {
  const encoder = new TextEncoder();
  return await crypto.subtle.importKey(
    "raw", encoder.encode(JWT_SECRET_RAW),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]
  );
}

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

async function getEncKey(): Promise<Uint8Array> {
  const raw = Deno.env.get("SESSION_ENC_KEY_BASE64") || "";
  if (raw) {
    try {
      const decoded = Uint8Array.from(atob(raw), (character) => character.charCodeAt(0));
      if (decoded.length === 32) return decoded;
    } catch { /* derive the configured value below */ }
    return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw)));
  }
  const fallback = Deno.env.get("JWT_REFRESH_SECRET") || "dev";
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(fallback)));
}

async function decryptSvpToken(encrypted: string): Promise<string> {
  const buffer = Uint8Array.from(atob(encrypted), (character) => character.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", await getEncKey(), "AES-GCM", false, ["decrypt"]);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: buffer.slice(0, 12) }, key, buffer.slice(12));
  return new TextDecoder().decode(decrypted);
}

async function fetchSvpDashboardData(path: string, token: string) {
  const response = await fetch(`${SVP_BASE}${path}?locale=en`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      Origin: SVP_ORIGIN,
      Referer: `${SVP_ORIGIN}/`,
      "User-Agent": SVP_UA,
    },
    signal: AbortSignal.timeout(7000),
  });
  const responseText = await response.text();
  let payload: unknown;
  try { payload = responseText ? JSON.parse(responseText) : {}; }
  catch { payload = {}; }
  if (!response.ok) throw new Error(`SVP ${path} returned ${response.status}`);
  return payload;
}

type DashboardSession = { user_id: string; svp_access_enc: string | null };
type AccountSummary = { id: string; name: string; email: string; phone: string | null; role: string; status: string; agency_id: string | null; created_at: string | null };

async function syncSvpDashboard(svpUsers: SvpIdentity[], sessions: DashboardSession[]) {
  const identityById = new Map(svpUsers.map((item) => [item.id, item]));
  const latestSessionByUser = new Map<string, DashboardSession>();
  for (const session of sessions) {
    if (!latestSessionByUser.has(session.user_id) && session.svp_access_enc) {
      latestSessionByUser.set(session.user_id, session);
    }
  }
  const selectedSessions = [...latestSessionByUser.values()].slice(0, DASHBOARD_SYNC_LIMIT);
  const reservations: ReturnType<typeof normalizeReservation>[] = [];
  const payments: ReturnType<typeof normalizePayment>[] = [];
  let syncedAccounts = 0;
  let syncFailures = 0;

  for (let offset = 0; offset < selectedSessions.length; offset += 10) {
    const batch = selectedSessions.slice(offset, offset + 10);
    await Promise.all(batch.map(async (session) => {
      const identity = identityById.get(session.user_id);
      if (!identity) return;
      try {
        const token = await decryptSvpToken(session.svp_access_enc);
        const [reservationResult, paymentResult] = await Promise.allSettled([
          fetchSvpDashboardData("/api/v1/individual_labor_space/exam_reservations", token),
          fetchSvpDashboardData("/api/v1/individual_labor_space/payments", token),
        ]);
        if (reservationResult.status === "fulfilled") {
          reservations.push(...extractSvpCollection(reservationResult.value, ["exam_reservations", "reservations", "records", "items", "results"])
            .map((item) => normalizeReservation(item, identity)));
        }
        if (paymentResult.status === "fulfilled") {
          payments.push(...extractSvpCollection(paymentResult.value, ["payments", "payment_transactions", "records", "items", "results"])
            .map((item) => normalizePayment(item, identity)));
        }
        if (reservationResult.status === "rejected" && paymentResult.status === "rejected") syncFailures += 1;
        else syncedAccounts += 1;
      } catch {
        syncFailures += 1;
      }
    }));
  }
  return {
    reservations,
    payments,
    sessionAccounts: latestSessionByUser.size,
    syncedAccounts,
    syncFailures,
    truncated: latestSessionByUser.size > DASHBOARD_SYNC_LIMIT,
  };
}

function publicAccount(a: any) {
  return {
    id: a.id, name: a.name, email: a.email, phone: a.phone, role: a.role, status: a.status,
    agency_id: a.agency_id, created_by_id: a.created_by_id,
    permission_mode: a.permission_mode || "LEGACY", self_registered: Boolean(a.self_registered),
    created_at: a.created_at, updated_at: a.updated_at,
  };
}

function paymentSettings(body: any) {
  const bkashEnabled = body.bkashEnabled === true;
  const nagadEnabled = body.nagadEnabled === true;
  const bkashNumber = String(body.bkashNumber || "").trim();
  const nagadNumber = String(body.nagadNumber || "").trim();
  const validReceiver = (value: string) => /^[0-9+ -]{6,30}$/.test(value);
  if ((bkashEnabled && !validReceiver(bkashNumber)) || (nagadEnabled && !validReceiver(nagadNumber))) {
    throw { statusCode: 400, message: "Each enabled payment method requires a valid receiver number" };
  }
  return {
    bkash_enabled: bkashEnabled,
    bkash_number: bkashNumber || null,
    bkash_instructions: String(body.bkashInstructions || "").trim().slice(0, 500) || null,
    nagad_enabled: nagadEnabled,
    nagad_number: nagadNumber || null,
    nagad_instructions: String(body.nagadInstructions || "").trim().slice(0, 500) || null,
  };
}

async function getAuth(req: Request) {
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return null;
  try {
    const key = await getJwtKey();
    const payload = await verify(token, key);
    return payload as { sub: string; role: string };
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const auth = await getAuth(req);
  if (!auth || auth.role !== "ADMIN") {
    return new Response(JSON.stringify({ message: "Forbidden" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/access-admin/, "");
  const supabase = getSupabase();

  const { data: actorAccount } = await supabase.from("accounts")
    .select("id,role,status")
    .eq("id", auth.sub)
    .single();
  if (!actorAccount || actorAccount.role !== "ADMIN" || actorAccount.status !== "ACTIVE") {
    return new Response(JSON.stringify({ message: "Admin account is not active" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // POST /result-verification — an audited, server-side lookup. Passport
    // data is never placed in a URL handled by the browser or audit log.
    if (path === "/result-verification" && req.method === "POST") {
      const input = verificationInput(await req.json());
      const result = await verifyLaborResult(input);
      await supabase.from("access_audit_log").insert({
        actor_account_id: auth.sub,
        action: "result_verification.requested",
        details: {
          passport_last4: input.passportNumber.slice(-4),
          occupation_key: input.occupationKey,
          nationality_id: input.nationalityId,
        },
      });
      return new Response(JSON.stringify({ result }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }

    // GET /dashboard — account ownership plus live SVP reservation/payment analytics.
    if (path === "/dashboard" && req.method === "GET") {
      const [accountsResult, svpUsersResult, sessionsResult, billingResult, walletsResult, walletTxResult] = await Promise.all([
        supabase.from("accounts").select("id,name,email,phone,role,status,agency_id,created_at").order("created_at", { ascending: false }),
        supabase.from("svp_users").select("id,login,email,full_name,created_at").order("created_at", { ascending: false }),
        supabase.from("svp_sessions")
          .select("id,user_id,svp_access_enc,svp_access_exp,updated_at")
          .is("revoked_at", null)
          .not("svp_access_enc", "is", null)
          .order("updated_at", { ascending: false }),
        supabase.from("access_billing_settings")
          .select("booking_credit_cost")
          .eq("singleton", true)
          .maybeSingle(),
        supabase.from("wallets")
          .select("account_id,balance")
          .order("account_id"),
        supabase.from("wallet_transactions")
          .select("id,account_id,direction,transaction_type,reference_id,amount,balance_after,description,metadata,created_at")
          .in("transaction_type", ["booking_debit", "refund"])
          .order("created_at", { ascending: false })
          .limit(200),
      ]);
      if (accountsResult.error) throw accountsResult.error;
      if (svpUsersResult.error) throw svpUsersResult.error;
      if (sessionsResult.error) throw sessionsResult.error;

      const accounts = (accountsResult.data || []) as AccountSummary[];
      const svpUsersRaw = (svpUsersResult.data || []) as SvpIdentity[];
      const sessions = (sessionsResult.data || []) as DashboardSession[];
      const live = await syncSvpDashboard(svpUsersRaw, sessions);

      // Build SVP user map with session info
      const sessionByUserId = new Map<string, DashboardSession>();
      for (const s of sessions) {
        if (s.user_id && !sessionByUserId.has(s.user_id)) {
          sessionByUserId.set(s.user_id, s);
        }
      }
      const svpUsers: SvpIdentity[] = svpUsersRaw.map((u) => {
        const session = sessionByUserId.get(u.id);
        const expiresAt = session?.svp_access_exp || null;
        const isActive = session ? !session.revoked_at && new Date(expiresAt || 0).getTime() > Date.now() : false;
        return { ...u, sessionExpiresAt: expiresAt, sessionActive: isActive };
      });

      // Build wallet balances map
      const walletBalances = new Map<string, number>();
      for (const w of (walletsResult.data || [])) {
        walletBalances.set(w.account_id, Number(w.balance) || 0);
      }

      const agencies = buildAgencyDashboard(accounts, svpUsers, live.reservations, live.payments, walletBalances);
      const accountByEmail = new Map(accounts.map((item) => [String(item.email || "").toLowerCase(), item]));
      const agencyById = new Map(accounts.filter((item) => item.role === "AGENCY").map((item) => [item.id, item]));
      const recentPayments = [...live.payments]
        .sort((left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime())
        .slice(0, 30)
        .map((payment) => {
          const account = accountByEmail.get(payment.svpEmail);
          const agency = account?.agency_id ? agencyById.get(account.agency_id) : null;
          return { ...payment, accountName: account?.name || payment.svpLogin, agencyName: agency?.name || null };
        });
      const linkedSvpAccounts = svpUsers.filter((item) => accountByEmail.has(String(item.email || item.login || "").toLowerCase())).length;
      const activeSvpAccounts = svpUsers.filter((item) => item.sessionActive).length;
      const bookingCreditCost = Number(billingResult.data?.booking_credit_cost) || 0;
      const totalWalletBalance = accounts.reduce((sum, item) => sum + (walletBalances.get(item.id) ?? 0), 0);

      // Build booking history from wallet transactions (always available even if SVP sessions expired)
      const accountById = new Map(accounts.map((item) => [item.id, item]));
      const svpUserByEmail = new Map<string, SvpIdentity>();
      for (const u of svpUsers) {
        const email = String(u.email || u.login || "").toLowerCase();
        if (email) svpUserByEmail.set(email, u);
      }
      const bookingHistory = (walletTxResult.data || [])
        .filter((tx) => tx.reference_id && tx.transaction_type === "booking_debit")
        .map((tx) => {
          const account = accountById.get(tx.account_id);
          const accountEmail = String(account?.email || "").toLowerCase();
          const svpUser = svpUserByEmail.get(accountEmail);
          const meta = tx.metadata && typeof tx.metadata === "object" ? tx.metadata : {};
          return {
            id: tx.reference_id,
            accountName: account?.name || "Unknown",
            svpLogin: svpUser?.login || account?.email || "-",
            amount: Number(tx.amount) || 0,
            direction: tx.direction,
            description: tx.description || tx.transaction_type,
            status: meta.svp_success === true ? "completed" : meta.svp_success === false ? "failed" : tx.direction === "refund" ? "refunded" : "charged",
            createdAt: tx.created_at,
          };
        })
        .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
        .slice(0, 50);

      return new Response(JSON.stringify({
        stats: {
          totalAccounts: accounts.length,
          agencies: accounts.filter((item) => item.role === "AGENCY").length,
          agencyUsers: accounts.filter((item) => item.role === "USER" && item.agency_id).length,
          realSvpAccounts: svpUsers.length,
          activeSvpAccounts,
          linkedSvpAccounts,
          completedBookings: live.reservations.filter((item) => item.completed).length,
          successfulPayments: live.payments.filter((item) => item.paid).length,
          bookingCreditCost,
          totalWalletBalance,
        },
        agencies,
        recentPayments,
        bookingHistory,
        recentAccounts: accounts.slice(0, 12).map(publicAccount),
        live: {
          sessionAccounts: live.sessionAccounts,
          syncedAccounts: live.syncedAccounts,
          syncFailures: live.syncFailures,
          truncated: live.truncated,
          refreshedAt: new Date().toISOString(),
        },
        bookingCreditCost,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // GET/PUT /billing-settings — global charge for each successful reservation.
    if (path === "/billing-settings" && req.method === "GET") {
      const { data, error } = await supabase
        .from("access_billing_settings")
        .select("booking_credit_cost,bkash_enabled,bkash_number,bkash_instructions,nagad_enabled,nagad_number,nagad_instructions,updated_at,updated_by")
        .eq("singleton", true)
        .single();
      if (error) throw error;
      return new Response(JSON.stringify({ settings: data }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (path === "/billing-settings" && req.method === "PUT") {
      const body = await req.json();
      const bookingCreditCost = Number(body.bookingCreditCost);
      if (!Number.isFinite(bookingCreditCost) || bookingCreditCost < 0 || bookingCreditCost > 1_000_000) {
        return new Response(JSON.stringify({ message: "Booking credit cost must be between 0 and 1,000,000" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const normalizedCost = Math.round(bookingCreditCost * 100) / 100;
      let methods;
      try { methods = paymentSettings(body); }
      catch (error: any) {
        return new Response(JSON.stringify({ message: error.message }), {
          status: error.statusCode || 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data, error } = await supabase.from("access_billing_settings").upsert({
        singleton: true,
        booking_credit_cost: normalizedCost,
        ...methods,
        updated_by: auth.sub,
        updated_at: new Date().toISOString(),
      }, { onConflict: "singleton" }).select("booking_credit_cost,bkash_enabled,bkash_number,bkash_instructions,nagad_enabled,nagad_number,nagad_instructions,updated_at,updated_by").single();
      if (error) throw error;
      await supabase.from("access_audit_log").insert({
        actor_account_id: auth.sub,
        action: "billing.booking_credit_cost.updated",
        details: { booking_credit_cost: normalizedCost, bkash_enabled: methods.bkash_enabled, nagad_enabled: methods.nagad_enabled },
      });
      return new Response(JSON.stringify({ message: "Booking credit cost updated", settings: data }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // POST /agencies
    if (path === "/agencies" && req.method === "POST") {
      const { name, email, phone: phoneInput, password, status } = await req.json();
      const phone = normalizeFullPhone(phoneInput);
      if (!name || !email || !password || !phone) {
        return new Response(JSON.stringify({ message: !phone ? FULL_PHONE_ERROR : "name, email, phone, password required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: existing } = await supabase.from("accounts").select("id").eq("email", email.toLowerCase()).single();
      if (existing) {
        return new Response(JSON.stringify({ message: "Email already in use" }), {
          status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: existingPhone } = await supabase.from("accounts").select("id").eq("phone", phone).maybeSingle();
      if (existingPhone) {
        return new Response(JSON.stringify({ message: "Phone number already in use" }), {
          status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const hash = bcrypt.hashSync(password);
      const { data: account, error } = await supabase.from("accounts").insert({
        name, email: email.toLowerCase(), phone, password: hash,
        role: "AGENCY", status: status || "PENDING", created_by_id: auth.sub,
        permission_mode: "MANAGED",
      }).select().single();

      if (error) throw error;
      return new Response(JSON.stringify({ message: "Agency created", agency: publicAccount(account) }), {
        status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // POST /users
    if (path === "/users" && req.method === "POST") {
      const { name, email, phone: phoneInput, password, agencyId, status } = await req.json();
      const phone = normalizeFullPhone(phoneInput);
      if (!name || !email || !password || !phone) {
        return new Response(JSON.stringify({ message: !phone ? FULL_PHONE_ERROR : "name, email, phone, password required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: existing } = await supabase.from("accounts").select("id").eq("email", email.toLowerCase()).single();
      if (existing) {
        return new Response(JSON.stringify({ message: "Email already in use" }), {
          status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: existingPhone } = await supabase.from("accounts").select("id").eq("phone", phone).maybeSingle();
      if (existingPhone) {
        return new Response(JSON.stringify({ message: "Phone number already in use" }), {
          status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (agencyId) {
        const { data: agency } = await supabase.from("accounts").select("id,role").eq("id", agencyId).single();
        if (!agency || agency.role !== "AGENCY") {
          return new Response(JSON.stringify({ message: "Invalid agencyId" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      const hash = bcrypt.hashSync(password);
      const { data: account, error } = await supabase.from("accounts").insert({
        name, email: email.toLowerCase(), phone, password: hash,
        role: "USER", status: status || "PENDING",
        agency_id: agencyId || null, created_by_id: auth.sub,
        permission_mode: "MANAGED",
      }).select().single();

      if (error) throw error;
      return new Response(JSON.stringify({ message: "User created", user: publicAccount(account) }), {
        status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // PATCH /accounts/:id/status
    const statusMatch = path.match(/^\/accounts\/([^/]+)\/status$/);
    if (statusMatch && req.method === "PATCH") {
      const id = statusMatch[1];
      const { status } = await req.json();
      if (!["PENDING", "ACTIVE", "BLOCKED"].includes(status)) {
        return new Response(JSON.stringify({ message: "Invalid status" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: account } = await supabase.from("accounts").select("*").eq("id", id).single();
      if (!account) {
        return new Response(JSON.stringify({ message: "Account not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (account.id === auth.sub) {
        return new Response(JSON.stringify({ message: "Cannot change own status" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: updated, error } = await supabase.from("accounts").update({ status }).eq("id", id).select().single();
      if (error) throw error;
      return new Response(JSON.stringify({ message: "Status updated", account: publicAccount(updated) }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // PATCH /accounts/:id/password
    const pwMatch = path.match(/^\/accounts\/([^/]+)\/password$/);
    if (pwMatch && req.method === "PATCH") {
      const id = pwMatch[1];
      const { password } = await req.json();
      if (!password || password.length < 8) {
        return new Response(JSON.stringify({ message: "Password must be at least 8 characters" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: account } = await supabase.from("accounts").select("id").eq("id", id).single();
      if (!account) {
        return new Response(JSON.stringify({ message: "Account not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const hash = bcrypt.hashSync(password);
      const { error } = await supabase.from("accounts").update({ password: hash }).eq("id", id);
      if (error) throw error;
      return new Response(JSON.stringify({ message: "Password updated successfully" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // GET /accounts
    if (path === "/accounts" && req.method === "GET") {
      const role = url.searchParams.get("role");
      const status = url.searchParams.get("status");

      let query = supabase.from("accounts").select("*").order("created_at", { ascending: false });
      if (role) query = query.eq("role", role);
      if (status) query = query.eq("status", status);

      const { data: accounts, error } = await query;
      if (error) throw error;
      return new Response(JSON.stringify({ accounts: (accounts || []).map(publicAccount) }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // GET /accounts/:id/access — permissions, wallet, deposits, and ledger.
    const accessMatch = path.match(/^\/accounts\/([^/]+)\/access$/);
    if (accessMatch && req.method === "GET") {
      const accountId = accessMatch[1];
      const [accountResult, permissionsResult, walletResult, transactionsResult, depositsResult] = await Promise.all([
        supabase.from("accounts").select("*").eq("id", accountId).single(),
        supabase.from("account_permissions").select("permission_key,allowed,note,updated_at").eq("account_id", accountId),
        supabase.from("wallets").select("balance,currency,updated_at").eq("account_id", accountId).single(),
        supabase.from("wallet_transactions").select("*").eq("account_id", accountId).order("created_at", { ascending: false }).limit(100),
        supabase.from("deposit_requests").select("*").eq("account_id", accountId).order("created_at", { ascending: false }).limit(50),
      ]);
      if (!accountResult.data) {
        return new Response(JSON.stringify({ message: "Account not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({
        account: publicAccount(accountResult.data),
        permissions: permissionsResult.data || [],
        wallet: walletResult.data || { balance: 0, currency: "CREDIT" },
        transactions: transactionsResult.data || [],
        deposits: depositsResult.data || [],
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // PUT /accounts/:id/permissions
    if (accessMatch && req.method === "PUT") {
      const accountId = accessMatch[1];
      const body = await req.json();
      const { data: target } = await supabase.from("accounts").select("id,role").eq("id", accountId).single();
      if (!target) return new Response(JSON.stringify({ message: "Account not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (target.role === "ADMIN") return new Response(JSON.stringify({ message: "Admin permissions are always enabled" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      const input = body.permissions && typeof body.permissions === "object" ? body.permissions : {};
      const rows = PERMISSION_KEYS.map((permissionKey) => ({
        account_id: accountId,
        permission_key: permissionKey,
        allowed: input[permissionKey] === true,
        granted_by: auth.sub,
        note: String(body.note || "").slice(0, 500) || null,
        updated_at: new Date().toISOString(),
      }));
      const { error } = await supabase.from("account_permissions").upsert(rows, { onConflict: "account_id,permission_key" });
      if (error) throw error;
      await supabase.from("accounts").update({ permission_mode: "MANAGED" }).eq("id", accountId);
      await supabase.from("access_audit_log").insert({
        actor_account_id: auth.sub, target_account_id: accountId,
        action: "permissions.updated", details: { permissions: input, note: body.note || null },
      });
      return new Response(JSON.stringify({ message: "Permissions updated", permissions: rows }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // GET/PUT /notice — the single dashboard-wide announcement banner shown
    // to every logged-in user. Admin can toggle it on/off and edit the text.
    if (path === "/notice" && (req.method === "GET" || req.method === "PUT")) {
      if (req.method === "GET") {
        const { data } = await supabase.from("access_dashboard_notice").select("enabled,message,updated_at").eq("singleton", true).single();
        return new Response(JSON.stringify({ notice: data || { enabled: false, message: "" } }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const body = await req.json().catch(() => ({}));
      const enabled = Boolean(body.enabled);
      const message = String(body.message || "").slice(0, 2000);
      const { data, error } = await supabase.from("access_dashboard_notice")
        .update({ enabled, message, updated_by: auth.sub, updated_at: new Date().toISOString() })
        .eq("singleton", true).select("enabled,message,updated_at").single();
      if (error) throw error;
      await supabase.from("access_audit_log").insert({
        actor_account_id: auth.sub, action: "dashboard_notice.updated", details: { enabled, message },
      });
      return new Response(JSON.stringify({ notice: data }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // POST /accounts/:id/wallet-adjustments
    const walletMatch = path.match(/^\/accounts\/([^/]+)\/wallet-adjustments$/);
    if (walletMatch && req.method === "POST") {
      const accountId = walletMatch[1];
      const body = await req.json();
      const amount = Number(body.amount);
      const direction = body.direction === "debit" ? "debit" : "credit";
      if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) {
        return new Response(JSON.stringify({ message: "Invalid adjustment amount" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const { data: transaction, error } = await supabase.rpc("wallet_post_adjustment", {
        p_account_id: accountId,
        p_amount: amount,
        p_direction: direction,
        p_transaction_type: direction === "credit" ? "admin_credit" : "admin_debit",
        p_idempotency_key: `admin:${auth.sub}:${crypto.randomUUID()}`,
        p_description: String(body.description || "Manual admin adjustment").slice(0, 500),
        p_created_by: auth.sub,
        p_reference_type: "admin_adjustment",
        p_reference_id: null,
        p_metadata: {},
      });
      if (error) throw error;
      await supabase.from("access_audit_log").insert({
        actor_account_id: auth.sub, target_account_id: accountId,
        action: `wallet.${direction}`, details: { amount, transaction_id: transaction?.id },
      });
      return new Response(JSON.stringify({ message: "Wallet updated", transaction }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // GET /deposits and PATCH /deposits/:id
    if (path === "/deposits" && req.method === "GET") {
      const status = url.searchParams.get("status");
      let query = supabase.from("deposit_requests").select("*, accounts!deposit_requests_account_id_fkey(name,email)").order("created_at", { ascending: false });
      if (status) query = query.eq("status", status);
      const { data, error } = await query.limit(200);
      if (error) throw error;
      return new Response(JSON.stringify({ deposits: data || [] }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const depositMatch = path.match(/^\/deposits\/([^/]+)$/);
    if (depositMatch && req.method === "PATCH") {
      const body = await req.json();
      const action = String(body.action || "").toLowerCase();
      const rpcName = action === "approve" ? "wallet_approve_deposit" : action === "reject" ? "wallet_reject_deposit" : "";
      if (!rpcName) return new Response(JSON.stringify({ message: "Action must be approve or reject" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data, error } = await supabase.rpc(rpcName, {
        p_deposit_id: depositMatch[1], p_admin_id: auth.sub, p_admin_note: String(body.note || "").slice(0, 500) || null,
      });
      if (error) throw error;
      await supabase.from("access_audit_log").insert({
        actor_account_id: auth.sub, action: `deposit.${action}`,
        details: { deposit_id: depositMatch[1], note: body.note || null },
      });
      return new Response(JSON.stringify({ message: `Deposit ${action}d`, result: data }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // GET /test-centers — list of all test centers for the picker
    if (path === "/test-centers" && req.method === "GET") {
      const { data, error } = await supabase
        .from("test_centers")
        .select("site_id, name, city, country_code, address")
        .order("city", { ascending: true })
        .order("name", { ascending: true });
      if (error) throw error;
      return new Response(JSON.stringify({ test_centers: data || [] }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // POST /test-centers — create or update (upsert by site_id)
    if (path === "/test-centers" && req.method === "POST") {
      const { siteId, name, city, countryCode, address } = await req.json();
      const sid = Number(siteId);
      if (!Number.isFinite(sid) || sid <= 0 || !name) {
        return new Response(JSON.stringify({ message: "siteId (positive number) and name are required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data, error } = await supabase
        .from("test_centers")
        .upsert({
          site_id: sid,
          name,
          city: city || null,
          country_code: countryCode || null,
          address: address || null,
        }, { onConflict: "site_id" })
        .select()
        .single();
      if (error) throw error;
      return new Response(JSON.stringify({ message: "Test center saved", test_center: data }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // DELETE /test-centers/:site_id
    const tcDelMatch = path.match(/^\/test-centers\/([^/]+)$/);
    if (tcDelMatch && req.method === "DELETE") {
      const sid = Number(tcDelMatch[1]);
      if (!Number.isFinite(sid)) {
        return new Response(JSON.stringify({ message: "Invalid site_id" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Block deletion if any session is mapped to it
      const { count } = await supabase
        .from("exam_session_centers").select("exam_session_id", { count: "exact", head: true }).eq("site_id", sid);
      if ((count || 0) > 0) {
        return new Response(JSON.stringify({ message: `Cannot delete: ${count} session mapping(s) still use this center` }), {
          status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { error } = await supabase.from("test_centers").delete().eq("site_id", sid);
      if (error) throw error;
      return new Response(JSON.stringify({ message: "Test center deleted" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // GET /session-centers — list mappings joined with test center
    if (path === "/session-centers" && req.method === "GET") {
      const { data, error } = await supabase
        .from("exam_session_centers")
        .select("exam_session_id, site_id, notes, created_at, updated_at, test_centers(name, city)")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      const rows = (data || []).map((r: any) => ({
        exam_session_id: r.exam_session_id,
        site_id: r.site_id,
        notes: r.notes,
        center_name: r.test_centers?.name || null,
        center_city: r.test_centers?.city || null,
        created_at: r.created_at,
        updated_at: r.updated_at,
      }));
      return new Response(JSON.stringify({ mappings: rows }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // POST /session-centers — upsert mapping
    if (path === "/session-centers" && req.method === "POST") {
      const { examSessionId, siteId, notes } = await req.json();
      const esid = Number(examSessionId);
      const sid = Number(siteId);
      if (!Number.isFinite(esid) || esid <= 0 || !Number.isFinite(sid) || sid <= 0) {
        return new Response(JSON.stringify({ message: "examSessionId and siteId must be positive numbers" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: tc } = await supabase.from("test_centers").select("site_id").eq("site_id", sid).single();
      if (!tc) {
        return new Response(JSON.stringify({ message: "Unknown site_id" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data, error } = await supabase
        .from("exam_session_centers")
        .upsert({ exam_session_id: esid, site_id: sid, notes: notes || null }, { onConflict: "exam_session_id" })
        .select()
        .single();
      if (error) throw error;
      return new Response(JSON.stringify({ message: "Mapping saved", mapping: data }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // DELETE /session-centers/:examSessionId
    const scDelMatch = path.match(/^\/session-centers\/([^/]+)$/);
    if (scDelMatch && req.method === "DELETE") {
      const esid = Number(scDelMatch[1]);
      if (!Number.isFinite(esid)) {
        return new Response(JSON.stringify({ message: "Invalid exam session id" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { error } = await supabase.from("exam_session_centers").delete().eq("exam_session_id", esid);
      if (error) throw error;
      return new Response(JSON.stringify({ message: "Mapping deleted" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // GET /section-rules — list rules with their center name
    if (path === "/section-rules" && req.method === "GET") {
      const { data, error } = await supabase
        .from("section_center_rules")
        .select("id, city, category_id, section, site_id, priority, notes, created_at, updated_at, test_centers!inner(name, city)")
        .order("priority", { ascending: false })
        .order("updated_at", { ascending: false });
      // Fallback if no implicit FK relationship: query separately
      if (error) {
        const { data: rules, error: e2 } = await supabase
          .from("section_center_rules")
          .select("*")
          .order("priority", { ascending: false })
          .order("updated_at", { ascending: false });
        if (e2) throw e2;
        const siteIds = Array.from(new Set((rules || []).map((r: any) => r.site_id)));
        const { data: centers } = siteIds.length
          ? await supabase.from("test_centers").select("site_id, name, city").in("site_id", siteIds)
          : { data: [] as any[] };
        const map = new Map((centers || []).map((c: any) => [c.site_id, c]));
        const rows = (rules || []).map((r: any) => ({
          ...r, center_name: map.get(r.site_id)?.name || null, center_city: map.get(r.site_id)?.city || null,
        }));
        return new Response(JSON.stringify({ rules: rows }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const rows = (data || []).map((r: any) => ({
        id: r.id, city: r.city, category_id: r.category_id, section: r.section,
        site_id: r.site_id, priority: r.priority, notes: r.notes,
        center_name: r.test_centers?.name || null, center_city: r.test_centers?.city || null,
        created_at: r.created_at, updated_at: r.updated_at,
      }));
      return new Response(JSON.stringify({ rules: rows }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // POST /section-rules — create or update
    if (path === "/section-rules" && req.method === "POST") {
      const { id, city, categoryId, section, siteId, priority, notes } = await req.json();
      const sid = Number(siteId);
      if (!Number.isFinite(sid) || sid <= 0) {
        return new Response(JSON.stringify({ message: "siteId is required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!city && !categoryId && !section) {
        return new Response(JSON.stringify({ message: "At least one of city, categoryId, or section must be set" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: tc } = await supabase.from("test_centers").select("site_id").eq("site_id", sid).single();
      if (!tc) {
        return new Response(JSON.stringify({ message: "Unknown site_id" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const payload: any = {
        city: city?.trim() || null,
        category_id: categoryId?.toString().trim() || null,
        section: section?.trim() || null,
        site_id: sid,
        priority: Number.isFinite(Number(priority)) ? Number(priority) : 0,
        notes: notes || null,
      };
      const q = id
        ? supabase.from("section_center_rules").update(payload).eq("id", id).select().single()
        : supabase.from("section_center_rules").insert(payload).select().single();
      const { data, error } = await q;
      if (error) throw error;
      return new Response(JSON.stringify({ message: "Rule saved", rule: data }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // DELETE /section-rules/:id
    const srDelMatch = path.match(/^\/section-rules\/([^/]+)$/);
    if (srDelMatch && req.method === "DELETE") {
      const { error } = await supabase.from("section_center_rules").delete().eq("id", srDelMatch[1]);
      if (error) throw error;
      return new Response(JSON.stringify({ message: "Rule deleted" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ message: "Not found" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ message: "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
