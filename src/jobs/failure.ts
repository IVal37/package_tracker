import { reportIssue } from "@/lib/monitoring";

/** Where the failed run's own event keeps the id worth reporting. */
type IdField = "emailId" | "notificationId";

const SNAKE: Record<IdField, string> = {
  emailId: "email_id",
  notificationId: "notification_id",
};

interface FailureContext {
  event: { data?: { event?: { data?: unknown } } };
  error: Error;
}

/**
 * An Inngest onFailure handler: the run ran out of retries (or failed for
 * good). Reports the job, the error's class and, when there is one, the id
 * from the run's event. Never the event's other data or the error's message.
 */
export function reportJobFailure(job: string, idField?: IdField) {
  return async ({ event, error }: FailureContext): Promise<void> => {
    const original = event.data?.event?.data;
    const id =
      idField && typeof original === "object" && original !== null
        ? (original as Record<string, unknown>)[idField]
        : undefined;
    reportIssue("job_out_of_retries", {
      job,
      error: error.name.toLowerCase(),
      ...(idField && typeof id === "string" && { [SNAKE[idField]]: id }),
    });
  };
}
