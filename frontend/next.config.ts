import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      // Prototype: proxy fly.io prod through the local dev server so
      // Safari/strict-browser fetch failures (TypeError: Load failed)
      // don't block the Lenia scenes. Same-origin from the page's view.
      { source: "/prod-api/:path*", destination: "https://rare-disease-atlas-api.fly.dev/api/:path*" },
    ];
  },
};

export default nextConfig;
