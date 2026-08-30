"use client";

import { useEffect, useMemo, useState } from "react";
import TopBar from "@/components/admin/TopBar";
import Pill from "@/components/ui/Pill";
import { demoWorkspace } from "@/lib/mock-data";
import { CURRENT_ACCOUNT_ID } from "@/lib/current-account";

// Calendario operativo: el objetivo no es duplicar la tabla de Reservas,
// es responder rápido "¿quién llega o se va tal día, y a qué hora hay que
// estar en el aeropuerto?" — porque Kuhane busca y lleva de vuelta a cada
// huésped, así que la fecha sola no alcanza para organizar el traslado.

type Reservation = {
  id: string;
  check_in: string;
  check_out: string;
  status: "requested" | "confirmed" | "completed" | "cancelled";
  channel: string;
  guests: { full_name: string; email: string | null; phone: string | null } | { full_name: string; email: string | null; phone: string | null }[] | null;
  rooms: { name: string; base_rate_cents: number | null } | { name: string; base_rate_cents: number | null }[] | null;
  reservation_guests: { full_name: string; document_id: string | null; is_primary: boolean }[] | null;
  arrival_flight_time: string | null;
  arrival_flight_number: string | null;
  departure_flight_time: string | null;
  departure_flight_number: string | null;
  airport_transfer_notes: string | null;
};

function one<T>(rel: T | T[] | null): T | null {
  if (!rel) return null;
  return Array.isArray(rel) ? rel[0] ?? null : rel;
}

const STATUS_TONE = {
  requested: "olive",
  confirmed: "sage",
  completed: "neutral",
  cancelled: "rust",
} as const;

const STATUS_LABEL: Record<string, string> = {
  requested: "Por confirmar",
  confirmed: "Confirmada",
  completed: "Completada",
  cancelled: "Cancelada",
};

const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function dateKey(y: number, m: number, d: number) {
  return `${y}-${pad(m + 1)}-${pad(d)}`;
}

function todayKey() {
  const now = new Date();
  return dateKey(now.getFullYear(), now.getMonth(), now.getDate());
}

function monthLabel(y: number, m: number) {
  const d = new Date(Date.UTC(y, m, 1));
  const label = new Intl.DateTimeFormat("es-CL", { month: "long", year: "numeric", timeZone: "UTC" }).format(d);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function shortDate(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const label = new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "long", timeZone: "UTC" }).format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

type FlightForm = {
  arrival_flight_time: string;
  arrival_flight_number: string;
  departure_flight_time: string;
  departure_flight_number: string;
  airport_transfer_notes: string;
};

function toForm(r: Reservation): FlightForm {
  return {
    arrival_flight_time: r.arrival_flight_time ?? "",
    arrival_flight_number: r.arrival_flight_number ?? "",
    departure_flight_time: r.departure_flight_time ?? "",
    departure_flight_number: r.departure_flight_number ?? "",
    airport_transfer_notes: r.airport_transfer_notes ?? "",
  };
}

export default function CalendarioPage() {
  const { account } = demoWorkspace;
  const [reservations, setReservations] = useState<Reservation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { y: now.getFullYear(), m: now.getMonth() };
  });
  const [selected, setSelected] = useState<string>(todayKey());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FlightForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function load() {
    fetch(`/api/dashboard/reservations?account_id=${CURRENT_ACCOUNT_ID}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setReservations(data.reservations);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Error desconocido"));
  }

  useEffect(load, []);

  // Mapa día -> { arrivals, departures } excluyendo canceladas (no hay
  // traslado que coordinar para una reserva que no va a pasar).
  const byDay = useMemo(() => {
    const map = new Map<string, { arrivals: Reservation[]; departures: Reservation[] }>();
    if (!reservations) return map;
    for (const r of reservations) {
      if (r.status === "cancelled") continue;
      if (!map.has(r.check_in)) map.set(r.check_in, { arrivals: [], departures: [] });
      map.get(r.check_in)!.arrivals.push(r);
      if (!map.has(r.check_out)) map.set(r.check_out, { arrivals: [], departures: [] });
      map.get(r.check_out)!.departures.push(r);
    }
    return map;
  }, [reservations]);

  const grid = useMemo(() => {
    const { y, m } = cursor;
    const firstDow = (new Date(Date.UTC(y, m, 1)).getUTCDay() + 6) % 7; // lunes = 0
    const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const cells: { key: string | null; day: number | null }[] = [];
    for (let i = 0; i < firstDow; i++) cells.push({ key: null, day: null });
    for (let d = 1; d <= daysInMonth; d++) cells.push({ key: dateKey(y, m, d), day: d });
    while (cells.length % 7 !== 0) cells.push({ key: null, day: null });
    return cells;
  }, [cursor]);

  function changeMonth(delta: number) {
    setCursor((prev) => {
      const m = prev.m + delta;
      const y = prev.y + Math.floor(m / 12);
      const normalizedM = ((m % 12) + 12) % 12;
      return { y, m: normalizedM };
    });
  }

  function startEdit(r: Reservation) {
    setEditingId(r.id);
    setForm(toForm(r));
    setSaveError(null);
  }

  async function saveFlight(r: Reservation) {
    if (!form) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/dashboard/reservations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ account_id: CURRENT_ACCOUNT_ID, id: r.id, ...form }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setReservations((prev) => (prev ? prev.map((x) => (x.id === r.id ? { ...x, ...form } : x)) : prev));
      setEditingId(null);
      setForm(null);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "No se pudo guardar.");
    } finally {
      setSaving(false);
    }
  }

  const dayInfo = byDay.get(selected);
  const arrivals = dayInfo?.arrivals ?? [];
  const departures = dayInfo?.departures ?? [];

  function ReservationRow({ r, kind }: { r: Reservation; kind: "arrival" | "departure" }) {
    const guest = one(r.guests);
    const room = one(r.rooms);
    const primary = (r.reservation_guests ?? []).find((p) => p.is_primary) ?? (r.reservation_guests ?? [])[0];
    const isEditing = editingId === r.id;
    const time = kind === "arrival" ? r.arrival_flight_time : r.departure_flight_time;
    const flightNo = kind === "arrival" ? r.arrival_flight_number : r.departure_flight_number;

    return (
      <div className="rounded-lg border border-line bg-surface p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-sm font-medium text-ink">{guest?.full_name ?? "—"}</p>
            <p className="text-xs text-ink-faint">
              {room?.name ?? "—"}
              {guest?.phone ? ` · ${guest.phone}` : ""}
              {primary?.document_id ? ` · ${primary.document_id}` : ""}
            </p>
          </div>
          <Pill tone={STATUS_TONE[r.status] ?? "neutral"}>{STATUS_LABEL[r.status] ?? r.status}</Pill>
        </div>

        {!isEditing ? (
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <span className="font-mono-ui text-sm tabular-nums text-ink">
              {time ? time.slice(0, 5) : "Hora sin confirmar"}
              {flightNo ? ` · ${flightNo}` : ""}
            </span>
            <button
              type="button"
              onClick={() => startEdit(r)}
              className="text-xs text-terracotta underline decoration-dotted"
            >
              {time || flightNo ? "Editar" : "Agregar vuelo"}
            </button>
          </div>
        ) : (
          <div className="mt-3 space-y-2 border-t border-line pt-3">
            <div className="flex gap-2">
              <input
                type="time"
                value={kind === "arrival" ? form?.arrival_flight_time ?? "" : form?.departure_flight_time ?? ""}
                onChange={(e) =>
                  setForm((f) =>
                    f
                      ? {
                          ...f,
                          [kind === "arrival" ? "arrival_flight_time" : "departure_flight_time"]: e.target.value,
                        }
                      : f
                  )
                }
                className="w-1/2 rounded-lg border border-line bg-paper px-2 py-1.5 text-sm outline-none focus:border-terracotta"
              />
              <input
                value={kind === "arrival" ? form?.arrival_flight_number ?? "" : form?.departure_flight_number ?? ""}
                onChange={(e) =>
                  setForm((f) =>
                    f
                      ? {
                          ...f,
                          [kind === "arrival" ? "arrival_flight_number" : "departure_flight_number"]: e.target.value,
                        }
                      : f
                  )
                }
                placeholder="N° de vuelo"
                className="w-1/2 rounded-lg border border-line bg-paper px-2 py-1.5 text-sm outline-none focus:border-terracotta"
              />
            </div>
            <textarea
              value={form?.airport_transfer_notes ?? ""}
              onChange={(e) => setForm((f) => (f ? { ...f, airport_transfer_notes: e.target.value } : f))}
              placeholder="Notas del traslado (ej: llega con otro vuelo de conexión, pidió esperar a un amigo, etc.)"
              rows={2}
              className="w-full rounded-lg border border-line bg-paper px-2 py-1.5 text-sm outline-none focus:border-terracotta"
            />
            {saveError && <p className="text-[11px] text-rust">{saveError}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => saveFlight(r)}
                className="rounded-lg bg-terracotta px-3 py-1.5 text-xs font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {saving ? "Guardando…" : "Guardar"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingId(null);
                  setForm(null);
                }}
                className="text-xs text-ink-faint hover:text-ink"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        {!isEditing && r.airport_transfer_notes && (
          <p className="mt-2 text-xs text-ink-faint">Nota: {r.airport_transfer_notes}</p>
        )}
      </div>
    );
  }

  return (
    <>
      <TopBar account={account} title="Calendario" />
      <main className="flex-1 space-y-5 p-6">
        <p className="max-w-2xl text-sm text-ink-soft">
          Vista por día de quién llega y quién se va — pensada para organizar el traslado al aeropuerto, ya que Kuhane
          busca y lleva de vuelta a cada huésped. Elegí un día para ver los detalles y cargar hora de vuelo.
        </p>

        {error && (
          <p className="max-w-2xl rounded-lg border border-rust/30 bg-rust-soft px-4 py-3 text-sm text-rust">
            {error}
          </p>
        )}

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px]">
          <div className="rounded-xl border border-line bg-surface p-4">
            <div className="flex items-center justify-between px-1 pb-3">
              <button
                type="button"
                onClick={() => changeMonth(-1)}
                className="rounded-lg border border-line px-2.5 py-1 text-sm text-ink-soft hover:bg-paper-alt"
              >
                ←
              </button>
              <p className="font-display text-lg text-ink">{monthLabel(cursor.y, cursor.m)}</p>
              <button
                type="button"
                onClick={() => changeMonth(1)}
                className="rounded-lg border border-line px-2.5 py-1 text-sm text-ink-soft hover:bg-paper-alt"
              >
                →
              </button>
            </div>

            <div className="grid grid-cols-7 gap-1.5 px-1 pb-1.5 text-center text-[11px] uppercase tracking-wide text-ink-faint">
              {WEEKDAYS.map((w) => (
                <div key={w}>{w}</div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1.5 px-1">
              {grid.map((cell, i) => {
                if (!cell.key) return <div key={i} />;
                const info = byDay.get(cell.key);
                const arrivalCount = info?.arrivals.length ?? 0;
                const departureCount = info?.departures.length ?? 0;
                const isSelected = selected === cell.key;
                const isToday = cell.key === todayKey();
                return (
                  <button
                    key={cell.key}
                    type="button"
                    onClick={() => setSelected(cell.key!)}
                    className={`flex min-h-[64px] flex-col items-start gap-1 rounded-lg border p-1.5 text-left transition-colors ${
                      isSelected
                        ? "border-terracotta bg-terracotta/10"
                        : isToday
                        ? "border-olive/50 bg-olive-soft/40"
                        : "border-line bg-paper hover:bg-paper-alt"
                    }`}
                  >
                    <span className="font-mono-ui text-xs tabular-nums text-ink-soft">{cell.day}</span>
                    <div className="flex flex-wrap gap-1">
                      {arrivalCount > 0 && (
                        <span className="rounded-full bg-sage-soft px-1.5 text-[10px] font-semibold text-sage">
                          ↓{arrivalCount}
                        </span>
                      )}
                      {departureCount > 0 && (
                        <span className="rounded-full bg-rust-soft px-1.5 text-[10px] font-semibold text-rust">
                          ↑{departureCount}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="mt-3 flex gap-4 px-1 text-[11px] text-ink-faint">
              <span>
                <span className="mr-1 rounded-full bg-sage-soft px-1.5 text-sage">↓</span> llegan
              </span>
              <span>
                <span className="mr-1 rounded-full bg-rust-soft px-1.5 text-rust">↑</span> se van
              </span>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-line bg-surface p-4">
              <p className="font-display text-base text-ink">{shortDate(selected)}</p>

              {!reservations && !error && <p className="mt-2 text-xs text-ink-faint">Cargando…</p>}

              {reservations && arrivals.length === 0 && departures.length === 0 && (
                <p className="mt-2 text-xs text-ink-faint">Nadie llega ni se va este día.</p>
              )}

              {arrivals.length > 0 && (
                <div className="mt-3">
                  <p className="font-mono-ui text-[11px] uppercase tracking-widest text-sage">
                    Llegan — buscar en el aeropuerto
                  </p>
                  <div className="mt-2 space-y-2">
                    {arrivals.map((r) => (
                      <ReservationRow key={`${r.id}-arr`} r={r} kind="arrival" />
                    ))}
                  </div>
                </div>
              )}

              {departures.length > 0 && (
                <div className="mt-4">
                  <p className="font-mono-ui text-[11px] uppercase tracking-widest text-rust">
                    Se van — llevar al aeropuerto
                  </p>
                  <div className="mt-2 space-y-2">
                    {departures.map((r) => (
                      <ReservationRow key={`${r.id}-dep`} r={r} kind="departure" />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
