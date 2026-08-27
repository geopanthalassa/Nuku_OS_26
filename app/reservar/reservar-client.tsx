"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { demoWorkspace } from "@/lib/mock-data";
import { formatMoney, nights } from "@/lib/format";

// Página pública de disponibilidad — a la que apunta el panel "Reservar" de
// kuhane-web. Fase 0: sin pagos ni persistencia reales todavía, solo
// muestra las habitaciones de ejemplo y deja los datos listos para que el
// equipo confirme por WhatsApp/email. Cuando exista backend real (Supabase +
// pagos), esto pasa a ser un flujo de reserva de verdad.
export default function ReservarClient() {
  const params = useSearchParams();
  const [sent, setSent] = useState(false);

  const checkin = params.get("checkin") ?? "";
  const checkout = params.get("checkout") ?? "";
  const guestsParam = Number(params.get("guests") ?? "2");
  const guests = Number.isFinite(guestsParam) && guestsParam > 0 ? guestsParam : 2;

  const nightCount = useMemo(() => {
    if (!checkin || !checkout) return null;
    const n = nights(checkin, checkout);
    return n > 0 ? n : null;
  }, [checkin, checkout]);

  const rooms = demoWorkspace.rooms;

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
          confirma automáticamente. Elige una habitación y te contactamos por WhatsApp o
          email para confirmar la reserva.
        </p>

        <div className="mt-8 grid grid-cols-1 gap-4 rounded-xl border border-line bg-surface p-5 sm:grid-cols-3">
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
        </div>

        <div className="mt-10 space-y-4">
          {rooms.map((room) => (
            <div
              key={room.id}
              className="flex flex-col justify-between gap-4 rounded-xl border border-line bg-surface p-5 sm:flex-row sm:items-center"
            >
              <div>
                <h2 className="font-display text-lg text-ink">{room.name}</h2>
                <p className="mt-1 text-sm text-ink-soft">Capacidad: hasta {room.capacity} personas</p>
              </div>
              <div className="flex items-center gap-4">
                <span className="font-mono-ui text-sm text-ink-soft">
                  {formatMoney(room.baseRateCents, demoWorkspace.account.currency)} / noche
                </span>
                <button
                  onClick={() => setSent(true)}
                  className="shrink-0 rounded-lg bg-terracotta px-5 py-2.5 text-sm font-medium text-paper transition-opacity hover:opacity-90"
                >
                  Solicitar esta habitación
                </button>
              </div>
            </div>
          ))}
        </div>

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
