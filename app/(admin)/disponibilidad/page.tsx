"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import TopBar from "@/components/admin/TopBar";
import { demoWorkspace } from "@/lib/mock-data";
import { useCurrentAccount } from "@/lib/account-context";
import { authHeader } from "@/lib/supabase/auth-header";

// 25/9/2026: pedido de Andre — "esta listo que habitaciones estan
// disponibles? cuales no? ... donde se ve eso de que habitaciones estan
// reservadas, cuales disponibles? que dias, que fechas etc?". El bloqueo
// de fechas ya existía (lib/availability.ts + la exclusion constraint de
// la base), pero no había ninguna vista que lo mostrara como un cuadro:
// Reservas es una lista, y Calendario está armado para el traslado al
// aeropuerto (llegadas/salidas), no para ver ocupación por habitación.
//
// Esta pantalla es SOLO de lectura a propósito: para editar una reserva
// (cambiar estado, cargar el vuelo, etc.) se sigue usando Reservas — acá
// el objetivo es que de un vistazo se vea qué habitación está libre y
// cuál no, qué días.
//
// Trae los datos de dos rutas que ya existían, sin agregar ninguna nueva:
// - /api/public/rooms (con account_id): la lista de habitaciones de la
//   cuenta. Si una habitación no tiene ninguna reserva, igual aparece acá
//   con su fila vacía — eso ES la respuesta a "cuál está disponible".
// - /api/dashboard/reservations (con sesión): las reservas, ahora con
//   room_id incluido (se agregó en esta misma tarea) para poder agrupar
//   cada reserva en la fila de su habitación.

type Room = { id: string; name: string; capacity: number; base_rate_cents: number | null };

type Reservation = {
  id: string;
  room_id: string | null;
  check_in: string;
  check_out: string;
  status: "requested" | "confirmed" | "completed" | "cancelled";
  guests: { full_name: string } | { full_name: string }[] | null;
  reservation_guests: { full_name: string; is_primary: boolean }[] | null;
};

function one<T>(rel: T | T[] | null): T | null {
  if (!rel) return null;
  return Array.isArray(rel) ? rel[0] ?? null : rel;
}

const STATUS_LABEL: Record<string, string> = {
  requested: "Por confirmar",
  confirmed: "Confirmada",
  completed: "Completada",
  cancelled: "Cancelada",
};

// Mismo color por estado que ya se usa en Reservas/Calendario (vía Pill),
// pero acá como relleno sólido porque cada reserva es una barra, no un chip.
const STATUS_BAR: Record<string, string> = {
  requested: "bg-olive",
  confirmed: "bg-sage",
  completed: "bg-ink-faint",
};

const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const MS_DAY = 86400000;
const DAY_COL_PX = 34;
const LABEL_COL_PX = 190;

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

function toUTCms(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function monthLabel(y: number, m: number) {
  const d = new Date(Date.UTC(y, m, 1));
  const label = new Intl.DateTimeFormat("es-CL", { month: "long", year: "numeric", timeZone: "UTC" }).format(d);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function dowMondayFirst(ms: number) {
  return (new Date(ms).getUTCDay() + 6) % 7; // lunes = 0
}

export default function DisponibilidadPage() {
  const { accountId, accountName } = useCurrentAccount();
  const account = { ...demoWorkspace.account, name: accountName ?? demoWorkspace.account.name };
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [reservations, setReservations] = useState<Reservation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { y: now.getFullYear(), m: now.getMonth() };
  });

  useEffect(() => {
    async function load() {
      if (!accountId) return;
      try {
        const [roomsRes, resvRes] = await Promise.all([
          fetch(`/api/public/rooms?account_id=${encodeURIComponent(accountId)}`),
          fetch("/api/dashboard/reservations", { headers: await authHeader() }),
        ]);
        const roomsData = await roomsRes.json();
        if (roomsData.error) throw new Error(roomsData.error);
        const resvData = await resvRes.json();
        if (resvData.error) throw new Error(resvData.error);
        setRooms(roomsData.rooms ?? []);
        setReservations(resvData.reservations ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error desconocido");
      }
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [accountId]);

  function changeMonth(delta: number) {
    setCursor((prev) => {
      const m = prev.m + delta;
      const y = prev.y + Math.floor(m / 12);
      const normalizedM = ((m % 12) + 12) % 12;
      return { y, m: normalizedM };
    });
  }

  const { y, m } = cursor;
  const monthStartMs = Date.UTC(y, m, 1);
  const monthEndExclusiveMs = Date.UTC(y, m + 1, 1);
  const totalDays = Math.round((monthEndExclusiveMs - monthStartMs) / MS_DAY);

  // Reservas agrupadas por habitación, recortadas al mes visible y
  // convertidas a "en qué columna del cuadro empieza y termina la barra".
  const barsByRoom = useMemo(() => {
    const map = new Map<
      string,
      { id: string; guestName: string; status: Reservation["status"]; startCol: number; endCol: number; check_in: string; check_out: string }[]
    >();
    if (!reservations) return map;
    for (const r of reservations) {
      if (r.status === "cancelled" || !r.room_id) continue;
      const ciMs = toUTCms(r.check_in);
      const coMs = toUTCms(r.check_out);
      if (coMs <= monthStartMs || ciMs >= monthEndExclusiveMs) continue; // no toca este mes

      const clipStartMs = Math.max(ciMs, monthStartMs);
      const clipEndMs = Math.min(coMs, monthEndExclusiveMs);
      const startIdx = Math.round((clipStartMs - monthStartMs) / MS_DAY);
      const endIdxExclusive = Math.round((clipEndMs - monthStartMs) / MS_DAY);

      const primary = (r.reservation_guests ?? []).find((p) => p.is_primary) ?? (r.reservation_guests ?? [])[0];
      const guest = one(r.guests);
      const guestName = primary?.full_name ?? guest?.full_name ?? "Huésped sin nombre";

      if (!map.has(r.room_id)) map.set(r.room_id, []);
      map.get(r.room_id)!.push({
        id: r.id,
        guestName,
        status: r.status,
        startCol: startIdx + 2, // +1 grilla 1-based, +1 por la columna de etiqueta
        endCol: endIdxExclusive + 2,
        check_in: r.check_in,
        check_out: r.check_out,
      });
    }
    return map;
  }, [reservations, monthStartMs, monthEndExclusiveMs]);

  const gridTemplateColumns = `${LABEL_COL_PX}px repeat(${totalDays}, ${DAY_COL_PX}px)`;
  const today = todayKey();

  return (
    <>
      <TopBar account={account} title="Disponibilidad" />
      <main className="flex-1 space-y-5 p-6">
        <p className="max-w-2xl text-sm text-ink-soft">
          Cuadro de ocupación: cada fila es una habitación, cada columna un día del mes. Una barra de color significa
          que esa habitación está tomada esos días — la fila vacía es lo que está libre. Para editar una reserva
          (confirmarla, cargar el vuelo, etc.) usa Reservas o Calendario; acá es solo para ver de un vistazo.
        </p>

        <div className="flex flex-wrap items-center gap-4 text-[11px] text-ink-soft">
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded bg-sage" /> Confirmada
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded bg-olive" /> Por confirmar
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded bg-ink-faint" /> Completada
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded border border-line" /> Libre
          </span>
        </div>

        {error && (
          <p className="max-w-2xl rounded-lg border border-rust/30 bg-rust-soft px-4 py-3 text-sm text-rust">
            {error}
          </p>
        )}

        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="flex items-center justify-between pb-3">
            <button
              type="button"
              onClick={() => changeMonth(-1)}
              className="rounded-lg border border-line px-2.5 py-1 text-sm text-ink-soft hover:bg-paper-alt"
            >
              ←
            </button>
            <p className="font-display text-lg text-ink">{monthLabel(y, m)}</p>
            <button
              type="button"
              onClick={() => changeMonth(1)}
              className="rounded-lg border border-line px-2.5 py-1 text-sm text-ink-soft hover:bg-paper-alt"
            >
              →
            </button>
          </div>

          {!rooms && !error && <p className="text-xs text-ink-faint">Cargando…</p>}

          {rooms && rooms.length === 0 && (
            <p className="text-xs text-ink-faint">Esta cuenta todavía no tiene habitaciones cargadas.</p>
          )}

          {rooms && rooms.length > 0 && (
            <div className="overflow-x-auto">
              <div
                className="inline-grid"
                style={{ gridTemplateColumns, gridAutoRows: `${DAY_COL_PX + 10}px` }}
              >
                {/* fila de encabezado: número de día por columna */}
                <div
                  className="sticky left-0 z-20 flex items-end border-b border-r border-line bg-surface px-3 pb-2"
                  style={{ gridColumn: 1, gridRow: 1 }}
                >
                  <span className="text-[11px] uppercase tracking-wide text-ink-faint">Habitación</span>
                </div>
                {Array.from({ length: totalDays }).map((_, i) => {
                  const key = dateKey(y, m, i + 1);
                  const dow = dowMondayFirst(monthStartMs + i * MS_DAY);
                  const isWeekend = dow === 5 || dow === 6;
                  const isToday = key === today;
                  return (
                    <div
                      key={key}
                      className={`flex flex-col items-center justify-end gap-0.5 border-b border-r border-line pb-1 text-[10px] ${
                        isToday ? "bg-terracotta/10 font-semibold text-terracotta" : isWeekend ? "bg-paper-alt text-ink-faint" : "text-ink-faint"
                      }`}
                      style={{ gridColumn: i + 2, gridRow: 1 }}
                      title={key}
                    >
                      <span>{WEEKDAYS[dow]}</span>
                      <span className="font-mono-ui tabular-nums">{i + 1}</span>
                    </div>
                  );
                })}

                {/* filas de habitaciones */}
                {rooms.map((room, rIdx) => {
                  const bars = barsByRoom.get(room.id) ?? [];
                  return (
                    <Fragment key={room.id}>
                      <div
                        className="sticky left-0 z-20 flex flex-col justify-center border-b border-r border-line bg-surface px-3"
                        style={{ gridColumn: 1, gridRow: rIdx + 2 }}
                      >
                        <span className="truncate text-sm font-medium text-ink">{room.name}</span>
                        <span className="text-[11px] text-ink-faint">{room.capacity} pax</span>
                      </div>

                      {Array.from({ length: totalDays }).map((_, i) => {
                        const dow = dowMondayFirst(monthStartMs + i * MS_DAY);
                        const isWeekend = dow === 5 || dow === 6;
                        const key = dateKey(y, m, i + 1);
                        const isToday = key === today;
                        return (
                          <div
                            key={i}
                            className={`border-b border-r border-line ${isToday ? "bg-terracotta/10" : isWeekend ? "bg-paper-alt" : ""}`}
                            style={{ gridColumn: i + 2, gridRow: rIdx + 2 }}
                          />
                        );
                      })}

                      {bars.map((bar) => (
                        <div
                          key={bar.id}
                          title={`${bar.guestName} · ${STATUS_LABEL[bar.status]} · ${bar.check_in} → ${bar.check_out}`}
                          className={`z-10 flex items-center truncate rounded-md px-2 text-[11px] font-medium text-white ${STATUS_BAR[bar.status]}`}
                          style={{ gridColumn: `${bar.startCol} / ${bar.endCol}`, gridRow: rIdx + 2, margin: "7px 2px" }}
                        >
                          {bar.guestName}
                        </div>
                      ))}
                    </Fragment>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
