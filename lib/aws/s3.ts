import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";

export const awsRegion = process.env.AWS_REGION ?? "us-west-2";

/**
 * Our OWN dedicated bucket (`sleep-stories-media`), holding both audio uploads
 * (`audio/`) and Modal's finished videos (`renders/<id>/<slug>.mp4`) — 7-day
 * lifecycle on both. Provisioned by `npm run deploy:site`.
 */
export function renderBucket(): string {
  const bucket = process.env.REMOTION_RENDER_BUCKET;
  if (!bucket) {
    throw new Error(
      "REMOTION_RENDER_BUCKET not set — run `npm run deploy:site` and paste the value into .env.local",
    );
  }
  return bucket;
}

const RENDER_PREFIX = "renders/";
// renders/<renderId>/<file>.mp4 — the 2-segment shape excludes the per-scene
// clips at renders/<renderId>/clips/clipNNNN.mp4.
const RENDER_KEY_RE = /^renders\/([^/]+)\/([^/]+\.mp4)$/;

let _client: S3Client | null = null;
export function s3(): S3Client {
  if (!_client) _client = new S3Client({ region: awsRegion });
  return _client;
}

export interface RenderListing {
  renderId: string;
  name: string;
  url: string;
  key: string;
  sizeMB: number;
  createdAt: string; // ISO
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function friendlyName(filename: string, fallback: string): string {
  const base = filename.replace(/\.mp4$/i, "");
  if (!base || base === "out") return fallback;
  return base.replace(/[-_]+/g, " ").trim();
}

/**
 * List finished renders from the last 7 days (the bucket's lifecycle deletes
 * them after that anyway). Authoritative across sessions/machines.
 */
export async function listRecentRenders(): Promise<RenderListing[]> {
  const bucket = renderBucket();
  const cutoff = Date.now() - SEVEN_DAYS_MS;
  const out: RenderListing[] = [];
  let token: string | undefined;

  do {
    const res = await s3().send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: RENDER_PREFIX,
        ContinuationToken: token,
      }),
    );
    for (const obj of res.Contents ?? []) {
      if (!obj.Key || !obj.LastModified) continue;
      const m = obj.Key.match(RENDER_KEY_RE);
      if (!m) continue;
      if (obj.LastModified.getTime() < cutoff) continue;
      out.push({
        renderId: m[1]!,
        name: friendlyName(m[2]!, m[1]!),
        key: obj.Key,
        url: `https://${bucket}.s3.${awsRegion}.amazonaws.com/${obj.Key}`,
        sizeMB: Math.round(((obj.Size ?? 0) / 1024 / 1024) * 100) / 100,
        createdAt: obj.LastModified.toISOString(),
      });
    }
    token = res.NextContinuationToken;
  } while (token);

  out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return out;
}

// Keep an uploaded filename safe as an S3 key segment: strip anything that
// isn't a word char/dash/dot, collapse repeats. A short uuid prefix guarantees
// uniqueness so two uploads of "narration.mp3" never collide.
function safeKeySegment(name: string): string {
  const cleaned = name
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return cleaned || "audio.mp3";
}

export interface AudioUploadTarget {
  /** Presigned PUT URL — the browser uploads the file straight here. */
  uploadUrl: string;
  /** Public HTTPS URL Lambda fetches at render time (bucket is public-read). */
  publicUrl: string;
  /** The S3 key, e.g. "audio/ab12cd34-narration.mp3". */
  key: string;
}

/**
 * Mint a presigned PUT URL so the browser can upload a narration mp3 directly
 * to our bucket under audio/ (bypassing the Next.js/Railway request-size limit;
 * CORS for PUT is already configured in deploy-site.mjs). The object lands in
 * the public bucket, so the returned publicUrl is fetchable by Lambda with no
 * presigning — and the audio/ lifecycle rule expires it after 7 days.
 *
 * Used for quick test renders: drop in a voiceover without first uploading it
 * to S3 by hand and pasting the URL.
 */
export async function presignAudioUpload(
  filename: string,
  contentType: string,
): Promise<AudioUploadTarget> {
  const bucket = renderBucket();
  const key = `audio/${randomUUID().slice(0, 8)}-${safeKeySegment(filename)}`;
  const uploadUrl = await getSignedUrl(
    s3(),
    new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
    { expiresIn: 600 },
  );
  return {
    uploadUrl,
    publicUrl: `https://${bucket}.s3.${awsRegion}.amazonaws.com/${key}`,
    key,
  };
}

/** Delete a finished render's mp4 (used by the "discard this take" button). */
export async function deleteRenderObject(key: string): Promise<void> {
  if (!RENDER_KEY_RE.test(key)) {
    throw new Error("Refusing to delete unexpected key");
  }
  await s3().send(
    new DeleteObjectCommand({ Bucket: renderBucket(), Key: key }),
  );
}
