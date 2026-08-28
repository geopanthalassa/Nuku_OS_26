"use client";

import { Fragment, useEffect, useState } from "react";
import TopBar from "@/components/admin/TopBar";
import Pill from "@/components/ui/Pill";
import { demoWorkspace } from "@/lib/mock-data";
import { formatMoney, formatDateRange, nights } from "@/lib/format";
import { CURRENT_ACCOUNT_ID } from "@/lib/current-account";

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
  reservation_guests: { full_name: string; document_id: string | null; is_primary: boolean }[] | null;
  tour_interest: boolean;
  tour_notes: string | null;
  stripe_payment_link?: string | null;
};

function one<T>(rel: T | T[] | null): T | null {
  if (!rel) return null;
  return Array.isArray(rel) ? rel[0] ?? null : rel;
}

export default function ReservasPage() {
  const { account } = demoWorkspace; // nombre/branding del TopBar — solo texto de UI
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

  function load() {
    fetch(`/api/dashboard/reservations?account_id=${CURRENT_ACCOUNT_ID}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setReservations(data.reservations);
        setCurrency(data.currency);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Error desconocido"));
  }

  useEffect(load, []);

  async function updateStatus(r: Reservation, status: string) {
    setPendingId(r.id);
    setError(null);
    try {
      const res = await fetch("/api/dashboard/reservations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ account_id: CURRENT_ACCOUNT_ID, id: r.id, status }),
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
    const pesos = Number(amountInput.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(pesos) || pesos <= 0) {
      setPaymentError("Ingresá un monto válido antes de generar el link.");
      return;
    }
    setPendingId(r.id);
    setPaymentError(null);
    try {
      const res = await fetch("/api/payments/create-checkout-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          account_id: CURRENT_ACCOUNT_ID,
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

  return (
    <>
      <TopBar account={account} title="Reservas" />
      <main className="flex-1 space-y-5 p-6">
        <p className="max-w-2xl text-sm text-ink-soft">
          Esta lista ya es real: las solicitudes que llegan desde la página
          pública de reservas quedan guardadas acá con estado{" "}
          <span className="font-medium text-ink">Por confirmar</span>. Al
          confirmarlas, se arma el mensaje de bienvenida para copiar y
          mandar por WhatsApp o email mientras el envío automático todavía
          no está conectado (ver n8n-templates/README.md).
        </p>

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
            Todavía no hay reservas reales. Van a aparecer acá apenas alguien complete el formulario en /reservar.
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
                        <Pill tone="neutral">{r.channel}</Pill>
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
                                    setAmountInput("");
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
                                  onClick={() => setPayingId(null)}
                                  className="text-xs text-ink-faint hover:text-ink"
                                >
                                  Cancelar
                                </button>
                              </div>
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
                            <ul className="mt-2 space-y-1">
                              {people.map((p, i) => (
                                <li key={i} className="flex items-center gap-2 text-sm text-ink">
                                  <span className="font-medium">{p.full_name}</span>
                                  {p.is_primary && <Pill tone="neutral">Titular</Pill>}
                                  <span className="text-ink-faint">
                                    {p.document_id ? `RUT/pasaporte: ${p.document_id}` : "sin identificación registrada"}
                                  </span>
                                </li>
                              ))}
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
