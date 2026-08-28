import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getStripeClient } from "@/lib/stripe";

// POST /api/payments/create-checkout-session
//
// Lo que usa el botón "Generar link de pago" en el panel de Reservas. No
// hay tarifas cargadas todavía para las habitaciones reales de Kuhane
// (por eso el equipo escribe el monto a mano acá, en vez de calcularlo
// solo) — cuando eso cambie, este mismo endpoint puede empezar a leer el
// monto de la reserva en vez de recibirlo por body.
//
// Devuelve la URL de pago de Stripe (Checkout, modo "payment", una sola
// vez) para copiar y mandar por WhatsApp o email. Falla con un error
// claro si todavía no está configurada la cuenta de Stripe (ver
// STRIPE.md) — no rompe nada más del panel.
//
// body: { account_id, reservation_id, amount_cents, currency? }
//
// OJO con las monedas "sin decimales" de Stripe (CLP, JPY, KRW, etc.):
// Stripe espera el monto en la unidad base de esas monedas (ej. pesos
// enteros para CLP), NO en "centavos" como con USD/EUR. El resto de esta
// app guarda todo en `_cents` como si toda moneda tuviera 2 decimales
// (ver lib/format.ts: formatMoney hace cents / 100) para ser consistente
// internamente — así que acá, justo antes de llamar a Stripe, hay que
// deshacer esa convención para las monedas sin decimales.
const STRIPE_ZERO_DECIMAL_CURRENCIES = new Set([
  "bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga",
  "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf",
]);

function toStripeUnitAmount(appCents: number, currency: string): number {
  const pesos = appCents / 100; // convención interna de esta app
  const isZeroDecimal = STRIPE_ZERO_DECIMAL_CURRENCIES.has(currency.toLowerCase());
  return Math.round(isZeroDecimal ? pesos : pesos * 100);
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  const { account_id, reservation_id, amount_cents, currency } = (body ?? {}) as Record<string, unknown>;
  if (
    typeof account_id !== "string" ||
    typeof reservation_id !== "string" ||
    typeof amount_cents !== "number" ||
    !Number.isFinite(amount_cents) ||
    amount_cents <= 0
  ) {
    return NextResponse.json(
      {
        error:
          "Faltan o son inválidos los campos obligatorios: account_id (string), reservation_id (string), amount_cents (número mayor a 0).",
      },
      { status: 400 }
    );
  }

  try {
    const supabase = getSupabaseServerClient();

    const { data: reservation, error: resError } = await supabase
      .from("reservations")
      .select("id, check_in, check_out, guests(full_name, email), rooms(name), accounts(currency, name)")
      .eq("id", reservation_id)
      .eq("account_id", account_id)
      .single();

    if (resError || !reservation) {
      throw new Error(`Reserva no encontrada (reservation_id=${reservation_id}): ${resError?.message ?? "sin datos"}`);
    }

    const guestRel = (reservation as { guests?: { full_name?: string; email?: string } | { full_name?: string; email?: string }[] }).guests;
    const roomRel = (reservation as { rooms?: { name?: string } | { name?: string }[] }).rooms;
    const accountRel = (reservation as { accounts?: { currency?: string; name?: string } | { currency?: string; name?: string }[] }).accounts;
    const guest = Array.isArray(guestRel) ? guestRel[0] : guestRel;
    const room = Array.isArray(roomRel) ? roomRel[0] : roomRel;
    const account = Array.isArray(accountRel) ? accountRel[0] : accountRel;

    const finalCurrency = (typeof currency === "string" && currency) || account?.currency || "CLP";
    const stripe = getStripeClient();

    const origin = new URL(req.url).origin;
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: finalCurrency.toLowerCase(),
            unit_amount: toStripeUnitAmount(amount_cents, finalCurrency),
            product_data: {
              name: `${account?.name ?? "Reserva"} — ${room?.name ?? "Habitación"}`,
              description: `${reservation.check_in} a ${reservation.check_out}`,
            },
          },
          quantity: 1,
        },
      ],
      customer_email: guest?.email || undefined,
      metadata: { reservation_id, account_id },
      success_url: `${origin}/pago-exitoso?reservation_id=${reservation_id}`,
      cancel_url: `${origin}/pago-cancelado?reservation_id=${reservation_id}`,
    });

    await supabase
      .from("reservations")
      .update({ stripe_checkout_session_id: session.id, stripe_payment_link: session.url })
      .eq("id", reservation_id)
      .eq("account_id", account_id);

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("[api/payments/create-checkout-session]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error desconocido" },
      { status: 500 }
    );
  }
}
