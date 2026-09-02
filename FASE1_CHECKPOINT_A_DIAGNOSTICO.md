# Fase 1 — Checkpoint A: inspección y diagnóstico

Sin cambios de código ni de base de datos. Todo lo de abajo sale de consultar directamente el proyecto real de Supabase (`nuku-os`, id `oraucziymsqqzaoskizf`, región `sa-east-1`, Postgres 17) vía sus propias tablas de sistema (`pg_policies`, `pg_class`, `pg_constraint`, `pg_indexes`, `information_schema`) — no de suposiciones ni del archivo local `db/schema.sql`.

---

## 1. ESQUEMA REAL DETECTADO

**13 tablas en producción**, todas con RLS habilitado (`rowsecurity = true` en las 13, confirmado por consulta directa a `pg_class`):

| Tabla | Filas hoy | Rol |
|---|---:|---|
| `accounts` | 1 | Un hostal por fila (Kuhane) |
| `account_members` | **0** ⚠️ | Vínculo usuario↔cuenta — ver observación crítica abajo |
| `properties` | 1 | Propiedad física de una cuenta |
| `rooms` | 7 | Habitaciones reales de Kuhane, no las 2 de ejemplo que documenta `lib/mock-data.ts` |
| `rate_plans` | 0 | Existe, sin usar todavía |
| `guests` | 0 | Sin huéspedes reales cargados aún |
| `reservations` | 0 | Sin reservas reales aún |
| `conversations` | 1 | Un hilo (de prueba, canal `test`) |
| `messages` | 4 | Los mensajes de esa prueba |
| `automations` | 3 | Sembradas para Kuhane (de las 4 plantillas que define el código — falta la de cumpleaños, ver discrepancias) |
| `content_assets` | 0 | Sin usar todavía |
| `concierge_settings` | 1 | Fila de Kuhane |
| `reservation_guests` | 0 | Sin datos aún |

**Columnas principales por tabla** (solo lo no obvio / lo que importa para las discrepancias):

- **`rooms`**: incluye `base_rate_cents` con un comentario real cargado en Postgres: *"Tarifa de referencia por noche. Para 5 de las 7 habitaciones viene de un snapshot real de Booking.com (29-ago-2026)... Habitación Doble Estándar y Triple Estándar siguen sin precio real."* — es decir, ya hay trabajo real de carga de datos hecho directamente en Supabase, nunca reflejado en `db/schema.sql` ni en `lib/mock-data.ts`.
- **`guests`**: tiene `birth_date` y `document_id` (con comentario: *"RUT o número de pasaporte del huésped principal, obligatorio ingresar a Rapa Nui"*).
- **`reservations`**: además de lo que documenta `db/schema.sql`, tiene `promo_code`, `stripe_checkout_session_id`, `stripe_payment_link`, `tour_interest`, `tour_notes`, `arrival_flight_time`, `arrival_flight_number`, `departure_flight_time`, `departure_flight_number`, `airport_transfer_notes`. La columna `status` tiene un comentario real en Postgres: *"requested | confirmed | cancelled | completed — solicitud pública sin confirmar todavía = requested"* — el enum documentado en el propio Postgres ya incluye `requested`, aunque el **default de la columna sigue siendo `'confirmed'`** (el código siempre pasa `status: "requested"` explícitamente al crear una reserva pública, así que hoy no causa un bug — pero es una inconsistencia menor a corregir).
- **`concierge_settings`**: `account_id` (PK), `system_prompt`, `business_facts` (jsonb), `ai_provider` (default `'anthropic'`), `model` (default `'claude-sonnet-4-5-20250929'`), `temperature` (default `0.4`), `updated_at`. No existe en `db/schema.sql`.
- **`reservation_guests`**: `id`, `account_id`, `reservation_id`, `full_name`, `document_id`, `birth_date`, `phone`, `email`, `is_primary`, más 6 columnas de dieta/movilidad (`dietary_vegan`, `dietary_vegetarian`, `dietary_celiac`, `dietary_lactose_free`, `dietary_other`, `mobility_assistance`, `mobility_notes`), cada una con su comentario real en Postgres. No existe en `db/schema.sql`.

**Relaciones (foreign keys)** — 20 FKs en total, todas `ON DELETE CASCADE` excepto `conversations.guest_id → guests.id` (`ON DELETE SET NULL`) y `reservation_guests.account_id → accounts.id` (sin acción explícita = `NO ACTION`, la única inconsistente con el resto del patrón `CASCADE`). Todas las tablas de negocio cuelgan de `account_id → accounts.id`, tal como documenta el comentario de cabecera de `db/schema.sql` — este patrón sí es fiel a la realidad.

**Índices**: solo los automáticos de cada PK/UNIQUE (`accounts.slug`, cada `_pkey`) más un índice explícito adicional: `reservation_guests_reservation_id_idx`. No hay ningún índice sobre `reservations(room_id, check_in, check_out)`, que es justo lo que va a necesitar la validación de disponibilidad del Paso 5.

**Constraints**: 20 FKs, 13 PKs, 1 UNIQUE (`accounts.slug`), y **un solo CHECK constraint en todo el esquema**: `reservation_dates` en `reservations`, `CHECK (check_out > check_in)`. No hay ningún constraint que impida reservas solapadas — confirmado, no es una suposición.

**RLS — políticas reales** (13 políticas, una por tabla):
- 11 tablas (`properties`, `rooms`, `rate_plans`, `guests`, `reservations`, `conversations`, `messages`, `automations`, `content_assets`, `concierge_settings`) usan el mismo patrón: `account_id IN (SELECT account_id FROM account_members WHERE user_id = auth.uid())`, para todos los comandos (`ALL`).
- `accounts` y `account_members` solo tienen política de `SELECT` (sin insert/update/delete vía RLS — coincide con lo que ya documentaba `db/schema.sql`: esas operaciones son administrativas, vía service role).
- **`reservation_guests` es la excepción**: su única política es `"service role only"`, `cmd: ALL`, `qual: false`, `with_check: false` — es decir, **ningún usuario autenticado del panel puede leer ni escribir esta tabla directamente**, solo el backend con la service role key (que ya es como funciona hoy: todas las rutas que la tocan — `/api/reservations/request`, `/api/dashboard/reservation-guests` — pasan por `getSupabaseServerClient()`, que usa la service role key y evita RLS). Esto es más estricto que el resto del esquema a propósito, probablemente porque esta tabla guarda datos sensibles (identificación, fecha de nacimiento, movilidad de cada persona que entra a la isla) — pero es una excepción real al patrón "mismo esquema en cada tabla" que documenta `db/schema.sql`, y merece confirmarse como intencional en el Checkpoint C, no asumirse.

**Triggers, funciones/RPCs, vistas, tipos enum**: **ninguno** — confirmado por consulta directa (`information_schema.triggers`, `pg_proc`, `information_schema.views`, `pg_enum`, todos vacíos en el esquema `public`). Todos los "enums" del sistema (`status`, `channel`, `payment_status`, `direction`, etc.) son columnas `text` libres, documentadas solo por comentarios — Postgres no impide hoy que se guarde un valor fuera de lista.

**Extensiones instaladas**: solo las de base (`pgcrypto`, `uuid-ossp`, `pg_stat_statements`, `supabase_vault`, `plpgsql`). **`btree_gist` está disponible pero no instalada** — es la pieza que normalmente se usa en Postgres para el constraint de no-solapamiento del Paso 6 (lo dejo anotado para el diseño, sin instalar nada todavía).

**Migraciones — hallazgo importante que corrige mi supuesto anterior**: sí existe un historial de migraciones real y prolijo, aplicado directo sobre Supabase (`supabase migration list`), 13 migraciones entre el 27 y el 31 de agosto:

```
20260827103557  fase0_schema_multicliente
20260827212503  concierge_settings
20260827234020  add_guest_birthday_and_request_fields
20260827234047  add_reservation_promo_code
20260828124746  kuhane_real_address_and_rooms
20260828125513  kuhane_rooms_by_type_not_unit
20260828130802  add_stripe_columns_to_reservations
20260828134512  fix_room_names_no_sea_view
20260828143741  add_reservation_guests_and_tour_interest
20260829022922  set_real_room_prices_from_booking
20260830225345  add_flight_transfer_fields_to_reservations
20260831020555  add_dietary_and_mobility_fields_to_reservation_guests
20260831223517  add_reservation_guests_rls_policy
```

Esto corrige algo que había asumido en la auditoría general anterior: **no es que falten migraciones o que los cambios se hicieran "a mano" sin registro** — Supabase sí las tiene todas prolijamente versionadas. El problema real es más simple: **el archivo `db/schema.sql` del repo nunca se volvió a generar después de la primera migración** (`fase0_schema_multicliente`), así que quedó describiendo solo el estado del 27 de agosto, no las 12 migraciones posteriores. Ninguna de estas 13 migraciones vive como archivo `.sql` dentro del repo git — solo existen en el historial interno de Supabase.

**Advisors de seguridad de Supabase**: cero alertas (`lints: []`) — el chequeo automático de Supabase no encontró RLS faltante ni problemas conocidos. Esto es una señal positiva, pero no reemplaza la revisión manual del Checkpoint C (los advisors no evalúan si una política tiene el alcance correcto, solo si existe).

### ⚠️ Observación operativa (no es de esquema, pero es urgente confirmar)

**`account_members` tiene 0 filas.** Según `ONBOARDING.md` y el propio código de `AdminGate`/`/api/auth/me`, sin una fila en `account_members` que vincule un usuario real de Supabase Auth con la cuenta de Kuhane, **nadie puede entrar al panel** — `/api/auth/me` devuelve 404 ("Tu usuario no está vinculado a ninguna cuenta de Nuku OS todavía") y `AdminGate` muestra la pantalla de error. `ONBOARDING.md` documenta el paso manual pendiente ("vincular el primer usuario a mano, una sola vez") — la tabla vacía sugiere que ese paso todavía no se hizo, o se deshizo. No toqué nada; lo señalo porque, si alguien intentó entrar al panel de Kuhane recientemente y no pudo, es probablemente por esto — no un bug de código.

---

## 2. DISCREPANCIAS CON db/schema.sql

| # | Qué dice el archivo local | Qué usa realmente el código | Qué hay en Supabase real | Riesgo |
|---|---|---|---|---|
| 1 | No menciona la tabla `concierge_settings` | `lib/concierge.ts`, `/api/auth/signup`, `ONBOARDING.md` la usan activamente | Existe, 1 fila real, RLS activo | 🔴 Alto — cualquier trabajo futuro que solo mire `db/schema.sql` no sabría que esta tabla existe |
| 2 | No menciona la tabla `reservation_guests` | Usada en Reservas, Calendario, Desayunos, `/api/reservations/request`, `/api/dashboard/reservation-guests` | Existe, RLS activo con política especial (ver arriba) | 🔴 Alto — es la tabla más usada por el panel después de `reservations`, y no aparece documentada |
| 3 | `guests` sin `birth_date` ni `document_id` | Usadas en el flujo de reserva pública y en la automatización de cumpleaños | Ambas existen | 🟡 Medio |
| 4 | `reservations` sin `promo_code`, columnas de Stripe, `tour_interest`/`tour_notes`, campos de vuelo | Todas usadas activamente (panel de Reservas, Calendario, checkout de Stripe) | Todas existen | 🔴 Alto — 10 columnas reales no documentadas |
| 5 | `reservations.status` documentado como default `'confirmed'`, enum `confirmed \| cancelled \| completed` (sin `requested`) | El código usa `"requested"` como estado inicial en todo el flujo público | Postgres ya tiene el comentario actualizado con `requested` incluido, pero el `DEFAULT` de columna sigue en `'confirmed'` | 🟡 Medio — no rompe nada hoy (el código siempre especifica el status), pero el default de la columna no coincide con el flujo real; lo prolijo sería que el default fuera `'requested'` |
| 6 | Sección de RLS documenta 10 políticas, todas con el mismo patrón "Acceso por cuenta" | — | Hay 13 políticas reales; `reservation_guests` usa una política distinta y más restrictiva (`service role only`), no el patrón estándar | 🟡 Medio — no es un error de seguridad, pero el archivo no refleja que hay una excepción deliberada |
| 7 | No documenta ningún índice más allá de los de PK/UNIQUE | — | Existe `reservation_guests_reservation_id_idx`, agregado en una migración | 🟢 Bajo |
| 8 | `rooms` documentado con 0 filas de ejemplo conceptual | — | 7 habitaciones reales, con precios reales tomados de Booking.com (parcialmente) | 🟢 Bajo (no es un error, es simplemente desactualización esperable) |
| 9 | Ningún constraint de no-solapamiento de reservas | El código tampoco lo valida en ningún punto | Confirmado: no existe ningún exclusion constraint ni chequeo — dos reservas pueden solaparse sin que nada lo impida | 🔴 Alto — es justo el problema que el Paso 5/6 de esta fase tiene que resolver |

---

## 3. TABLAS UTILIZADAS POR NUKU-OS (mapa real, por módulo)

```
Reservas (/reservas)
→ reservations         → leer, actualizar (status, payment_status, stripe_payment_link)
→ guests                → leer (join)
→ rooms                 → leer (join)
→ reservation_guests    → leer (join, detalle expandible)

Calendario (/calendario)
→ reservations          → leer, actualizar (campos de vuelo/traslado)
→ guests, rooms          → leer (join)
→ reservation_guests    → leer (join)

Desayunos (/desayunos)
→ reservations          → leer
→ rooms                 → leer (join)
→ reservation_guests    → leer, actualizar (dieta/movilidad)

Bandeja (/bandeja)
→ conversations         → leer, crear
→ messages              → leer, crear
→ guests                → crear/buscar (vía Concierge)

Automatizaciones (/automatizaciones)
→ automations           → leer, crear (semilla), actualizar (enabled)

Huéspedes (/huespedes)
→ HOY: ninguna tabla real — lee lib/mock-data.ts (demoWorkspace)
→ DEBERÍA: guests (+ cruce con reservations/conversations/reservation_guests)

Resumen (/dashboard)
→ HOY: ninguna tabla real — lee lib/mock-data.ts (demoWorkspace)
→ DEBERÍA: reservations, rooms, guests reales

Concierge IA (lib/concierge.ts, /api/concierge/inbound, /api/concierge/reply)
→ accounts               → leer
→ concierge_settings    → leer
→ messages               → leer historial, crear
→ conversations          → actualizar (last_message_at)
→ guests                 → crear/buscar

Reserva pública (/reservar, /api/reservations/request, /api/public/rooms)
→ rooms                  → leer
→ guests                 → crear/buscar
→ reservations           → crear
→ reservation_guests    → crear

Leads públicos (/api/public/leads)
→ guests                → crear/buscar

Pagos (/api/payments/create-checkout-session, /api/payments/webhook)
→ reservations           → leer, actualizar (payment_status, stripe_checkout_session_id, stripe_payment_link)

Autenticación (/api/auth/me, /api/auth/signup)
→ account_members        → leer, crear
→ accounts                → crear
→ concierge_settings     → crear (semilla)
```

---

## 4. PLAN DE SINCRONIZACIÓN (propuesta — no ejecutado)

**Archivos que modificaría** (documentación pura, cero impacto en la base real):
- `db/schema.sql` — reescribir para reflejar fielmente las 13 tablas, sus columnas y comentarios reales, el único CHECK constraint real, los índices reales, y las 13 políticas RLS reales (incluida la excepción de `reservation_guests`). Corregiría también el comentario de cabecera del archivo, que hoy sigue diciendo "Fase 0" y dejando afuera media base de datos.

**Archivos que crearía** (opcional, a definir contigo antes de hacerlo):
- Una carpeta `db/migrations/` con las 13 migraciones reales como archivos `.sql` individuales, para que el historial de cambios quede versionado en git y no solo dentro de Supabase. No es indispensable para "Fase 1" tal como la definiste (no rompe nada si no se hace), pero sí ayuda a que el repo cuente la historia completa. Lo puedo traer del propio Supabase si lo apruebas — hoy solo tengo el nombre y la fecha de cada migración, no el SQL exacto de cada una.

**Migraciones nuevas necesarias**: **ninguna** para el paso de sincronización en sí — no hay que tocar la base real, solo el archivo que la describe. La única corrección de esquema real que dejo anotada para cuando decidas (no para ahora) es el default de `reservations.status` (`'confirmed'` → `'requested'`), que es menor y no bloquea nada.

**Qué es solo documentación vs qué afecta la base real**:
- 100% documentación: reescribir `db/schema.sql`, agregar los archivos de migración histórica.
- Afecta la base real (fuera del alcance de este Checkpoint, vendría en C/D/E con tu aprobación explícita): cualquier política RLS nueva o modificada, el constraint de no-solapamiento de reservas, el índice sobre `reservations(room_id, check_in, check_out)`, la instalación de `btree_gist`, y la corrección del default de `status`.

---

**DETENGO ACÁ, como pediste. Nada de esto se ejecutó — es solo el diagnóstico.** Quedo esperando tu aprobación para pasar al Checkpoint B (sincronizar `db/schema.sql` con esta realidad).
