import {
  CreateBucketCommand,
  DeletePublicAccessBlockCommand,
  HeadBucketCommand,
  PutBucketCorsCommand,
  PutBucketLifecycleConfigurationCommand,
  PutBucketOwnershipControlsCommand,
  PutBucketPolicyCommand,
  S3Client,
} from "@aws-sdk/client-s3";

// Our OWN dedicated bucket — nothing is shared with production. Name must start
// with "remotionlambda-" (a Remotion requirement) and is globally unique.
const region = process.env.AWS_REGION ?? "us-west-2";
const bucketName =
  process.env.REMOTION_RENDER_BUCKET ?? "remotionlambda-uswest2-sleepstories";

const client = new S3Client({ region });

async function bucketExists() {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucketName }));
    return true;
  } catch {
    return false;
  }
}

// Create the bucket if missing, then make it public-read in the same way
// Remotion expects. Idempotent: safe to run on an existing bucket too.
async function ensureBucket() {
  if (await bucketExists()) {
    console.log("[deploy-site] bucket already exists — reconfiguring");
  } else {
    await client.send(
      new CreateBucketCommand({
        Bucket: bucketName,
        CreateBucketConfiguration:
          region === "us-east-1" ? undefined : { LocationConstraint: region },
      }),
    );
    console.log(`[deploy-site] created bucket ${bucketName}`);
  }

  // Re-enable ACLs (new buckets default to BucketOwnerEnforced = ACLs OFF, but
  // Remotion's site upload sets a public-read ACL on objects).
  await client.send(
    new PutBucketOwnershipControlsCommand({
      Bucket: bucketName,
      OwnershipControls: { Rules: [{ ObjectOwnership: "BucketOwnerPreferred" }] },
    }),
  );
  // Allow public policy/ACLs.
  await client.send(new DeletePublicAccessBlockCommand({ Bucket: bucketName }));
  // GetObject-only public policy so rendered MP4s are downloadable by URL.
  await client.send(
    new PutBucketPolicyCommand({
      Bucket: bucketName,
      Policy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Sid: "PublicReadGetObject",
            Effect: "Allow",
            Principal: "*",
            Action: "s3:GetObject",
            Resource: `arn:aws:s3:::${bucketName}/*`,
          },
        ],
      }),
    }),
  );
  console.log("[deploy-site] public-read posture configured (ACLs on + policy)");
}

// CORS so the browser can PUT narration audio straight to S3.
async function configureCors() {
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
  console.log("[deploy-site] CORS configured");
}

// 7-day expiry on uploads and renders. This is OUR bucket so we own the whole
// lifecycle config — no merging required. (sites/ is intentionally excluded so
// the deployed player bundle is never deleted.)
async function configureLifecycle() {
  await client.send(
    new PutBucketLifecycleConfigurationCommand({
      Bucket: bucketName,
      LifecycleConfiguration: {
        Rules: [
          {
            ID: "expire-renders-7d",
            Filter: { Prefix: "renders/" },
            Status: "Enabled",
            Expiration: { Days: 7 },
            AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
          },
          {
            ID: "expire-audio-7d",
            Filter: { Prefix: "audio/" },
            Status: "Enabled",
            Expiration: { Days: 7 },
            AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
          },
        ],
      },
    }),
  );
  console.log("[deploy-site] 7-day lifecycle set on renders/ and audio/");
}

async function main() {
  console.log(`[deploy-site] region=${region} bucket=${bucketName}`);

  await ensureBucket();
  await configureCors();
  await configureLifecycle();

  // Rendering now runs on Modal (ffmpeg), not Remotion-Lambda — this script only
  // provisions/configures the S3 bucket that holds audio/ + renders/.
  console.log("");
  console.log("Confirm this in your .env.local:");
  console.log(`REMOTION_RENDER_BUCKET=${bucketName}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
