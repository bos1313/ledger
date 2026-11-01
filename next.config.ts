import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone", // small self-contained server for the Docker image
  typedRoutes: true,
};

export default nextConfig;
