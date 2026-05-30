import path from "node:path";
import { deploySite, getOrCreateBucket } from "@remotion/lambda";
import { PutBucketCorsCommand, S3Client } from "@aws-sdk/client-s3";

const region = process.env.AWS_REGION ?? "us-east-1";
const siteName = process.env.REMOTION_SITE_NAME ?? "sleep-stories";

// CORS so the browser can PUT the narration audio straight to S3 (presigned).
// Without this the upload fails the preflight. Renders read images/audio
// server-to-server, so this is only about the browser upload path.
async function ensureCors(bucketName) {
  const client = new S3Client({ region });
  await client.send(
    new PutBucketCorsCommand({
      Bucket: bucketName,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedMethods: ["PUT", "GET", "HEAD"],
            AllowedOrigins: ["*"],
            AllowedHeaders: ["*"],
            ExposeHeaders: ["ETag"],
            MaxAgeSeconds: 3000,
          },
        ],
      },
    }),
  );
  console.log("[deploy-site] CORS configured for browser uploads");
}

async function main() {
  console.log(`[deploy-site] region=${region} siteName=${siteName}`);
  const { bucketName } = await getOrCreateBucket({ region });
  console.log(`[deploy-site] bucket: ${bucketName}`);

  await ensureCors(bucketName);

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
