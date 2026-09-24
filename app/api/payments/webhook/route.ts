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
        const { data: updated } = await supabase
          .from("reservations")
          .update({ payment_status: "paid" })
          .eq("id", reservationId)
          .eq("account_id", accountId)
          .select("promo_code")
          .maybeSingle();

        // 24/9/2026: pedido de Andre — el contador "usos" de un cupón
        // (Cupones → 0/1 usos) nunca subía en ningún lado del código, así
        // que un cupón de "1 uso" en la práctica no tenía límite real. Acá
        // es el único lugar donde se confirma que un pago con cupón
        // realmente se cobró, así que es el punto correcto para sumar el
        // uso. Lectura + escritura (no un incremento atómico) porque los
        // pagos de un mismo cupón no llegan en simultáneo para un hostal de
        // este tamaño — si eso cambia algún día, esto debería pasar a una
        // función de base de datos con incremento atómico.
        if (updated?.promo_code) {
          const { data: promo } = await supabase
            .from("promo_codes")
            .select("uses_count")
            .eq("account_id", accountId)
            .eq("code", updated.promo_code)
            .maybeSingle();
          if (promo) {
            await supabase
              .from("promo_codes")
              .update({ uses_count: promo.uses_count + 1 })
              .eq("account_id", accountId)
              .eq("code", updated.promo_code);
          }
        }
      } catch (err) {
        console.error("[api/payments/webhook] No se pudo marcar la reserva como pagada", err);
      }
    }
  }

  return NextResponse.json({ received: true });
}
