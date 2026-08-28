# Conectar Stripe (pagos internacionales)

El código ya está listo (ver `lib/stripe.ts`, `app/api/payments/create-checkout-session/route.ts`
y `app/api/payments/webhook/route.ts`) y ya aparece el botón **"Cobrar"** en el panel de
Reservas para cada reserva confirmada. Lo único que falta es la cuenta real de Stripe —
eso lo tiene que crear el dueño del negocio (Kuhane), con sus propios datos: no lo puede
crear otra persona en su nombre.

## 1. Crear la cuenta

1. Andá a [stripe.com](https://stripe.com) y creá una cuenta con el mail y los datos de
   Kuhane (no los tuyos si sos otra persona armando esto).
2. Cuando te pida el país del negocio, elegí **Chile**.
3. Vas a poder probar todo esto en **modo Test** antes de activar cobros reales — no hace
   falta completar la verificación de identidad/banco todavía para probar.

## 2. Conseguir la clave secreta

1. En el dashboard de Stripe, andá a **Developers → API keys**.
2. Copiá la **Secret key** (empieza con `sk_test_...` en modo Test, `sk_live_...` en modo
   Live). Nunca la compartas en un chat ni la subas a GitHub — va directo a Vercel.
3. En Vercel (el proyecto de Nuku OS, no el de Kuhane) → Settings → Environment Variables,
   agregá:
   - `STRIPE_SECRET_KEY` = esa clave secreta

## 3. Conectar el webhook (para que el sistema sepa cuándo se pagó)

1. En Stripe: **Developers → Webhooks → Add endpoint**.
2. URL del endpoint: `https://<tu-deploy-de-nuku-os>.vercel.app/api/payments/webhook`
3. Evento a escuchar: `checkout.session.completed` (buscalo en la lista y marcalo).
4. Al crear el endpoint, Stripe te muestra un **Signing secret** (empieza con `whsec_...`).
   Copialo y agregalo en Vercel:
   - `STRIPE_WEBHOOK_SECRET` = ese signing secret

## 4. Probar

1. Con las dos variables cargadas, hacé un redeploy en Vercel (o esperá el próximo push).
2. En el panel de Reservas, confirmá una reserva y tocá **"Cobrar"** → poné un monto →
   **"Generar link"**.
3. Copiá el link y abrilo — en modo Test, Stripe deja pagar con la tarjeta de prueba
   `4242 4242 4242 4242`, cualquier fecha futura y cualquier CVC.
4. Si el pago se completa bien, la reserva en el panel debería pasar a mostrar **"Pagado"**
   (lo actualiza el webhook automáticamente, no hace falta tocar nada a mano).

## 5. Pasar a cobros reales

Cuando quieras cobrar de verdad: completá la verificación de identidad y cuenta bancaria
que pide Stripe (Settings → Account), y cambiá `STRIPE_SECRET_KEY` en Vercel por la clave
que empieza con `sk_live_...` (y el webhook por uno nuevo apuntando también a modo Live,
con su propio `STRIPE_WEBHOOK_SECRET`).

## Nota sobre PayPal

Stripe permite combinar PayPal dentro de la misma integración solo para cuentas de
Europa/Reino Unido/Suiza — no para cuentas de Chile. Si más adelante querés ofrecer
también PayPal, sería un botón de pago separado (su propio SDK), no algo que se sume
gratis a esta integración de Stripe.
