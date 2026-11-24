import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  cacheComponents: false,
  async redirects() {
    return [{ source: "/demo", destination: "/app?tab=overview", permanent: false }];
  },
  outputFileTracingIncludes: {
    "/api/seed": [
      "./steward-data/bank_transactions_q3_2026.csv",
      "./steward-data/gl_export_bookkeeper.csv",
      "./steward-data/staff_allocation.csv",
      "./steward-data/precedents.json",
      "./steward-data/grant_A_federal_passthrough.pdf",
      "./steward-data/grant_B_harbor_light_foundation.pdf",
      // v2 GL-first demo (`/api/seed?set=v2`). The answer key (expected_v2.json) is deliberately not shipped.
      "./steward-data-v2/gl_detail_qb.csv",
      "./steward-data-v2/bank_statement.csv",
      "./steward-data-v2/staff_allocation.csv",
      "./steward-data-v2/precedents.json",
      "./steward-data-v2/contract_city_FS-27-0412.pdf",
      "./steward-data-v2/grant_foundation_RF-26-118.pdf",
      "./steward-data-v2/receipts/*",
    ],
  },
  // The seed route builds paths at runtime, so the tracer would pull in the whole repo. Keep answer keys,
  // sealed hold-outs and tooling out of the deployed function.
  outputFileTracingExcludes: {
    "/api/seed": [
      "**/expected_*.json",
      "**/*.zip",
      "_archive/**",
      "steward-holdout*/**",
      "design-screenshots/**",
      "demo-video/**",
      "docs/**",
      "scripts/**",
      "public/**",
      "**/README.md",
      "**/README.txt",
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
