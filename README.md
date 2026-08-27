# Nuku OS — Fase 0

Esqueleto multi-cliente del sistema operativo hotelero (nombre de trabajo:
**Nuku OS**). Next.js (App Router) + TypeScript + Tailwind CSS v4, pensado
para conectarse a Supabase cuando exista un proyecto real.

Este es el punto de partida técnico del plan "técnico + negocio" — Kuhane
todavía **no** está conectado acá. Todo lo que se ve corre con datos de
ejemplo de un hostal ficticio ("Hostal Ejemplo"), a propósito, para no
mezclar la construcción del producto genérico con los datos reales de
ningún cliente.

## Cómo correrlo

```bash
npm install
npm run dev
```

Abrí http://localhost:3000 — el botón de la pantalla de acceso entra
directo al panel (todavía no hay autenticación real conectada).

## Qué hay hoy

- **`db/schema.sql`** — el esquema completo pensado para Supabase:
  `accounts` (cada hostal es una fila, no un caso especial en el código),
  `account_members`, `properties`, `rooms`, `rate_plans`, `guests`,
  `reservations`, `conversations`, `messages`, `automations`,
  `content_assets`, y un ejemplo de política de Row Level Security para
  que cada cuenta solo vea sus propios datos. No está aplicado a ningún
  proyecto Supabase todavía — es el diseño de la base de datos.
- **`lib/types.ts`** — los mismos tipos reflejados en TypeScript. Toda la
  interfaz está escrita contra estos tipos, así que el día que haya un
  Supabase real, cambia de dónde vienen los datos (`lib/mock-data.ts` →
  una consulta real), no la forma que tienen ni los componentes.
- **`lib/mock-data.ts`** — el hostal de ejemplo con habitaciones, huéspedes,
  reservas, conversaciones y automatizaciones ficticias.
- **Panel de administración** (`app/(admin)/`), con selector de cuenta
  (deshabilitado por ahora — representa que en el futuro un mismo usuario
  podría operar más de una cuenta):
  - `/dashboard` — ocupación, reservas activas, pagos pendientes, próximas
    llegadas.
  - `/reservas` — todas las reservas del hostal de ejemplo.
  - `/huespedes` — CRM simple, una ficha por huésped.
  - `/bandeja` — bandeja unificada (WhatsApp + Instagram + correo).
  - `/automatizaciones` — reglas tipo n8n, activables por cuenta (los
    interruptores son de demostración, no están conectados a n8n todavía).

## Qué falta (a propósito, según el plan de fases)

- **Fase 1 — Motor de Reservas real**: calendario de disponibilidad,
  checkout con pasarela de pago (Webpay Plus o Mercado Pago, a decidir), y
  el widget embebible para insertar en cualquier sitio.
- **Fase 2 — Concierge + Bandeja real**: conexión a WhatsApp Business API
  e Instagram Graph API, por cuenta.
- **Fase 3 — CRM + Automatizaciones reales**: conexión a n8n, historial de
  huésped completo.
- **Fase 4 — Panel completo + Banco de Contenido (UGC)**.
- **Fase 5 — Kuhane entra con datos reales**: se crea la cuenta real de
  Kuhane dentro de este sistema y se reemplazan los datos de ejemplo.
- **Fase 6 — Empaquetar para vender**: onboarding de cuentas nuevas sin
  programar por cliente, términos de servicio y política de privacidad.

Ver el documento de plan completo (técnico + negocio) para el detalle de
cada fase y qué se necesita en cada una.

## Fuentes de marca

Mismo caso que en `kuhane-web`: este entorno de desarrollo no tiene salida
a internet hacia Google Fonts, así que el panel usa fuentes del sistema
por ahora. `app/globals.css` y `app/layout.tsx` tienen comentarios con las
tres líneas para activar Newsreader + IBM Plex Sans + IBM Plex Mono vía
`next/font/google` en un entorno con internet (tu máquina o Vercel).

## Conectar Supabase (cuando exista el proyecto)

1. Crear un proyecto en Supabase y correr `db/schema.sql`.
2. Agregar `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` como
   variables de entorno.
3. Reemplazar las lecturas de `lib/mock-data.ts` por consultas reales
   filtradas por `account_id` (que vendría de la sesión del usuario
   autenticado vía Supabase Auth).
4. Activar las políticas de Row Level Security que faltan (el archivo deja
   un ejemplo en `reservations`; hay que repetirlo en el resto de las
   tablas con `account_id`).

## Deploy

Igual que `kuhane-web`: pensado para Vercel, sin configuración adicional
más allá de las variables de entorno de Supabase.
