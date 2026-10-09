// @vitest-environment node
import { describe, expect, it } from "vitest";
import { GET, dynamic, dynamicParams, generateStaticParams } from "./route";

const get = async (file: string) =>
  GET(new Request(`https://wayfind.example.test/icons/${file}`), {
    params: Promise.resolve({ file }),
  });

/** Width and height from a PNG's header, or null if it is not a PNG. */
async function pngSize(response: Response) {
  const bytes = new Uint8Array(await response.arrayBuffer());
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!signature.every((byte, i) => bytes[i] === byte)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

describe("GET /icons/[file]", () => {
  it.each([
    ["icon-192.png", 192],
    ["icon-512.png", 512],
    ["maskable-512.png", 512],
    ["apple-touch-icon.png", 180],
  ])("serves %s as a %i px square PNG", async (file, size) => {
    const response = await get(file);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(await pngSize(response)).toEqual({ width: size, height: size });
  });

  it("lets browsers keep an icon for a year", async () => {
    const response = await get("icon-192.png");
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  it.each([
    "nope.png",
    "icon-193.png",
    "",
    "../secret",
    "__proto__",
    "constructor",
    "toString",
  ])("answers 404 for %j", async (file) => {
    const response = await get(file);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });

  it("is drawn once at build time, for exactly the known files", () => {
    expect(dynamic).toBe("force-static");
    expect(dynamicParams).toBe(false);
    expect(
      generateStaticParams()
        .map((p) => p.file)
        .sort(),
    ).toEqual([
      "apple-touch-icon.png",
      "icon-192.png",
      "icon-512.png",
      "maskable-512.png",
    ]);
  });
});
