import { NextResponse } from "next/server";
import { deleteRenderObject, listRecentRenders } from "@/lib/aws/s3";
import { getUploadedMap, setUploaded } from "@/lib/jobs/render-meta";

export const runtime = "nodejs";

// List finished renders from the last 7 days, each carrying its persistent
// "uploaded" flag from render_meta.
export async function GET() {
  try {
    const [renders, uploaded] = await Promise.all([listRecentRenders(), getUploadedMap()]);
    return NextResponse.json({
      renders: renders.map((r) => ({ ...r, uploaded: uploaded[r.renderId] ?? false })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

// Toggle a render's "uploaded" flag. Body: { renderId, uploaded }.
export async function POST(req: Request) {
  try {
    const { renderId, uploaded } = await req.json();
    if (!renderId) {
      return NextResponse.json({ error: "renderId required" }, { status: 400 });
    }
    await setUploaded(String(renderId), Boolean(uploaded));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

// Delete a finished render (discard a take you don't like).
export async function DELETE(req: Request) {
  const key = new URL(req.url).searchParams.get("key");
  if (!key) {
    return NextResponse.json({ error: "key query param required" }, { status: 400 });
  }
  try {
    await deleteRenderObject(key);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
