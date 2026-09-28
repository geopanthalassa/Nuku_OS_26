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
  guests: ({ full_name: string; email?: string | null; phone?: string | null }) | ({ full_name: string; email?: string | null; phone?: string | null })[] | null;
  rooms: { name: string } | { name: string }[] | null;
  // 23/9/2026: el nombre declarado en la reserva (titular) — la API ya lo
  // manda, solo faltaba usarlo acá. Ver nota junto a la tabla de abajo.
  reservation_guests: { full_name: string; is_primary: boolean; phone?: string | null; email?: string | null }[] | null;
  // 27/9/2026: pedido de Andre — para la tarjeta "Se van hoy". Estos tres
  // campos ya existen en `reservations` (carga de vuelo/traslado desde la
  // ficha de la reserva) y la API ya los manda; solo faltaba pedirlos acá.
  departure_flight_time: string | null;
  departure_flight_number: string | null;
  airport_transfer_notes: string | null;
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

// 27/9/2026: pedido de Andre — el mismo aviso que se manda por WhatsApp al
// equipo (ver renderUpcomingArrivalsStaffDigest en lib/automations.ts)
// también tiene que verse acá en el panel, sin depender de WhatsApp. Mismo
// criterio de fecha (UTC + 3 días) que usa esa función, para que panel y
// WhatsApp hablen siempre del mismo día.
function dateInThreeDaysKey() {
  const target = new Date();
  target.setUTCDate(target.getUTCDate() + 3);
  return target.toISOString().slice(0, 10);
}

// 28/9/2026: pedido de Andre — "podrías poner, mañana check out de...".
// Aviso adelantado de las salidas de MAÑANA (no solo las de hoy), para que
// el equipo pueda preparar el traslado al aeropuerto con un día de anticipo
// en vez de enterarse recién esa misma mañana.
function tomorrowKey() {
  const target = new Date();
  target.setDate(target.getDate() + 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}`;
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

  // Llegadas en 3 días: mismo recorte que usa el aviso interno por WhatsApp,
  // pero calculado acá con lo que ya se cargó para "Próximas llegadas" — no
  // hace falta pedirle nada nuevo al servidor.
  const arrivalsTargetDate = dateInThreeDaysKey();
  const arrivingInThreeDays = (reservations ?? []).filter(
    (r) => r.status === "confirmed" && r.check_in === arrivalsTargetDate
  );

  // 27/9/2026: pedido de Andre — "quienes se van al aeropuerto hoy, habitación
  // tanto pasajera tanto tiene traslado al aeropuerto". Reservas confirmadas
  // cuyo check-out es hoy: quién se va, de qué habitación, y si ya quedó
  // coordinado un traslado (vuelo/hora cargados en la ficha) o si todavía
  // hay que preguntarle al huésped.
  const departingToday = (reservations ?? []).filter((r) => r.status === "confirmed" && r.check_out === today);

  // 28/9/2026: mismo criterio que "Se van hoy" pero un día antes, para
  // avisar con anticipación en vez de recién la misma mañana.
  const tomorrow = tomorrowKey();
  const departingTomorrow = (reservations ?? []).filter((r) => r.status === "confirmed" && r.check_out === tomorrow);

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

        {reservations !== null && arrivingInThreeDays.length > 0 && (
          <section className="rounded-xl border border-terracotta/30 bg-terracotta-bright/10 p-4">
            <h2 className="mb-3 font-display text-lg text-terracotta">
              Llegan en 3 días · para preparar
            </h2>
            <ul className="space-y-2">
              {arrivingInThreeDays.map((r) => {
                const guest = one(r.guests);
                const room = one(r.rooms);
                const people = r.reservation_guests ?? [];
                const primaryGuest = people.find((p) => p.is_primary) ?? people[0];
                const displayName = primaryGuest?.full_name ?? guest?.full_name ?? "—";
                const contacto = primaryGuest?.phone || primaryGuest?.email || guest?.phone || guest?.email;
                return (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface px-3 py-2 text-sm"
                  >
                    <span className="font-medium">{displayName}</span>
                    <span className="text-ink-soft">{room?.name ?? "—"}</span>
                    <span className="text-ink-soft">hasta {r.check_out}</span>
                    <span className="text-ink-faint">{contacto ?? "sin contacto registrado"}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {reservations !== null && departingToday.length > 0 && (
          <section className="rounded-xl border border-sage/30 bg-sage-soft/20 p-4">
            <h2 className="mb-3 font-display text-lg text-sage">Se van hoy</h2>
            <ul className="space-y-2">
              {departingToday.map((r) => {
                const guest = one(r.guests);
                const room = one(r.rooms);
                const people = r.reservation_guests ?? [];
                const primaryGuest = people.find((p) => p.is_primary) ?? people[0];
                const displayName = primaryGuest?.full_name ?? guest?.full_name ?? "—";
                const hasTransfer = Boolean(
                  r.departure_flight_time || r.departure_flight_number || r.airport_transfer_notes
                );
                return (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface px-3 py-2 text-sm"
                  >
                    <span className="font-medium">{displayName}</span>
                    <span className="text-ink-soft">{room?.name ?? "—"}</span>
                    {hasTransfer ? (
                      <span className="flex items-center gap-1.5 text-ink-soft">
                        <Pill tone="sage">Traslado coordinado</Pill>
                        {r.departure_flight_time ?? ""}
                        {r.departure_flight_number ? ` · ${r.departure_flight_number}` : ""}
                      </span>
                    ) : (
                      <Pill tone="olive">Sin traslado coordinado</Pill>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {reservations !== null && departingTomorrow.length > 0 && (
          <section className="rounded-xl border border-line bg-paper-alt/60 p-4">
            <h2 className="mb-3 font-display text-lg text-ink">Mañana se van</h2>
            <ul className="space-y-2">
              {departingTomorrow.map((r) => {
                const guest = one(r.guests);
                const room = one(r.rooms);
                const people = r.reservation_guests ?? [];
                const primaryGuest = people.find((p) => p.is_primary) ?? people[0];
                const displayName = primaryGuest?.full_name ?? guest?.full_name ?? "—";
                const hasTransfer = Boolean(
                  r.departure_flight_time || r.departure_flight_number || r.airport_transfer_notes
                );
                return (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface px-3 py-2 text-sm"
                  >
                    <span className="font-medium">{displayName}</span>
                    <span className="text-ink-soft">{room?.name ?? "—"}</span>
                    {hasTransfer ? (
                      <span className="flex items-center gap-1.5 text-ink-soft">
                        <Pill tone="sage">Traslado coordinado</Pill>
                        {r.departure_flight_time ?? ""}
                        {r.departure_flight_number ? ` · ${r.departure_flight_number}` : ""}
                      </span>
                    ) : (
                      <Pill tone="olive">Sin traslado coordinado</Pill>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

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
                  // 23/9/2026: mismo arreglo que en Reservas y Calendario —
                  // mostrar el nombre declarado en ESTA reserva, no el del
                  // contacto reutilizado (ver lib/guest-match.ts).
                  const people = r.reservation_guests ?? [];
                  const primaryGuest = people.find((p) => p.is_primary) ?? people[0];
                  const displayName = primaryGuest?.full_name ?? guest?.full_name ?? "—";
                  return (
                    <tr key={r.id} className="border-b border-line last:border-0">
                      <td className="px-4 py-3 font-medium">{displayName}</td>
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
