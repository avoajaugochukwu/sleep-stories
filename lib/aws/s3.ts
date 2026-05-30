import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const awsRegion = process.env.AWS_REGION ?? "us-east-1";

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
