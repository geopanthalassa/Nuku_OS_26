# Fase 1 — Checkpoint C: implementación de la propuesta de autorización

Fecha: 2026-09-02. Esto es la ejecución de la propuesta que quedó documentada en `FASE1_CHECKPOINT_C_AUDITORIA_RLS.md` ("PROPUESTA — sin implementar") y que aprobaste con "avanza en todo". No toca RLS, no toca Supabase, no toca el esquema — es código.

## Qué cambió

**Nuevo:** `lib/auth/require-account.ts` — reconstruye el mismo camino que ya usaba `/api/auth/me` (token de sesión → `auth.getUser()` → `account_members` → `account_id`) para que cada ruta de datos lo use, en vez de confiar en el `account_id` que manda el cliente. Expone dos funciones:
- `requireAccountFromRequest(req)` — exige una sesión real del panel; devuelve el `account_id` real de esa sesión (ignora cualquier `account_id` que venga en la query o el body).
- `requireSessionOrSharedSecret(req, accountId)` — para los dos endpoints que también los llama un sistema externo sin sesión de usuario (n8n): acepta sesión real O el header `x-nuku-secret` comparado contra la nueva variable de entorno `NUKU_INBOUND_SECRET`.

**Nuevo:** `lib/supabase/auth-header.ts` — helper del lado del navegador que arma `{ authorization: "Bearer <token>" }` a partir de la sesión activa, para que cada `fetch()` del panel lo mande.

**Rutas de servidor actualizadas** (ya no confían en `account_id` del cliente — lo resuelven de la sesión):
- `app/api/dashboard/reservations/route.ts` (GET y POST)
- `app/api/dashboard/reservation-guests/route.ts` (POST)
- `app/api/dashboard/conversations/route.ts` (GET)
- `app/api/dashboard/conversations/[id]/messages/route.ts` (GET)
- `app/api/dashboard/automations/route.ts` (GET y POST)
- `app/api/payments/create-checkout-session/route.ts` (POST — el botón "Generar link de pago")
- `app/api/concierge/inbound/route.ts` (POST — sesión O `x-nuku-secret`)
- `app/api/concierge/reply/route.ts` (POST — mismo esquema; no está conectada a ningún botón del panel todavía, pero tenía el mismo hueco)

**Páginas del panel actualizadas** para mandar el token en cada llamada a las rutas de arriba: `reservas`, `automatizaciones`, `desayunos`, `bandeja`, `calendario`.

**Deliberadamente sin tocar** (siguen públicas, tal como estaban documentadas): `/api/public/rooms`, `/api/public/leads`, `/api/reservations/request` — son endpoints pensados para visitantes sin login, no forman parte del hallazgo de Checkpoint C.

**Documentación actualizada:** `.env.example` (nueva variable `NUKU_INBOUND_SECRET`) y `n8n-templates/README.md` (nueva sección explicando que hay que agregar el header `x-nuku-secret` en los workflows de n8n que llaman a `/api/concierge/inbound`).

## Verificación

- `npx tsc --noEmit` — sin errores.
- `npx eslint` sobre todos los archivos tocados — sin errores ni warnings (de paso corregí dos problemas de lint preexistentes que no tenían que ver con este cambio: un `eslint-disable` mal ubicado en `concierge/inbound/route.ts` y un patrón de `useEffect` que el linter ya marcaba como riesgoso en `bandeja/page.tsx` — los dejé arreglados ya que estaba tocando esos archivos igual, sin cambiar el comportamiento).
- `npx next build` (producción, con variables de entorno de prueba) — build completo sin errores, las 32 rutas compilan.

## Qué falta para que esto funcione en producción

Agregar `NUKU_INBOUND_SECRET` en Vercel (un valor largo y aleatorio, ej. `openssl rand -hex 32`) y pegar ese mismo valor como header `x-nuku-secret` en el nodo HTTP Request de `concierge-inbound.json` dentro de n8n — mientras no se haga esto, ese workflow de n8n dejaría de poder llamar a `/api/concierge/inbound` (hoy no importa: no hay ningún canal conectado todavía, per lo confirmado en el Checkpoint A).

## Qué NO cambié

Ni una política RLS, ni una tabla, ni una fila de datos. `db/schema.sql` no se tocó en este paso. Esto es puramente autorización a nivel de código de las rutas — el "Checkpoint C" en sentido estricto (auditoría RLS) ya estaba cerrado; esto es la implementación de su hallazgo principal, no un cambio de RLS en sí.
