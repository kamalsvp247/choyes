import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Activity, Building2, CircleUserRound, Database, FileSliders,
  LayoutDashboard, LogOut, Megaphone, Plus, RefreshCw, SearchCheck, Server, ShieldCheck, Users, WalletCards,
} from "lucide-react";
import { useAccessAuth } from "@/contexts/AccessAuthContext";
import { accessAdminApi, accessAgencyApi } from "@/lib/access-api";
import "@/styles/access-dashboard-premium.css";
import "@/styles/access-admin-analytics.css";

interface Account {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  role: string;
  status: string;
  created_at?: string;
}

interface SvpLoginInfo {
  login: string;
  active: boolean;
  expiresAt: string | null;
}

interface AdminDashboardData {
  stats: { totalAccounts: number; agencies: number; agencyUsers: number; realSvpAccounts: number; activeSvpAccounts: number; linkedSvpAccounts: number; completedBookings: number; successfulPayments: number; bookingCreditCost: number; totalWalletBalance: number };
  agencies: Array<{
    id: string; name: string; email: string; status: string; createdAt?: string | null;
    userCount: number; svpAccountCount: number; activeSvpCount: number; completedBookings: number; pendingBookings: number; failedBookings: number; paidPayments: number; totalWalletBalance: number;
    users: Array<{
      id: string; name: string; email: string; phone?: string | null; status: string; createdAt?: string | null;
      svpAccountCount: number; activeSvpCount: number; expiredSvpCount: number; svpLogins: SvpLoginInfo[];
      completedBookings: number; pendingBookings: number; failedBookings: number; paidPayments: number; totalPayments: number;
      walletBalance: number | null;
      recentReservations: Array<{ id: string; status: string; completed: boolean; createdAt: string | null }>;
    }>;
  }>;
  recentPayments: Array<{ id: string; reservationId?: string | null; accountName: string; agencyName?: string | null; svpLogin: string; status: string; paid: boolean; amount?: number | null; currency?: string | null; createdAt?: string | null }>;
  recentAccounts: Account[];
  live: { sessionAccounts: number; syncedAccounts: number; syncFailures: number; truncated: boolean; refreshedAt: string };
  bookingCreditCost: number;
}

function initials(name?: string) {
  return String(name || "User").split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function formatDate(value?: string) {
  if (!value) return "Recently";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Recently" : date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

const REFRESH_INTERVAL_MS = 30_000; // 30 seconds
const CLOCK_INTERVAL_MS = 1_000; // 1 second

function LiveClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), CLOCK_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="ap-live-clock">
      <span className="ap-live-clock__dot" />
      {now.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}
      {" "}
      {now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
    </span>
  );
}

export default function AccessDashboardPage() {
  const { user, logout } = useAccessAuth();
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [adminDashboard, setAdminDashboard] = useState<AdminDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const isAdmin = user?.role === "ADMIN";
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (isInitial = false) => {
    if (isInitial) setLoading(true);
    else setRefreshing(true);
    setError("");
    try {
      if (isAdmin) {
        const dashboard = await accessAdminApi<AdminDashboardData>("/dashboard");
        setAdminDashboard(dashboard);
        setAccounts(dashboard.recentAccounts || []);
      } else {
        const nextAccounts = (await accessAgencyApi<{ users: Account[] }>("/users")).users;
        setAccounts(nextAccounts || []);
      }
      setLastRefreshed(new Date());
    } catch (err: unknown) {
      const value = err as { message?: string };
      setError(value.message || "Could not load dashboard data");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    if (user) void load(true);
  }, [user, load]);

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (autoRefresh && user) {
      intervalRef.current = setInterval(() => { void load(false); }, REFRESH_INTERVAL_MS);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoRefresh, user, load]);

  const stats = useMemo(() => {
    const active = accounts.filter((item) => item.status === "ACTIVE").length;
    const inactive = accounts.length - active;
    const bookingCost = adminDashboard?.bookingCreditCost ?? 0;
    const totalWallet = adminDashboard?.stats?.totalWalletBalance ?? 0;
    if (isAdmin) return [
      ["Agencies", adminDashboard?.stats.agencies ?? 0, "Agency partners", "gold"],
      ["Users", adminDashboard?.stats.agencyUsers ?? 0, "Users under agencies", "blue"],
      ["SVP Active", adminDashboard?.stats.activeSvpAccounts ?? 0, `of ${adminDashboard?.stats.realSvpAccounts ?? 0} total`, "green"],
      ["Bookings", adminDashboard?.stats.completedBookings ?? 0, "Completed reservations", "blue"],
      ["Per Booking", bookingCost > 0 ? `${bookingCost.toFixed(2)} CR` : "Free", "Credit cost", "gold"],
      ["Wallet Pool", totalWallet > 0 ? totalWallet.toFixed(1) : "0", "Total credits", "green"],
    ];
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return [
      ["My users", accounts.length, "Users in agency", "blue"],
      ["Active", active, "Currently active", "green"],
      ["Inactive", inactive, "Suspended / pending", "red"],
      ["This week", accounts.filter((item) => item.created_at && new Date(item.created_at).getTime() >= weekAgo).length, "Recently added", "gold"],
    ];
  }, [accounts, adminDashboard, isAdmin]);

  function handleLogout() { logout(); navigate("/access/login"); }

  return (
    <div className={isAdmin ? "ap-shell ap-admin-dashboard" : "ap-shell"}>
      <aside className="ap-sidebar">
        <div className="ap-brand">
          <span className="ap-brand__mark">A</span>
          <div><strong>Access</strong><small>{isAdmin ? "ADMIN" : "AGENCY"}</small></div>
        </div>
        <nav className="ap-nav">
          <small>Overview</small>
          <Link className="ap-nav__link ap-nav__link--active" to="/access/dashboard"><LayoutDashboard />Dashboard</Link>
          {isAdmin ? <>
            <small>Access Control</small>
            <Link className="ap-nav__link" to="/access/accounts"><Users />User Management</Link>
            <Link className="ap-nav__link" to="/access/users"><CircleUserRound />Create User</Link>
            <Link className="ap-nav__link" to="/access/finance"><WalletCards />Permissions & Wallets</Link>
            <Link className="ap-nav__link" to="/access/notice"><Megaphone />Notice</Link>
            <Link className="ap-nav__link" to="/access/agencies"><Building2 />Create Agency</Link>
            <small>Infrastructure</small>
            <Link className="ap-nav__link" to="/access/session-centers"><Server />Session Centers</Link>
            <Link className="ap-nav__link" to="/access/section-rules"><FileSliders />Section Rules</Link>
            <Link className="ap-nav__link" to="/access/result-verification"><SearchCheck />Result Verification</Link>
          </> : <>
            <small>Agency</small>
            <Link className="ap-nav__link" to="/access/users"><Users />My Users</Link>
          </>}
        </nav>
        <div className="ap-sidebar__foot">Access Control v2</div>
      </aside>

      <main className="ap-main">
        <header className="ap-topbar">
          <div>
            <small>{isAdmin ? "ADMIN CONSOLE" : "AGENCY CONSOLE"}</small>
            <strong>Welcome back, {user?.name || "User"}</strong>
          </div>
          <div className="ap-account">
            <div className="ap-live-controls">
              <LiveClock />
              <button
                className={`ap-live-toggle ${autoRefresh ? "ap-live-toggle--on" : ""}`}
                onClick={() => setAutoRefresh(!autoRefresh)}
                title={autoRefresh ? "Auto-refresh ON (30s)" : "Auto-refresh OFF"}
              >
                <RefreshCw className={refreshing ? "ap-spinning" : ""} />
                <span>{autoRefresh ? "Live" : "Paused"}</span>
              </button>
              <button className="ap-refresh-btn" onClick={() => void load(false)} disabled={refreshing} title="Refresh now">
                <RefreshCw className={refreshing ? "ap-spinning" : ""} />
              </button>
            </div>
            <span className={`ap-role ap-role--${isAdmin ? "admin" : "agency"}`}>{user?.role}</span>
            <span className="ap-avatar">{initials(user?.name)}</span>
            <div><strong>{user?.name}</strong><small>{user?.email}</small></div>
            <button onClick={handleLogout}><LogOut />Logout</button>
          </div>
        </header>

        <section className="ap-hero">
          <span className="ap-hero__ring ap-hero__ring--one" />
          <span className="ap-hero__ring ap-hero__ring--two" />
          <div className="ap-eyebrow"><ShieldCheck />{isAdmin ? "SYSTEM ADMINISTRATOR" : "AGENCY WORKSPACE"}</div>
          <h1>{isAdmin ? "Admin command centre for accounts, agencies and live operations." : "Manage your team of exam-booking users with confidence."}</h1>
          <p>{isAdmin ? "Monitor the portal at a glance, then jump directly into account, agency, finance and infrastructure controls." : "Create users, monitor account health and keep your agency team ready."}</p>
          <div className="ap-hero__actions">
            {isAdmin ? (
              <>
                <Link className="ap-btn ap-btn--gold" to="/access/agencies"><Plus />New Agency</Link>
                <Link className="ap-btn" to="/access/users"><Plus />New User</Link>
                <Link className="ap-btn" to="/access/accounts">Manage Accounts</Link>
              </>
            ) : (
              <Link className="ap-btn ap-btn--gold" to="/access/users"><Plus />Add User</Link>
            )}
          </div>
        </section>

        {error && <div className="ap-error">{error}</div>}

        <section className="ap-stats">
          {stats.map(([label, value, note, tone]) => (
            <article className="ap-stat" key={String(label)}>
              <small>{label}</small>
              <strong className={`ap-tone--${tone}`}>{loading ? "..." : value}</strong>
              <span>{note}</span>
            </article>
          ))}
        </section>

        {isAdmin && (
          <section className="ap-infra">
            <Link className="ap-infra__card" to="/access/session-centers">
              <Server /><div><small>SESSION CENTERS</small><strong>Manage</strong></div>
            </Link>
            <Link className="ap-infra__card" to="/access/section-rules">
              <FileSliders /><div><small>SECTION RULES</small><strong>Configure</strong></div>
            </Link>
            <Link className="ap-infra__card" to="/access/test-centers">
              <Database /><div><small>TEST CENTERS</small><strong>Review</strong></div>
            </Link>
          </section>
        )}

        {isAdmin && adminDashboard && (
          <>
            <section className="ap-panel ap-agency-overview">
              <header>
                <div><small>AGENCY OWNERSHIP</small><h2>Agency users and SVP activity</h2></div>
                <span className="ap-live-note">
                  Live sync {adminDashboard.live.syncedAccounts}/{adminDashboard.live.sessionAccounts}
                  {adminDashboard.live.truncated ? " (latest 50)" : ""} - {formatDate(adminDashboard.live.refreshedAt)}
                </span>
              </header>
              <div className="ap-agency-list">
                {adminDashboard.agencies.map((agency) => (
                  <details className="ap-agency-card" key={agency.id}>
                    <summary>
                      <div><strong>{agency.name}</strong><small>{agency.email} - {formatDate(agency.createdAt || undefined)}</small></div>
                      <span><b>{agency.userCount}</b> users</span>
                      <span><b>{agency.activeSvpCount ?? 0}</b> SVP active</span>
                      <span><b>{agency.completedBookings}</b> booked</span>
                      <span><b>{agency.pendingBookings ?? 0}</b> pending</span>
                      <span><b>{agency.failedBookings ?? 0}</b> failed</span>
                      <span><b>{(agency.totalWalletBalance ?? 0).toFixed(1)}</b> credits</span>
                    </summary>
                    <div className="ap-agency-users">
                      <div className="ap-agency-user ap-agency-user--head">
                        <span>User</span><span>SVP Accounts</span><span>Recent Bookings</span><span>Failed</span><span>Payments</span><span>Balance</span><span>Status</span>
                      </div>
                      {agency.users.map((u) => (
                        <div className="ap-agency-user" key={u.id}>
                          <span><strong>{u.name}</strong><small>{u.email}{u.phone ? ` · ${u.phone}` : ""}</small></span>
                          <span className="ap-svp-logins">
                            {u.svpLogins?.length ? u.svpLogins.slice(0, 2).map((svp) => (
                              <small key={svp.login} className={`ap-svp-login-badge ${svp.active ? "ap-svp-login-badge--active" : "ap-svp-login-badge--expired"}`}>
                                {svp.login}
                                {svp.expiresAt && <span className="ap-svp-expiry">{new Date(svp.expiresAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}</span>}
                              </small>
                            )) : <small className="ap-muted">No SVP</small>}
                            {(u.svpLogins?.length ?? 0) > 2 && <small className="ap-svp-more">+{(u.svpLogins?.length ?? 0) - 2}</small>}
                          </span>
                          <span className="ap-booking-list">
                            {u.recentReservations?.length ? u.recentReservations.slice(-3).reverse().map((r) => (
                              <span key={r.id} className={`ap-booking-item ${r.completed ? "ap-booking-item--done" : "ap-booking-item--pending"}`}>
                                <small className="ap-booking-id">#{r.id}</small>
                                <small className="ap-booking-status">{r.completed ? "OK" : r.status.slice(0, 6)}</small>
                              </span>
                            )) : <small className="ap-muted">No bookings</small>}
                          </span>
                          <span className="ap-booking-stats">
                            {u.failedBookings > 0 ? <b className="ap-tone--red">{u.failedBookings}</b> : <b>-</b>}
                          </span>
                          <span className="ap-booking-stats">
                            <b>{u.paidPayments}/{u.totalPayments}</b>
                          </span>
                          <span className="ap-wallet-balance">
                            <b>{u.walletBalance != null ? u.walletBalance.toFixed(1) : "-"}</b>
                          </span>
                          <span className={`ap-status ap-status--${u.status === "ACTIVE" ? "active" : "inactive"}`}>{u.status}</span>
                        </div>
                      ))}
                      {!agency.users.length && <p className="ap-muted">No users yet.</p>}
                    </div>
                  </details>
                ))}
                {!adminDashboard.agencies.length && <p className="ap-muted">No agencies found.</p>}
              </div>
            </section>

            <section className="ap-panel ap-payment-activity">
              <header>
                <div><small>SVP LIVE PAYMENTS</small><h2>Recent payment activity</h2></div>
                <div className="ap-live-note-group">
                  <span className="ap-booking-cost-badge">
                    Per booking: <strong>{(adminDashboard.bookingCreditCost ?? 0).toFixed(2)} credits</strong>
                  </span>
                  {adminDashboard.live.syncFailures > 0 && (
                    <span className="ap-sync-warning">{adminDashboard.live.syncFailures} expired session(s)</span>
                  )}
                </div>
              </header>
              <div className="ap-payment-table">
                <div className="ap-payment-row ap-payment-row--head">
                  <span>Account</span><span>Agency</span><span>Reservation</span><span>Amount</span><span>Date</span><span>Status</span>
                </div>
                {adminDashboard.recentPayments.map((p) => (
                  <div className="ap-payment-row" key={`${p.svpLogin}:${p.id}`}>
                    <span><strong>{p.accountName}</strong><small>{p.svpLogin}</small></span>
                    <span>{p.agencyName || "Independent"}</span>
                    <span>#{p.reservationId || "-"}</span>
                    <b>{p.amount == null ? "-" : `${p.amount.toFixed(2)} ${p.currency || ""}`}</b>
                    <time>{formatDate(p.createdAt || undefined)}</time>
                    <span className={`ap-status ap-status--${p.paid ? "active" : "inactive"}`}>{p.status}</span>
                  </div>
                ))}
                {!adminDashboard.recentPayments.length && <p className="ap-muted">No payment activity available.</p>}
              </div>
            </section>

            <section className="ap-panel ap-payment-activity">
              <header>
                <div><small>BOOKING HISTORY</small><h2>All reservations by SVP login</h2></div>
              </header>
              <div className="ap-payment-table">
                <div className="ap-payment-row ap-payment-row--head">
                  <span>SVP Login</span><span>Reservation ID</span><span>Status</span><span>Completed</span><span>Date</span>
                </div>
                {adminDashboard.agencies.flatMap((agency) =>
                  agency.users.flatMap((user) =>
                    (user.recentReservations || []).map((r) => ({
                      ...r,
                      svpLogin: user.svpLogins?.[0]?.login || user.email,
                      userName: user.name,
                      agencyName: agency.name,
                    }))
                  )
                ).sort((a, b) => {
                  const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                  const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                  return dateB - dateA;
                }).slice(0, 20).map((r) => (
                  <div className="ap-payment-row" key={`${r.svpLogin}:${r.id}`}>
                    <span><strong>{r.userName}</strong><small>{r.svpLogin}</small></span>
                    <span>#{r.id}</span>
                    <span className={`ap-status ap-status--${r.completed ? "active" : r.status.toLowerCase().includes("fail") || r.status.toLowerCase().includes("cancel") ? "inactive" : ""}`}>{r.status}</span>
                    <span>{r.completed ? "Yes" : "No"}</span>
                    <time>{formatDate(r.createdAt || undefined)}</time>
                  </div>
                ))}
                {!adminDashboard.agencies.some((a) => a.users.some((u) => u.recentReservations?.length)) && (
                  <p className="ap-muted">No reservation activity available.</p>
                )}
              </div>
            </section>
          </>
        )}

        <section className="ap-grid">
          <article className="ap-panel ap-list">
            <header>
              <div><small>RECENT ACTIVITY</small><h2>{isAdmin ? "Recently created accounts" : "Your agency users"}</h2></div>
              <Link to={isAdmin ? "/access/accounts" : "/access/users"}>View all</Link>
            </header>
            {loading ? (
              <p className="ap-muted">Loading accounts...</p>
            ) : accounts.slice(0, 6).map((item) => (
              <div className="ap-row" key={item.id}>
                <span className="ap-row__avatar">{initials(item.name)}</span>
                <div><strong>{item.name}</strong><small>{item.email}{item.phone ? ` - ${item.phone}` : ""}</small></div>
                <span className="ap-row__role">{item.role}</span>
                <time>{formatDate(item.created_at)}</time>
                <span className={`ap-status ap-status--${item.status === "ACTIVE" ? "active" : "inactive"}`}>{item.status}</span>
              </div>
            ))}
            {!loading && !accounts.length && <p className="ap-muted">No accounts found.</p>}
          </article>

          <aside className="ap-panel ap-quick">
            <small>SHORTCUTS</small>
            <h2>Quick Actions</h2>
            {isAdmin && (
              <>
                <Link to="/access/accounts"><Users />User Management</Link>
                <Link to="/access/agencies"><Building2 />Create Agency</Link>
                <Link to="/access/finance"><WalletCards />Permissions & Wallets</Link>
              </>
            )}
            <Link to="/access/users"><Users />{isAdmin ? "Create User" : "Manage Users"}</Link>
            <div className="ap-self">
              <Activity />
              <div>
                <small>YOUR ACCOUNT</small>
                <strong>{user?.status}</strong>
                <span>{user?.email}</span>
              </div>
            </div>
          </aside>
        </section>
      </main>
    </div>
  );
}
