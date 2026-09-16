// Exam Sessions API helpers — mirrors the SVP individual_labor_space Vuex module.
// All requests go through the svp-proxy edge function via `api()`.
//
// NOTE: Paths follow SVP's REST conventions. If a particular endpoint
// returns 404, adjust the path here (single source of truth).

import { api } from "./api";

function qs(params?: Record<string, any>) {
  if (!params) return "";
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "");
  if (!entries.length) return "";
  const usp = new URLSearchParams();
  entries.forEach(([k, v]) => {
    if (Array.isArray(v)) v.forEach((x) => usp.append(k, String(x)));
    else usp.append(k, String(v));
  });
  return `?${usp.toString()}`;
}

const BASE = "/exam_sessions";
const RES = "/exam_reservations";

export const ExamSessionsApi = {
  // Available dates for booking (used by BookingPage)
  getAvailableDatesSvp: (params?: Record<string, any>) =>
    api(`${BASE}/available_dates${qs(params)}`),

  // Listings
  getExamSessions: (params?: Record<string, any>) =>
    api(`${BASE}${qs(params)}`),
  getPrometricExamSessions: (params?: Record<string, any>) =>
    api(`${BASE}/prometric${qs(params)}`),
  getProctorExamSessions: (params?: Record<string, any>) =>
    api(`${BASE}/proctor${qs(params)}`),
  getAssignedExamSessions: (params?: Record<string, any>) =>
    api(`${BASE}/assigned${qs(params)}`),
  getUnassignedSessions: (params?: Record<string, any>) =>
    api(`${BASE}/unassigned${qs(params)}`),

  // Slots & holds
  getAvailableSlots: (params?: Record<string, any>) =>
    api(`${BASE}/available_slots${qs(params)}`),
  createSlotHold: (data: any) =>
    api(`${BASE}/slot_hold`, { method: "POST", body: data }),
  createProctorSlotHold: (data: any) =>
    api(`${BASE}/proctor_slot_hold`, { method: "POST", body: data }),

  // Single session
  getExamSessionById: (id: string | number) =>
    api(`${BASE}/${id}?locale=en`),
  getExamSessionReservations: (id: string | number, params?: Record<string, any>) =>
    api(`${BASE}/${id}/reservations${qs(params)}`),

  // Session lifecycle
  createSession: (data: any) =>
    api(`${BASE}`, { method: "POST", body: data }),
  cancelSessions: (id: string | number, body: { cancellation_reason?: string }) =>
    api(`${BASE}/${id}/cancel`, { method: "POST", body }),

  // Reservation lifecycle
  // Validation inputs stay in the POST body so category_id/condition are not
  // exposed in the browser URL or browser history.
  validateReservationAvailability: (data: {
    category_id: string | number;
    condition?: string;
    locale?: string;
  }) => api("/exam-reservations/validate", { method: "POST", body: data }),
  cancelReservations: (id: string | number, body: { cancellation_reason?: string }) =>
    api(`${RES}/${id}/cancel`, { method: "POST", body }),
  recheduleReservation: (id: string | number, body: any) =>
    api(`${RES}/${id}/reschedule`, { method: "POST", body }),

  // Practical results
  getPracticalResults: (id: string | number) =>
    api(`${BASE}/${id}/practical_results`),
  updatePracticalResult: (data: any) =>
    api(`${BASE}/practical_results`, { method: "PUT", body: data }),
  submitPracticalExamEvaluation: (data: any) =>
    api(`${BASE}/practical_evaluation`, { method: "POST", body: data }),

  // Test taker / start exam
  getTestTakerExamInfo: (params?: Record<string, any>) =>
    api(`${BASE}/test_taker_info${qs(params)}`),
  startExam: (params: any) =>
    api(`${BASE}/start`, { method: "POST", body: params }),

  // Assessor actions
  approveSessionByAssessor: (id: string | number) =>
    api(`${BASE}/${id}/approve_by_assessor`, { method: "POST" }),
  rejectSessionByAssessor: (id: string | number) =>
    api(`${BASE}/${id}/reject_by_assessor`, { method: "POST" }),
  withdrawSessionByAssessor: (id: string | number, body: { withdraw_reason?: string }) =>
    api(`${BASE}/${id}/withdraw_by_assessor`, { method: "POST", body }),

  // Misc
  getExamConstraints: () => api(`${BASE}/constraints`),
  updateExamEvidence: (id: string | number, formData: FormData) =>
    // FormData not supported by the JSON `api()` helper; left as a stub.
    Promise.reject(new Error("updateExamEvidence requires multipart upload — implement when needed")),
};

// ---- Convenience state mirroring the Vuex getters ----

export interface SessionDetailsState {
  category: { exam_type: string };
  status: string;
  labors: Array<{ reservation: { exam_result: string } }>;
}

export function isPendingPracticalVisible(details?: SessionDetailsState | null): boolean {
  if (!details) return false;
  return (
    details.category?.exam_type === "cbt_and_practical" &&
    details.status === "in_progress" &&
    Array.isArray(details.labors) &&
    details.labors.some((i) => i?.reservation?.exam_result === "pending")
  );
}

export default ExamSessionsApi;
