import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db/client";

const { finishEmail } = vi.hoisted(() => ({ finishEmail: vi.fn() }));
vi.mock("@/lib/db/inbound-emails", () => ({ finishEmail }));

import { keepGmailConfirmation } from "./keep-gmail-confirmation";

const db = {} as Db;
const GMAIL = "forwarding-noreply@google.com";

beforeEach(() => {
  finishEmail.mockReset();
});

describe("keepGmailConfirmation", () => {
  it("keeps the code and finishes the email as ignored", async () => {
    const kept = await keepGmailConfirmation(
      db,
      "user-1",
      "email-1",
      { from: GMAIL, text: "Confirmation code: 99427480" },
      "",
    );
    expect(kept).toBe(true);
    expect(finishEmail).toHaveBeenCalledWith(
      db,
      "user-1",
      "email-1",
      "ignored",
      expect.objectContaining({ code: "99427480" }),
    );
  });

  it("searches the HTML part too", async () => {
    const kept = await keepGmailConfirmation(
      db,
      "user-1",
      "email-1",
      { from: GMAIL, text: "" },
      "Confirmation code: 99427480",
    );
    expect(kept).toBe(true);
  });

  it("leaves any other email alone", async () => {
    const kept = await keepGmailConfirmation(
      db,
      "user-1",
      "email-1",
      { from: "friend@example.com", text: "Confirmation code: 99427480" },
      "",
    );
    expect(kept).toBe(false);
    expect(finishEmail).not.toHaveBeenCalled();
  });
});
