import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produces .next/standalone — a self-contained server.js + trimmed node_modules
  // required by the Dockerfile. Has no effect on `next dev` or local `next start`.
  output: "standalone",
};

export default nextConfig;
