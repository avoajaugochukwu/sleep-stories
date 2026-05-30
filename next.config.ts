import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Pin the workspace root — a parent lockfile (~/package-lock.json) otherwise
  // confuses Next's root inference and breaks the production manifest path.
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
