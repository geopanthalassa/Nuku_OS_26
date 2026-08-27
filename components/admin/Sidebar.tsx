"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/dashboard", label: "Resumen" },
  { href: "/reservas", label: "Reservas" },
  { href: "/huespedes", label: "Huéspedes" },
  { href: "/bandeja", label: "Bandeja" },
  { href: "/automatizaciones", label: "Automatizaciones" },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex items-center gap-2 border-b border-line px-5 py-4">
        <span className="font-mono-ui text-amber">◈</span>
        <span className="font-display text-lg">Nuku OS</span>
      </div>
      <nav className="flex flex-1 flex-col gap-0.5 p-3">
        {NAV.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-lg px-3 py-2 text-sm transition-colors ${
                active
                  ? "bg-indigo text-paper font-medium"
                  : "text-ink-soft hover:bg-paper-alt"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-line p-4 text-[11px] leading-relaxed text-ink-faint">
        Fase 0 — datos de ejemplo. Sin conexión a Supabase todavía.
      </div>
    </aside>
  );
}
