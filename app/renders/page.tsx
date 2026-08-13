import { redirect } from "next/navigation";

// The standalone /renders screen is gone — finished videos now live in the
// channel-grouped queue on /jobs, next to the jobs that made them. Kept as a
// redirect so old links and bookmarks still land somewhere useful.
export default function RendersPage() {
  redirect("/jobs");
}
