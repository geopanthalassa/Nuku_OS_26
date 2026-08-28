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
};

const EMPTY_GUEST: GuestForm = { full_name: "", document_id: "", email: "", phone: "", birth_date: "" };

// Página pública de disponibilidad — a la que apunta el panel "Reservar" de
// kuhane-web. Fase 0: sin pagos automáticos todavía, pero la solicitud ya
// queda guardada de verdad en Supabase (antes se perdía en el aire) para
// que el equipo la confirme por WhatsApp/email.
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
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLDivElement | null>(null);

  const checkin = params.get("checkin") ?? "";
  const checkout = params.get("checkout") ?? "";
  const guestsParam = Number(params.get("guests") ?? "2");
  const guests = Number.isFinite(guestsParam) && guestsParam > 0 ? guestsParam : 2;
  const promo = params.get("promo") ?? "";

  const nightCount = useMemo(() => {
    if (!checkin || !checkout) return null;
    const n = nights(checkin, checkout);
    return n > 0 ? n : null;
  }, [checkin, checkout]);

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
    if (!selectedRoomId || !checkin || !checkout || missingRequired) return;
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
          },
          companions: companions.map((c) => ({
            full_name: c.full_name.trim(),
            document_id: c.document_id.trim() || undefined,
            email: c.email.trim() || undefined,
            phone: c.phone.trim() || undefined,
            birth_date: c.birth_date || undefined,
          })),
          tour_interest: wantsTours,
          tour_notes: wantsTours ? tourNotes.trim() || undefined : undefined,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSent(true);
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
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-paper-alt px-6 py-16 sm:px-10">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center gap-2 font-mono-ui text-xs uppercase tracking-widest text-ink-faint">
          <span className="text-olive">◈</span> Nuku OS — {demoWorkspace.account.name}
        </div>

        <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-olive-soft px-3 py-1 font-mono-ui text-[11px] uppercase tracking-widest text-olive">
          Modo demo — Fase 0
        </div>

        <h1 className="font-display mt-5 text-3xl text-ink sm:text-4xl">Disponibilidad</h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-soft">
          Este sistema de reservas está en fase de pruebas: todavía no procesa pagos ni
          confirma automáticamente. Elige una habitación, dejanos tus datos y te contactamos
          por WhatsApp o email para confirmar la reserva.
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
                  placeholder="Contanos qué te interesa (ej: tour a Rano Raraku, buceo un día, cabalgata) — el equipo te cotiza junto con la reserva."
                  rows={3}
                  className="mt-3 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-terracotta"
                />
              )}
            </div>

            <button
              onClick={submitRequest}
              disabled={sending || missingRequired}
              className="w-full rounded-lg bg-terracotta px-5 py-2.5 text-sm font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-50 sm:w-auto"
            >
              {sending ? "Enviando…" : "Solicitar esta habitación"}
            </button>
            {missingRequired && (
              <p className="text-[11px] text-ink-faint">
                Falta nombre y/o identificación de alguna persona de la reserva.
              </p>
            )}
          </div>
        )}

        {sent && (
          <div className="mt-8 rounded-xl border border-sage bg-sage-soft p-5 text-sm text-ink">
            Recibimos tu solicitud. Como el sistema todavía está en fase de pruebas, el
            equipo de Kuhane te va a escribir por WhatsApp o email para confirmar
            disponibilidad y forma de pago — no se ha realizado ningún cobro.
          </div>
        )}
      </div>
    </main>
  );
}
