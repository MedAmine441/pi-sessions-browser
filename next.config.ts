import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["node:os"],
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  /* config options here */
};

export default nextConfig;
