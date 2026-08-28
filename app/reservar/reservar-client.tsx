"use client";

import { useEffect, useMemo, useState } from "react";
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
  email: string;
  phone: string;
  birth_date: string;
};

const EMPTY_GUEST: GuestForm = { full_name: "", email: "", phone: "", birth_date: "" };

// Página pública de disponibilidad — a la que apunta el panel "Reservar" de
// kuhane-web. Fase 0: sin pagos automáticos todavía, pero la solicitud ya
// queda guardada de verdad en Supabase (antes se perdía en el aire) para
// que el equipo la confirme por WhatsApp/email.
export default function ReservarClient() {
  const params = useSearchParams();
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [currency, setCurrency] = useState("CLP");
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [guestForm, setGuestForm] = useState<GuestForm>(EMPTY_GUEST);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  async function submitRequest() {
    if (!selectedRoomId || !checkin || !checkout || !guestForm.full_name.trim()) return;
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
            email: guestForm.email.trim() || undefined,
            phone: guestForm.phone.trim() || undefined,
            birth_date: guestForm.birth_date || undefined,
          },
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
          <div className="mt-8 space-y-3 rounded-xl border border-line bg-surface p-5">
            <p className="font-mono-ui text-[11px] uppercase tracking-widest text-ink-faint">Tus datos</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <input
                value={guestForm.full_name}
                onChange={(e) => setGuestForm((f) => ({ ...f, full_name: e.target.value }))}
                placeholder="Nombre completo *"
                className="rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-terracotta"
              />
              <input
                value={guestForm.email}
                onChange={(e) => setGuestForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="Email"
                type="email"
                className="rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-terracotta"
              />
              <input
                value={guestForm.phone}
                onChange={(e) => setGuestForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder="WhatsApp / teléfono"
                className="rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-terracotta"
              />
              <div>
                <input
                  value={guestForm.birth_date}
                  onChange={(e) => setGuestForm((f) => ({ ...f, birth_date: e.target.value }))}
                  type="date"
                  className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-terracotta"
                />
                <p className="mt-1 text-[11px] text-ink-faint">
                  Opcional — para saludarte con algo especial en tu cumpleaños.
                </p>
              </div>
            </div>
            <button
              onClick={submitRequest}
              disabled={sending || !guestForm.full_name.trim()}
              className="w-full rounded-lg bg-terracotta px-5 py-2.5 text-sm font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-50 sm:w-auto"
            >
              {sending ? "Enviando…" : "Solicitar esta habitación"}
            </button>
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
