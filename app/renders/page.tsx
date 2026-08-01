import { RenderHistory } from "@/components/renders/render-history";

// Finished videos, independent of any project. The editor's /render step needs a
// session (audio + scenes) to do anything; this page needs nothing — most videos
// here were rendered headlessly by the ingest worker and never had a session.
export default function RendersPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-12">
      <h1 className="font-display text-3xl">Renders.</h1>
      <p className="mt-3 max-w-xl text-muted-foreground">
        Every finished video from the last 7 days — from the queue or rendered by
        hand. S3 deletes them after that, so download anything worth keeping.
      </p>
      <div className="mt-10">
        <RenderHistory />
      </div>
    </main>
  );
}
