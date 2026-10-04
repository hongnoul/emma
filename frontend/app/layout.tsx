import type { Metadata } from "next";
import { Fraunces } from "next/font/google";
import "./globals.css";

const serif = Fraunces({ subsets: ["latin"], variable: "--font-serif-display" });

export const metadata: Metadata = {
  title: "Rare Disease Atlas",
  description: "Connecting rare diseases through biology, evidence, and shared research. Demonstration prototype with synthetic data.",
};

// Root layout is chrome-free so the apex landing page (/) can be full-bleed.
// The card shell (header, container, bottom tab bar) lives in app/(atlas)/layout.tsx.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={serif.variable}>
      <body className="min-h-screen bg-muted/50 text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
