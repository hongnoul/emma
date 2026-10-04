import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow dev access from LAN IPs (phone testing, headless browser QA).
  // Without this Next blocks /_next/* cross-origin and the page never hydrates.
  allowedDevOrigins: ["10.29.156.189", "localhost", "127.0.0.1"],
  // Same-origin proxy for the API. When EMMA_API_PROXY is set (e.g. the prod
  // Fly API), /api/* and /v1/* are forwarded server-side, which sidesteps the
  // prod CORS allowlist during local demos. Pair with NEXT_PUBLIC_API_BASE=""
  // so lib/api.ts and lib/v1.ts fetch relative URLs.
  async rewrites() {
    const target = process.env.EMMA_API_PROXY;
    if (!target) return [];
    return [
      { source: "/api/:path*", destination: `${target}/api/:path*` },
      { source: "/v1/:path*", destination: `${target}/v1/:path*` },
    ];
  },
};

export default nextConfig;
