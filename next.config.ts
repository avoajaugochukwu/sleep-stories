import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Pin the workspace root — a parent lockfile (~/package-lock.json) otherwise
  // confuses Next's root inference and breaks the production manifest path.
  outputFileTracingRoot: path.join(__dirname),
  // @remotion/lambda (and its esbuild/bundler deps) must not be bundled by
  // webpack into the API routes — we only use the lightweight `/client` entry
  // server-side. Keep it external so Next leaves it as a node require.
  serverExternalPackages: ["@remotion/lambda", "@remotion/bundler"],
};

export default nextConfig;
