import { ImageResponse } from "next/og";
import { ICONS, iconElement, iconSpec } from "@/lib/pwa/icons";

// Drawn once at build time and served as static files.
export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(ICONS).map((file) => ({ file }));
}

/** One of the app icons as a PNG. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> },
): Promise<Response> {
  const spec = iconSpec((await params).file);
  if (!spec) return new Response(null, { status: 404 });

  return new ImageResponse(iconElement(spec), {
    width: spec.size,
    height: spec.size,
    headers: { "cache-control": "public, max-age=31536000, immutable" },
  });
}
