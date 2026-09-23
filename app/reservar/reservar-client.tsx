"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { demoWorkspace } from "@/lib/mock-data";
import { formatMoney, nights } from "@/lib/format";
import { CURRENT_ACCOUNT_ID } from "@/lib/current-account";

type Room = {
  id: string;
  name: string;
  capacity: number;
  base_rate_cents: number | null;
};

type GuestForm = {
  full_name: string;
  document_id: string;
  email: string;
  phone: string;
  birth_date: string;
  dietary_vegan: boolean;
  dietary_vegetarian: boolean;
  dietary_celiac: boolean;
  dietary_lactose_free: boolean;
  dietary_other: string;
  mobility_assistance: boolean;
  mobility_notes: string;
};

// Contacto real de Kuhane (mismo que en el correo de confirmación,
// lib/email.ts) — se reusa acá para el modal de "reserva registrada".
const WHATSAPP_NUMBER = "56977668288"; // +56 9 7766 8288, sin espacios ni +
const CONTACT_EMAIL = "contacto@kuhanehostal.com";
const MARKETING_SITE_URL = "https://kuhanehostal.com";

function formatDateLong(dateStr: string) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  if (Number.isNaN(d.getTime())) return dateStr;
  return new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "long", year: "numeric" }).format(d);
}

// Días que faltan para el check-in, contados desde hoy (0 = llega hoy,
// negativo si la fecha ya pasó — no se muestra en ese caso).
function daysUntil(dateStr: string) {
  if (!dateStr) return null;
  const target = new Date(dateStr + "T00:00:00");
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const ms = target.getTime() - today.getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

const EMPTY_GUEST: GuestForm = {
  full_name: "",
  document_id: "",
  email: "",
  phone: "",
  birth_date: "",
  dietary_vegan: false,
  dietary_vegetarian: false,
  dietary_celiac: false,
  dietary_lactose_free: false,
  dietary_other: "",
  mobility_assistance: false,
  mobility_notes: "",
};

// Página pública de disponibilidad — a la que apunta el panel "Reservar" de
// kuhane-web. La reserva y el correo de confirmación son reales y quedan
// guardados de verdad en Supabase apenas se envía el formulario — no es
// una fase de pruebas (confirmado por Andre, 22/9/2026). El pago nunca se
// procesa online: se hace directo en el hostal, así que no hay cobro
// automático que agregar aquí.
//
// El hostal se hace responsable de declarar a todas las personas que
// ingresan a Rapa Nui en esta reserva, así que el formulario pide los
// mismos datos (nombre, identificación, teléfono, correo, fecha de
// nacimiento) para el titular y para cada acompañante — no solo para
// quien reserva.
export default function ReservarClient() {
  const params = useSearchParams();
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [currency, setCurrency] = useState("CLP");
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [guestForm, setGuestForm] = useState<GuestForm>(EMPTY_GUEST);
  const [companions, setCompanions] = useState<GuestForm[]>([]);
  const [wantsTours, setWantsTours] = useState(false);
  const [tourNotes, setTourNotes] = useState("");
  const [arrivalFlightTime, setArrivalFlightTime] = useState("");
  const [arrivalFlightNumber, setArrivalFlightNumber] = useState("");
  const [departureFlightTime, setDepartureFlightTime] = useState("");
  const [departureFlightNumber, setDepartureFlightNumber] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLDivElement | null>(null);

  const checkin = params.get("checkin") ?? "";
  const checkout = params.get("checkout") ?? "";
  const guestsParam = Number(params.get("guests") ?? "2");
  const guests = Number.isFinite(guestsParam) && guestsParam > 0 ? guestsParam : 2;
  const promo = params.get("promo") ?? "";
  const tourParam = params.get("tour") ?? "";

  // Tour agregado desde kuhane-web (/tours -> homepage -> acá). Precarga el
  // check de "nos interesan tours" y deja el nombre del tour en las notas,
  // sin pisar lo que la persona ya haya escrito. Pedido de Andre
  // (22-23/9/2026): ningún precio de tour se muestra en ningún lado del
  // sitio público — el equipo lo cotiza al confirmar la reserva.
  useEffect(() => {
    if (!tourParam) return;
    setWantsTours(true);
    setTourNotes((prev) => (prev.trim() ? prev : `Tour agregado desde la página: ${tourParam}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourParam]);

  const nightCount = useMemo(() => {
    if (!checkin || !checkout) return null;
    const n = nights(checkin, checkout);
    return n > 0 ? n : null;
  }, [checkin, checkout]);

  // Estadía mínima de 2 noches — pedido de Andre (22/9/2026).
  const MIN_NIGHTS = 2;
  const stayTooShort = nightCount !== null && nightCount < MIN_NIGHTS;

  useEffect(() => {
    fetch(`/api/public/rooms?account_id=${CURRENT_ACCOUNT_ID}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setRooms(data.rooms);
        setCurrency(data.currency);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Error desconocido"));
  }, []);

  // El formulario pide los datos de TODOS los que van a ingresar a la isla
  // con esta reserva: el titular + un acompañante por cada persona extra
  // indicada en "Huéspedes" al buscar disponibilidad.
  useEffect(() => {
    const companionCount = Math.max(0, guests - 1);
    setCompanions((prev) => {
      if (prev.length === companionCount) return prev;
      if (prev.length > companionCount) return prev.slice(0, companionCount);
      return [...prev, ...Array.from({ length: companionCount - prev.length }, () => ({ ...EMPTY_GUEST }))];
    });
  }, [guests]);

  // Bug reportado: al elegir una habitación el botón cambiaba a
  // "Seleccionada" pero el formulario quedaba fuera de la vista y parecía
  // que no pasaba nada. Ahora hacemos scroll automático hasta el formulario
  // apenas se elige una habitación.
  useEffect(() => {
    if (selectedRoomId && formRef.current) {
      formRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [selectedRoomId]);

  function updateCompanion(index: number, patch: Partial<GuestForm>) {
    setCompanions((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }

  const missingRequired =
    !guestForm.full_name.trim() ||
    !guestForm.document_id.trim() ||
    companions.some((c) => !c.full_name.trim() || !c.document_id.trim());

  async function submitRequest() {
    if (!selectedRoomId || !checkin || !checkout || missingRequired || stayTooShort) return;
    setSending(true);
    setError(null);

    try {
      const res = await fetch("/api/reservations/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          account_id: CURRENT_ACCOUNT_ID,
          room_id: selectedRoomId,
          check_in: checkin,
          check_out: checkout,
          promo_code: promo || undefined,
          guest: {
            full_name: guestForm.full_name.trim(),
            document_id: guestForm.document_id.trim(),
            email: guestForm.email.trim() || undefined,
            phone: guestForm.phone.trim() || undefined,
            birth_date: guestForm.birth_date || undefined,
            dietary_vegan: guestForm.dietary_vegan,
            dietary_vegetarian: guestForm.dietary_vegetarian,
            dietary_celiac: guestForm.dietary_celiac,
            dietary_lactose_free: guestForm.dietary_lactose_free,
            dietary_other: guestForm.dietary_other.trim() || undefined,
            mobility_assistance: guestForm.mobility_assistance,
            mobility_notes: guestForm.mobility_assistance ? guestForm.mobility_notes.trim() || undefined : undefined,
          },
          companions: companions.map((c) => ({
            full_name: c.full_name.trim(),
            document_id: c.document_id.trim() || undefined,
            email: c.email.trim() || undefined,
            phone: c.phone.trim() || undefined,
            birth_date: c.birth_date || undefined,
            dietary_vegan: c.dietary_vegan,
            dietary_vegetarian: c.dietary_vegetarian,
            dietary_celiac: c.dietary_celiac,
            dietary_lactose_free: c.dietary_lactose_free,
            dietary_other: c.dietary_other.trim() || undefined,
            mobility_assistance: c.mobility_assistance,
            mobility_notes: c.mobility_assistance ? c.mobility_notes.trim() || undefined : undefined,
          })),
          tour_interest: wantsTours,
          tour_notes: wantsTours ? tourNotes.trim() || undefined : undefined,
          arrival_flight_time: arrivalFlightTime || undefined,
          arrival_flight_number: arrivalFlightNumber.trim() || undefined,
          departure_flight_time: departureFlightTime || undefined,
          departure_flight_number: departureFlightNumber.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSent(true);
      setModalOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo enviar la solicitud.");
    } finally {
      setSending(false);
    }
  }

  const displayRooms = useMemo(() => {
    if (rooms) {
      return rooms.map((r) => ({ id: r.id, name: r.name, capacity: r.capacity, rateCents: r.base_rate_cents, real: true as const }));
    }
    // Respaldo visual mientras la API todavía no respondió — no seleccionable.
    return demoWorkspace.rooms.map((r) => ({ id: r.id, name: r.name, capacity: r.capacity, rateCents: r.baseRateCents, real: false as const }));
  }, [rooms]);

  const selectedRoom = useMemo(
    () => displayRooms.find((r) => r.id === selectedRoomId) ?? null,
    [displayRooms, selectedRoomId]
  );

  const daysToArrival = useMemo(() => daysUntil(checkin), [checkin]);

  // Total estimado de la estadía (tarifa/noche × noches) — no es un cobro,
  // el pago se hace directo en el hostal. Si la habitación todavía no
  // tiene tarifa cargada en Supabase, formatMoney ya devuelve
  // "[POR CONFIRMAR]" en vez de inventar un número.
  const totalCents = useMemo(() => {
    if (!selectedRoom || selectedRoom.rateCents == null || !nightCount) return null;
    return selectedRoom.rateCents * nightCount;
  }, [selectedRoom, nightCount]);

  const whatsappHref = useMemo(() => {
    const text = `Hola! Acabo de solicitar una reserva en Kuhane Etno-Hostal${
      selectedRoom ? ` (${selectedRoom.name})` : ""
    }${checkin && checkout ? ` del ${checkin} al ${checkout}` : ""}${
      guestForm.full_name ? ` a nombre de ${guestForm.full_name}` : ""
    }. Quería confirmar unos detalles.`;
    return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;
  }, [selectedRoom, checkin, checkout, guestForm.full_name]);

  function guestFields(
    value: GuestForm,
    onChange: (patch: Partial<GuestForm>) => void,
    keyPrefix: string
  ) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <input
          key={`${keyPrefix}-name`}
          value={value.full_name}
          onChange={(e) => onChange({ full_name: e.target.value })}
          placeholder="Nombre completo *"
          className="rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-terracotta"
        />
        <input
          key={`${keyPrefix}-doc`}
          value={value.document_id}
          onChange={(e) => onChange({ document_id: e.target.value })}
          placeholder="RUT o pasaporte *"
          className="rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-terracotta"
        />
        <input
          key={`${keyPrefix}-email`}
          value={value.email}
          onChange={(e) => onChange({ email: e.target.value })}
          placeholder="Email"
          type="email"
          className="rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-terracotta"
        />
        <input
          key={`${keyPrefix}-phone`}
          value={value.phone}
          onChange={(e) => onChange({ phone: e.target.value })}
          placeholder="WhatsApp / teléfono"
          className="rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-terracotta"
        />
        <div className="sm:col-span-2">
          <input
            key={`${keyPrefix}-birth`}
            value={value.birth_date}
            onChange={(e) => onChange({ birth_date: e.target.value })}
            type="date"
            className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-terracotta sm:w-1/2"
          />
          <p className="mt-1 text-[11px] text-ink-faint">
            Fecha de nacimiento — opcional, para saludar con algo especial en el cumpleaños.
          </p>
        </div>

        <div className="sm:col-span-2 border-t border-line pt-3">
          <p className="text-[11px] text-ink-faint">
            Preferencias para el desayuno — para que la cocina prepare algo apropiado.
          </p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
            {(
              [
                ["dietary_vegan", "Vegano"],
                ["dietary_vegetarian", "Vegetariano"],
                ["dietary_celiac", "Celíaco / sin gluten"],
                ["dietary_lactose_free", "Sin lactosa"],
              ] as const
            ).map(([field, label]) => (
              <label key={`${keyPrefix}-${field}`} className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={value[field]}
                  onChange={(e) => onChange({ [field]: e.target.checked } as Partial<GuestForm>)}
                  className="h-4 w-4 rounded border-line accent-terracotta"
                />
                {label}
              </label>
            ))}
          </div>
          <input
            key={`${keyPrefix}-dietary-other`}
            value={value.dietary_other}
            onChange={(e) => onChange({ dietary_other: e.target.value })}
            placeholder="Otra alergia o preferencia alimentaria (opcional)"
            className="mt-2 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-terracotta"
          />
        </div>

        <div className="sm:col-span-2">
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={value.mobility_assistance}
              onChange={(e) => onChange({ mobility_assistance: e.target.checked })}
              className="mt-0.5 h-4 w-4 rounded border-line accent-terracotta"
            />
            <span className="text-sm text-ink">Necesita algún tipo de asistencia de movilidad</span>
          </label>
          {value.mobility_assistance && (
            <input
              key={`${keyPrefix}-mobility-notes`}
              value={value.mobility_notes}
              onChange={(e) => onChange({ mobility_notes: e.target.value })}
              placeholder="Cuéntanos qué necesitas (silla de ruedas, dificultad para escaleras, etc.)"
              className="mt-2 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-terracotta"
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-paper-alt px-6 py-16 sm:px-10">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center gap-2 font-mono-ui text-xs uppercase tracking-widest text-ink-faint">
          <span className="text-olive">◈</span> Nuku OS — {demoWorkspace.account.name}
        </div>

        <h1 className="font-display mt-5 text-3xl text-ink sm:text-4xl">Disponibilidad</h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-soft">
          Tu reserva queda registrada al instante y te enviamos la confirmación por correo.
          El pago se hace directo en el hostal — efectivo, débito o crédito (nacional o
          extranjera). Escríbenos por WhatsApp o email si necesitas coordinar tu llegada.
        </p>

        <div
          className={`mt-8 grid grid-cols-1 gap-4 rounded-xl border border-line bg-surface p-5 ${
            promo ? "sm:grid-cols-4" : "sm:grid-cols-3"
          }`}
        >
          <div>
            <p className="font-mono-ui text-[11px] uppercase tracking-widest text-ink-faint">Llegada</p>
            <p className="mt-1 text-sm text-ink">{checkin || "Por elegir"}</p>
          </div>
          <div>
            <p className="font-mono-ui text-[11px] uppercase tracking-widest text-ink-faint">Salida</p>
            <p className="mt-1 text-sm text-ink">{checkout || "Por elegir"}</p>
          </div>
          <div>
            <p className="font-mono-ui text-[11px] uppercase tracking-widest text-ink-faint">Huéspedes</p>
            <p className="mt-1 text-sm text-ink">
              {guests} {guests === 1 ? "persona" : "personas"}
              {nightCount ? ` · ${nightCount} ${nightCount === 1 ? "noche" : "noches"}` : ""}
            </p>
            {stayTooShort && (
              <p className="mt-1 text-[11px] text-terracotta">
                La estadía mínima es de {MIN_NIGHTS} noches. Elige otras fechas.
              </p>
            )}
          </div>
          {promo && (
            <div>
              <p className="font-mono-ui text-[11px] uppercase tracking-widest text-ink-faint">Código</p>
              <p className="mt-1 text-sm text-terracotta">{promo}</p>
            </div>
          )}
        </div>

        {promo && (
          <p className="mt-3 text-xs text-ink-faint">
            Código promocional <strong className="text-ink-soft">{promo}</strong> registrado — el equipo de Kuhane lo
            valida y aplica el descuento al confirmar por WhatsApp o email (todavía no hay tarifas cargadas en el
            sistema para aplicarlo automáticamente).
          </p>
        )}

        {error && (
          <p className="mt-4 rounded-lg border border-rust/30 bg-rust-soft px-4 py-3 text-sm text-rust">{error}</p>
        )}

        <div className="mt-10 space-y-4">
          {displayRooms.map((room) => (
            <div
              key={room.id}
              className={`flex flex-col justify-between gap-4 rounded-xl border p-5 sm:flex-row sm:items-center ${
                selectedRoomId === room.id ? "border-terracotta bg-surface" : "border-line bg-surface"
              }`}
            >
              <div>
                <h2 className="font-display text-lg text-ink">{room.name}</h2>
                <p className="mt-1 text-sm text-ink-soft">Capacidad: hasta {room.capacity} personas</p>
              </div>
              <div className="flex items-center gap-4">
                <span className="font-mono-ui text-sm text-ink-soft">
                  {formatMoney(room.rateCents, currency)} / noche
                </span>
                <button
                  disabled={!room.real}
                  onClick={() => setSelectedRoomId(room.id)}
                  className="shrink-0 rounded-lg bg-terracotta px-5 py-2.5 text-sm font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {selectedRoomId === room.id ? "Seleccionada" : "Elegir esta habitación"}
                </button>
              </div>
            </div>
          ))}
        </div>

        {selectedRoomId && !sent && (
          <div ref={formRef} className="mt-8 scroll-mt-6 space-y-6 rounded-xl border border-line bg-surface p-5">
            <div>
              <p className="font-mono-ui text-[11px] uppercase tracking-widest text-ink-faint">
                Datos del titular de la reserva
              </p>
              <p className="mt-1 text-xs text-ink-faint">
                Para ingresar a Rapa Nui hay que declarar la identificación de cada persona que viaja — por eso
                pedimos estos datos completos, no solo el nombre.
              </p>
              <div className="mt-3">{guestFields(guestForm, (patch) => setGuestForm((f) => ({ ...f, ...patch })), "titular")}</div>
            </div>

            {companions.map((companion, i) => (
              <div key={i} className="border-t border-line pt-5">
                <p className="font-mono-ui text-[11px] uppercase tracking-widest text-ink-faint">
                  Acompañante {i + 1} de {companions.length}
                </p>
                <div className="mt-3">
                  {guestFields(companion, (patch) => updateCompanion(i, patch), `acomp-${i}`)}
                </div>
              </div>
            ))}

            <div className="border-t border-line pt-5">
              <p className="font-mono-ui text-[11px] uppercase tracking-widest text-ink-faint">
                Traslado al aeropuerto
              </p>
              <p className="mt-1 text-xs text-ink-faint">
                Kuhane te busca al llegar y te lleva de vuelta a la salida — si ya tienes el vuelo, déjanos el dato acá.
                Si todavía no lo sabes, no hay problema: lo confirmamos más cerca de la fecha.
              </p>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <p className="mb-1 text-[11px] text-ink-faint">Llegada</p>
                  <div className="flex gap-2">
                    <input
                      value={arrivalFlightTime}
                      onChange={(e) => setArrivalFlightTime(e.target.value)}
                      type="time"
                      className="w-1/2 rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-terracotta"
                    />
                    <input
                      value={arrivalFlightNumber}
                      onChange={(e) => setArrivalFlightNumber(e.target.value)}
                      placeholder="N° de vuelo"
                      className="w-1/2 rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-terracotta"
                    />
                  </div>
                </div>
                <div>
                  <p className="mb-1 text-[11px] text-ink-faint">Salida</p>
                  <div className="flex gap-2">
                    <input
                      value={departureFlightTime}
                      onChange={(e) => setDepartureFlightTime(e.target.value)}
                      type="time"
                      className="w-1/2 rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-terracotta"
                    />
                    <input
                      value={departureFlightNumber}
                      onChange={(e) => setDepartureFlightNumber(e.target.value)}
                      placeholder="N° de vuelo"
                      className="w-1/2 rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-terracotta"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t border-line pt-5">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={wantsTours}
                  onChange={(e) => setWantsTours(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-line accent-terracotta"
                />
                <span className="text-sm text-ink">
                  Nos interesa sumar tours o experiencias en la isla (guiados por Kuhane, buceo, cabalgatas, etc.)
                </span>
              </label>
              {wantsTours && (
                <textarea
                  value={tourNotes}
                  onChange={(e) => setTourNotes(e.target.value)}
                  placeholder="Cuéntanos qué te interesa (ej: tour a Rano Raraku, buceo un día, cabalgata) — el equipo te cotiza junto con la reserva."
                  rows={3}
                  className="mt-3 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-terracotta"
                />
              )}
            </div>

            <button
              onClick={submitRequest}
              disabled={sending || missingRequired || stayTooShort}
              className="w-full rounded-lg bg-terracotta px-5 py-2.5 text-sm font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-50 sm:w-auto"
            >
              {sending ? "Enviando…" : "Solicitar esta habitación"}
            </button>
            {missingRequired && (
              <p className="text-[11px] text-ink-faint">
                Falta nombre y/o identificación de alguna persona de la reserva.
              </p>
            )}
            {stayTooShort && (
              <p className="text-[11px] text-ink-faint">
                La estadía mínima es de {MIN_NIGHTS} noches — ajusta las fechas arriba para continuar.
              </p>
            )}
          </div>
        )}

        {sent && (
          <div className="mt-8 flex items-center justify-between gap-4 rounded-xl border border-sage bg-sage-soft p-5 text-sm text-ink">
            <span>
              ¡Reserva registrada! Te enviamos la confirmación a tu correo. El pago se hace
              directo en el hostal — no se ha realizado ningún cobro online.
            </span>
            {!modalOpen && (
              <button
                type="button"
                onClick={() => setModalOpen(true)}
                className="shrink-0 whitespace-nowrap text-xs font-medium text-terracotta underline underline-offset-4"
              >
                Ver detalle
              </button>
            )}
          </div>
        )}
      </div>

      {/* Ventana emergente grande al confirmar la reserva — pedido de Andre
          (23/9/2026): quería algo más visible que un cuadro chico, con el
          mensaje personalizado ("tu aventura ya está en cuenta regresiva"),
          los datos que la persona puso, y los contactos de WhatsApp/email
          además de un link para volver al sitio. Se puede cerrar sin perder
          la reserva (que ya quedó guardada) — el cuadro chico de arriba
          queda como respaldo con un link "Ver detalle" para reabrirla. */}
      {sent && modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 px-4 py-8 backdrop-blur-sm"
          onClick={() => setModalOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="reserva-confirmada-titulo"
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_40px_80px_-24px_rgba(28,24,20,0.45)]"
          >
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              aria-label="Cerrar"
              className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-lg text-ink-faint hover:bg-paper-alt hover:text-ink"
            >
              ×
            </button>

            <div className="bg-olive px-8 pb-7 pt-9 text-paper sm:px-10">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-paper/15 text-xl">
                ✓
              </div>
              <h2 id="reserva-confirmada-titulo" className="font-display mt-4 text-2xl sm:text-3xl">
                Gracias por preferirnos{guestForm.full_name ? `, ${guestForm.full_name.split(" ")[0]}` : ""}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-paper/85">
                Tu reserva {selectedRoom ? <>a la <strong>{selectedRoom.name}</strong></> : ""}
                {checkin && checkout ? (
                  <>
                    {" "}
                    del <strong>{formatDateLong(checkin)}</strong> al <strong>{formatDateLong(checkout)}</strong>
                  </>
                ) : (
                  ""
                )}{" "}
                ha sido registrada. Tu aventura ya está en cuenta regresiva.
              </p>
            </div>

            <div className="space-y-5 px-8 py-7 sm:px-10">
              <div className="grid grid-cols-1 gap-3 rounded-xl border border-line bg-paper-alt p-4 text-sm sm:grid-cols-3">
                <div>
                  <p className="font-mono-ui text-[10px] uppercase tracking-widest text-ink-faint">Llegada</p>
                  <p className="mt-1 text-ink">{checkin ? formatDateLong(checkin) : "—"}</p>
                </div>
                <div>
                  <p className="font-mono-ui text-[10px] uppercase tracking-widest text-ink-faint">Salida</p>
                  <p className="mt-1 text-ink">{checkout ? formatDateLong(checkout) : "—"}</p>
                </div>
                <div>
                  <p className="font-mono-ui text-[10px] uppercase tracking-widest text-ink-faint">Noches</p>
                  <p className="mt-1 text-ink">{nightCount ?? "—"}</p>
                </div>
              </div>

              {daysToArrival !== null && daysToArrival >= 0 && (
                <p className="text-sm text-ink-soft">
                  {daysToArrival === 0
                    ? "¡Llegas hoy!"
                    : `Faltan ${daysToArrival} ${daysToArrival === 1 ? "día" : "días"} para tu llegada.`}
                </p>
              )}

              <div className="flex items-baseline justify-between gap-4 rounded-xl border border-line bg-paper-alt px-4 py-3">
                <span className="text-sm text-ink-soft">
                  Total estimado
                  {nightCount ? ` · ${nightCount} ${nightCount === 1 ? "noche" : "noches"}` : ""}
                </span>
                <span className="font-mono-ui text-lg text-ink">{formatMoney(totalCents, currency)}</span>
              </div>

              <p className="text-sm leading-relaxed text-ink-soft">
                El pago se hace directo en el hostal — no se ha realizado ningún cobro online.
                {guestForm.email ? (
                  <>
                    {" "}
                    Te enviamos la confirmación a <strong className="text-ink">{guestForm.email}</strong>.
                  </>
                ) : (
                  " No dejaste un correo, así que coordinemos directo por WhatsApp."
                )}
              </p>

              <div className="border-t border-line pt-5">
                <p className="text-sm text-ink-soft">
                  Si necesitas coordinar algo antes de tu llegada, escríbenos:
                </p>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <a
                    href={whatsappHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#25D366] px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
                  >
                    WhatsApp
                  </a>
                  <a
                    href={`mailto:${CONTACT_EMAIL}`}
                    className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-line bg-paper px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-paper-alt"
                  >
                    {CONTACT_EMAIL}
                  </a>
                </div>
              </div>

              <a
                href={MARKETING_SITE_URL}
                className="block text-center text-sm font-medium text-terracotta underline underline-offset-4"
              >
                Volver al inicio
              </a>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
