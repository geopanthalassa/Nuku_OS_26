"use client";

import { useEffect, useMemo, useState } from "react";
import TopBar from "@/components/admin/TopBar";
import Pill from "@/components/ui/Pill";
import { demoWorkspace } from "@/lib/mock-data";
import { useCurrentAccount } from "@/lib/account-context";
import { authHeader } from "@/lib/supabase/auth-header";

// Huéspedes — pedido de Andre (23/9/2026): "sigue con ejemplos falsos que
// no se pueden modificar". Igual que pasó con Resumen, esta pantalla se
// había quedado 100% en datos de ejemplo (lib/mock-data.ts) desde la Fase
// 0. No existe todavía una tabla "un huésped, una ficha" aparte — se arma
// acá agrupando las reservas reales (GET /api/dashboard/reservations) por
// guest_id, que es la misma fuente que ya usan Reservas y Calendario.

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
      { fullName: string; source: string; nationality: string | null; stayCount: number; lastCheckIn: string }
    >();
    for (const r of reservations) {
      if (r.status === "cancelled") continue;
      const g = one(r.guests);
      const primary = (r.reservation_guests ?? []).find((p) => p.is_primary) ?? (r.reservation_guests ?? [])[0];
      const existing = byGuest.get(r.guest_id);
      if (existing) {
        existing.stayCount += 1;
        if (r.check_in > existing.lastCheckIn) existing.lastCheckIn = r.check_in;
        if (!existing.nationality && primary?.nationality) existing.nationality = primary.nationality;
      } else {
        byGuest.set(r.guest_id, {
          fullName: g?.full_name ?? "[POR CONFIRMAR]",
          source: r.channel,
          nationality: primary?.nationality ?? null,
          stayCount: 1,
          lastCheckIn: r.check_in,
        });
      }
    }
    return Array.from(byGuest.entries())
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.lastCheckIn.localeCompare(a.lastCheckIn));
  }, [reservations]);

  return (
    <>
      <TopBar account={account} title="Huéspedes" />
      <main className="flex-1 space-y-5 p-6">
        <p className="max-w-2xl text-sm text-ink-soft">
          CRM (Fase 3 del plan): una ficha por huésped en vez de repartida
          entre WhatsApp, Instagram y la memoria de quien atendió. Acá
          todavía es una lista simple, armada con tus reservas reales — el
          historial detallado y las automatizaciones de reseña se agregan en
          la siguiente etapa.
        </p>

        {error && (
          <p className="max-w-2xl rounded-lg border border-rust/30 bg-rust-soft px-4 py-3 text-sm text-rust">
            {error}
          </p>
        )}

        {reservations === null && !error && <p className="text-xs text-ink-faint">Cargando…</p>}

        {reservations !== null && guestCards.length === 0 && (
          <p className="text-xs text-ink-faint">Todavía no hay huéspedes registrados.</p>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {guestCards.map((g) => (
            <div key={g.id} className="rounded-xl border border-line bg-surface p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-terracotta font-mono-ui text-xs font-semibold text-paper">
                  {g.fullName
                    .split(" ")
                    .map((p) => p[0])
                    .slice(0, 2)
                    .join("")}
                </div>
                <div>
                  <div className="text-sm font-medium">{g.fullName}</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <Pill tone="neutral">{SOURCE_LABEL[g.source] ?? g.source}</Pill>
                    {g.nationality && <Pill tone="olive">{g.nationality}</Pill>}
                  </div>
                </div>
              </div>
              <div className="mt-3 text-xs text-ink-faint">
                {g.stayCount} {g.stayCount === 1 ? "estadía" : "estadías"} registradas
              </div>
            </div>
          ))}
        </div>
      </main>
    </>
  );
}
