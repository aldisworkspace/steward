import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  cacheComponents: false,
  outputFileTracingIncludes: {
    "/api/seed": [
      "./steward-data/bank_transactions_q3_2026.csv",
      "./steward-data/gl_export_bookkeeper.csv",
      "./steward-data/staff_allocation.csv",
      "./steward-data/precedents.json",
      "./steward-data/grant_A_federal_passthrough.pdf",
      "./steward-data/grant_B_harbor_light_foundation.pdf",
    ],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
