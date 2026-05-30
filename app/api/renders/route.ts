import { NextResponse } from "next/server";
import { deleteRenderObject, listRecentRenders } from "@/lib/aws/s3";

export const runtime = "nodejs";

// List finished renders from the last 7 days.
export async function GET() {
  try {
    const renders = await listRecentRenders();
    return NextResponse.json({ renders });
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
