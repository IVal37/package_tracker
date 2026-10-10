// Every outside service that sees personal data, and exactly what it sees.
// The privacy policy is rendered from this list, and a test checks the page
// names each one: a new service has to be added here to ship.

export interface Service {
  name: string;
  /** What it does for Wayfind. */
  role: string;
  /** What it receives about a person. */
  sees: string;
}

export const SERVICES: readonly Service[] = [
  {
    name: "Supabase",
    role: "Sign-in and the database",
    sees: "Your email address and sign-in details, and everything Wayfind stores (it hosts the database).",
  },
  {
    name: "Vercel",
    role: "Hosts the app",
    sees: "Every request to Wayfind, including your IP address, as part of serving the site.",
  },
  {
    name: "Ship24",
    role: "Tracks packages with the carriers",
    sees: "The tracking numbers you add or forward.",
  },
  {
    name: "OpenStreetMap Nominatim",
    role: "Turns place names into map positions",
    sees: "Place text from tracking events, such as a city and postcode. Never your name, street address or tracking number.",
  },
  {
    name: "OpenFreeMap",
    role: "Map tiles",
    sees: "Your IP address, when your browser loads the map.",
  },
  {
    name: "Anthropic (Claude)",
    role: "Reads forwarded order and shipping emails",
    sees: "The text of each email you forward, which can include your name, address and what you bought. It is not used to train models.",
  },
  {
    name: "Cloudflare",
    role: "Receives forwarded email",
    sees: "Each email you forward to your Wayfind address, on its way to us.",
  },
  {
    name: "Resend",
    role: "Sends alert emails",
    sees: "Your email address and the alert: the package's name and its latest status.",
  },
  {
    name: "Inngest",
    role: "Runs background jobs",
    sees: "Internal ids only, such as which package or email a job is about.",
  },
  {
    name: "Sentry",
    role: "Error reports",
    sees: "Technical details of errors, with email addresses, tracking numbers, request contents and other personal details removed first.",
  },
  {
    name: "Your browser's push service (Google, Mozilla, Microsoft or Apple)",
    role: "Delivers push notifications",
    sees: "The encrypted alert sent to your device, and the device's push address.",
  },
];
