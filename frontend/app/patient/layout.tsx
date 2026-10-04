import type { Metadata, Viewport } from "next";
import { Fraunces } from "next/font/google";

export const metadata: Metadata = {
  title: "Rarepath · Patient companion",
  description:
    "AI symptom matching, patient community, research-trained AI assistant, check-ins and daily treatment support for rare disease patients.",
};

// Real app viewport: dvh-driven shell, safe-area insets on notched phones.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-fraunces",
});

// Standalone app shell: /patient lives outside the (emmatics) card chrome and
// owns the whole viewport on mobile and desktop.
export default function PatientLayout({ children }: { children: React.ReactNode }) {
  return <div className={fraunces.variable}>{children}</div>;
}
