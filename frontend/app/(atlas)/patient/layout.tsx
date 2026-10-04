import type { Metadata } from "next";
import { Fraunces } from "next/font/google";

export const metadata: Metadata = {
  title: "Rarepath · Patient companion",
  description:
    "Mobile prototype: AI symptom matching, patient community, research-trained AI assistant, check-ins and daily treatment support for rare disease patients.",
};

const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-fraunces",
});

// Full-bleed phone-demo canvas: escape the root container like /physician does.
export default function PatientLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${fraunces.variable} -m-4 min-h-screen overflow-hidden rounded-2xl bg-muted/60 sm:-m-8`}>
      {children}
    </div>
  );
}
