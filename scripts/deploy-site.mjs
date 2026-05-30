import path from "node:path";
import { deploySite, getOrCreateBucket } from "@remotion/lambda";
import {
  GetBucketCorsCommand,
  GetBucketLifecycleConfigurationCommand,
  PutBucketCorsCommand,
  PutBucketLifecycleConfigurationCommand,
  S3Client,
} from "@aws-sdk/client-s3";

// Same region as production. We share the region's single Remotion bucket with
// remotion-test-2 (Remotion enforces one bucket per region), but deploy our own
// site path (sites/sleep-stories/) and our own Lambda. Because the bucket is
// SHARED, every bucket-level change below MERGES with prod's config — it never
// replaces it.
const region = process.env.AWS_REGION ?? "us-west-2";
const siteName = process.env.REMOTION_SITE_NAME ?? "sleep-stories";

const client = new S3Client({ region });

// CORS so the browser can PUT narration audio straight to S3. Prod doesn't use
// browser uploads, so it has no CORS rules — but we still merge defensively.
async function ensureCors(bucketName) {
  let existing = [];
  try {
    const res = await client.send(new GetBucketCorsCommand({ Bucket: bucketName }));
    existing = res.CORSRules ?? [];
  } catch (e) {
    if (e?.name !== "NoSuchCORSConfiguration") throw e;
  }
  const hasPut = existing.some((r) => (r.AllowedMethods ?? []).includes("PUT"));
  if (hasPut) {
    console.log("[deploy-site] CORS already allows PUT — leaving as-is");
    return;
  }
  const rules = [
    ...existing,
    {
      AllowedMethods: ["PUT", "GET", "HEAD"],
      AllowedOrigins: ["*"],
      AllowedHeaders: ["*"],
      ExposeHeaders: ["ETag"],
      MaxAgeSeconds: 3000,
    },
  ];
  await client.send(
    new PutBucketCorsCommand({
      Bucket: bucketName,
      CORSConfiguration: { CORSRules: rules },
    }),
  );
  console.log("[deploy-site] CORS rule for browser uploads added (merged)");
}

// Our renders live under renders/, which prod's bucket ALREADY expires after
// 7 days. We only need to add an audio/ expiry rule — merged in alongside the
// existing rules, never replacing them.
async function ensureLifecycle(bucketName) {
  let rules = [];
  try {
    const res = await client.send(
      new GetBucketLifecycleConfigurationCommand({ Bucket: bucketName }),
    );
    rules = res.Rules ?? [];
  } catch (e) {
    if (e?.name !== "NoSuchLifecycleConfiguration") throw e;
  }
  if (rules.some((r) => r.ID === "expire-audio-7d")) {
    console.log("[deploy-site] audio/ lifecycle rule already present");
    return;
  }
  rules.push({
    ID: "expire-audio-7d",
    Filter: { Prefix: "audio/" },
    Status: "Enabled",
    Expiration: { Days: 7 },
  });
  await client.send(
    new PutBucketLifecycleConfigurationCommand({
      Bucket: bucketName,
      LifecycleConfiguration: { Rules: rules },
    }),
  );
  console.log(
    `[deploy-site] audio/ 7-day expiry added (merged with ${rules.length - 1} existing rule(s))`,
  );
}

async function main() {
  console.log(`[deploy-site] region=${region} siteName=${siteName}`);
  const { bucketName } = await getOrCreateBucket({ region });
  console.log(`[deploy-site] bucket (shared w/ prod): ${bucketName}`);

  await ensureCors(bucketName);
  await ensureLifecycle(bucketName);

  const entryPoint = path.resolve(process.cwd(), "remotion/index.ts");
  const { serveUrl, siteName: deployedName } = await deploySite({
    bucketName,
    entryPoint,
    region,
    siteName,
    options: {
      onBundleProgress: (p) => {
        if (p % 10 === 0) console.log(`  bundling ${p}%`);
      },
      onUploadProgress: ({ sizeUploaded, totalSize }) => {
        const pct = Math.round((sizeUploaded / totalSize) * 100);
        if (pct % 20 === 0) console.log(`  uploading ${pct}%`);
      },
    },
  });

  console.log(`[deploy-site] deployed "${deployedName}"`);
  console.log("");
  console.log("Add these to your .env.local:");
  console.log(`REMOTION_SERVE_URL=${serveUrl}`);
  console.log(`REMOTION_RENDER_BUCKET=${bucketName}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
