import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Link } from "react-router-dom";
import { apiAuth, apiAuthGet } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { getPendingAuth, setPendingAuth } from "@/lib/pending-auth";
import "@/styles/auth-premium.css";
import "@/styles/login-verification.css";

export default function LoginPage() {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [otpMethod, setOtpMethod] = useState("email");
  const [msg, setMsg] = useState("");
  const [msgType, setMsgType] = useState<"info" | "ok" | "error">("info");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [mode, setMode] = useState<"otp" | "token">("otp");

  const [tokenLogin, setTokenLogin] = useState("");
  const [svpToken, setSvpToken] = useState("");
  const [tokenMsg, setTokenMsg] = useState("");
  const [tokenMsgType, setTokenMsgType] = useState<"info" | "ok" | "error">("info");
  const [tokenSubmitting, setTokenSubmitting] = useState(false);

  const [occQuery, setOccQuery] = useState("");
  const [allOccupations, setAllOccupations] = useState<any[]>([]);
  const [occupationsLoaded, setOccupationsLoaded] = useState(false);
  const [occLoading, setOccLoading] = useState(false);
  const [occOpen, setOccOpen] = useState(false);
  const [occSelected, setOccSelected] = useState<{ occupation_key: string; name: string } | null>(null);
  const [occError, setOccError] = useState("");
  const [passportNumber, setPassportNumber] = useState("");
  const [nationality, setNationality] = useState("BGD");
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyError, setVerifyError] = useState("");
  const [verifyResult, setVerifyResult] = useState<any>(null);

  const navigate = useNavigate();
  const { login: authLogin } = useAuth();

  useEffect(() => {
    const pending = getPendingAuth();
    const portalLogin = sessionStorage.getItem("portal_login") || "";
    setLogin(pending?.login || portalLogin);
    setPassword(pending?.password || "");
    if (pending?.otpMethod) setOtpMethod(pending.otpMethod);
    if (pending?.login) setTokenLogin(pending.login);
  }, []);

  // Restore previously selected occupation from sessionStorage
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem("selected_occupation");
      if (saved) setOccSelected(JSON.parse(saved));
    } catch { /* ignore */ }
  }, []);

  // Load the complete occupation catalogue once. The live API returns 297 records
  // when `name` is omitted, while short partial `name` filters can return no rows.
  useEffect(() => {
    let active = true;
    setOccLoading(true);
    setOccError("");
    apiAuthGet<any>("/registration/occupations?per_page=1000")
      .then((data) => {
        if (!active) return;
        const list = Array.isArray(data)
          ? data
          : Array.isArray(data?.occupations)
            ? data.occupations
            : Array.isArray(data?.data)
              ? data.data
              : Array.isArray(data?.data?.occupations)
                ? data.data.occupations
                : Array.isArray(data?.items)
                  ? data.items
                  : [];
        setAllOccupations(list);
        setOccupationsLoaded(true);
      })
      .catch((err: any) => {
        if (active) setOccError(err?.message || "Failed to load occupations");
      })
      .finally(() => {
        if (active) setOccLoading(false);
      });
    return () => { active = false; };
  }, []);

  const occupationQuery = occQuery.trim().toLowerCase();
  const visibleOccupations = allOccupations.filter((occ) => {
    const name = String(occ.name || occ.english_name || occ.label || "").toLowerCase();
    const key = String(occ.occupation_key || occ.occupationKey || occ.id || "").toLowerCase();
    return !occupationQuery || name.includes(occupationQuery) || key.includes(occupationQuery);
  }).slice(0, 20);

  function handleOccSelect(occ: any) {
    const key = String(occ.occupation_key || occ.occupationKey || occ.id || "");
    const name = String(occ.name || occ.english_name || occ.label || key);
    setOccSelected({ occupation_key: key, name });
    sessionStorage.setItem("selected_occupation", JSON.stringify({ occupation_key: key, name }));
    setOccOpen(false);
    setOccQuery("");
  }

  function findValue(value: any, names: string[]): string {
    const queue = [value];
    while (queue.length) {
      const current = queue.shift();
      if (!current || typeof current !== "object") continue;
      for (const [key, item] of Object.entries(current)) {
        if (names.includes(key) && item != null && item !== "") return String(item);
        if (item && typeof item === "object") queue.push(item);
      }
    }
    return "";
  }

  async function verifyApplicant(event: React.FormEvent) {
    event.preventDefault();
    if (!occSelected) { setVerifyError("Search for and select an occupation first."); return; }
    setVerifyLoading(true); setVerifyError(""); setVerifyResult(null);
    try {
      const response = await apiAuth<any>("/result-verification", {
        passportNumber,
        occupationKey: occSelected.occupation_key,
        nationalityId: nationality,
      });
      setVerifyResult(response.result ?? response);
    } catch (err: any) {
      setVerifyError(err?.data?.message || err?.message || "Could not verify this applicant.");
    } finally { setVerifyLoading(false); }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setMsg("Sending OTP...");
    setMsgType("info");
    try {
      const requestId = crypto.randomUUID();
      const response = await apiAuth<{ requestId?: string }>("/login", {
        login,
        password,
        otp_method: otpMethod,
        request_id: requestId,
      });
      setPendingAuth({
        login,
        password,
        otpMethod,
        requestId: response?.requestId || requestId,
      });
      setMsg("OTP sent. Check your email or SMS.");
      setMsgType("ok");
      navigate("/auth/otp");
    } catch (err: any) {
      const detail = err?.data?.message || err?.data?.error || err?.message || "Login failed";
      setMsg(typeof detail === "string" ? detail : JSON.stringify(detail));
      setMsgType("error");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitToken(e: React.FormEvent) {
    e.preventDefault();
    setTokenSubmitting(true);
    setTokenMsg("Verifying bearer token...");
    setTokenMsgType("info");
    try {
      const res = await apiAuth("/token-login", { login: tokenLogin, token: svpToken });
      authLogin(res.accessToken, res.user || res);
      setTokenMsg("Login successful. Redirecting...");
      setTokenMsgType("ok");
      navigate("/dashboard");
    } catch (err: any) {
      const detail = err?.data?.message || err?.data?.error || err?.message || "Token login failed";
      setTokenMsg(typeof detail === "string" ? detail : JSON.stringify(detail));
      setTokenMsgType("error");
    } finally {
      setTokenSubmitting(false);
    }
  }

  return (
    <main className="ap-shell ap-login-shell">
      {/* Left – Brand showcase */}
      <aside className="ap-brand-panel">
        <div className="ap-brand-head">
          <div className="ap-brand-mark">S</div>
          <div className="ap-brand-title">
            <strong>SVP Accreditation</strong>
            <span>Labor exam portal</span>
          </div>
        </div>

        <div className="ap-brand-copy">
          <span className="ap-brand-eyebrow">Verified access · SVP live</span>
          <h2>Sign in to your <em>professional</em> accreditation account</h2>
          <p>Manage bookings, review reservations and track every payment attempt through the official Saudi Skill Verification Program.</p>
        </div>

        <div className="ap-brand-features">
          <div className="ap-brand-feature">
            <div className="ap-brand-feature-icon">✓</div>
            <div className="ap-brand-feature-copy">
              <strong>Live SVP integration</strong>
              <span>Real-time OTP delivery and session tokens.</span>
            </div>
          </div>
          <div className="ap-brand-feature">
            <div className="ap-brand-feature-icon">◈</div>
            <div className="ap-brand-feature-copy">
              <strong>Secure by design</strong>
              <span>Encrypted transport and short-lived bearer tokens.</span>
            </div>
          </div>
          <div className="ap-brand-feature">
            <div className="ap-brand-feature-icon">☰</div>
            <div className="ap-brand-feature-copy">
              <strong>One place for everything</strong>
              <span>Bookings, reservations and payments in one premium workspace.</span>
            </div>
          </div>
        </div>

        <div className="ap-brand-foot">
          <span>© {new Date().getFullYear()} Accreditation Suite</span>
          <span>Official SVP flow</span>
        </div>
      </aside>

      {/* Centre – SVP sign in */}
      <section className="ap-form-panel">
        <div className="ap-form-card">
          <div className="ap-form-header">
            <h1>Welcome back</h1>
            <p>Sign in with your SVP account. Choose OTP or bearer-token verification below.</p>
          </div>

          <div className="ap-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={mode === "otp"}
              className={`ap-tab${mode === "otp" ? " is-active" : ""}`}
              onClick={() => setMode("otp")}>
              OTP verification
            </button>
            <button type="button" role="tab" aria-selected={mode === "token"}
              className={`ap-tab${mode === "token" ? " is-active" : ""}`}
              onClick={() => setMode("token")}>
              Bearer token
            </button>
          </div>

          {mode === "otp" ? (
            <form className="ap-form" onSubmit={submit}>
              <div className="ap-field">
                <label htmlFor="login-email">Email</label>
                <input id="login-email" type="email" autoComplete="username"
                  value={login} onChange={(e) => setLogin(e.target.value)}
                  placeholder="you@example.com" required />
              </div>

              <div className="ap-field">
                <label htmlFor="login-password">Password</label>
                <div className="ap-input-wrap">
                  <input id="login-password" type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    value={password} onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password" required />
                  <button type="button" className="ap-input-toggle" aria-label="Toggle password"
                    onClick={() => setShowPassword((v) => !v)}>
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
              </div>

              <div className="ap-field">
                <label htmlFor="login-otp">OTP verify option</label>
                <select id="login-otp" value={otpMethod} onChange={(e) => setOtpMethod(e.target.value)}>
                  <option value="email">Email</option>
                  <option value="sms">SMS</option>
                </select>
              </div>

              <button type="submit" className="ap-submit" disabled={submitting}>
                {submitting ? "Sending OTP…" : "Continue with OTP"}
              </button>

              {msg ? (
                <div className={`ap-message${msgType === "error" ? " ap-message--error" : msgType === "ok" ? " ap-message--ok" : ""}`}>
                  {msg}
                </div>
              ) : null}

              <p className="ap-hint">
                New labor applicant? <Link to="/auth/register">Create an SVP account</Link>
              </p>
            </form>
          ) : (
            <form className="ap-form" onSubmit={submitToken}>
              <p className="ap-hint" style={{ textAlign: "left", marginBottom: 4 }}>
                Paste your SVP bearer token from an official login and sign in instantly — no OTP required.
              </p>

              <div className="ap-field">
                <label htmlFor="token-login">Account email</label>
                <input id="token-login" type="email" value={tokenLogin}
                  onChange={(e) => setTokenLogin(e.target.value)}
                  placeholder="you@example.com" required />
              </div>

              <div className="ap-field">
                <label htmlFor="token-value">SVP bearer token</label>
                <textarea id="token-value" rows={4} value={svpToken}
                  onChange={(e) => setSvpToken(e.target.value)}
                  placeholder="Paste bearer token from your official SVP session" required />
              </div>

              <button type="submit" className="ap-submit" disabled={tokenSubmitting}>
                {tokenSubmitting ? "Verifying token…" : "Login with token"}
              </button>

              {tokenMsg ? (
                <div className={`ap-message${tokenMsgType === "error" ? " ap-message--error" : tokenMsgType === "ok" ? " ap-message--ok" : ""}`}>
                  {tokenMsg}
                </div>
              ) : null}

              <p className="ap-hint">
                Don&apos;t have a token? Switch to <button type="button" className="ap-link"
                  style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}
                  onClick={() => setMode("otp")}>OTP verification</button>.
              </p>
            </form>
          )}
        </div>
      </section>

      {/* Right – applicant result verification */}
      <aside className="ap-verify-panel">
        <div className="ap-verify-card">
          <div className="ap-verify-header"><span>SVP LIVE</span><h2>Verify Applicant Result</h2><p>Enter the applicant details and select an occupation to check the current result.</p></div>
          <form className="ap-verify-form" onSubmit={verifyApplicant}>
            <label>Passport No. <b>*</b><input value={passportNumber} onChange={(e) => setPassportNumber(e.target.value.toUpperCase())} placeholder="Passport number" autoComplete="off" required /></label>
            <label>Nationality <b>*</b><select value={nationality} onChange={(e) => setNationality(e.target.value)}><option value="BGD">Bangladesh (BGD)</option><option value="IND">India (IND)</option><option value="PAK">Pakistan (PAK)</option><option value="NPL">Nepal (NPL)</option><option value="PHL">Philippines (PHL)</option></select></label>
              <label>Occupation <b>*</b><div className="ap-occ-input-wrap"><input id="occ-search" type="text" value={occQuery} onFocus={() => setOccOpen(true)} onChange={(e) => { setOccQuery(e.target.value); setOccSelected(null); setOccOpen(true); }} placeholder={occSelected ? occSelected.name : "Search occupation name"} autoComplete="off" required={!occSelected} />{occLoading && <span className="ap-occ-spinner">⌛</span>}{occSelected && !occQuery && <button type="button" className="ap-occ-clear" aria-label="Clear selected occupation" onClick={() => { setOccSelected(null); sessionStorage.removeItem("selected_occupation"); setOccOpen(true); }}>×</button>}</div></label>
              {occError && <div className="ap-message ap-message--error">{occError}</div>}
              {occSelected && <div className="ap-occ-badge"><strong>{occSelected.name}</strong><code>{occSelected.occupation_key}</code></div>}
              {occOpen && occupationsLoaded && <ul className="ap-occ-list">{visibleOccupations.length > 0 ? visibleOccupations.map((occ, i) => { const key = String(occ.occupation_key || occ.occupationKey || occ.id || ""); const name = String(occ.name || occ.english_name || occ.label || key); return <li key={`${key}-${i}`} className="ap-occ-item" onClick={() => handleOccSelect(occ)}><span className="ap-occ-name">{name}</span><code className="ap-occ-key">{key}</code></li>; }) : <li className="ap-occ-item ap-occ-item--empty">No occupations found.</li>}</ul>}
            <button className="ap-verify-submit" type="submit" disabled={verifyLoading}>{verifyLoading ? "Verifying…" : "Verify  →"}</button>
          </form>
          <section className="ap-result-box" aria-live="polite">
            <div className="ap-result-heading">
              <div>
                <span className="ap-result-eyebrow">Verification result</span>
                <h3>Applicant status</h3>
              </div>
              {verifyResult && <span className="ap-result-live"><span className="ap-result-live-dot" />Live response</span>}
            </div>
            {verifyError ? <p className="ap-result-error">{verifyError}</p> : !verifyResult ? (
              <div className="ap-result-empty"><span className="ap-result-empty-icon">⌁</span><p>Complete the form to view the live result.</p></div>
            ) : (() => {
              const rawResult = findValue(verifyResult, ["exam_result", "final_result", "result_status"]);
              const normalizedResult = rawResult.toLowerCase();
              const resultLabel = rawResult ? rawResult.charAt(0).toUpperCase() + rawResult.slice(1) : "—";
              const outcomeClass = normalizedResult === "passed" ? "is-passed" : normalizedResult === "failed" ? "is-failed" : "is-pending";
              return (
                <>
                  <div className={`ap-result-outcome ${outcomeClass}`}>
                    <span className="ap-result-outcome-icon">{normalizedResult === "passed" ? "✓" : "!"}</span>
                    <div className="ap-result-outcome-copy"><span>Exam result</span><strong>{resultLabel}</strong><small>Result received successfully</small></div>
                    <span className="ap-result-outcome-badge">{normalizedResult === "passed" ? "PASSED" : resultLabel.toUpperCase()}</span>
                  </div>
                  <dl className="ap-result-details">
                    <div className="ap-result-detail ap-result-detail--primary"><dt>Applicant name</dt><dd>{findValue(verifyResult, ["full_name", "name", "applicant_name"]) || "—"}</dd></div>
                    <div className="ap-result-detail"><dt>Passport no.</dt><dd>{findValue(verifyResult, ["passport_number"]) || passportNumber}</dd></div>
                    <div className="ap-result-detail"><dt>Occupation</dt><dd>{occSelected?.name || "—"}</dd></div>
                    <div className="ap-result-detail ap-result-detail--wide"><dt>Test center</dt><dd>{findValue(verifyResult, ["test_center_name", "center_name"]) || "—"}</dd></div>
                    <div className="ap-result-detail"><dt>Test date</dt><dd>{findValue(verifyResult, ["test_date", "exam_date", "date"]) || "—"}</dd></div>
                  </dl>
                </>
              );
            })()}
          </section>
        </div>
      </aside>
    </main>
  );
}
