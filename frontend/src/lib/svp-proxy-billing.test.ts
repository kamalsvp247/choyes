import { describe, expect, it } from "vitest";
import {
  canFinalizeWalletDebit,
  getReservationBillingOperation,
  getReservationRefundIdempotencyKey,
  isNonRefundableStatus,
  isRefundEligibleOrphan,
  isRefundEligibleReservation,
} from "../../supabase/functions/svp-proxy/billing-utils";

describe("SVP proxy reservation wallet billing", () => {
  it("charges successful new reservations", () => {
    expect(getReservationBillingOperation("POST", "/exam-reservations")).toBe("booking");
  });

  it("charges successful reservation reschedules", () => {
    expect(
      getReservationBillingOperation("POST", "/exam-reservations/123/reschedule"),
    ).toBe("reschedule");
  });

  it("does not charge reservation reads, cancellation, or preparation", () => {
    expect(getReservationBillingOperation("GET", "/exam-reservations")).toBeNull();
    expect(getReservationBillingOperation("DELETE", "/exam-reservations/123")).toBeNull();
    expect(getReservationBillingOperation("POST", "/temporary-seats")).toBeNull();
    expect(getReservationBillingOperation("POST", "/reservation-credits/use")).toBeNull();
  });

  it("finalizes a wallet debit only with a real reservation ID", () => {
    expect(canFinalizeWalletDebit("booking", "5312907")).toBe(true);
    expect(canFinalizeWalletDebit("reschedule", 5312907)).toBe(true);
    expect(canFinalizeWalletDebit("booking", "")).toBe(false);
    expect(canFinalizeWalletDebit("booking", null)).toBe(false);
    expect(canFinalizeWalletDebit(null, "svp-success:request-id")).toBe(false);
  });

  it("treats failed, cancelled, and expired outcomes as refundable", () => {
    expect(isRefundEligibleReservation("failed")).toBe(true);
    expect(isRefundEligibleReservation("declined")).toBe(true);
    expect(isRefundEligibleReservation("cancelled")).toBe(true);
    expect(isRefundEligibleReservation("expired")).toBe(true);
    expect(isRefundEligibleReservation("active")).toBe(false);
    expect(isRefundEligibleReservation("paid")).toBe(false);
    expect(isRefundEligibleReservation("", "2026-09-01T10:00:00Z")).toBe(true);
  });

  it("does not refund successful finalized reservations", () => {
    expect(isRefundEligibleReservation("completed")).toBe(false);
    expect(isRefundEligibleReservation("attended")).toBe(false);
    expect(isRefundEligibleReservation("completed", "2026-09-01T10:00:00Z")).toBe(false);
    expect(isRefundEligibleReservation("attended", "2026-09-01T10:00:00Z")).toBe(false);
  });

  it("uses one stable refund key for every retry of the same account and reservation", () => {
    const first = getReservationRefundIdempotencyKey("acct-42", "5312907");
    const retry = getReservationRefundIdempotencyKey("acct-42", 5312907);
    const otherAccount = getReservationRefundIdempotencyKey("acct-99", "5312907");
    expect(first).toBe("refund:acct-42:5312907");
    expect(retry).toBe(first);
    expect(otherAccount).not.toBe(first);
  });

  // ---------------------------------------------------------------------
  // Regression coverage for the duplicate-refund bug observed in
  // production: bookings with statuses like "Booking completed" and
  // "Payment succeeded" must NEVER be auto-refunded, even when the
  // reservation later disappears from the SVP list.
  // ---------------------------------------------------------------------

  it.each([
    "Booking completed",
    "booking completed",
    "BOOKING COMPLETED",
    "Payment completed",
    "Payment succeeded",
    "Reservation succeeded",
    "Reservation confirmed",
    "Reservation active",
    "Exam attended",
    "Completed",
    "Active",
    "Paid",
    "Booked",
    "Reserved",
    "Scheduled",
    "Processing",
  ])("refuses to refund a successful booking (status=%s)", (status) => {
    expect(isRefundEligibleReservation(status)).toBe(false);
    // …and refuses even when a stale cancellation timestamp is present.
    expect(isRefundEligibleReservation(status, "2026-09-01T10:00:00Z")).toBe(false);
    expect(isNonRefundableStatus(status)).toBe(true);
  });

  it.each([
    "Cancelled",
    "cancelled",
    "Canceled",
    "canceled",
    "Expired",
    "expired",
    "Failed",
    "failed",
    "Declined",
    "No show",
    "no-show",
    "Absent",
    "Void",
    "Revoked",
    "Terminated",
  ])("refunds an explicitly refundable outcome (status=%s)", (status) => {
    expect(isRefundEligibleReservation(status)).toBe(true);
  });

  it("does not refund on a bare missing status without a cancellation timestamp", () => {
    expect(isRefundEligibleReservation(undefined)).toBe(false);
    expect(isRefundEligibleReservation(null)).toBe(false);
    expect(isRefundEligibleReservation("")).toBe(false);
  });

  describe("isRefundEligibleOrphan (orphan-refund sweep safety net)", () => {
    it("never refunds a successful booking that fell out of the SVP list", () => {
      expect(isRefundEligibleOrphan("Booking completed", false)).toBe(false);
      expect(isRefundEligibleOrphan("Payment succeeded", false)).toBe(false);
      expect(isRefundEligibleOrphan("completed", false)).toBe(false);
      expect(isRefundEligibleOrphan("active", false)).toBe(false);
    });

    it("refunds when status is explicitly cancelled/expired/failed", () => {
      expect(isRefundEligibleOrphan("cancelled", false)).toBe(true);
      expect(isRefundEligibleOrphan("expired", false)).toBe(true);
      expect(isRefundEligibleOrphan("failed", false)).toBe(true);
    });

    it("refunds on a cancellation timestamp when status is missing", () => {
      expect(isRefundEligibleOrphan("", true)).toBe(true);
      expect(isRefundEligibleOrphan(undefined, true)).toBe(true);
    });

    it("does not refund on a missing status without a cancellation timestamp", () => {
      // This is the default case for any old "Booking completed" debit whose
      // metadata was lost. Conservative default: do nothing.
      expect(isRefundEligibleOrphan("", false)).toBe(false);
      expect(isRefundEligibleOrphan(undefined, false)).toBe(false);
    });

    it("non-refundable status always wins, even when a timestamp is present", () => {
      expect(isRefundEligibleOrphan("Booking completed", true)).toBe(false);
      expect(isRefundEligibleOrphan("Payment succeeded", true)).toBe(false);
    });
  });
});
