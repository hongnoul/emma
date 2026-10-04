import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rare Disease Atlas",
  description: "Connecting rare diseases through biology, evidence, and shared research. Demonstration prototype with synthetic data.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background text-foreground antialiased">
        <nav className="border-b px-6 py-3 flex items-center gap-6 text-sm">
          <Link href="/" className="font-semibold">Rare Disease Atlas</Link>
          <Link href="/" className="text-muted-foreground hover:text-foreground">Search</Link>
          <Link href="/evals" className="text-muted-foreground hover:text-foreground">Evals</Link>
          <Link href="/physician" className="font-medium hover:underline">Physician</Link>
          <Badge variant="outline" className="ml-auto text-muted-foreground">
            Research prototype · not medical advice
          </Badge>
        </nav>
        <main className="max-w-5xl mx-auto px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
