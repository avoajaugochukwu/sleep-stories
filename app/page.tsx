import { redirect } from "next/navigation";

/**
 * Land on the queue, not the editor.
 *
 * `/` used to client-side `router.push('/scenes')` from a useEffect, which both
 * flashed an empty page and put the manual scene editor front and centre. Almost
 * every video now arrives through the Baserow/ClickUp ingest and renders on its
 * own — the queue is what you actually come here to look at, and the editor is
 * where you go to FIX one. The header keeps a Scenes link for that.
 *
 * Server-side redirect: no flash, no client bundle.
 */
export default function Home() {
  redirect("/jobs");
}
