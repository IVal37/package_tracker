import type { Details } from "./scrub";

/** Problems worth a human's attention that are not exceptions. */
export type IssueKind =
  /** A background job ran out of retries (or failed for good). */
  | "job_out_of_retries"
  /** An alert could not be delivered on any channel. */
  | "notification_failed"
  /** The re-fetch met a bad API key or an exhausted quota and paused. */
  | "refetch_stopped"
  /** A forwarded email was given up on: after its retries, or immediately
   *  when retrying would not help (a bad key, an exhausted balance, ...). */
  | "email_failed"
  /** A deleted account's sign-in could not be removed. */
  | "account_deletion_incomplete"
  /** An error in the browser that the server never saw. */
  | "client_error";

/**
 * Where problems go. Details are ids, kinds and counts only (see
 * sanitizeDetails); an implementation must never be handed shipment
 * contents, email text or addresses.
 */
export interface Monitor {
  readonly name: "noop" | "sentry";
  reportIssue(kind: IssueKind, details?: Details): void;
  reportError(error: unknown, details?: Details): void;
}
