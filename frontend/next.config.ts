import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow dev access from LAN IPs (phone testing, headless browser QA).
  // Without this Next blocks /_next/* cross-origin and the page never hydrates.
  allowedDevOrigins: ["10.29.156.189", "localhost", "127.0.0.1"],
};

export default nextConfig;
