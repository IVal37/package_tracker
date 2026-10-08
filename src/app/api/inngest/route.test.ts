// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getEnv, serveHandlers } = vi.hoisted(() => ({
  getEnv: vi.fn(),
  serveHandlers: {
    GET: vi.fn(async () => new Response("get")),
    POST: vi.fn(async () => new Response("post")),
    PUT: vi.fn(async () => new Response("put")),
  },
}));

vi.mock("@/lib/env", () => ({ getEnv }));
vi.mock("inngest/next", () => ({ serve: () => serveHandlers }));
vi.mock("@/jobs", () => ({ inngest: {}, functions: [] }));

import { GET, POST, PUT } from "./route";

const request = new Request("http://localhost/api/inngest") as never;

beforeEach(() => {
  getEnv.mockReset();
  for (const handler of Object.values(serveHandlers)) handler.mockClear();
});

describe("/api/inngest", () => {
  it.each([
    ["GET", GET, serveHandlers.GET],
    ["POST", POST, serveHandlers.POST],
    ["PUT", PUT, serveHandlers.PUT],
  ])(
    "%s validates the environment, then serves",
    async (_m, handler, inner) => {
      const response = await handler(request, undefined);

      expect(getEnv).toHaveBeenCalledOnce();
      expect(inner).toHaveBeenCalledOnce();
      expect(response.status).toBe(200);
    },
  );

  it("does not serve when the environment is invalid", () => {
    getEnv.mockImplementation(() => {
      throw new Error("Invalid environment: missing INNGEST_SIGNING_KEY");
    });

    expect(() => POST(request, undefined)).toThrow("INNGEST_SIGNING_KEY");
    expect(serveHandlers.POST).not.toHaveBeenCalled();
  });
});
