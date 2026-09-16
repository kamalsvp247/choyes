import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, LockKeyhole, Mail, RefreshCw, ShieldCheck, Smartphone } from "lucide-react";
import { apiAuth } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { clearPendingAuth, getPendingAuth, setPendingAuth } from "@/lib/pending-auth";
import "@/styles/otp-page.css";

type MessageType = "info" | "ok" | "error";
type AuthError = {
  data?: {
    message?: string;
    details?: { errors?: { otp_attempt_invalid?: { en?: string } } };
  };
  message?: string;
};

export default function OtpPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { login: authLogin } = useAuth();
  const otpInputRef = useRef<HTMLInputElement>(null);

  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [otpMethod, setOtpMethod] = useState("email");
  const [requestId, setRequestId] = useState("");
  const [otpAttempt, setOtpAttempt] = useState("");
  const [msg, setMsg] = useState("");
  const [msgType, setMsgType] = useState<MessageType>("info");
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);

  useEffect(() => {
    const pending = getPendingAuth();
    const queryLogin = searchParams.get("login");
    const queryOtpMethod = searchParams.get("otpMethod");
    const queryRequestId = searchParams.get("requestId");
    setLogin(queryLogin || pending?.login || "");
    setPassword(pending?.password || "");
    setOtpMethod(queryOtpMethod || pending?.otpMethod || "email");
    setRequestId(queryRequestId || pending?.requestId || "");
    otpInputRef.current?.focus();
  }, [searchParams]);

  function getErrorMessage(err: unknown) {
    const error = err as AuthError;
    const otpInvalidMessage = error?.data?.details?.errors?.otp_attempt_invalid?.en;
    if (otpInvalidMessage) {
      return `${otpInvalidMessage} Please resend and use only the newest code.`;
    }
    return error?.data?.message || error?.message || "OTP verification failed";
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();

    if (!login || !password || !requestId) {
      setMsg("Your sign-in session has expired. Return to sign in and request a new code.");
      setMsgType("error");
      return;
    }

    setVerifying(true);
    setMsg("Checking your verification code\u2026");
    setMsgType("info");

    try {
      const res = await apiAuth("/otp-verify", {
        login,
        password,
        otp_attempt: otpAttempt,
        otp_method: otpMethod,
        request_id: requestId,
      });
      authLogin(res.accessToken, res.user || res);
      clearPendingAuth();
      setMsg("Verified. Taking you to your dashboard\u2026");
      setMsgType("ok");
      navigate("/dashboard");
    } catch (err: unknown) {
      setMsg(getErrorMessage(err));
      setMsgType("error");
    } finally {
      setVerifying(false);
    }
  }

  async function resendOtp() {
    if (!login || !password) {
      setMsg("Your sign-in session has expired. Return to sign in and request a new code.");
      setMsgType("error");
      return;
    }

    setResending(true);
    setMsg("Sending a fresh verification code\u2026");
    setMsgType("info");

    try {
      const nextRequestId = crypto.randomUUID();
      const response = await apiAuth<{ requestId?: string }>("/login", {
        login,
        password,
        otp_method: otpMethod,
        request_id: nextRequestId,
      });
      const persistedRequestId = response?.requestId || nextRequestId;
      setRequestId(persistedRequestId);
      setPendingAuth({ login, password, otpMethod, requestId: persistedRequestId });
      setOtpAttempt("");
      setMsg(`A new code was sent by ${otpMethod === "sms" ? "SMS" : "email"}. Use the latest code only.`);
      setMsgType("ok");
      otpInputRef.current?.focus();
    } catch (err: unknown) {
      const error = err as AuthError;
      setMsg(error?.data?.message || error?.message || "Could not resend the verification code");
      setMsgType("error");
    } finally {
      setResending(false);
    }
  }

  const DeliveryIcon = otpMethod === "sms" ? Smartphone : Mail;
  const deliveryLabel = otpMethod === "sms" ? "SMS" : "Email";
  const sessionReady = Boolean(login && password && requestId);

  return (
    <div className="otp-bg">
      <div className="otp-orb otp-orb--1" />
      <div className="otp-orb otp-orb--2" />

      <Link className="otp-back" to="/auth/login">
        <ArrowLeft size={16} /> Back to sign in
      </Link>

      <div className="otp-card">
        <div className="otp-icon-ring">
          <div className="otp-icon-circle">
            <ShieldCheck size={32} />
          </div>
        </div>

        <h1 className="otp-title">Verify your identity</h1>
        <p className="otp-subtitle">
          Enter the 6-digit code sent to your {deliveryLabel.toLowerCase()}
        </p>

        <div className="otp-account-bar">
          <div className="otp-account-info">
            <span className="otp-label-tiny">Account</span>
            <strong>{login || "No account"}</strong>
          </div>
          <span className="otp-method-badge">
            <DeliveryIcon size={13} /> {deliveryLabel}
          </span>
        </div>

        <form className="otp-form" onSubmit={verify}>
          <div className="otp-field">
            <label htmlFor="otp-code">Verification code</label>
            <input
              ref={otpInputRef}
              id="otp-code"
              value={otpAttempt}
              onChange={(e) => setOtpAttempt(e.target.value.replace(/\s/g, ""))}
              placeholder="\u2022\u2022\u2022\u2022\u2022\u2022"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={10}
              required
            />
            <small>Codes expire quickly. Use the newest code only.</small>
          </div>

          <button type="submit" className="otp-btn-primary" disabled={verifying || resending || !otpAttempt.trim()}>
            {verifying ? (
              <span className="otp-spinner" />
            ) : (
              <LockKeyhole size={16} />
            )}
            {verifying ? "Verifying\u2026" : "Verify & Continue"}
          </button>
        </form>

        <button
          type="button"
          className="otp-resend-btn"
          onClick={resendOtp}
          disabled={verifying || resending || !sessionReady}
        >
          <RefreshCw size={14} className={resending ? "is-spinning" : ""} />
          {resending ? "Sending\u2026" : "Resend code"}
        </button>

        {msg ? (
          <div className={`otp-msg otp-msg--${msgType}`}>{msg}</div>
        ) : null}

        {!sessionReady ? (
          <p className="otp-expired">
            Session expired. <Link to="/auth/login">Request a new code</Link>.
          </p>
        ) : null}
      </div>

      <p className="otp-footer">&copy; {new Date().getFullYear()} FlyDuronto.com &middot; SVP Accreditation</p>
    </div>
  );
}
