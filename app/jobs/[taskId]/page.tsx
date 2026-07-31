import { JobDetail } from "@/components/jobs/job-detail";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const { taskId } = await params;
  return { title: `Job ${taskId} — Sleep Stories` };
}

/**
 * One job at its own URL — linkable, refreshable, openable twice.
 *
 * The job used to exist only as `/scenes?job=<taskId>`, a query param on the
 * editor that dumped the prebaked project into the global session store. That
 * gave no stable link, raced the IndexedDB rehydrate on refresh, and buried
 * render status inside `projectJson`. `/scenes?job=` still works and is still
 * the EDIT path; this page is the READ path.
 */
export default async function JobPage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const { taskId } = await params;
  return (
    <div className="mx-auto max-w-3xl px-5 py-12 sm:py-16">
      <div className="stagger space-y-6">
        <JobDetail taskId={taskId} />
      </div>
    </div>
  );
}
