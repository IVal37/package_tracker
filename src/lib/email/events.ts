/** Sent when an inbound email has been stored and is ready to be read. */
export const EMAIL_RECEIVED = "wayfind/email.received";

export interface EmailReceivedData {
  emailId: string;
}
