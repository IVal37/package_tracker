import { setupServer } from "msw/node";

// No default handlers: each test registers the fixtures it needs with
// server.use(...), and any unhandled request fails the test.
export const server = setupServer();
