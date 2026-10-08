import { Inngest } from "inngest";

// INNGEST_SIGNING_KEY (production) and INNGEST_DEV=1 (local) are read from the
// environment by the SDK itself.
export const inngest = new Inngest({ id: "wayfind" });
