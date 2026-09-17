import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BookingPage from "./BookingPage";

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock("@/lib/api", () => ({
  api: apiMock,
  getSession: () => ({}),
  getBackendUrl: () => "",
  getProxyPrefix: () => "",
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ isAuthenticated: true }),
}));
vi.mock("@/contexts/AccessAuthContext", () => ({
  useAccessAuth: () => ({ hasPermission: () => false }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        then: (resolve: (value: unknown) => void) => resolve({ data: [] }),
        in: async () => ({ data: [] }),
      }),
    }),
  },
}));

const centreName = "Khulna Technical Training Centre";
const makeSession = (id: string, centre = "156") => ({
  id,
  site_id: centre,
  test_center_id: centre,
  site_city: "Khulna",
  test_center_name: centre === "156" ? centreName : "Other centre",
  exam_date: "2026-09-30",
  available_seats: 5,
  prometric_codes: [{ code: "LOBEN", english_name: "Bengali" }],
});

let listCalls: string[];
let refreshedSessions: ReturnType<typeof makeSession>[];
let refreshError: Error | null;
let rejectHold: boolean;

beforeEach(() => {
  listCalls = [];
  refreshedSessions = [makeSession("fresh-session"), makeSession("other-session", "999")];
  refreshError = null;
  rejectHold = false;
  apiMock.mockReset();
  apiMock.mockImplementation(async (path: string, opts?: { method?: string }) => {
    if (path.startsWith("/fly-occupations")) return [{
      id: 159, occupation_id: 2033, category_id: 159, name: "Workshop Worker",
      prometric_codes: [{ code: "LOBEN", english_name: "Bengali" }],
    }];
    if (path.startsWith("/fly-dates")) return { available_dates: [{ city: "Khulna", date: "2026-09-30" }] };
    if (path.startsWith("/fly-centers")) return { sites: [{ id: 156, name: centreName, city: "Khulna" }] };
    if (path.startsWith("/fly-pacc-sessions")) {
      listCalls.push(path);
      if (listCalls.length > 1 && refreshError) throw refreshError;
      return { sessions: listCalls.length === 1 ? [makeSession("old-session")] : refreshedSessions };
    }
    if (/^\/exam-sessions?\//.test(path)) {
      const id = decodeURIComponent(path.split("/")[2].split("?")[0]);
      return makeSession(id, id === "other-session" ? "999" : "156");
    }
    if (path === "/temporary-seats") {
      if (rejectHold) throw { status: 422, message: "No exam session found" };
      return { id: 12345, test_center_id: "156" };
    }
    if (path === "/exam-reservations" && opts?.method === "POST") {
      throw { status: 422, message: "No exam session found" };
    }
    return {};
  });
});
afterEach(cleanup);

async function selectSession() {
  render(<MemoryRouter><BookingPage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: /Select occupation/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Workshop Worker" }));
  const centre = screen.getByRole("combobox", { name: "Live SVP test centre" });
  await waitFor(() => expect(centre).toBeEnabled());
  await screen.findByRole("option", { name: /Khulna Technical Training Centre.*Site #156/ });
  fireEvent.change(centre, { target: { value: "156" } });
  await waitFor(() => expect(screen.getByRole("button", { name: "Create hold" })).toBeEnabled());
}

async function rejectReservation() {
  await selectSession();
  fireEvent.click(screen.getByRole("button", { name: "Create hold" }));
  const confirm = await screen.findByRole("button", { name: /Confirm booking/ });
  fireEvent.click(confirm);
  await waitFor(() => expect(listCalls).toHaveLength(2));
}

describe("same-centre session recovery", () => {
  it("reloads after a reservation 422, preserves centre/date and requires a new hold", async () => {
    await rejectReservation();
    const sessions = screen.getByRole("combobox", { name: "Available sessions at the selected centre" });
    await waitFor(() => expect(sessions).toHaveValue("fresh-session"));
    expect(screen.getByRole("combobox", { name: "Live SVP test centre" })).toHaveValue("156");
    expect(listCalls[1]).toBe(listCalls[0]);
    expect(listCalls[1]).toContain("exam_date=2026-09-30");
    expect(sessions.querySelector('option[value="old-session"]')).toBeNull();
    expect(sessions.querySelector('option[value="other-session"]')).toBeNull();
    expect(screen.getByRole("button", { name: "Create hold before booking" })).toBeDisabled();
    expect(apiMock.mock.calls.filter(([path, opts]) => path === "/exam-reservations" && opts?.method === "POST")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Create hold" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/temporary-seats", {
      method: "POST", body: { exam_session_id: "fresh-session", test_center_id: "156" },
    }));
  });

  it("does not substitute another centre when no matching sessions are returned", async () => {
    refreshedSessions = [makeSession("other-session", "999")];
    await rejectReservation();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/No sessions returned.*2026-09-30/));
    expect(screen.getByRole("combobox", { name: "Live SVP test centre" })).toHaveValue("156");
    expect(screen.getByRole("combobox", { name: "Available sessions at the selected centre" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Create hold" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Create hold before booking" })).toBeDisabled();
  });

  it("reports a failed refresh instead of claiming that no seats exist", async () => {
    refreshError = new Error("Session service temporarily unavailable");
    await rejectReservation();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Session service temporarily unavailable"));
    expect(screen.getByRole("button", { name: "Create hold before booking" })).toBeDisabled();
  });

  it("also reloads after hold creation rejects the old session", async () => {
    rejectHold = true;
    await selectSession();
    fireEvent.click(screen.getByRole("button", { name: "Create hold" }));
    await waitFor(() => expect(listCalls).toHaveLength(2));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Available sessions at the selected centre" })).toHaveValue("fresh-session"));
    expect(screen.getByRole("combobox", { name: "Live SVP test centre" })).toHaveValue("156");
  });
});