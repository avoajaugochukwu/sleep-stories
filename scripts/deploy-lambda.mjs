import { deployFunction, getFunctions } from "@remotion/lambda";

// Deploy OUR OWN Remotion render Lambda in the same region as production
// (us-west-2). We never touch the production functions because ours has a
// DISTINCT config (disk 2048 MB) and therefore a distinct name:
//   ours: remotion-render-4-0-451-mem10240mb-disk2048mb-900sec
//   prod: remotion-render-4-0-451-mem10240mb-disk10240mb-900sec (+ 4-0-462)
const region = process.env.AWS_REGION ?? "us-west-2";

async function main() {
  console.log(`[deploy-lambda] region=${region}`);

  const existing = await getFunctions({ region, compatibleOnly: true });
  for (const fn of existing) {
    console.log(`[deploy-lambda] existing function: ${fn.functionName}`);
  }

  const { functionName, alreadyExisted } = await deployFunction({
    region,
    timeoutInSeconds: 900,
    // Full power: 10240 MB ≈ 6 vCPUs (us-west-2 allows it; us-east-1 didn't).
    memorySizeInMb: 10240,
    createCloudWatchLogGroup: true,
    // 2048 MB disk is plenty for 1080p sleep renders, and — importantly — it
    // makes our function name differ from prod's (which uses disk 10240) so we
    // can never overwrite their Lambda.
    diskSizeInMb: 2048,
  });

  console.log(
    `[deploy-lambda] ${alreadyExisted ? "reused" : "deployed"} function: ${functionName}`,
  );
  console.log("");
  console.log("Add this to your .env.local:");
  console.log(`REMOTION_LAMBDA_FUNCTION_NAME=${functionName}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
