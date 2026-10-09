import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ registerServiceWorker: vi.fn() }));

vi.mock("@/lib/pwa/service-worker", () => ({
  registerServiceWorker: mocks.registerServiceWorker,
}));

import { ServiceWorkerRegistrar } from "./service-worker-registrar";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.registerServiceWorker.mockResolvedValue(null);
});

describe("ServiceWorkerRegistrar", () => {
  it("registers the service worker once, after the page loads, and shows nothing", () => {
    const { container } = render(<ServiceWorkerRegistrar />);
    expect(mocks.registerServiceWorker).toHaveBeenCalledOnce();
    expect(container).toBeEmptyDOMElement();
  });

  it("does not register again when it re-renders", () => {
    const { rerender } = render(<ServiceWorkerRegistrar />);
    rerender(<ServiceWorkerRegistrar />);
    expect(mocks.registerServiceWorker).toHaveBeenCalledOnce();
  });
});
