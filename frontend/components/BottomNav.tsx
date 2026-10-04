"use client";
// Mobile bottom tab bar (Rarepath-style). Hidden on md+ where the top nav shows.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check, Compass, FlaskConical, Search, Stethoscope } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/", label: "Search", icon: Search },
  { href: "/physician", label: "Physician", icon: Stethoscope },
  { href: "/physician/triage", label: "Triage", icon: Check },
  { href: "/physician/paths", label: "Paths", icon: Compass },
  { href: "/evals", label: "Evals", icon: FlaskConical },
];

export default function BottomNav() {
  const pathname = usePathname();
  // longest-prefix wins so /physician/triage doesn't also light up /physician
  const active = TABS.reduce<string | null>((best, t) => {
    const hit = pathname === t.href || pathname.startsWith(`${t.href}/`);
    return hit && t.href.length > (best?.length ?? 0) ? t.href : best;
  }, null);

  return (
    <nav className="fixed inset-x-3 bottom-3 z-50 rounded-2xl border bg-background/95 shadow-lg backdrop-blur md:hidden">
      <div className="grid grid-cols-5">
        {TABS.map((t) => {
          const Icon = t.icon;
          const isActive = active === t.href;
          return (
            <Link key={t.href} href={t.href}
              className={cn(
                "flex flex-col items-center gap-1 rounded-2xl py-2.5 text-[11px]",
                isActive ? "font-semibold text-foreground" : "text-muted-foreground",
              )}>
              <Icon className="size-5" strokeWidth={isActive ? 2.5 : 2} />
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
