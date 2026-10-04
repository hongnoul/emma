"use client";
// Tab strip for the physician workbench. Client-side only for the active
// state; the surrounding chrome stays a server component so metadata works.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/physician", label: "Overview" },
  { href: "/physician/triage", label: "Triage queue" },
  { href: "/physician/paths", label: "Path inspector" },
];

export default function PhysicianTabs() {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-4 md:gap-5">
      {TABS.map((t) => {
        const active = t.href === "/physician"
          ? pathname === t.href
          : pathname === t.href || pathname.startsWith(`${t.href}/`);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "text-muted-foreground hover:text-foreground",
              active && "font-medium text-foreground underline underline-offset-8",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
