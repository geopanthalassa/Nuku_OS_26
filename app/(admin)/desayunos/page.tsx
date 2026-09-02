"use client";

import { useEffect, useMemo, useState } from "react";
import TopBar from "@/components/admin/TopBar";
import Pill from "@/components/ui/Pill";
import { demoWorkspace } from "@/lib/mock-data";
import { useCurrentAccount } from "@/lib/account-context";
import { authHeader } from "@/lib/supabase/auth-header";

// Ficha de desayunos: la cocina necesita saber, cada mañana, quién está
// alojado y si hay alguna restricción alimentaria (vegano, vegetariano,
// celíaco, sin lactosa, otra alergia) o alguna necesidad de movilidad —
// para tenerlo resuelto antes de que el huésped baje a desayunar, no
// preguntando en la mesa. Esta pantalla junta esos datos por día y deja
// cargarlos/corregirlos ahí mismo (útil para reservas que no entraron por
// el formulario público de /reservar, como las de Booking o Airbnb).

type Guest = {
  id: string;
  full_name: string;
  is_primary: boolean;
  dietary_vegan: boolean;
  dietary_vegetarian: boolean;
  dietary_celiac: boolean;
  dietary_lactose_free: boolean;
  dietary_other: string | null;
  mobility_assistance: boolean;
  mobility_notes: string | null;
};

type Reservation = {
  id: string;
  check_in: string;
  check_out: string;
  status: "requested" | "confirmed" | "completed" | "cancelled";
  rooms: { name: string } | { name: string }[] | null;
  reservation_guests: Guest[] | null;
};

function one<T>(rel: T | T[] | null): T | null {
  if (!rel) return null;
  return Array.isArray(rel) ? rel[0] ?? null : rel;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function addDays(key: string, delta: number) {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + delta);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function longDate(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const label = new Intl.DateTimeFormat("es-CL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

const DIETARY_FIELDS = [
  ["dietary_vegan", "Vegano"],
  ["dietary_vegetarian", "Vegetariano"],
  ["dietary_celiac", "Celíaco"],
  ["dietary_lactose_free", "Sin lactosa"],
] as const;

type EditForm = {
  dietary_vegan: boolean;
  dietary_vegetarian: boolean;
  dietary_celiac: boolean;
  dietary_lactose_free: boolean;
  dietary_other: string;
  mobility_assistance: boolean;
  mobility_notes: string;
};

function toForm(g: Guest): EditForm {
  return {
    dietary_vegan: g.dietary_vegan,
    dietary_vegetarian: g.dietary_vegetarian,
    dietary_celiac: g.dietary_celiac,
    dietary_lactose_free: g.dietary_lactose_free,
    dietary_other: g.dietary_other ?? "",
    mobility_assistance: g.mobility_assistance,
    mobility_notes: g.mobility_notes ?? "",
  };
}

export default function DesayunosPage() {
  const { accountId, accountName } = useCurrentAccount();
  const account = { ...demoWorkspace.account, name: accountName ?? demoWorkspace.account.name };
  const [reservations, setReservations] = useState<Reservation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(todayKey());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<EditForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function load() {
    if (!accountId) return;
    try {
      const res = await fetch("/api/dashboard/reservations", { headers: await authHeader() });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setReservations(data.reservations);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  // Alojados el día seleccionado: reservas confirmadas cuya estadía cubre
  // esa fecha (incluye el día de check-out, porque todavía desayunan antes
  // de irse).
  const staying = useMemo(() => {
    if (!reservations) return [];
    return reservations
      .filter((r) => r.status === "confirmed" && r.check_in <= selected && r.check_out >= selected)
      .sort((a, b) => {
        const roomA = one(a.rooms)?.name ?? "";
        const roomB = one(b.rooms)?.name ?? "";
        return roomA.localeCompare(roomB);
      });
  }, [reservations, selected]);

  const totalGuests = staying.reduce((sum, r) => sum + (r.reservation_guests?.length || 1), 0);
  const withRestrictions = staying.reduce(
    (sum, r) =>
      sum +
      (r.reservation_guests ?? []).filter(
        (g) =>
          g.dietary_vegan ||
          g.dietary_vegetarian ||
          g.dietary_celiac ||
          g.dietary_lactose_free ||
          !!g.dietary_other ||
          g.mobility_assistance
      ).length,
    0
  );

  function startEdit(g: Guest) {
    setEditingId(g.id);
    setForm(toForm(g));
    setSaveError(null);
  }

  async function save(guestId: string) {
    if (!form || !accountId) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/dashboard/reservation-guests", {
        method: "POST",
        headers: { "content-type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ id: guestId, ...form }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setReservations((prev) =>
        prev
          ? prev.map((r) => ({
              ...r,
              reservation_guests: (r.reservation_guests ?? []).map((g) =>
                g.id === guestId ? { ...g, ...form, dietary_other: form.dietary_other || null, mobility_notes: form.mobility_notes || null } : g
              ),
            }))
          : prev
      );
      setEditingId(null);
      setForm(null);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "No se pudo guardar.");
    } finally {
      setSaving(false);
    }
  }

  function GuestRow({ g }: { g: Guest }) {
    const isEditing = editingId === g.id;
    const tags = DIETARY_FIELDS.filter(([field]) => g[field]).map(([, label]) => label);

    if (!isEditing) {
      const hasInfo = tags.length > 0 || g.dietary_other || g.mobility_assistance;
      return (
        <li className="flex flex-wrap items-center gap-1.5 py-1.5 text-sm">
          <span className="font-medium text-ink">{g.full_name}</span>
          {g.is_primary && <Pill tone="neutral">Titular</Pill>}
          {tags.map((tag) => (
            <Pill key={tag} tone="olive">
              {tag}
            </Pill>
          ))}
          {g.dietary_other && <span className="text-xs text-terracotta">· {g.dietary_other}</span>}
          {g.mobility_assistance && (
            <Pill tone="rust">Movilidad{g.mobility_notes ? `: ${g.mobility_notes}` : ""}</Pill>
          )}
          {!hasInfo && <span className="text-xs text-ink-faint">Sin preferencias registradas</span>}
          <button
            type="button"
            onClick={() => startEdit(g)}
            className="ml-auto text-xs text-terracotta underline decoration-dotted print:hidden"
          >
            {hasInfo ? "Editar" : "Agregar"}
          </button>
        </li>
      );
    }

    return (
      <li className="rounded-lg border border-terracotta/40 bg-terracotta/5 p-3 print:hidden">
        <p className="text-sm font-medium text-ink">{g.full_name}</p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
          {DIETARY_FIELDS.map(([field, label]) => (
            <label key={field} className="flex items-center gap-1.5 text-sm text-ink">
              <input
                type="checkbox"
                checked={form?.[field] ?? false}
                onChange={(e) => setForm((f) => (f ? { ...f, [field]: e.target.checked } : f))}
                className="h-4 w-4 rounded border-line accent-terracotta"
              />
              {label}
            </label>
          ))}
        </div>
        <input
          value={form?.dietary_other ?? ""}
          onChange={(e) => setForm((f) => (f ? { ...f, dietary_other: e.target.value } : f))}
          placeholder="Otra alergia o preferencia alimentaria"
          className="mt-2 w-full rounded-lg border border-line bg-paper px-3 py-1.5 text-sm outline-none focus:border-terracotta"
        />
        <label className="mt-3 flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={form?.mobility_assistance ?? false}
            onChange={(e) => setForm((f) => (f ? { ...f, mobility_assistance: e.target.checked } : f))}
            className="h-4 w-4 rounded border-line accent-terracotta"
          />
          Necesita asistencia de movilidad
        </label>
        {form?.mobility_assistance && (
          <input
            value={form?.mobility_notes ?? ""}
            onChange={(e) => setForm((f) => (f ? { ...f, mobility_notes: e.target.value } : f))}
            placeholder="Detalle (silla de ruedas, dificultad para escaleras, etc.)"
            className="mt-2 w-full rounded-lg border border-line bg-paper px-3 py-1.5 text-sm outline-none focus:border-terracotta"
          />
        )}
        {saveError && <p className="mt-2 text-[11px] text-rust">{saveError}</p>}
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={() => save(g.id)}
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
      </li>
    );
  }

  return (
    <>
      <TopBar account={account} title="Desayunos" />
      <main className="flex-1 space-y-5 p-6 print:p-0">
        <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
          <p className="max-w-2xl text-sm text-ink-soft">
            Quién está alojado cada día y sus preferencias de desayuno o necesidades de movilidad — para que la
            cocina lo tenga resuelto de antemano. Se completa solo cuando la reserva pasa por /reservar; para las que
            llegan por otro canal, cargalo acá mismo.
          </p>
          <button
            type="button"
            onClick={() => window.print()}
            className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-soft hover:bg-paper-alt"
          >
            Imprimir ficha
          </button>
        </div>

        <div className="flex items-center gap-3 print:hidden">
          <button
            type="button"
            onClick={() => setSelected((d) => addDays(d, -1))}
            className="rounded-lg border border-line px-2.5 py-1.5 text-sm text-ink-soft hover:bg-paper-alt"
          >
            ←
          </button>
          <input
            type="date"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="rounded-lg border border-line bg-paper px-3 py-1.5 text-sm outline-none focus:border-terracotta"
          />
          <button
            type="button"
            onClick={() => setSelected((d) => addDays(d, 1))}
            className="rounded-lg border border-line px-2.5 py-1.5 text-sm text-ink-soft hover:bg-paper-alt"
          >
            →
          </button>
          {selected !== todayKey() && (
            <button
              type="button"
              onClick={() => setSelected(todayKey())}
              className="text-xs text-terracotta underline decoration-dotted"
            >
              Hoy
            </button>
          )}
        </div>

        <div className="rounded-xl border border-line bg-surface p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-display text-xl text-ink">{longDate(selected)}</p>
            {reservations && (
              <p className="font-mono-ui text-[11px] uppercase tracking-widest text-ink-faint">
                {totalGuests} {totalGuests === 1 ? "persona" : "personas"}
                {withRestrictions > 0 ? ` · ${withRestrictions} con preferencias registradas` : ""}
              </p>
            )}
          </div>

          {error && <p className="mt-3 text-sm text-rust">{error}</p>}
          {!reservations && !error && <p className="mt-3 text-sm text-ink-faint">Cargando…</p>}
          {reservations && staying.length === 0 && !error && (
            <p className="mt-3 text-sm text-ink-faint">Nadie alojado este día (solo cuentan reservas confirmadas).</p>
          )}

          {staying.length > 0 && (
            <div className="mt-4 space-y-4">
              {staying.map((r) => {
                const room = one(r.rooms);
                const people = r.reservation_guests ?? [];
                return (
                  <div key={r.id} className="border-t border-line pt-4 first:border-0 first:pt-0">
                    <p className="font-mono-ui text-[11px] uppercase tracking-widest text-ink-faint">
                      {room?.name ?? "Habitación sin asignar"}
                    </p>
                    {people.length === 0 ? (
                      <p className="mt-1 text-xs text-ink-faint">
                        Reserva sin personas registradas todavía — solo se guardó el nombre del titular.
                      </p>
                    ) : (
                      <ul className="mt-1 divide-y divide-line">
                        {people.map((g) => (
                          <GuestRow key={g.id} g={g} />
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </>
  );
}
