import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Node-only packages used by server code; keep them out of the bundler.
  serverExternalPackages: ["pg", "pg-boss", "@react-pdf/renderer"],
};

export default nextConfig;
