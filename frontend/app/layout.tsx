import type { Metadata } from "next";
import { Fraunces } from "next/font/google";
import "./globals.css";
import MeshBackdrop from "@/components/MeshBackdrop";

const serif = Fraunces({ subsets: ["latin"], variable: "--font-serif-display" });

export const metadata: Metadata = {
  title: "Emmatics",
  description: "Connecting rare diseases through biology, evidence, and shared research. Demonstration prototype with synthetic data.",
};

// Root layout is chrome-free so the apex landing page (/) can be full-bleed.
// The card shell (header, container, bottom tab bar) lives in app/(emmatics)/layout.tsx.
// MeshBackdrop mounts the atlas canvas once, fixed at -z-10; it persists
// across route changes so a click-zoom on the landing page carries straight
// into the destination with no white reload.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={serif.variable}>
      <body className="min-h-screen text-foreground antialiased">
        <MeshBackdrop />
        {children}
      </body>
    </html>
  );
}
