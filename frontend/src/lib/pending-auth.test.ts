import { beforeEach, describe, expect, it } from "vitest";
import { clearPendingAuth, getPendingAuth, setPendingAuth } from "./pending-auth";

describe("pending OTP authentication state", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("persists the email, credentials, method, and request ID", () => {
    setPendingAuth({
      login: "candidate@example.com",
      password: "secret",
      otpMethod: "email",
      requestId: "request-123",
    });

    expect(getPendingAuth()).toEqual({
      login: "candidate@example.com",
      password: "secret",
      otpMethod: "email",
      requestId: "request-123",
    });
  });

  it("does not restore an incomplete pending session", () => {
    localStorage.setItem(
      "pending_auth",
      JSON.stringify({ login: "candidate@example.com", password: "secret", otpMethod: "email" }),
    );

    expect(getPendingAuth()).toBeNull();
  });

  it("clears pending authentication state after successful verification", () => {
    setPendingAuth({
      login: "candidate@example.com",
      password: "secret",
      otpMethod: "email",
      requestId: "request-123",
    });

    clearPendingAuth();

    expect(getPendingAuth()).toBeNull();
  });
});
