"use server";

import { headers } from "next/headers";
import { getDb } from "@/lib/db/client";
import { reportIssue } from "@/lib/monitoring";
import { LIMITS, clientIp, hit } from "@/lib/ratelimit";

/**
 * Reports an error that happened in the browser only (a server error has a
 * digest and was already reported by instrumentation.ts). Just the error's
 * class name is sent: a message could quote what was on the page. Limited per
 * client IP, since anyone can call it.
 */
export async function reportClientErrorAction(name: unknown): Promise<void> {
  const ip = clientIp(await headers());
  if (!(await hit(getDb(), LIMITS.clientError, ip, new Date())).allowed) return;
  const safeName =
    typeof name === "string" && /^[A-Za-z]{1,40}$/.test(name)
      ? name.toLowerCase()
      : "unknown";
  reportIssue("client_error", { error: safeName });
}
