import { deployFunction, getFunctions } from "@remotion/lambda";

// Deploy the Remotion render Lambda into OUR region (us-east-1 by default).
// Production (remotion-test-2) lives in us-west-2, so this never touches it.
const region = process.env.AWS_REGION ?? "us-east-1";

async function main() {
  console.log(`[deploy-lambda] region=${region}`);

  const existing = await getFunctions({ region, compatibleOnly: true });
  for (const fn of existing) {
    console.log(`[deploy-lambda] existing function: ${fn.functionName}`);
  }

  const { functionName, alreadyExisted } = await deployFunction({
    region,
    timeoutInSeconds: 900,
    // This AWS account is capped at 3008 MB in us-east-1 (unverified-tier
    // limit). That's ~2 vCPUs — plenty for slow sleep renders. Production's
    // us-west-2 region allows more, but we stay here for isolation.
    memorySizeInMb: 3008,
    createCloudWatchLogGroup: true,
    diskSizeInMb: 10240,
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
