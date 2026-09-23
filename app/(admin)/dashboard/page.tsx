"use client";

import { useEffect, useState } from "react";
import TopBar from "@/components/admin/TopBar";
import KpiCard from "@/components/ui/KpiCard";
import Pill from "@/components/ui/Pill";
import { demoWorkspace } from "@/lib/mock-data";
import { formatMoney, formatDateRange } from "@/lib/format";
import { useCurrentAccount } from "@/lib/account-context";
import { authHeader } from "@/lib/supabase/auth-header";

// Resumen — pedido de Andre (23/9/2026): "sigue con ejemplos falsos que no
// se pueden modificar... no aparecieron mis nuevas reservas". Esta pantalla
// seguía 100% en datos de ejemplo (lib/mock-data.ts) desde la Fase 0,
// mientras que Reservas y Calendario ya se habían migrado a la tabla real
// `reservations` de Supabase. Ahora lee de la misma fuente que esas dos
// (GET /api/dashboard/reservations), con el mismo patrón de carga.
//
// "Ocupación" y "Reservas activas" ahora se calculan sobre HOY, no sobre
// "alguna vez confirmada" como hacía la versión de ejemplo — para que el
// número realmente responda "¿cuántas habitaciones están ocupadas ahora
// mismo?" en vez de contar reservas ya terminadas hace meses.

type Reservation = {
  id: string;
  check_in: string;
  check_out: string;
  status: "requested" | "confirmed" | "completed" | "cancelled";
  channel: string;
  payment_status: string;
  total_cents: number | null;
  guests: { full_name: string } | { full_name: string }[] | null;
  rooms: { name: string } | { name: string }[] | null;
};

type RoomOption = { id: string; name: string };

function one<T>(rel: T | T[] | null): T | null {
  if (!rel) return null;
  return Array.isArray(rel) ? rel[0] ?? null : rel;
}

function todayKey() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export default function DashboardPage() {
  const { accountId, accountName } = useCurrentAccount();
  const account = { ...demoWorkspace.account, name: accountName ?? demoWorkspace.account.name };
  const [reservations, setReservations] = useState<Reservation[] | null>(null);
  const [currency, setCurrency] = useState("CLP");
  const [rooms, setRooms] = useState<RoomOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accountId) return;
    (async () => {
      try {
        const res = await fetch("/api/dashboard/reservations", { headers: await authHeader() });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        setReservations(data.reservations);
        setCurrency(data.currency);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error desconocido");
      }
    })();
    fetch(`/api/public/rooms?account_id=${accountId}`)
      .then((res) => res.json())
      .then((data) => setRooms(data.error ? [] : data.rooms))
      .catch(() => setRooms([]));
  }, [accountId]);

  const today = todayKey();

  // Ocupadas ahora mismo: reservas confirmadas cuya estadía cubre hoy.
  const occupiedRoomIds = new Set(
    (reservations ?? [])
      .filter((r) => r.status === "confirmed" && r.check_in <= today && today < r.check_out)
      .map((r) => one(r.rooms)?.name ?? r.id)
  );
  const totalRooms = rooms?.length ?? 0;
  const occupancyPct = totalRooms > 0 ? Math.round((occupiedRoomIds.size / totalRooms) * 100) : 0;

  // Próximas llegadas: confirmadas o por confirmar, desde hoy en adelante.
  const upcoming = (reservations ?? [])
    .filter((r) => r.status !== "cancelled" && r.status !== "completed" && r.check_in >= today)
    .sort((a, b) => a.check_in.localeCompare(b.check_in))
    .slice(0, 10);

  const activeCount = (reservations ?? []).filter(
    (r) => (r.status === "confirmed" || r.status === "requested") && r.check_out > today
  ).length;

  const pendingPaymentCount = (reservations ?? []).filter(
    (r) => r.payment_status === "pending" && r.status !== "cancelled"
  ).length;

  const STATUS_LABEL: Record<string, string> = {
    requested: "Por confirmar",
    confirmed: "Confirmada",
    completed: "Completada",
    cancelled: "Cancelada",
  };

  return (
    <>
      <TopBar account={account} title="Resumen" />
      <main className="flex-1 space-y-8 p-6">
        {error && (
          <p className="max-w-2xl rounded-lg border border-rust/30 bg-rust-soft px-4 py-3 text-sm text-rust">
            {error}
          </p>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <KpiCard
            label="Ocupación"
            value={reservations === null ? "…" : `${occupancyPct}%`}
            hint={totalRooms > 0 ? `${occupiedRoomIds.size} de ${totalRooms} habitaciones (hoy)` : "sin habitaciones cargadas"}
          />
          <KpiCard
            label="Reservas activas"
            value={reservations === null ? "…" : String(activeCount)}
            hint="por confirmar o confirmadas, sin terminar"
          />
          <KpiCard
            label="Pagos pendientes"
            value={reservations === null ? "…" : String(pendingPaymentCount)}
            hint="reservas por cobrar"
          />
        </div>

        <section>
          <h2 className="mb-3 font-display text-lg">Próximas llegadas</h2>
          <div className="overflow-hidden rounded-xl border border-line bg-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-paper-alt text-left text-[11px] uppercase tracking-wide text-ink-faint">
                  <th className="px-4 py-2.5 font-medium">Huésped</th>
                  <th className="px-4 py-2.5 font-medium">Habitación</th>
                  <th className="px-4 py-2.5 font-medium">Fechas</th>
                  <th className="px-4 py-2.5 font-medium">Canal</th>
                  <th className="px-4 py-2.5 font-medium">Estado</th>
                  <th className="px-4 py-2.5 font-medium">Pago</th>
                </tr>
              </thead>
              <tbody>
                {reservations === null && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-xs text-ink-faint">
                      Cargando…
                    </td>
                  </tr>
                )}
                {reservations !== null && upcoming.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-xs text-ink-faint">
                      No hay llegadas próximas todavía.
                    </td>
                  </tr>
                )}
                {upcoming.map((r) => {
                  const guest = one(r.guests);
                  const room = one(r.rooms);
                  return (
                    <tr key={r.id} className="border-b border-line last:border-0">
                      <td className="px-4 py-3 font-medium">{guest?.full_name ?? "—"}</td>
                      <td className="px-4 py-3 text-ink-soft">{room?.name ?? "—"}</td>
                      <td className="px-4 py-3 text-ink-soft">{formatDateRange(r.check_in, r.check_out)}</td>
                      <td className="px-4 py-3">
                        <Pill tone="neutral">{r.channel}</Pill>
                      </td>
                      <td className="px-4 py-3">
                        <Pill tone={r.status === "confirmed" ? "sage" : "olive"}>
                          {STATUS_LABEL[r.status] ?? r.status}
                        </Pill>
                      </td>
                      <td className="px-4 py-3">
                        {r.payment_status === "paid" ? (
                          <Pill tone="sage">Pagado{r.total_cents != null ? ` · ${formatMoney(r.total_cents, currency)}` : ""}</Pill>
                        ) : (
                          <Pill tone="olive">Pendiente{r.total_cents != null ? ` · ${formatMoney(r.total_cents, currency)}` : ""}</Pill>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </>
  );
}
