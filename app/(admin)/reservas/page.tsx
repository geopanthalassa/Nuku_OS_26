"use client";

import { Fragment, useEffect, useState } from "react";
import TopBar from "@/components/admin/TopBar";
import Pill from "@/components/ui/Pill";
import { demoWorkspace } from "@/lib/mock-data";
import { formatMoney, formatDateRange, nights } from "@/lib/format";
import { useCurrentAccount } from "@/lib/account-context";
import { authHeader } from "@/lib/supabase/auth-header";

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

// Canales que puede elegir el equipo al cargar una reserva a mano —
// tienen que coincidir con MANUAL_CHANNELS en app/api/dashboard/reservations/route.ts.
// "direct" no está acá a propósito: esa la crea sola /api/reservations/request
// cuando alguien reserva por la página pública.
const MANUAL_CHANNEL_LABELS: Record<string, string> = {
  phone: "Teléfono",
  whatsapp: "WhatsApp",
  booking: "Booking.com",
  airbnb: "Airbnb",
  walk_in: "Llegó directo (walk-in)",
  other: "Otro",
};

type Reservation = {
  id: string;
  check_in: string;
  check_out: string;
  status: keyof typeof STATUS_TONE;
  channel: string;
  payment_status: string;
  promo_code: string | null;
  total_cents: number | null;
  guests: { full_name: string; email: string | null; phone: string | null } | { full_name: string; email: string | null; phone: string | null }[] | null;
  rooms: { name: string; base_rate_cents: number | null } | { name: string; base_rate_cents: number | null }[] | null;
  reservation_guests:
    | {
        id: string;
        full_name: string;
        document_id: string | null;
        nationality: string | null;
        is_primary: boolean;
        dietary_vegan: boolean;
        dietary_vegetarian: boolean;
        dietary_celiac: boolean;
        dietary_lactose_free: boolean;
        dietary_other: string | null;
        mobility_assistance: boolean;
        mobility_notes: string | null;
      }[]
    | null;
  tour_interest: boolean;
  tour_notes: string | null;
  stripe_payment_link?: string | null;
};

type RoomOption = { id: string; name: string; capacity: number; base_rate_cents: number | null };

function one<T>(rel: T | T[] | null): T | null {
  if (!rel) return null;
  return Array.isArray(rel) ? rel[0] ?? null : rel;
}

type PromoCodeLite = {
  code: string;
  discount_type: "percent" | "fixed_amount";
  discount_value: number;
  active: boolean;
};

// Calcula el monto sugerido para el botón "Cobrar": noches × tarifa de la
// habitación, con el descuento del cupón ya aplicado si la reserva trae uno
// válido. Pedido de Andre (22/9/2026): antes se ponía el cupón y el
// descuento se calculaba a mano — ahora el staff ya no tiene que calcularlo,
// pero el monto sigue siendo editable por si hace falta un ajuste.
// Devuelve null si no hay tarifa cargada para la habitación (no inventamos
// un precio) — en ese caso el campo sigue en blanco, como antes.
function computeSuggestedAmount(
  r: Reservation,
  promoCodes: PromoCodeLite[] | null
): { pesos: number; breakdown: string } | null {
  const room = one(r.rooms);
  if (!room || room.base_rate_cents == null) return null;

  const n = nights(r.check_in, r.check_out);
  if (n <= 0) return null;

  const subtotalPesos = (room.base_rate_cents / 100) * n;
  const nightsLabel = `${n} ${n === 1 ? "noche" : "noches"} × ${formatMoney(room.base_rate_cents)}`;

  const promo = r.promo_code
    ? promoCodes?.find((p) => p.code === r.promo_code && p.active)
    : undefined;

  if (!promo) {
    return { pesos: Math.round(subtotalPesos), breakdown: nightsLabel };
  }

  const discountPesos =
    promo.discount_type === "percent" ? subtotalPesos * (promo.discount_value / 100) : promo.discount_value;
  const finalPesos = Math.max(0, Math.round(subtotalPesos - discountPesos));
  const discountLabel =
    promo.discount_type === "percent" ? `${promo.discount_value}%` : formatMoney(promo.discount_value * 100);

  return {
    pesos: finalPesos,
    breakdown: `${nightsLabel} − ${discountLabel} (${promo.code}) = ${formatMoney(finalPesos * 100)}`,
  };
}

const EMPTY_CREATE_FORM = {
  room_id: "",
  check_in: "",
  check_out: "",
  channel: "phone",
  status: "confirmed",
  full_name: "",
  email: "",
  phone: "",
  document_id: "",
  nationality: "",
  birth_date: "",
  total_cents: "",
  promo_code: "",
  tour_interest: false,
  tour_notes: "",
};

export default function ReservasPage() {
  const { accountId, accountName } = useCurrentAccount();
  const account = { ...demoWorkspace.account, name: accountName ?? demoWorkspace.account.name };
  const [reservations, setReservations] = useState<Reservation[] | null>(null);
  const [currency, setCurrency] = useState("CLP");
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [welcomeFor, setWelcomeFor] = useState<{ id: string; message: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [amountInput, setAmountInput] = useState("");
  const [paymentLinkFor, setPaymentLinkFor] = useState<{ id: string; url: string } | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [promoCodes, setPromoCodes] = useState<PromoCodeLite[] | null>(null);
  const [amountBreakdown, setAmountBreakdown] = useState<string | null>(null);

  // Reserva manual — hasta ahora la única forma de que una reserva quedara
  // guardada en Nuku OS era que el huésped la pidiera él mismo en /reservar.
  // Una llamada, un WhatsApp, o una reserva por Booking/Airbnb no quedaban
  // registradas en ningún lado. Este formulario llama al mismo POST
  // /api/dashboard/reservations, sin "id", que ahora también sabe crear.
  const [showCreate, setShowCreate] = useState(false);
  const [rooms, setRooms] = useState<RoomOption[] | null>(null);
  const [createForm, setCreateForm] = useState(EMPTY_CREATE_FORM);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function load() {
    if (!accountId) return;
    try {
      const res = await fetch("/api/dashboard/reservations", { headers: await authHeader() });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setReservations(data.reservations);
      setCurrency(data.currency);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    }
  }

  async function loadRooms() {
    if (!accountId) return;
    try {
      const res = await fetch(`/api/public/rooms?account_id=${accountId}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setRooms(data.rooms);
    } catch {
      // Si esto falla, el selector de habitación queda vacío y se ve el
      // aviso de abajo — no bloquea el resto del panel.
      setRooms([]);
    }
  }

  async function loadPromoCodes() {
    if (!accountId) return;
    try {
      const res = await fetch("/api/dashboard/promo-codes", { headers: await authHeader() });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setPromoCodes(data.promoCodes);
    } catch {
      // Si esto falla, el cálculo automático simplemente no aplica ningún
      // descuento (queda el subtotal sin cupón) -- no bloquea "Cobrar".
      setPromoCodes([]);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    loadRooms();
    loadPromoCodes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  async function updateStatus(r: Reservation, status: string) {
    if (!accountId) return;
    setPendingId(r.id);
    setError(null);
    try {
      const res = await fetch("/api/dashboard/reservations", {
        method: "POST",
        headers: { "content-type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ id: r.id, status }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setReservations((prev) => prev!.map((x) => (x.id === r.id ? { ...x, status: status as Reservation["status"] } : x)));
      if (status === "confirmed" && data.welcome_message) {
        setWelcomeFor({ id: r.id, message: data.welcome_message });
        setCopied(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo actualizar la reserva.");
    } finally {
      setPendingId(null);
    }
  }

  async function copyMessage() {
    if (!welcomeFor) return;
    try {
      await navigator.clipboard.writeText(welcomeFor.message);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  async function generatePaymentLink(r: Reservation) {
    if (!accountId) return;
    const pesos = Number(amountInput.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(pesos) || pesos <= 0) {
      setPaymentError("Ingresa un monto válido antes de generar el link.");
      return;
    }
    setPendingId(r.id);
    setPaymentError(null);
    try {
      const res = await fetch("/api/payments/create-checkout-session", {
        method: "POST",
        headers: { "content-type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({
          reservation_id: r.id,
          amount_cents: Math.round(pesos * 100), // misma convención interna que el resto de la app
          currency,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setPaymentLinkFor({ id: r.id, url: data.url });
      setCopiedLink(false);
      setPayingId(null);
      setAmountInput("");
      setAmountBreakdown(null);
      setReservations((prev) => prev!.map((x) => (x.id === r.id ? { ...x, stripe_payment_link: data.url } : x)));
    } catch (err) {
      setPaymentError(err instanceof Error ? err.message : "No se pudo generar el link de pago.");
    } finally {
      setPendingId(null);
    }
  }

  async function copyLink() {
    if (!paymentLinkFor) return;
    try {
      await navigator.clipboard.writeText(paymentLinkFor.url);
      setCopiedLink(true);
    } catch {
      setCopiedLink(false);
    }
  }

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!accountId) return;

    if (!createForm.room_id || !createForm.check_in || !createForm.check_out || !createForm.full_name.trim()) {
      setCreateError("Falta habitación, fechas o nombre del huésped.");
      return;
    }

    let totalCents: number | null = null;
    if (createForm.total_cents.trim()) {
      const pesos = Number(createForm.total_cents.replace(/[^0-9.]/g, ""));
      if (!Number.isFinite(pesos) || pesos < 0) {
        setCreateError("El monto ingresado no es válido.");
        return;
      }
      totalCents = Math.round(pesos * 100);
    }

    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/dashboard/reservations", {
        method: "POST",
        headers: { "content-type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({
          room_id: createForm.room_id,
          check_in: createForm.check_in,
          check_out: createForm.check_out,
          channel: createForm.channel,
          status: createForm.status,
          total_cents: totalCents,
          promo_code: createForm.promo_code || undefined,
          tour_interest: createForm.tour_interest,
          tour_notes: createForm.tour_notes || undefined,
          guest: {
            full_name: createForm.full_name.trim(),
            email: createForm.email || undefined,
            phone: createForm.phone || undefined,
            document_id: createForm.document_id || undefined,
            nationality: createForm.nationality || undefined,
            birth_date: createForm.birth_date || undefined,
          },
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      setShowCreate(false);
      const wasConfirmed = createForm.status === "confirmed";
      setCreateForm(EMPTY_CREATE_FORM);
      await load();
      if (wasConfirmed && data.welcome_message) {
        setWelcomeFor({ id: data.reservation_id, message: data.welcome_message });
        setCopied(false);
      }
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "No se pudo crear la reserva.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <TopBar account={account} title="Reservas" />
      <main className="flex-1 space-y-5 p-6">
        <div className="flex flex-wrap items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => {
              setShowCreate((v) => !v);
              setCreateError(null);
            }}
            className="shrink-0 rounded-lg bg-terracotta px-4 py-2 text-xs font-medium text-paper transition-opacity hover:opacity-90"
          >
            {showCreate ? "Cerrar" : "+ Nueva reserva"}
          </button>
        </div>

        {showCreate && (
          <form
            onSubmit={submitCreate}
            className="max-w-2xl space-y-4 rounded-xl border border-line bg-surface p-4"
          >
            <div>
              <p className="font-mono-ui text-[11px] uppercase tracking-widest text-ink-faint">
                Reserva manual
              </p>
              <p className="mt-1 text-xs text-ink-faint">
                Para reservas que llegaron por teléfono, WhatsApp, Booking,
                Airbnb o directo en recepción — no pasaron por /reservar, así
                que no quedaban guardadas hasta ahora.
              </p>
            </div>

            {rooms !== null && rooms.length === 0 && (
              <p className="rounded-lg border border-rust/30 bg-rust-soft px-3 py-2 text-xs text-rust">
                No hay habitaciones cargadas para esta cuenta todavía.
              </p>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs text-ink-soft">
                Habitación
                <select
                  required
                  value={createForm.room_id}
                  onChange={(e) => setCreateForm((f) => ({ ...f, room_id: e.target.value }))}
                  className="rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-ink outline-none focus:border-terracotta"
                >
                  <option value="">Elige una habitación…</option>
                  {(rooms ?? []).map((room) => (
                    <option key={room.id} value={room.id}>
                      {room.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1 text-xs text-ink-soft">
                Canal
                <select
                  value={createForm.channel}
                  onChange={(e) => setCreateForm((f) => ({ ...f, channel: e.target.value }))}
                  className="rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-ink outline-none focus:border-terracotta"
                >
                  {Object.entries(MANUAL_CHANNEL_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1 text-xs text-ink-soft">
                Check-in
                <input
                  required
                  type="date"
                  value={createForm.check_in}
                  onChange={(e) => setCreateForm((f) => ({ ...f, check_in: e.target.value }))}
                  className="rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-ink outline-none focus:border-terracotta"
                />
              </label>

              <label className="flex flex-col gap-1 text-xs text-ink-soft">
                Check-out
                <input
                  required
                  type="date"
                  value={createForm.check_out}
                  onChange={(e) => setCreateForm((f) => ({ ...f, check_out: e.target.value }))}
                  className="rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-ink outline-none focus:border-terracotta"
                />
              </label>

              <label className="flex flex-col gap-1 text-xs text-ink-soft sm:col-span-2">
                Nombre del huésped
                <input
                  required
                  type="text"
                  value={createForm.full_name}
                  onChange={(e) => setCreateForm((f) => ({ ...f, full_name: e.target.value }))}
                  className="rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-ink outline-none focus:border-terracotta"
                />
              </label>

              <label className="flex flex-col gap-1 text-xs text-ink-soft">
                Email (opcional)
                <input
                  type="email"
                  value={createForm.email}
                  onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
                  className="rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-ink outline-none focus:border-terracotta"
                />
              </label>

              <label className="flex flex-col gap-1 text-xs text-ink-soft">
                Teléfono (opcional)
                <input
                  type="tel"
                  value={createForm.phone}
                  onChange={(e) => setCreateForm((f) => ({ ...f, phone: e.target.value }))}
                  className="rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-ink outline-none focus:border-terracotta"
                />
              </label>

              <label className="flex flex-col gap-1 text-xs text-ink-soft">
                RUT / pasaporte (opcional)
                <input
                  type="text"
                  value={createForm.document_id}
                  onChange={(e) => setCreateForm((f) => ({ ...f, document_id: e.target.value }))}
                  className="rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-ink outline-none focus:border-terracotta"
                />
              </label>

              <label className="flex flex-col gap-1 text-xs text-ink-soft">
                Nacionalidad (opcional)
                <input
                  type="text"
                  placeholder="ej: Chilena, Argentina..."
                  value={createForm.nationality}
                  onChange={(e) => setCreateForm((f) => ({ ...f, nationality: e.target.value }))}
                  className="rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-ink outline-none focus:border-terracotta"
                />
              </label>

              <label className="flex flex-col gap-1 text-xs text-ink-soft">
                Fecha de nacimiento (opcional)
                <input
                  type="date"
                  value={createForm.birth_date}
                  onChange={(e) => setCreateForm((f) => ({ ...f, birth_date: e.target.value }))}
                  className="rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-ink outline-none focus:border-terracotta"
                />
              </label>

              <label className="flex flex-col gap-1 text-xs text-ink-soft">
                Estado
                <select
                  value={createForm.status}
                  onChange={(e) => setCreateForm((f) => ({ ...f, status: e.target.value }))}
                  className="rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-ink outline-none focus:border-terracotta"
                >
                  <option value="confirmed">Confirmada</option>
                  <option value="requested">Por confirmar</option>
                </select>
              </label>

              <label className="flex flex-col gap-1 text-xs text-ink-soft">
                Monto total en {currency} (opcional)
                <input
                  type="number"
                  min="0"
                  placeholder="Se calcula con la tarifa si lo dejas vacío"
                  value={createForm.total_cents}
                  onChange={(e) => setCreateForm((f) => ({ ...f, total_cents: e.target.value }))}
                  className="rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-ink outline-none focus:border-terracotta"
                />
              </label>

              <label className="flex flex-col gap-1 text-xs text-ink-soft">
                Código promocional (opcional)
                <input
                  type="text"
                  value={createForm.promo_code}
                  onChange={(e) => setCreateForm((f) => ({ ...f, promo_code: e.target.value }))}
                  className="rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-ink outline-none focus:border-terracotta"
                />
              </label>
            </div>

            <label className="flex items-center gap-2 text-xs text-ink-soft">
              <input
                type="checkbox"
                checked={createForm.tour_interest}
                onChange={(e) => setCreateForm((f) => ({ ...f, tour_interest: e.target.checked }))}
                className="h-4 w-4 rounded border-line"
              />
              Interesado en tours / experiencias
            </label>

            {createForm.tour_interest && (
              <label className="flex flex-col gap-1 text-xs text-ink-soft">
                Notas sobre tours (opcional)
                <textarea
                  rows={2}
                  value={createForm.tour_notes}
                  onChange={(e) => setCreateForm((f) => ({ ...f, tour_notes: e.target.value }))}
                  className="rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-ink outline-none focus:border-terracotta"
                />
              </label>
            )}

            {createError && <p className="text-xs text-rust">{createError}</p>}

            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={creating}
                className="rounded-lg bg-terracotta px-4 py-2 text-xs font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {creating ? "Guardando…" : "Guardar reserva"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowCreate(false);
                  setCreateError(null);
                }}
                className="text-xs text-ink-faint hover:text-ink"
              >
                Cancelar
              </button>
            </div>
          </form>
        )}

        {error && (
          <p className="max-w-2xl rounded-lg border border-rust/30 bg-rust-soft px-4 py-3 text-sm text-rust">
            {error}
          </p>
        )}

        {welcomeFor && (
          <div className="max-w-2xl rounded-xl border border-sage bg-sage-soft p-4">
            <div className="flex items-start justify-between gap-3">
              <p className="font-mono-ui text-[11px] uppercase tracking-widest text-sage">
                Mensaje de bienvenida — listo para copiar
              </p>
              <button
                type="button"
                onClick={() => setWelcomeFor(null)}
                className="text-xs text-ink-faint hover:text-ink"
              >
                Cerrar
              </button>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm text-ink">{welcomeFor.message}</p>
            <button
              type="button"
              onClick={copyMessage}
              className="mt-3 rounded-lg bg-terracotta px-4 py-2 text-xs font-medium text-paper transition-opacity hover:opacity-90"
            >
              {copied ? "¡Copiado!" : "Copiar mensaje"}
            </button>
          </div>
        )}

        {paymentLinkFor && (
          <div className="max-w-2xl rounded-xl border border-terracotta/40 bg-terracotta/5 p-4">
            <div className="flex items-start justify-between gap-3">
              <p className="font-mono-ui text-[11px] uppercase tracking-widest text-terracotta">
                Link de pago — listo para copiar
              </p>
              <button
                type="button"
                onClick={() => setPaymentLinkFor(null)}
                className="text-xs text-ink-faint hover:text-ink"
              >
                Cerrar
              </button>
            </div>
            <p className="mt-2 break-all text-sm text-ink">{paymentLinkFor.url}</p>
            <button
              type="button"
              onClick={copyLink}
              className="mt-3 rounded-lg bg-terracotta px-4 py-2 text-xs font-medium text-paper transition-opacity hover:opacity-90"
            >
              {copiedLink ? "¡Copiado!" : "Copiar link"}
            </button>
          </div>
        )}

        {!reservations && !error && <p className="text-sm text-ink-faint">Cargando…</p>}

        {reservations && reservations.length === 0 && !error && (
          <p className="max-w-2xl text-sm text-ink-faint">
            Todavía no hay reservas reales. Van a aparecer acá apenas alguien complete el formulario en /reservar, o cuando cargues una a mano con &quot;+ Nueva reserva&quot;.
          </p>
        )}

        {reservations && reservations.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-paper-alt text-left text-[11px] uppercase tracking-wide text-ink-faint">
                  <th className="px-4 py-2.5 font-medium">Huésped</th>
                  <th className="px-4 py-2.5 font-medium">Habitación</th>
                  <th className="px-4 py-2.5 font-medium">Fechas</th>
                  <th className="px-4 py-2.5 font-medium">Noches</th>
                  <th className="px-4 py-2.5 font-medium">Canal</th>
                  <th className="px-4 py-2.5 font-medium">Personas</th>
                  <th className="px-4 py-2.5 font-medium">Estado</th>
                  <th className="px-4 py-2.5 font-medium">Total</th>
                  <th className="px-4 py-2.5 font-medium">Acción</th>
                </tr>
              </thead>
              <tbody>
                {reservations.map((r) => {
                  const guest = one(r.guests);
                  const room = one(r.rooms);
                  const totalCents = r.total_cents ?? room?.base_rate_cents ?? null;
                  const people = r.reservation_guests ?? [];
                  const isExpanded = expandedId === r.id;
                  return (
                    <Fragment key={r.id}>
                    <tr className="border-b border-line last:border-0">
                      <td className="px-4 py-3 font-medium">
                        {guest?.full_name ?? "—"}
                        {r.promo_code && (
                          <span className="ml-2 text-[11px] font-normal text-terracotta">{r.promo_code}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-ink-soft">{room?.name ?? "—"}</td>
                      <td className="px-4 py-3 text-ink-soft">{formatDateRange(r.check_in, r.check_out)}</td>
                      <td className="px-4 py-3 tabular-nums text-ink-soft">{nights(r.check_in, r.check_out)}</td>
                      <td className="px-4 py-3">
                        <Pill tone="neutral">{MANUAL_CHANNEL_LABELS[r.channel] ?? r.channel}</Pill>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => setExpandedId(isExpanded ? null : r.id)}
                          className="flex items-center gap-1.5 text-xs text-ink-soft hover:text-ink"
                        >
                          <span className="rounded-full bg-paper-alt px-2 py-0.5 font-mono-ui tabular-nums">
                            {people.length || 1}
                          </span>
                          {r.tour_interest && <Pill tone="olive">Tours</Pill>}
                          <span className="underline decoration-dotted">{isExpanded ? "Ocultar" : "Ver"}</span>
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <Pill tone={STATUS_TONE[r.status] ?? "neutral"}>{STATUS_LABEL[r.status] ?? r.status}</Pill>
                      </td>
                      <td className="px-4 py-3 tabular-nums">{formatMoney(totalCents, currency)}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          {r.status === "requested" && (
                            <>
                              <button
                                type="button"
                                disabled={pendingId === r.id}
                                onClick={() => updateStatus(r, "confirmed")}
                                className="rounded-lg bg-sage px-3 py-1.5 text-xs font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-50"
                              >
                                Confirmar
                              </button>
                              <button
                                type="button"
                                disabled={pendingId === r.id}
                                onClick={() => updateStatus(r, "cancelled")}
                                className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-soft transition-colors hover:border-rust/40 hover:text-rust disabled:opacity-50"
                              >
                                Cancelar
                              </button>
                            </>
                          )}
                          {r.status === "confirmed" && payingId !== r.id && (
                            <>
                              {r.payment_status === "paid" ? (
                                <span className="rounded-lg bg-sage-soft px-3 py-1.5 text-xs font-medium text-sage">
                                  Pagado
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  disabled={pendingId === r.id}
                                  onClick={() => {
                                    setPayingId(r.id);
                                    const suggestion = computeSuggestedAmount(r, promoCodes);
                                    setAmountInput(suggestion ? String(suggestion.pesos) : "");
                                    setAmountBreakdown(suggestion?.breakdown ?? null);
                                    setPaymentError(null);
                                  }}
                                  className="rounded-lg border border-terracotta/40 px-3 py-1.5 text-xs font-medium text-terracotta transition-colors hover:bg-terracotta/10 disabled:opacity-50"
                                >
                                  Cobrar
                                </button>
                              )}
                              <button
                                type="button"
                                disabled={pendingId === r.id}
                                onClick={() => updateStatus(r, "completed")}
                                className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-soft transition-colors hover:border-sage/50 hover:text-sage disabled:opacity-50"
                              >
                                Marcar completada
                              </button>
                              <button
                                type="button"
                                disabled={pendingId === r.id}
                                onClick={() => updateStatus(r, "cancelled")}
                                className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-soft transition-colors hover:border-rust/40 hover:text-rust disabled:opacity-50"
                              >
                                Cancelar
                              </button>
                            </>
                          )}
                          {r.status === "confirmed" && payingId === r.id && (
                            <div className="flex flex-col gap-1.5">
                              <div className="flex items-center gap-1.5">
                                <input
                                  autoFocus
                                  type="number"
                                  min="1"
                                  value={amountInput}
                                  onChange={(e) => setAmountInput(e.target.value)}
                                  placeholder={`Monto en ${currency}`}
                                  className="w-32 rounded-lg border border-line bg-paper px-2 py-1.5 text-xs outline-none focus:border-terracotta"
                                />
                                <button
                                  type="button"
                                  disabled={pendingId === r.id}
                                  onClick={() => generatePaymentLink(r)}
                                  className="rounded-lg bg-terracotta px-3 py-1.5 text-xs font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-50"
                                >
                                  Generar link
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setPayingId(null);
                                    setAmountBreakdown(null);
                                  }}
                                  className="text-xs text-ink-faint hover:text-ink"
                                >
                                  Cancelar
                                </button>
                              </div>
                              {amountBreakdown && (
                                <p className="text-[11px] text-ink-faint">
                                  {amountBreakdown} — calculado solo, podés editarlo arriba.
                                </p>
                              )}
                              {!amountBreakdown && (
                                <p className="text-[11px] text-ink-faint">
                                  Esta habitación todavía no tiene tarifa cargada — ingresá el monto a mano.
                                </p>
                              )}
                              {paymentError && <p className="text-[11px] text-rust">{paymentError}</p>}
                            </div>
                          )}
                          {(r.status === "completed" || r.status === "cancelled") && (
                            <span className="text-xs text-ink-faint">—</span>
                          )}
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="border-b border-line bg-paper-alt last:border-0">
                        <td colSpan={9} className="px-4 py-4">
                          <p className="font-mono-ui text-[11px] uppercase tracking-widest text-ink-faint">
                            Personas que ingresan a la isla con esta reserva
                          </p>
                          {people.length === 0 ? (
                            <p className="mt-2 text-xs text-ink-faint">
                              Reserva antigua sin este detalle todavía — solo se guardó el nombre del titular.
                            </p>
                          ) : (
                            <ul className="mt-2 space-y-1.5">
                              {people.map((p, i) => {
                                const dietTags = [
                                  p.dietary_vegan && "Vegano",
                                  p.dietary_vegetarian && "Vegetariano",
                                  p.dietary_celiac && "Celíaco",
                                  p.dietary_lactose_free && "Sin lactosa",
                                ].filter(Boolean) as string[];
                                return (
                                  <li key={p.id ?? i} className="flex flex-wrap items-center gap-1.5 text-sm text-ink">
                                    <span className="font-medium">{p.full_name}</span>
                                    {p.is_primary && <Pill tone="neutral">Titular</Pill>}
                                    <span className="text-ink-faint">
                                      {p.document_id ? `RUT/pasaporte: ${p.document_id}` : "sin identificación registrada"}
                                      {p.nationality ? ` · ${p.nationality}` : ""}
                                    </span>
                                    {dietTags.map((tag) => (
                                      <Pill key={tag} tone="olive">
                                        {tag}
                                      </Pill>
                                    ))}
                                    {p.dietary_other && (
                                      <span className="text-xs text-terracotta">· {p.dietary_other}</span>
                                    )}
                                    {p.mobility_assistance && (
                                      <Pill tone="rust">
                                        Movilidad{p.mobility_notes ? `: ${p.mobility_notes}` : ""}
                                      </Pill>
                                    )}
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                          {r.tour_interest && (
                            <div className="mt-3 border-t border-line pt-3">
                              <p className="font-mono-ui text-[11px] uppercase tracking-widest text-olive">
                                Interesados en tours / experiencias
                              </p>
                              <p className="mt-1 text-sm text-ink">
                                {r.tour_notes || "No dejaron detalle — hay que preguntar qué les interesa al confirmar."}
                              </p>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  );
}
