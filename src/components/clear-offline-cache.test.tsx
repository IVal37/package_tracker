import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ clearOfflineCaches: vi.fn() }));

vi.mock("@/lib/pwa/device-cleanup", () => ({
  clearOfflineCaches: mocks.clearOfflineCaches,
}));

import { ClearOfflineCache } from "./clear-offline-cache";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.clearOfflineCaches.mockResolvedValue(undefined);
});

describe("ClearOfflineCache", () => {
  it("clears the saved package list once, and shows nothing", () => {
    const { container } = render(<ClearOfflineCache />);
    expect(mocks.clearOfflineCaches).toHaveBeenCalledOnce();
    expect(container).toBeEmptyDOMElement();
  });
});
