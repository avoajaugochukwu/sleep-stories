import { JobsPanel } from "@/components/jobs/jobs-panel";

export const metadata = { title: "Jobs — Sleep Stories" };

export default function JobsPage() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-12 sm:py-16">
      <div className="stagger space-y-8">
        <div>
          <h1 className="font-display text-4xl font-light tracking-tight sm:text-5xl">
            <span className="text-aurora italic">The queue.</span>
          </h1>
          <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
            Videos Baserow has sent in — breaking down, generating imagery and
            rendering on their own. Monitor, open, cancel, or retry.
          </p>
        </div>
        <JobsPanel />
      </div>
    </div>
  );
}
