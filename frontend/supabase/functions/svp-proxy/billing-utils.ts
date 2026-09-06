export type ReservationBillingOperation = "booking" | "reschedule";

// ---------------------------------------------------------------------------
// Reservation refund eligibility
// ---------------------------------------------------------------------------
//
// A reservation may be immutable/finalized without being refundable. In
// particular, completed and attended reservations represent a successful
// booking/exam and MUST NEVER be credited back to the wallet.
//
// SVP returns status as a free-form string that the wallet UI shows to the
// user verbatim ("Booking completed", "Payment completed", "Reservation
// succeeded", etc.). We must be defensive against any phrasing that signals a
// successful outcome — the cost of refunding a real booking is much worse
// than the cost of missing a refund we could retry later.
//
// Two sets of patterns drive eligibility:
//
//   * NON_REFUNDABLE  — any status that signals an active or successful booking.
//                       These short-circuit eligibility and return false.
//   * REFUNDABLE      — only refund if the status is explicitly one of these.
//
// The presence of a cancellation timestamp is NOT, by itself, enough to
// refund: a reservation can carry a stale `cancelled_at` while still being
// active upstream. Both signals must point to a refundable outcome.
const NON_REFUNDABLE_RESERVATION_STATUS_RE =
  /active|pending|reserved|hold|scheduled|booked|confirm|processing|paid|succeed|success|complete|attend|finish|done|final|present|issued|approved|accepted|valid/i;
const REFUNDABLE_RESERVATION_STATUS_RE =
  /cancel|expired|no[_\s-]?show|absent|void|fail|declin|reject|error|closed|revoked|terminated|denied/i;

export function getReservationBillingOperation(
  method: string,
  path: string,
): ReservationBillingOperation | null {
  if (method !== "POST") return null;
  if (path === "/exam-reservations") return "booking";
  if (/^\/exam-reservations\/[^/]+\/reschedule$/.test(path)) return "reschedule";
  return null;
}

export function canFinalizeWalletDebit(
  operation: ReservationBillingOperation | null,
  reservationId: string | number | null | undefined,
): boolean {
  return operation !== null && String(reservationId ?? "").trim().length > 0;
}

export function isRefundEligibleReservation(
  status: string | null | undefined,
  cancellationTimestamp?: string | null,
): boolean {
  const normalizedStatus = String(status ?? "").toLowerCase().trim();

  // Status is authoritative when the upstream API supplies a non-empty
  // status. If SVP says "Booking completed" / "Payment succeeded" /
  // "Active" / "Reserved" / etc., the booking succeeded — refuse the
  // refund outright even when a stale cancellation timestamp is present.
  if (normalizedStatus && NON_REFUNDABLE_RESERVATION_STATUS_RE.test(normalizedStatus)) {
    return false;
  }
  // Explicitly refundable status always wins.
  if (normalizedStatus && REFUNDABLE_RESERVATION_STATUS_RE.test(normalizedStatus)) {
    return true;
  }
  // No status available: fall back to the cancellation timestamp, matching
  // the existing live-reservations sweep contract.
  return Boolean(String(cancellationTimestamp ?? "").trim());
}

export function getReservationRefundIdempotencyKey(accountId: string, reservationId: string | number): string {
  return `refund:${accountId}:${String(reservationId).trim()}`;
}

export function isNonRefundableStatus(status: string | null | undefined): boolean {
  const s = String(status ?? "").toLowerCase().trim();
  return /active|pending|reserved|hold|scheduled|booked|confirm|processing|succeed|success|complete|attend|finish|done|paid/.test(s);
}

/**
 * True when the row's status (or absence thereof) makes it safe to refund
 * during an "orphan" sweep — i.e. when SVP has stopped returning the
 * reservation in its list.
 *
 * The conservative default is "do not refund": when status is missing we
 * assume the reservation is still active, because SVP tends to drop rows
 * from `exam-reservations` after the exam date even though the booking was
 * successful.
 */
export function isRefundEligibleOrphan(
  status: string | null | undefined,
  rowHasCancellationTimestamp: boolean,
): boolean {
  const normalizedStatus = String(status ?? "").toLowerCase().trim();

  // Explicit non-refundable wins, always.
  if (normalizedStatus && NON_REFUNDABLE_RESERVATION_STATUS_RE.test(normalizedStatus)) {
    return false;
  }
  // Explicit refundable wins, always.
  if (normalizedStatus && REFUNDABLE_RESERVATION_STATUS_RE.test(normalizedStatus)) {
    return true;
  }
  // No status available: only refund when a cancellation timestamp is
  // present — a bare missing row is not enough to act on.
  return rowHasCancellationTimestamp;
}
