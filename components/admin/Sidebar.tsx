"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clearSession } from "@/lib/admin-auth";

const NAV = [
  { href: "/dashboard", label: "Resumen" },
  { href: "/reservas", label: "Reservas" },
  { href: "/huespedes", label: "Huéspedes" },
  { href: "/bandeja", label: "Bandeja" },
  { href: "/automatizaciones", label: "Automatizaciones" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  function handleLogout() {
    clearSession();
    router.push("/login");
  }

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex items-center gap-2.5 border-b border-line px-5 py-4">
        <Image src="/logo/nuku-mark.png" alt="Nuku OS" width={28} height={28} className="rounded-full" />
        <div className="leading-tight">
          <span className="font-display block text-lg">Nuku OS</span>
          <span className="block text-[10px] uppercase tracking-[0.2em] text-terracotta">
            Hospitalidad, ordenada
          </span>
        </div>
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
                  ? "bg-terracotta text-paper font-medium"
                  : "text-ink-soft hover:bg-paper-alt"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-line p-4">
        <p className="text-[11px] leading-relaxed text-ink-faint">
          Fase 0 — datos de ejemplo. Sin conexión a Supabase todavía.
        </p>
        <button
          type="button"
          onClick={handleLogout}
          className="mt-3 text-[11px] font-medium text-ink-soft underline decoration-line underline-offset-2 transition-colors hover:text-terracotta"
        >
          Cerrar sesión
        </button>
      </div>
    </aside>
  );
}
