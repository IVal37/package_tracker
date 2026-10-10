// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { reportIssue } = vi.hoisted(() => ({ reportIssue: vi.fn() }));
vi.mock("@/lib/monitoring", () => ({ reportIssue }));

import { reportJobFailure } from "./failure";

const UUID = "3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b";

const failed = (data: unknown, error = new Error("boom")) => ({
  event: { data: { event: { data } } },
  error,
});

beforeEach(() => reportIssue.mockReset());

describe("reportJobFailure", () => {
  it("reports the job, the error class and the id from the run's event", async () => {
    await reportJobFailure(
      "send-notification",
      "notificationId",
    )(failed({ notificationId: UUID, other: "secret" }, new RangeError("x")));
    expect(reportIssue).toHaveBeenCalledExactlyOnceWith("job_out_of_retries", {
      job: "send-notification",
      error: "rangeerror",
      notification_id: UUID,
    });
  });

  it("leaves the id out when there is none, or it is not a string", async () => {
    await reportJobFailure(
      "process-inbound-email",
      "emailId",
    )(failed({ emailId: 5 }));
    await reportJobFailure("process-inbound-email", "emailId")(failed(null));
    await reportJobFailure("geocode-place")(failed({ key: "memphis" }));
    await reportJobFailure("geocode-place")({ event: {}, error: new Error() });

    for (const [, details] of reportIssue.mock.calls) {
      expect(Object.keys(details)).toEqual(["job", "error"]);
    }
  });
});
