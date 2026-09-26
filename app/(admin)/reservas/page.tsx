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
  room_id: string | null;
  check_in: string;
  check_out: string;
  status: keyof typeof STATUS_TONE;
  channel: string;
  payment_status: string;
  promo_code: string | null;
  total_cents: number | null;
  guest_count: number | null;
  internal_notes: string | null;
  guests: { full_name: string; email: string | null; phone: string | null } | { full_name: string; email: string | null; phone: string | null }[] | null;
  rooms: { name: string; base_rate_cents: number | null } | { name: string; base_rate_cents: number | null }[] | null;
  reservation_guests:
    | {
        id: string;
        full_name: string;
        document_id: string | null;
        nationality: string | null;
        birth_date: string | null;
        phone: string | null;
        email: string | null;
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
  arrival_flight_time: string | null;
  arrival_flight_number: string | null;
  departure_flight_time: string | null;
  departure_flight_number: string | null;
  airport_transfer_notes: string | null;
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
  guest_count: "",
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

// 26/9/2026: pedido de Andre — botón "Editar" para toda la ficha de una
// reserva ya guardada (antes solo se podía cambiar el estado, la habitación
// y los datos de vuelo, cada uno por su lado). Este formulario cubre todos
// los campos de la reserva; los datos de cada huésped se editan aparte, en
// editGuests, porque viven en otra tabla (reservation_guests).
const EMPTY_EDIT_FORM = {
  room_id: "",
  guest_count: "",
  check_in: "",
  check_out: "",
  channel: "phone",
  status: "confirmed",
  payment_status: "pending",
  total_cents: "",
  promo_code: "",
  tour_interest: false,
  tour_notes: "",
  arrival_flight_time: "",
  arrival_flight_number: "",
  departure_flight_time: "",
  departure_flight_number: "",
  airport_transfer_notes: "",
  internal_notes: "",
};

// Todos los canales posibles en el selector de "Editar" — a diferencia de
// "Nueva reserva", acá también puede aparecer "direct" (reservas que llegaron
// solas por /reservar), así que se agrega solo para mostrarlo correctamente.
const ALL_CHANNEL_LABELS: Record<string, string> = {
  direct: "Directo (reserva pública)",
  ...MANUAL_CHANNEL_LABELS,
};

// Una fila de huésped en edición. `key` es estable para React aunque todavía
// no tenga `id` (huésped recién agregado, sin guardar). Sin `id` => al
// guardar se CREA un reservation_guests nuevo; con `id` => se actualiza.
type EditGuestRow = {
  key: string;
  id?: string;
  full_name: string;
  document_id: string;
  nationality: string;
  birth_date: string;
  phone: string;
  email: string;
  is_primary: boolean;
};

let guestRowCounter = 0;
function newGuestRowKey() {
  guestRowCounter += 1;
  return `new-${guestRowCounter}`;
}

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

  // 26/9/2026: pedido de Andre — al cargar una reserva a mano por teléfono a
  // veces todavía no se sabe qué habitación va a quedar. Ahora se puede
  // guardar sin habitación (ver EMPTY_CREATE_FORM / submitCreate) y
  // asignarla después acá mismo, en la fila de la reserva — este estado
  // guarda cuál fila tiene el selector de habitación abierto y qué valor
  // tiene elegido mientras tanto.
  const [assigningRoomFor, setAssigningRoomFor] = useState<string | null>(null);
  const [roomToAssign, setRoomToAssign] = useState("");
  const [assigningRoom, setAssigningRoom] = useState(false);
  const [assignRoomError, setAssignRoomError] = useState<string | null>(null);

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

  // Editar ficha completa — ver EMPTY_EDIT_FORM más arriba.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState(EMPTY_EDIT_FORM);
  const [editGuests, setEditGuests] = useState<EditGuestRow[]>([]);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

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

  // 26/9/2026: asigna (o cambia) la habitación de una reserva que se cargó
  // sin ese dato — reusa el mismo POST /api/dashboard/reservations que ya
  // actualiza el estado, mandando room_id junto con el id. El chequeo de
  // disponibilidad para esa habitación/fechas lo hace la API recién en este
  // momento (antes no tenía sentido, no había habitación que chequear).
  async function assignRoom(r: Reservation) {
    if (!accountId || !roomToAssign) return;
    setAssigningRoom(true);
    setAssignRoomError(null);
    try {
      const res = await fetch("/api/dashboard/reservations", {
        method: "POST",
        headers: { "content-type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ id: r.id, room_id: roomToAssign }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setAssigningRoomFor(null);
      setRoomToAssign("");
      await load();
    } catch (err) {
      setAssignRoomError(err instanceof Error ? err.message : "No se pudo asignar la habitación.");
    } finally {
      setAssigningRoom(false);
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

    // 26/9/2026: pedido de Andre — la habitación ya no es obligatoria acá
    // (a veces todavía no se sabe cuál va a quedar cuando se está anotando
    // la reserva); se puede asignar después desde la fila de la reserva.
    // Fechas y nombre del huésped siguen siendo indispensables: sin eso la
    // reserva no significa nada y rompería el Calendario/Disponibilidad.
    if (!createForm.check_in || !createForm.check_out || !createForm.full_name.trim()) {
      setCreateError("Falta alguna fecha o el nombre del huésped.");
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

    let guestCount: number | null = null;
    if (createForm.guest_count.trim()) {
      const n = Number(createForm.guest_count);
      if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
        setCreateError("La cantidad de huéspedes debe ser un número entero mayor a 0.");
        return;
      }
      guestCount = n;
    }

    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/dashboard/reservations", {
        method: "POST",
        headers: { "content-type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({
          room_id: createForm.room_id || undefined,
          check_in: createForm.check_in,
          check_out: createForm.check_out,
          channel: createForm.channel,
          status: createForm.status,
          total_cents: totalCents,
          guest_count: guestCount,
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

  // Abre la ficha completa de edición de una reserva ya guardada, con todo
  // precargado: fechas, habitación, canal, estado, pago, monto, cupón,
  // tours, vuelos, comentarios, y la lista de huéspedes ya cargados. Si
  // todavía no hay ningún huésped registrado (reserva vieja, o cargada antes
  // de este cambio), arranca con una fila vacía para el titular en vez de
  // dejar la lista en blanco.
  function openEdit(r: Reservation) {
    setEditForm({
      room_id: r.room_id ?? "",
      guest_count: r.guest_count != null ? String(r.guest_count) : "",
      check_in: r.check_in,
      check_out: r.check_out,
      channel: r.channel,
      status: r.status,
      payment_status: r.payment_status,
      total_cents: r.total_cents != null ? String(r.total_cents / 100) : "",
      promo_code: r.promo_code ?? "",
      tour_interest: r.tour_interest,
      tour_notes: r.tour_notes ?? "",
      arrival_flight_time: (r.arrival_flight_time ?? "").slice(0, 5),
      arrival_flight_number: r.arrival_flight_number ?? "",
      departure_flight_time: (r.departure_flight_time ?? "").slice(0, 5),
      departure_flight_number: r.departure_flight_number ?? "",
      airport_transfer_notes: r.airport_transfer_notes ?? "",
      internal_notes: r.internal_notes ?? "",
    });

    const people = r.reservation_guests ?? [];
    if (people.length > 0) {
      setEditGuests(
        people.map((p) => ({
          key: p.id,
          id: p.id,
          full_name: p.full_name,
          document_id: p.document_id ?? "",
          nationality: p.nationality ?? "",
          birth_date: p.birth_date ?? "",
          phone: p.phone ?? "",
          email: p.email ?? "",
          is_primary: p.is_primary,
        }))
      );
    } else {
      // Sin nadie cargado todavía: arrancar con una fila para el titular,
      // usando lo que haya en el contacto (guests) como punto de partida.
      const guest = one(r.guests);
      setEditGuests([
        {
          key: newGuestRowKey(),
          full_name: guest?.full_name ?? "",
          document_id: "",
          nationality: "",
          birth_date: "",
          phone: guest?.phone ?? "",
          email: guest?.email ?? "",
          is_primary: true,
        },
      ]);
    }

    setEditError(null);
    setExpandedId(r.id);
    setEditingId(r.id);
  }

  function closeEdit() {
    setEditingId(null);
    setEditError(null);
  }

  function addGuestRow() {
    setEditGuests((prev) => [
      ...prev,
      {
        key: newGuestRowKey(),
        full_name: "",
        document_id: "",
        nationality: "",
        birth_date: "",
        phone: "",
        email: "",
        is_primary: false,
      },
    ]);
  }

  function removeGuestRow(key: string) {
    // Solo se puede quitar una fila recién agregada (sin id todavía) — una
    // ya guardada no tiene forma de borrarse desde acá.
    setEditGuests((prev) => prev.filter((g) => g.key !== key || g.id));
  }

  function updateGuestRow(key: string, patch: Partial<EditGuestRow>) {
    setEditGuests((prev) => prev.map((g) => (g.key === key ? { ...g, ...patch } : g)));
  }

  async function saveEdit(r: Reservation) {
    if (!accountId) return;

    if (!editForm.check_in || !editForm.check_out) {
      setEditError("Falta el check-in o el check-out.");
      return;
    }
    if (editForm.check_out <= editForm.check_in) {
      setEditError("El check-out debe ser posterior al check-in.");
      return;
    }

    let totalCents: number | null = null;
    if (editForm.total_cents.trim()) {
      const pesos = Number(editForm.total_cents.replace(/[^0-9.]/g, ""));
      if (!Number.isFinite(pesos) || pesos < 0) {
        setEditError("El monto ingresado no es válido.");
        return;
      }
      totalCents = Math.round(pesos * 100);
    }

    let guestCount: number | null = null;
    if (editForm.guest_count.trim()) {
      const n = Number(editForm.guest_count);
      if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
        setEditError("La cantidad de huéspedes debe ser un número entero mayor a 0.");
        return;
      }
      guestCount = n;
    }

    setSavingEdit(true);
    setEditError(null);
    try {
      const res = await fetch("/api/dashboard/reservations", {
        method: "POST",
        headers: { "content-type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({
          id: r.id,
          room_id: editForm.room_id || null,
          guest_count: guestCount,
          check_in: editForm.check_in,
          check_out: editForm.check_out,
          channel: editForm.channel,
          status: editForm.status,
          payment_status: editForm.payment_status,
          total_cents: totalCents,
          promo_code: editForm.promo_code || "",
          tour_interest: editForm.tour_interest,
          tour_notes: editForm.tour_notes || "",
          arrival_flight_time: editForm.arrival_flight_time || "",
          arrival_flight_number: editForm.arrival_flight_number || "",
          departure_flight_time: editForm.departure_flight_time || "",
          departure_flight_number: editForm.departure_flight_number || "",
          airport_transfer_notes: editForm.airport_transfer_notes || "",
          internal_notes: editForm.internal_notes || "",
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      // Los huéspedes se guardan aparte (viven en reservation_guests, no en
      // reservations) — uno por uno, en orden, para poder señalar
      // exactamente cuál falló si algo sale mal.
      for (const g of editGuests) {
        if (!g.id && !g.full_name.trim()) continue; // fila agregada y dejada en blanco: se ignora, no es error
        const guestRes = await fetch("/api/dashboard/reservation-guests", {
          method: "POST",
          headers: { "content-type": "application/json", ...(await authHeader()) },
          body: JSON.stringify(
            g.id
              ? {
                  id: g.id,
                  full_name: g.full_name,
                  document_id: g.document_id,
                  nationality: g.nationality,
                  birth_date: g.birth_date,
                  phone: g.phone,
                  email: g.email,
                }
              : {
                  reservation_id: r.id,
                  full_name: g.full_name,
                  document_id: g.document_id || undefined,
                  nationality: g.nationality || undefined,
                  birth_date: g.birth_date || undefined,
                  phone: g.phone || undefined,
                  email: g.email || undefined,
                  is_primary: g.is_primary,
                }
          ),
        });
        const guestData = await guestRes.json();
        if (guestData.error) throw new Error(`Huésped "${g.full_name || "(sin nombre)"}": ${guestData.error}`);
      }

      setEditingId(null);
      await load();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "No se pudo guardar la reserva.");
    } finally {
      setSavingEdit(false);
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
                que no quedaban guardadas hasta ahora. Si todavía no sabes qué
                habitación va a quedar, guarda igual sin elegir una — se
                asigna después desde la lista de reservas.
              </p>
            </div>

            {rooms !== null && rooms.length === 0 && (
              <p className="rounded-lg border border-line bg-paper-alt px-3 py-2 text-xs text-ink-soft">
                No hay habitaciones cargadas para esta cuenta todavía — igual podés guardar la reserva y asignar la habitación más adelante.
              </p>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs text-ink-soft">
                Habitación (opcional)
                <select
                  value={createForm.room_id}
                  onChange={(e) => setCreateForm((f) => ({ ...f, room_id: e.target.value }))}
                  className="rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-ink outline-none focus:border-terracotta"
                >
                  <option value="">Todavía no se sabe — asignar después</option>
                  {(rooms ?? []).map((room) => (
                    <option key={room.id} value={room.id}>
                      {room.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1 text-xs text-ink-soft">
                Cantidad de huéspedes (opcional)
                <input
                  type="number"
                  min="1"
                  step="1"
                  placeholder="ej: 2"
                  value={createForm.guest_count}
                  onChange={(e) => setCreateForm((f) => ({ ...f, guest_count: e.target.value }))}
                  className="rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-ink outline-none focus:border-terracotta"
                />
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
                  const stayNights = nights(r.check_in, r.check_out);
                  // 24/9/2026: bug real encontrado por Andre — las reservas
                  // que vienen de /reservar nunca traen total_cents (esa ruta
                  // no lo calcula), así que este fallback caía directo en
                  // room.base_rate_cents SIN multiplicar por las noches. Una
                  // reserva de 2 noches en Calipso mostraba $302.315 (la
                  // tarifa de 1 noche) en vez de $604.630 (el total real).
                  const totalCents =
                    r.total_cents ?? (room?.base_rate_cents != null && stayNights > 0 ? room.base_rate_cents * stayNights : null);
                  const isEstimated = r.total_cents == null && totalCents != null;
                  const people = r.reservation_guests ?? [];
                  // 23/9/2026: mostrar el nombre declarado en ESTA reserva
                  // (reservation_guests, titular), no el del contacto
                  // reutilizado (guests.full_name) — si el mismo teléfono o
                  // correo ya estaba registrado a otro nombre, guests.full_name
                  // se queda con el nombre viejo y confunde (ver lib/guest-match.ts
                  // para cómo se evita esto en reservas nuevas).
                  const primaryGuest = people.find((p) => p.is_primary) ?? people[0];
                  const displayName = primaryGuest?.full_name ?? guest?.full_name ?? "—";
                  const isExpanded = expandedId === r.id;
                  return (
                    <Fragment key={r.id}>
                    <tr className="border-b border-line last:border-0">
                      <td className="px-4 py-3 font-medium">
                        {displayName}
                        {r.promo_code && (
                          <span className="ml-2 text-[11px] font-normal text-terracotta">{r.promo_code}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-ink-soft">
                        {room?.name ? (
                          room.name
                        ) : assigningRoomFor === r.id ? (
                          <div className="flex flex-col gap-1.5">
                            <div className="flex items-center gap-1.5">
                              <select
                                autoFocus
                                value={roomToAssign}
                                onChange={(e) => setRoomToAssign(e.target.value)}
                                className="rounded-lg border border-line bg-paper px-2 py-1 text-xs text-ink outline-none focus:border-terracotta"
                              >
                                <option value="">Elige…</option>
                                {(rooms ?? []).map((room) => (
                                  <option key={room.id} value={room.id}>
                                    {room.name}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                disabled={assigningRoom || !roomToAssign}
                                onClick={() => assignRoom(r)}
                                className="rounded-lg bg-terracotta px-2.5 py-1 text-xs font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-50"
                              >
                                {assigningRoom ? "…" : "Guardar"}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setAssigningRoomFor(null);
                                  setRoomToAssign("");
                                  setAssignRoomError(null);
                                }}
                                className="text-xs text-ink-faint hover:text-ink"
                              >
                                Cancelar
                              </button>
                            </div>
                            {assignRoomError && <p className="text-[11px] text-rust">{assignRoomError}</p>}
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setAssigningRoomFor(r.id);
                              setRoomToAssign("");
                              setAssignRoomError(null);
                            }}
                            className="text-xs text-terracotta underline decoration-dotted"
                          >
                            Sin asignar — elegir
                          </button>
                        )}
                      </td>
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
                            {people.length || r.guest_count || 1}
                          </span>
                          {/* 26/9/2026: si todavía no hay personas cargadas una
                              por una (reservation_guests) pero sí se anotó una
                              cantidad aproximada al crear la reserva a mano,
                              se avisa que es un estimado — no inventa nombres. */}
                          {people.length === 0 && r.guest_count != null && (
                            <span className="text-[10px] text-ink-faint">aprox.</span>
                          )}
                          {r.tour_interest && <Pill tone="olive">Tours</Pill>}
                          <span className="underline decoration-dotted">{isExpanded ? "Ocultar" : "Ver"}</span>
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <Pill tone={STATUS_TONE[r.status] ?? "neutral"}>{STATUS_LABEL[r.status] ?? r.status}</Pill>
                      </td>
                      <td className="px-4 py-3 tabular-nums">
                        {formatMoney(totalCents, currency)}
                        {isEstimated && room?.base_rate_cents != null && (
                          <p className="mt-0.5 text-[10px] font-normal text-ink-faint">
                            {formatMoney(room.base_rate_cents, currency)} × {stayNights}{" "}
                            {stayNights === 1 ? "noche" : "noches"}
                            {r.promo_code ? " · sin cupón" : ""}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => (editingId === r.id ? closeEdit() : openEdit(r))}
                            className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-soft transition-colors hover:border-terracotta/40 hover:text-terracotta"
                          >
                            {editingId === r.id ? "Cerrar edición" : "Editar"}
                          </button>
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
                          {editingId === r.id ? (
                            <div className="max-w-3xl space-y-4">
                              <p className="font-mono-ui text-[11px] uppercase tracking-widest text-ink-faint">
                                Editar reserva completa
                              </p>

                              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <label className="flex flex-col gap-1 text-xs text-ink-soft">
                                  Habitación
                                  <select
                                    value={editForm.room_id}
                                    onChange={(e) => setEditForm((f) => ({ ...f, room_id: e.target.value }))}
                                    className="rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-ink outline-none focus:border-terracotta"
                                  >
                                    <option value="">Todavía no se sabe — asignar después</option>
                                    {(rooms ?? []).map((room) => (
                                      <option key={room.id} value={room.id}>
                                        {room.name}
                                      </option>
                                    ))}
                                  </select>
                                </label>

                                <label className="flex flex-col gap-1 text-xs text-ink-soft">
                                  Cantidad de huéspedes
                                  <input
                                    type="number"
                                    min="1"
                                    step="1"
                                    value={editForm.guest_count}
                                    onChange={(e) => setEditForm((f) => ({ ...f, guest_count: e.target.value }))}
                                    className="rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-ink outline-none focus:border-terracotta"
                                  />
                                </label>

                                <label className="flex flex-col gap-1 text-xs text-ink-soft">
                                  Canal
                                  <select
                                    value={editForm.channel}
                                    onChange={(e) => setEditForm((f) => ({ ...f, channel: e.target.value }))}
                                    className="rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-ink outline-none focus:border-terracotta"
                                  >
                                    {Object.entries(ALL_CHANNEL_LABELS).map(([value, label]) => (
                                      <option key={value} value={value}>
                                        {label}
                                      </option>
                                    ))}
                                  </select>
                                </label>

                                <label className="flex flex-col gap-1 text-xs text-ink-soft">
                                  Estado
                                  <select
                                    value={editForm.status}
                                    onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value }))}
                                    className="rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-ink outline-none focus:border-terracotta"
                                  >
                                    {Object.entries(STATUS_LABEL).map(([value, label]) => (
                                      <option key={value} value={value}>
                                        {label}
                                      </option>
                                    ))}
                                  </select>
                                </label>

                                <label className="flex flex-col gap-1 text-xs text-ink-soft">
                                  Check-in
                                  <input
                                    type="date"
                                    value={editForm.check_in}
                                    onChange={(e) => setEditForm((f) => ({ ...f, check_in: e.target.value }))}
                                    className="rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-ink outline-none focus:border-terracotta"
                                  />
                                </label>

                                <label className="flex flex-col gap-1 text-xs text-ink-soft">
                                  Check-out
                                  <input
                                    type="date"
                                    value={editForm.check_out}
                                    onChange={(e) => setEditForm((f) => ({ ...f, check_out: e.target.value }))}
                                    className="rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-ink outline-none focus:border-terracotta"
                                  />
                                </label>

                                <label className="flex flex-col gap-1 text-xs text-ink-soft">
                                  Estado de pago
                                  <select
                                    value={editForm.payment_status}
                                    onChange={(e) => setEditForm((f) => ({ ...f, payment_status: e.target.value }))}
                                    className="rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-ink outline-none focus:border-terracotta"
                                  >
                                    <option value="pending">Pendiente</option>
                                    <option value="paid">Pagado</option>
                                    <option value="refunded">Reembolsado</option>
                                  </select>
                                </label>

                                <label className="flex flex-col gap-1 text-xs text-ink-soft">
                                  Monto total en {currency}
                                  <input
                                    type="number"
                                    min="0"
                                    placeholder="Se calcula con la tarifa si lo dejas vacío"
                                    value={editForm.total_cents}
                                    onChange={(e) => setEditForm((f) => ({ ...f, total_cents: e.target.value }))}
                                    className="rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-ink outline-none focus:border-terracotta"
                                  />
                                </label>

                                <label className="flex flex-col gap-1 text-xs text-ink-soft">
                                  Código promocional
                                  <input
                                    type="text"
                                    value={editForm.promo_code}
                                    onChange={(e) => setEditForm((f) => ({ ...f, promo_code: e.target.value }))}
                                    className="rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-ink outline-none focus:border-terracotta"
                                  />
                                </label>
                              </div>

                              <label className="flex items-center gap-2 text-xs text-ink-soft">
                                <input
                                  type="checkbox"
                                  checked={editForm.tour_interest}
                                  onChange={(e) => setEditForm((f) => ({ ...f, tour_interest: e.target.checked }))}
                                  className="h-4 w-4 rounded border-line"
                                />
                                Interesado en tours / experiencias
                              </label>

                              {editForm.tour_interest && (
                                <label className="flex flex-col gap-1 text-xs text-ink-soft">
                                  Notas sobre tours
                                  <textarea
                                    rows={2}
                                    value={editForm.tour_notes}
                                    onChange={(e) => setEditForm((f) => ({ ...f, tour_notes: e.target.value }))}
                                    className="rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-ink outline-none focus:border-terracotta"
                                  />
                                </label>
                              )}

                              <div className="border-t border-line pt-3">
                                <p className="font-mono-ui text-[11px] uppercase tracking-widest text-ink-faint">
                                  Vuelos y traslado al aeropuerto
                                </p>
                                <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                                  <label className="flex flex-col gap-1 text-xs text-ink-soft">
                                    Hora de llegada
                                    <input
                                      type="time"
                                      value={editForm.arrival_flight_time}
                                      onChange={(e) => setEditForm((f) => ({ ...f, arrival_flight_time: e.target.value }))}
                                      className="rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-ink outline-none focus:border-terracotta"
                                    />
                                  </label>
                                  <label className="flex flex-col gap-1 text-xs text-ink-soft">
                                    Número de vuelo (llegada)
                                    <input
                                      type="text"
                                      placeholder="ej: LA841"
                                      value={editForm.arrival_flight_number}
                                      onChange={(e) => setEditForm((f) => ({ ...f, arrival_flight_number: e.target.value }))}
                                      className="rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-ink outline-none focus:border-terracotta"
                                    />
                                  </label>
                                  <label className="flex flex-col gap-1 text-xs text-ink-soft">
                                    Hora de salida
                                    <input
                                      type="time"
                                      value={editForm.departure_flight_time}
                                      onChange={(e) => setEditForm((f) => ({ ...f, departure_flight_time: e.target.value }))}
                                      className="rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-ink outline-none focus:border-terracotta"
                                    />
                                  </label>
                                  <label className="flex flex-col gap-1 text-xs text-ink-soft">
                                    Número de vuelo (salida)
                                    <input
                                      type="text"
                                      placeholder="ej: LA842"
                                      value={editForm.departure_flight_number}
                                      onChange={(e) => setEditForm((f) => ({ ...f, departure_flight_number: e.target.value }))}
                                      className="rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-ink outline-none focus:border-terracotta"
                                    />
                                  </label>
                                </div>
                                <label className="mt-3 flex flex-col gap-1 text-xs text-ink-soft">
                                  Notas del traslado
                                  <textarea
                                    rows={2}
                                    value={editForm.airport_transfer_notes}
                                    onChange={(e) => setEditForm((f) => ({ ...f, airport_transfer_notes: e.target.value }))}
                                    className="rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-ink outline-none focus:border-terracotta"
                                  />
                                </label>
                              </div>

                              <label className="flex flex-col gap-1 text-xs text-ink-soft">
                                Comentarios
                                <textarea
                                  rows={3}
                                  placeholder="Cualquier cosa que el equipo necesite saber sobre esta reserva — no se le muestra al huésped."
                                  value={editForm.internal_notes}
                                  onChange={(e) => setEditForm((f) => ({ ...f, internal_notes: e.target.value }))}
                                  className="rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-ink outline-none focus:border-terracotta"
                                />
                              </label>

                              <div className="border-t border-line pt-3">
                                <p className="font-mono-ui text-[11px] uppercase tracking-widest text-ink-faint">
                                  Huéspedes
                                </p>
                                <div className="mt-2 space-y-3">
                                  {editGuests.map((g) => (
                                    <div key={g.key} className="rounded-lg border border-line bg-paper p-3">
                                      <div className="mb-2 flex items-center gap-2">
                                        {g.is_primary && <Pill tone="neutral">Titular</Pill>}
                                        {!g.id && (
                                          <button
                                            type="button"
                                            onClick={() => removeGuestRow(g.key)}
                                            className="ml-auto text-[11px] text-ink-faint hover:text-rust"
                                          >
                                            Quitar
                                          </button>
                                        )}
                                      </div>
                                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                                        <label className="flex flex-col gap-1 text-xs text-ink-soft sm:col-span-2">
                                          Nombre
                                          <input
                                            type="text"
                                            value={g.full_name}
                                            onChange={(e) => updateGuestRow(g.key, { full_name: e.target.value })}
                                            className="rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-ink outline-none focus:border-terracotta"
                                          />
                                        </label>
                                        <label className="flex flex-col gap-1 text-xs text-ink-soft">
                                          RUT / pasaporte
                                          <input
                                            type="text"
                                            value={g.document_id}
                                            onChange={(e) => updateGuestRow(g.key, { document_id: e.target.value })}
                                            className="rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-ink outline-none focus:border-terracotta"
                                          />
                                        </label>
                                        <label className="flex flex-col gap-1 text-xs text-ink-soft">
                                          Nacionalidad
                                          <input
                                            type="text"
                                            value={g.nationality}
                                            onChange={(e) => updateGuestRow(g.key, { nationality: e.target.value })}
                                            className="rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-ink outline-none focus:border-terracotta"
                                          />
                                        </label>
                                        <label className="flex flex-col gap-1 text-xs text-ink-soft">
                                          Fecha de nacimiento
                                          <input
                                            type="date"
                                            value={g.birth_date}
                                            onChange={(e) => updateGuestRow(g.key, { birth_date: e.target.value })}
                                            className="rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-ink outline-none focus:border-terracotta"
                                          />
                                        </label>
                                        <label className="flex flex-col gap-1 text-xs text-ink-soft">
                                          Teléfono
                                          <input
                                            type="tel"
                                            value={g.phone}
                                            onChange={(e) => updateGuestRow(g.key, { phone: e.target.value })}
                                            className="rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-ink outline-none focus:border-terracotta"
                                          />
                                        </label>
                                        <label className="flex flex-col gap-1 text-xs text-ink-soft">
                                          Email
                                          <input
                                            type="email"
                                            value={g.email}
                                            onChange={(e) => updateGuestRow(g.key, { email: e.target.value })}
                                            className="rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-ink outline-none focus:border-terracotta"
                                          />
                                        </label>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                                <button
                                  type="button"
                                  onClick={addGuestRow}
                                  className="mt-3 text-xs text-terracotta underline decoration-dotted"
                                >
                                  + Agregar huésped
                                </button>
                              </div>

                              {editError && <p className="text-xs text-rust">{editError}</p>}

                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  disabled={savingEdit}
                                  onClick={() => saveEdit(r)}
                                  className="rounded-lg bg-terracotta px-4 py-2 text-xs font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-50"
                                >
                                  {savingEdit ? "Guardando…" : "Guardar cambios"}
                                </button>
                                <button type="button" onClick={closeEdit} className="text-xs text-ink-faint hover:text-ink">
                                  Cancelar
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <p className="font-mono-ui text-[11px] uppercase tracking-widest text-ink-faint">
                                Personas que ingresan a la isla con esta reserva
                              </p>
                              {people.length === 0 ? (
                                <p className="mt-2 text-xs text-ink-faint">
                                  {r.guest_count != null
                                    ? `Todavía no se cargaron los datos de cada persona — se anotó que serían ${r.guest_count} ${r.guest_count === 1 ? "huésped" : "huéspedes"} en total (solo el titular quedó registrado por ahora).`
                                    : "Reserva antigua sin este detalle todavía — solo se guardó el nombre del titular."}
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
                              {(r.arrival_flight_number || r.departure_flight_number || r.airport_transfer_notes) && (
                                <div className="mt-3 border-t border-line pt-3">
                                  <p className="font-mono-ui text-[11px] uppercase tracking-widest text-ink-faint">
                                    Vuelos y traslado
                                  </p>
                                  <p className="mt-1 text-sm text-ink">
                                    {r.arrival_flight_number && (
                                      <>
                                        Llegada: {r.arrival_flight_number}
                                        {r.arrival_flight_time ? ` a las ${r.arrival_flight_time.slice(0, 5)}` : ""}
                                        <br />
                                      </>
                                    )}
                                    {r.departure_flight_number && (
                                      <>
                                        Salida: {r.departure_flight_number}
                                        {r.departure_flight_time ? ` a las ${r.departure_flight_time.slice(0, 5)}` : ""}
                                        <br />
                                      </>
                                    )}
                                    {r.airport_transfer_notes}
                                  </p>
                                </div>
                              )}
                              {r.internal_notes && (
                                <div className="mt-3 border-t border-line pt-3">
                                  <p className="font-mono-ui text-[11px] uppercase tracking-widest text-ink-faint">
                                    Comentarios
                                  </p>
                                  <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{r.internal_notes}</p>
                                </div>
                              )}
                            </>
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
