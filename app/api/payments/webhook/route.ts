import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getStripeClient } from "@/lib/stripe";

// POST /api/payments/webhook
//
// Stripe llama a esto directamente (no el navegador del huésped) apenas
// se completa un pago — así el sistema se entera de que cobró incluso si
// el huésped cierra la pestaña antes de volver al sitio. Hay que
// configurar esta URL en el dashboard de Stripe (Developers → Webhooks →
// Add endpoint) apuntando a
// https://<tu-deploy-de-nuku-os>/api/payments/webhook, escuchando el
// evento "checkout.session.completed" — ver STRIPE.md.
//
// Verifica la firma con STRIPE_WEBHOOK_SECRET para asegurarse de que el
// aviso viene realmente de Stripe y no de cualquiera que le pegue a esta
// URL diciendo "ya pagué".

export async function POST(req: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("[api/payments/webhook] Falta STRIPE_WEBHOOK_SECRET.");
    return NextResponse.json({ error: "Falta STRIPE_WEBHOOK_SECRET." }, { status: 500 });
  }

  const signature = req.headers.get("stripe-signature");
  const rawBody = await req.text();

  let event;
  try {
    const stripe = getStripeClient();
    event = stripe.webhooks.constructEvent(rawBody, signature ?? "", webhookSecret);
  } catch (err) {
    console.error("[api/payments/webhook] Firma inválida", err);
    return NextResponse.json({ error: "Firma inválida." }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as { metadata?: { reservation_id?: string; account_id?: string } };
    const reservationId = session.metadata?.reservation_id;
    const accountId = session.metadata?.account_id;

    if (reservationId && accountId) {
      try {
        const supabase = getSupabaseServerClient();
        await supabase
          .from("reservations")
          .update({ payment_status: "paid" })
          .eq("id", reservationId)
          .eq("account_id", accountId);
      } catch (err) {
        console.error("[api/payments/webhook] No se pudo marcar la reserva como pagada", err);
      }
    }
  }

  return NextResponse.json({ received: true });
}
