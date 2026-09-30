import "./scripts/swc-native-cache";

import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Node-only packages used by server code; keep them out of the bundler.
  serverExternalPackages: ["pg", "pg-boss", "@react-pdf/renderer"],
};

export default withNextIntl(nextConfig);
