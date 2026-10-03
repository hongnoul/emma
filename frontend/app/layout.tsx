import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rare Disease Atlas",
  description: "Connecting rare diseases through biology, evidence, and shared research. Demonstration prototype with synthetic data.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-slate-900 antialiased">
        <nav className="border-b border-slate-200 px-6 py-3 flex items-center gap-6 text-sm">
          <Link href="/" className="font-semibold">Rare Disease Atlas</Link>
          <Link href="/" className="text-slate-600 hover:text-slate-900">Search</Link>
          <Link href="/evals" className="text-slate-600 hover:text-slate-900">Evals</Link>
          <span className="ml-auto text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">
            Synthetic demonstration data
          </span>
        </nav>
        <main className="max-w-5xl mx-auto px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
