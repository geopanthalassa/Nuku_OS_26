"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { logout } from "@/lib/admin-auth";
import { useCurrentAccount } from "@/lib/account-context";

const NAV = [
  { href: "/dashboard", label: "Resumen" },
  { href: "/reservas", label: "Reservas" },
  { href: "/disponibilidad", label: "Disponibilidad" },
  { href: "/calendario", label: "Calendario" },
  { href: "/desayunos", label: "Desayunos" },
  { href: "/huespedes", label: "Huéspedes" },
  { href: "/bandeja", label: "Bandeja" },
  { href: "/automatizaciones", label: "Automatizaciones" },
  { href: "/cupones", label: "Cupones" },
  { href: "/equipo", label: "Equipo" },
];

// 25/9/2026: pedido de Andre — "esto no funciona en version movil, nada de
// nuku OS". Primera vuelta: el menú pasó a ser una barra chica con botón de
// hamburguesa abajo de "lg". Segunda vuelta, otro pedido de Andre viendo
// esa primera versión: al abrirlo, la lista se insertaba en el flujo normal
// de la página y empujaba TODO el contenido para abajo — "deberia ser un
// menu desplegable y no ocupando tanto espacio". Ahora el panel (lista +
// datos de cuenta) es un desplegable de verdad: flota ENCIMA del contenido
// (position absolute, ancho completo, con una sombra) en vez de empujarlo,
// y aparece un fondo oscuro semitransparente atrás que lo cierra si lo
// tocás. De "lg" para arriba sigue exactamente igual que siempre (columna
// fija al costado, sin desplegable, sin botón).
export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { accountName, email } = useCurrentAccount();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Si el menú móvil queda abierto y el usuario toca un link, se cierra
  // solo al cambiar de página — si no, la próxima pantalla aparece tapada.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  async function handleLogout() {
    await logout();
    router.push("/login");
  }

  return (
    <aside className="relative flex w-full shrink-0 flex-col border-b border-line bg-surface lg:w-56 lg:border-b-0 lg:border-r">
      <div className="relative z-50 flex items-center justify-between border-b border-line bg-surface px-5 py-4">
        <div className="flex items-center gap-2.5">
          <Image src="/logo/nuku-mark.png" alt="Nuku OS" width={28} height={28} className="rounded-full" />
          <div className="leading-tight">
            <span className="font-display block text-lg">Nuku OS</span>
            <span className="block text-[10px] uppercase tracking-[0.2em] text-terracotta">
              Hospitalidad, ordenada
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setMobileOpen((v) => !v)}
          aria-label={mobileOpen ? "Cerrar menú" : "Abrir menú"}
          aria-expanded={mobileOpen}
          className="rounded-lg border border-line p-2 text-lg leading-none text-ink-soft lg:hidden"
        >
          {mobileOpen ? "✕" : "☰"}
        </button>
      </div>

      {/* Fondo que tapa el resto de la pantalla mientras el desplegable está
          abierto — tocarlo lo cierra. Solo en celular; en desktop el menú
          nunca está "abierto/cerrado", así que esto no existe ahí. */}
      {mobileOpen && (
        <button
          type="button"
          aria-label="Cerrar menú"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-30 bg-ink/30 lg:hidden"
        />
      )}

      <div
        className={`${mobileOpen ? "flex" : "hidden"} absolute inset-x-0 top-full z-40 max-h-[calc(100vh-64px)] flex-col overflow-y-auto border-b border-line bg-surface shadow-lg lg:static lg:z-auto lg:flex lg:max-h-none lg:flex-1 lg:overflow-visible lg:border-b-0 lg:shadow-none`}
      >
        <nav className="flex flex-col gap-0.5 p-3 lg:flex-1">
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
          <p className="truncate text-[11px] font-medium text-ink-soft" title={accountName ?? undefined}>
            {accountName ?? "—"}
          </p>
          <p className="truncate text-[11px] text-ink-faint" title={email ?? undefined}>
            {email ?? ""}
          </p>
          <button
            type="button"
            onClick={handleLogout}
            className="mt-3 text-[11px] font-medium text-ink-soft underline decoration-line underline-offset-2 transition-colors hover:text-terracotta"
          >
            Cerrar sesión
          </button>
        </div>
      </div>
    </aside>
  );
}
