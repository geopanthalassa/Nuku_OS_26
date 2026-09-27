import Stripe from "stripe";

// Cliente de Stripe para uso EXCLUSIVO del lado del servidor (rutas API,
// nunca componentes de cliente) — usa la clave secreta, que nunca debe
// llegar al navegador. Mismo patrón que lib/supabase/server.ts: una sola
// variable de entorno, configurada en Vercel, no en el código, así el
// mismo build sirve para cualquier cliente nuevo que arme su propia
// cuenta de Stripe.
//
// Variable de entorno requerida:
//   STRIPE_SECRET_KEY → Developers → API keys → Secret key, en el
//   dashboard de Stripe (arrancar con la clave de modo Test hasta probar
//   que todo funciona; recién ahí pasar a la clave de modo Live).

let cached: Stripe | null = null;

export function getStripeClient(): Stripe {
  if (cached) return cached;

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error(
      "Falta la variable de entorno STRIPE_SECRET_KEY. Se configura en Vercel (Project Settings → " +
        "Environment Variables), no en el código — ver STRIPE.md para cómo conseguirla."
    );
  }

  cached = new Stripe(secretKey);
  return cached;
}
