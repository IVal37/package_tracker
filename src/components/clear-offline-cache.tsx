"use client";

import { useEffect } from "react";
import { clearOfflineCaches } from "@/lib/pwa/device-cleanup";

/**
 * Put on the sign-in page: anyone who is signed out has no business seeing a
 * saved package list, even if the last session ended without a sign-out.
 */
export function ClearOfflineCache() {
  useEffect(() => {
    void clearOfflineCaches();
  }, []);
  return null;
}
