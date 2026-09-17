import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarCheck, CalendarDays, CheckCircle2, Clock3, MapPin, Save, Users } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { useTakamolAuth } from "@/contexts/TakamolAuthContext";
import {
  getCategories,
  getCenters,
  getDates,
  getSessions,
  getReservation,
  type TakamolCategory,
  type TakamolCenter,
  type TakamolDatesResult,
  type TakamolSession,
} from "@/lib/takamol-api";

const LANGUAGES = [
  ["LOANN", "English (LOANN)"],
  ["LOANN", "Nepali (LOANN)"],
  ["LOAAR", "Arabic (LOAAR)"],
  ["LOBEN", "Bengali (LOBEN)"],
] as const;

function listFrom<T = any>(value: any, keys: string[]): T[] {
  if (Array.isArray(value)) return value;
  for (const key of keys) if (Array.isArray(value?.[key])) return value[key];
  return [];
}

function dateValue(row: any): string {
  if (typeof row === "string") return row;
  return String(row?.date || row?.exam_date || row?.start_date || row?.value || "");
}

function centerKey(center: any): string {
  return String(center?.id ?? center?.site_id ?? center?.test_center_id ?? center?.name ?? center?.city ?? "");
}

function sessionCenterKey(session: any): string {
  const center = session?.test_center || session?.center || {};
  return String(
    session?.test_center_id ?? session?.site_id ?? center?.id ?? center?.site_id ?? center?.test_center_id ?? center?.name ?? center?.city ?? ""
  );
}

function centerName(center: any): string {
  return String(center?.name || center?.test_center_name || center?.title || center?.city || "Live SVP Test Centre");
}

function sessionLabel(session: TakamolSession): string {
  return String(session?.name || session?.title || session?.slot || session?.start_time || session?.start_date || session?.exam_date || "Available session");
}

export default function TakamolBookingPage() {
  const { loggedIn, refresh } = useTakamolAuth();
  const [searchParams] = useSearchParams();
  const [categories, setCategories] = useState<TakamolCategory[]>([]);
  const [categoryId, setCategoryId] = useState(searchParams.get("category_id") || "");
  const [datesRes, setDatesRes] = useState<TakamolDatesResult | null>(null);
  const [centers, setCenters] = useState<TakamolCenter[]>([]);
  const [city, setCity] = useState("");
  const [date, setDate] = useState("");
  const [centerId, setCenterId] = useState("");
  const [sessions, setSessions] = useState<TakamolSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [language, setLanguage] = useState("LOANN");
  const [passportNumber, setPassportNumber] = useState("");
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const selectedCategory = useMemo(() => categories.find((item) => String(item.id) === String(categoryId)), [categories, categoryId]);
  const availableCities = useMemo(() => Array.from(new Set((datesRes?.cities || []).filter(Boolean).map(String))), [datesRes]);
  const availableDates = useMemo(() => {
    const values = (datesRes?.dates || []).map(dateValue).filter(Boolean);
    return Array.from(new Set(values));
  }, [datesRes]);
  const selectedCenter = useMemo(() => centers.find((item) => centerKey(item) === centerId) || null, [centers, centerId]);
  const centerSessions = useMemo(() => {
    if (!centerId) return sessions.filter((s) => s.resolved === true);
    return sessions.filter((item) => {
      const key = sessionCenterKey(item);
      const matchesCenter = key === centerId || key.toLowerCase() === centerName(selectedCenter).toLowerCase();
      return matchesCenter && item.resolved === true;
    });
  }, [centerId, selectedCenter, sessions]);

  const loadCategories = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await getCategories();
      setCategories(listFrom<TakamolCategory>(response, ["categories", "data"]));
    } catch (err: any) {
      setError(err?.message || "Failed to load occupations");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadCategories(); }, [loadCategories]);

  const selectCategory = useCallback(async (value: string) => {
    setCategoryId(value);
    setCity("");
    setDate("");
    setCenterId("");
    setSessions([]);
    setSelectedSessionId("");
    setDatesRes(null);
    setCenters([]);
    setError(null);
    setOk(null);
    if (!value) return;
    setLoading(true);
    try {
      const response = await getDates({ category_id: Number(value) });
      setDatesRes(response);
    } catch (err: any) {
      setError(err?.message || "Failed to load cities for this occupation");
    } finally {
      setLoading(false);
    }
  }, []);

  const selectCity = useCallback(async (value: string) => {
    setCity(value);
    setDate("");
    setCenterId("");
    setSelectedSessionId("");
    setSessions([]);
    setCenters([]);
    setDatesRes(null);
    setError(null);
    if (!value || !categoryId) return;
    setLoading(true);
    try {
      const body = { category_id: Number(categoryId), city: value };
      const centerResponse = await getCenters(body);
      const centerList = listFrom<TakamolCenter>(centerResponse, ["centers", "data"]);
      setCenters(centerList);
    } catch (err: any) {
      setError(err?.message || "Failed to load test centres");
    } finally {
      setLoading(false);
    }
  }, [categoryId]);

  const selectCenter = useCallback(async (value: string) => {
    setCenterId(value);
    setSelectedSessionId("");
    setSessions([]);
    setDatesRes(null);
    setDate("");
    setError(null);
    if (!value || !categoryId || !city) return;
    setLoading(true);
    try {
      const body = { category_id: Number(categoryId), city, test_center_id: value };
      const response = await getDates(body);
      setDatesRes(response);
    } catch (err: any) {
      setError(err?.message || "Failed to load exam dates for this centre");
    } finally {
      setLoading(false);
    }
  }, [categoryId, city]);

  const selectDate = useCallback(async (value: string) => {
    setDate(value);
    setSelectedSessionId("");
    setSessions([]);
    setError(null);
    if (!value || !categoryId || !city || !centerId) return;
    setSearching(true);
    try {
      const body = { category_id: Number(categoryId), city, exam_date: value, test_center_id: centerId };
      const sessionResponse = await getSessions(body);
      const sessionList = listFrom<TakamolSession>(sessionResponse, ["sessions", "data"]);
      const verifiedSessions = sessionList.filter((s: any) => s.resolved === true);
      setSessions(verifiedSessions);
    } catch (err: any) {
      setError(err?.message || "Failed to load sessions");
    } finally {
      setSearching(false);
    }
  }, [categoryId, city, centerId]);

  const submitReservation = useCallback(async () => {
    if (!selectedSessionId || !passportNumber.trim()) {
      setError("Select an available session and enter a passport number.");
      return;
    }
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const response = await getReservation({
        category_id: Number(categoryId),
        city,
        exam_date: date,
        test_center_id: centerId,
        session_id: selectedSessionId,
        language,
        passport_number: passportNumber.trim().toUpperCase(),
        nationality: "BGD",
      });
      setOk(typeof response === "string" ? response : "Reservation request completed successfully.");
    } catch (err: any) {
      setError(err?.message || "Reservation failed. Please verify the live portal session.");
    } finally {
      setBusy(false);
    }
  }, [categoryId, city, date, centerId, language, passportNumber, selectedSessionId]);

  return (
    <div className="tk-container tk-booking-page" style={{ padding: 0 }}>
      <section className="tk-hero tk-booking-hero">
        <div className="tk-card-header">
          <div>
            <p className="tk-eyebrow">TAKAMOL SVP BOOKING</p>
            <h1>Find Exam Center</h1>
            <p>Only test centres with an available session on the selected date are shown.</p>
          </div>
          <span className={loggedIn ? "tk-badge tk-badge--ok" : "tk-badge tk-badge--warn"}>{loggedIn ? "Live session" : "Login required"}</span>
        </div>
        <div className="tk-hero-actions">
          {!loggedIn && <a className="tk-btn tk-btn--gold" href="/auth/login">Sign in to SVP candidate account</a>}
          <button type="button" className="tk-btn tk-btn--sm" onClick={() => refresh()}><CalendarCheck size={14} /> Refresh portal status</button>
        </div>
      </section>

      {error && <div className="tk-msg tk-msg--error">{error}</div>}
      {ok && <div className="tk-msg tk-msg--ok"><CheckCircle2 size={16} /> {ok}</div>}

      <section className="tk-card tk-booking-card">
        <div className="tk-step-heading"><span>01</span><div><p className="tk-eyebrow">METHODOLOGY</p><strong>in_person</strong></div></div>
        <div className="tk-field"><label htmlFor="occupation">Occupation <b>*</b></label><select id="occupation" value={categoryId} onChange={(event) => selectCategory(event.target.value)} disabled={loading}><option value="">Select Occupation</option>{categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
        {selectedCategory && <p className="tk-selection-note">Selected occupation: <strong>{selectedCategory.name}</strong></p>}
        <div className="tk-field"><label htmlFor="city">City <b>*</b></label><select id="city" value={city} onChange={(event) => selectCity(event.target.value)} disabled={!categoryId || loading}><option value="">Select City</option>{availableCities.map((item) => <option key={item} value={item}>{item}</option>)}</select></div>

        <div className="tk-field"><label htmlFor="test-centre"><MapPin size={14} /> Test Centre <b>*</b></label><select id="test-centre" value={centerId} onChange={(event) => selectCenter(event.target.value)} disabled={!city || loading || !centers.length}><option value="">{loading ? "Loading centres..." : "Select Test Centre"}</option>{centers.map((item) => <option key={centerKey(item)} value={centerKey(item)}>{centerName(item)}{item.city ? ` — ${item.city}` : ""}</option>)}</select></div>

        <div className="tk-field"><label htmlFor="exam-date">Available Date <b>*</b></label><select id="exam-date" value={date} onChange={(event) => selectDate(event.target.value)} disabled={!centerId || loading}><option value="">Select Date</option>{availableDates.map((item) => <option key={item} value={item}>{item}</option>)}</select></div>

        {selectedCenter && <p className="tk-live-centre">Selected centre: <strong>{centerName(selectedCenter)}</strong>{selectedCenter.id ? ` · ID ${selectedCenter.id}` : ""}{selectedCenter.city ? ` · ${selectedCenter.city}` : ""}</p>}

        <div className="tk-field"><label htmlFor="available-session"><Clock3 size={14} /> Available Sessions <b>*</b></label><select id="available-session" value={selectedSessionId} onChange={(event) => setSelectedSessionId(event.target.value)} disabled={!date || searching || !centerSessions.length}><option value="">{searching ? "Loading sessions..." : "Select Session"}</option>{centerSessions.map((item, index) => { const id = String(item.id ?? item.session_id ?? item.sessionId ?? index); return <option key={id} value={id}>{sessionLabel(item)}{item.status ? ` — ${item.status}` : ""}{item.available_seats != null ? ` (${item.available_seats} seats)` : ""}</option>; })}</select><p className="tk-help"><Users size={14} /> {centerSessions.length ? `${centerSessions.length} verified session${centerSessions.length === 1 ? "" : "s"}` : "Select a date to load sessions."}</p></div>

        <div className="tk-field"><label htmlFor="language">Language <b>*</b></label><select id="language" value={language} onChange={(event) => setLanguage(event.target.value)}><option value="">Select Language</option>{LANGUAGES.map(([value, label]) => <option key={`${value}-${label}`} value={value}>{label}</option>)}</select></div>
      </section>

      <section className="tk-card tk-booking-card tk-reservation-card">
        <div className="tk-step-heading"><span>02</span><div><p className="tk-eyebrow">SECURE BOOKING</p><strong>Candidate details</strong></div></div>
        <div className="tk-grid tk-grid-2"><div className="tk-field"><label htmlFor="passport">Passport number <b>*</b></label><input id="passport" value={passportNumber} onChange={(event) => setPassportNumber(event.target.value.toUpperCase())} placeholder="Enter passport number" /></div><div className="tk-field"><label>Selected session</label><input value={selectedSessionId || "No session selected"} readOnly /></div></div>
        <button type="button" className="tk-btn tk-btn--gold" onClick={submitReservation} disabled={busy || !selectedSessionId}><Save size={16} /> {busy ? "Reserving..." : "Continue to booking"}</button>
      </section>
    </div>
  );
}
