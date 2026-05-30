import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const awsRegion = process.env.AWS_REGION ?? "us-west-2";

/**
 * Bucket used for both audio uploads (under audio/) and the rendered videos.
 * It's the Remotion bucket created by `deploy:site` in our region — separate
 * from the production stack's bucket because that lives in a different region.
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

let _client: S3Client | null = null;
export function s3(): S3Client {
  if (!_client) _client = new S3Client({ region: awsRegion });
  return _client;
}

/** Safe-ish object key fragment from a user filename. */
export function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9.\-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "audio";
}

/**
 * Presigned PUT so the browser uploads the (potentially large) audio file
 * directly to S3 — never through the Next server. The object stays private;
 * we hand the renderer a presigned GET at render time.
 */
export async function presignAudioUpload(opts: {
  key: string;
  contentType: string;
  expiresIn?: number;
}): Promise<string> {
  const cmd = new PutObjectCommand({
    Bucket: renderBucket(),
    Key: opts.key,
    ContentType: opts.contentType,
  });
  return getSignedUrl(s3(), cmd, { expiresIn: opts.expiresIn ?? 3600 });
}

/**
 * Presigned GET handed to the Lambda renderer as the audio source. No public
 * ACL needed; 6h is far longer than any render takes.
 */
export async function presignAudioDownload(
  key: string,
  expiresIn = 6 * 3600,
): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: renderBucket(), Key: key });
  return getSignedUrl(s3(), cmd, { expiresIn });
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
        Prefix: "renders/",
        ContinuationToken: token,
      }),
    );
    for (const obj of res.Contents ?? []) {
      if (!obj.Key || !obj.LastModified) continue;
      // renders/<renderId>/<file>.mp4
      const m = obj.Key.match(/^renders\/([^/]+)\/([^/]+\.mp4)$/);
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

/** Delete a finished render's mp4 (used by the "discard this take" button). */
export async function deleteRenderObject(key: string): Promise<void> {
  if (!/^renders\/[^/]+\/[^/]+\.mp4$/.test(key)) {
    throw new Error("Refusing to delete unexpected key");
  }
  await s3().send(
    new DeleteObjectCommand({ Bucket: renderBucket(), Key: key }),
  );
}
