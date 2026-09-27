"use client";

import { useEffect, useMemo, useState } from "react";
import TopBar from "@/components/admin/TopBar";
import Pill from "@/components/ui/Pill";
import { demoWorkspace } from "@/lib/mock-data";
import { formatDateRange } from "@/lib/format";
import { useCurrentAccount } from "@/lib/account-context";
import { authHeader } from "@/lib/supabase/auth-header";

// Huéspedes — pedido de Andre (23/9/2026): "sigue con ejemplos falsos que
// no se pueden modificar". Igual que pasó con Resumen, esta pantalla se
// había quedado 100% en datos de ejemplo (lib/mock-data.ts) desde la Fase
// 0. No existe todavía una tabla "un huésped, una ficha" aparte — se arma
// acá agrupando las reservas reales (GET /api/dashboard/reservations) por
// guest_id, que es la misma fuente que ya usan Reservas y Calendario.
//
// 27/9/2026: pedido de Andre — "huéspedes quedó exactamente igual... no me
// sirve una página de pasajeros infinita, de qué le sirve en practicidad a
// Kuhane?". Tenía razón: una grilla de tarjetas sin buscador ni contacto
// visible, con Booking.com trayendo decenas de huéspedes por temporada, se
// vuelve una pared que hay que scrollear a ciegas. Se pasa a tabla (mismo
// lenguaje que Reservas/Automatizaciones), con buscador por nombre y el
// teléfono/correo a la vista — para que el equipo pueda ubicar y contactar
// a alguien sin abrir reserva por reserva. "Repite" marca a quien ya se
// quedó más de una vez (útil para reconocerlo/tratarlo distinto), y la
// tabla sigue ordenada por última estadía, la más reciente arriba.

const SOURCE_LABEL: Record<string, string> = {
  direct: "Directo",
  booking: "Booking.com",
  airbnb: "Airbnb",
  instagram: "Instagram",
  phone: "Teléfono",
  whatsapp: "WhatsApp",
  walk_in: "Llegó directo (walk-in)",
  other: "Otro",
};

type Reservation = {
  id: string;
  guest_id: string;
  status: "requested" | "confirmed" | "completed" | "cancelled";
  channel: string;
  check_in: string;
  check_out: string;
  guests: { full_name: string; email: string | null; phone: string | null } | { full_name: string; email: string | null; phone: string | null }[] | null;
  reservation_guests: { nationality: string | null; document_id: string | null; is_primary: boolean }[] | null;
};

function one<T>(rel: T | T[] | null): T | null {
  if (!rel) return null;
  return Array.isArray(rel) ? rel[0] ?? null : rel;
}

export default function HuespedesPage() {
  const { accountId, accountName } = useCurrentAccount();
  const account = { ...demoWorkspace.account, name: accountName ?? demoWorkspace.account.name };
  const [reservations, setReservations] = useState<Reservation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!accountId) return;
    (async () => {
      try {
        const res = await fetch("/api/dashboard/reservations", { headers: await authHeader() });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        setReservations(data.reservations);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error desconocido");
      }
    })();
  }, [accountId]);

  const guestCards = useMemo(() => {
    if (!reservations) return [];
    const byGuest = new Map<
      string,
      {
        fullName: string;
        source: string;
        nationality: string | null;
        phone: string | null;
        email: string | null;
        stayCount: number;
        lastCheckIn: string;
        lastCheckOut: string;
      }
    >();
    for (const r of reservations) {
      if (r.status === "cancelled") continue;
      const g = one(r.guests);
      const primary = (r.reservation_guests ?? []).find((p) => p.is_primary) ?? (r.reservation_guests ?? [])[0];
      const existing = byGuest.get(r.guest_id);
      if (existing) {
        existing.stayCount += 1;
        if (r.check_in > existing.lastCheckIn) {
          existing.lastCheckIn = r.check_in;
          existing.lastCheckOut = r.check_out;
        }
        if (!existing.nationality && primary?.nationality) existing.nationality = primary.nationality;
        if (!existing.phone && g?.phone) existing.phone = g.phone;
        if (!existing.email && g?.email) existing.email = g.email;
      } else {
        byGuest.set(r.guest_id, {
          fullName: g?.full_name ?? "[POR CONFIRMAR]",
          source: r.channel,
          nationality: primary?.nationality ?? null,
          phone: g?.phone ?? null,
          email: g?.email ?? null,
          stayCount: 1,
          lastCheckIn: r.check_in,
          lastCheckOut: r.check_out,
        });
      }
    }
    return Array.from(byGuest.entries())
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.lastCheckIn.localeCompare(a.lastCheckIn));
  }, [reservations]);

  const filteredGuestCards = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return guestCards;
    return guestCards.filter(
      (g) =>
        g.fullName.toLowerCase().includes(q) ||
        (g.phone ?? "").toLowerCase().includes(q) ||
        (g.email ?? "").toLowerCase().includes(q)
    );
  }, [guestCards, search]);

  return (
    <>
      <TopBar account={account} title="Huéspedes" />
      <main className="flex-1 space-y-5 p-6">
        {error && (
          <p className="max-w-2xl rounded-lg border border-rust/30 bg-rust-soft px-4 py-3 text-sm text-rust">
            {error}
          </p>
        )}

        {reservations === null && !error && <p className="text-xs text-ink-faint">Cargando…</p>}

        {reservations !== null && guestCards.length === 0 && (
          <p className="text-xs text-ink-faint">Todavía no hay huéspedes registrados.</p>
        )}

        {reservations !== null && guestCards.length > 0 && (
          <>
            <div className="flex items-center justify-between gap-3">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nombre, teléfono o correo…"
                className="w-full max-w-sm rounded-lg border border-line bg-paper px-3 py-1.5 text-sm text-ink outline-none focus:border-terracotta"
              />
              <span className="whitespace-nowrap text-xs text-ink-faint">
                {filteredGuestCards.length} de {guestCards.length}
              </span>
            </div>

            {filteredGuestCards.length === 0 ? (
              <p className="text-xs text-ink-faint">Nadie coincide con “{search}”.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-line bg-surface">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line bg-paper-alt text-left text-[11px] uppercase tracking-wide text-ink-faint">
                      <th className="px-4 py-2.5 font-medium">Huésped</th>
                      <th className="px-4 py-2.5 font-medium">Contacto</th>
                      <th className="px-4 py-2.5 font-medium">Canal</th>
                      <th className="px-4 py-2.5 font-medium">Nacionalidad</th>
                      <th className="px-4 py-2.5 font-medium">Estadías</th>
                      <th className="px-4 py-2.5 font-medium">Última estadía</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredGuestCards.map((g) => (
                      <tr key={g.id} className="border-b border-line last:border-0">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-terracotta font-mono-ui text-[11px] font-semibold text-paper">
                              {g.fullName
                                .split(" ")
                                .map((p) => p[0])
                                .slice(0, 2)
                                .join("")}
                            </div>
                            <span className="font-medium">{g.fullName}</span>
                            {g.stayCount > 1 && <Pill tone="sage">Repite</Pill>}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-ink-soft">
                          {g.phone || g.email ? (
                            <div className="flex flex-col">
                              {g.phone && <span>{g.phone}</span>}
                              {g.email && <span className="text-xs text-ink-faint">{g.email}</span>}
                            </div>
                          ) : (
                            <span className="text-xs text-ink-faint">Sin contacto registrado</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <Pill tone="neutral">{SOURCE_LABEL[g.source] ?? g.source}</Pill>
                        </td>
                        <td className="px-4 py-3">
                          {g.nationality ? <Pill tone="olive">{g.nationality}</Pill> : <span className="text-xs text-ink-faint">—</span>}
                        </td>
                        <td className="px-4 py-3 tabular-nums text-ink-soft">{g.stayCount}</td>
                        <td className="px-4 py-3 text-ink-soft">{formatDateRange(g.lastCheckIn, g.lastCheckOut)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}
