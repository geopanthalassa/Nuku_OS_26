# Fase 1 — Checkpoint B: Sincronización documental del esquema

Fecha: 2026-09-02. Proyecto Supabase real: `nuku-os` (ref `oraucziymsqqzaoskizf`).

Impacto en este checkpoint: **base de datos real = cero cambios. Repositorio = documentación sincronizada.** Todo lo de abajo fue leído directo de `information_schema` / `pg_catalog` / `auth.users` / `supabase_migrations.schema_migrations` mediante SELECTs de solo lectura — ningún `INSERT`, `UPDATE`, `DELETE`, `ALTER`, ni migración se ejecutó.

---

## 1. VERIFICACIÓN DE ACCESO Y ONBOARDING

Investigado sin modificar nada, siguiendo las 7 preguntas pedidas:

**1. Cómo funciona el flujo de autenticación actual.** Es Supabase Auth real. `/login` llama a `supabase.auth.signInWithPassword`. `AdminGate` (envuelve todo `app/(admin)/*`) revisa la sesión en el navegador, y si existe, llama a `/api/auth/me` mandando el `access_token`. Esa ruta valida el token contra Supabase Auth y después busca en `account_members` la fila cuyo `user_id` coincide, para saber a qué `account_id` pertenece ese usuario.

**2. Qué ocurre cuando un usuario intenta acceder al panel.** Dos casos: (a) sin sesión → `AdminGate` redirige a `/login` inmediatamente. (b) con sesión pero sin fila en `account_members` → `/api/auth/me` responde `404` con el mensaje *"Tu usuario no está vinculado a ninguna cuenta de Nuku OS todavía. Contacta al soporte."*, y `AdminGate` muestra una pantalla de error ("No pudimos abrir tu panel") con botón para volver a `/login`. No hay ningún estado intermedio ni acceso parcial.

**3. Si existe algún mecanismo alternativo a `account_members`.** No. Confirmado leyendo `/api/auth/me` completo: es la única fuente que decide la cuenta de un usuario. No hay rol especial, no hay override por variable de entorno, no hay excepción hardcodeada para ningún email.

**4. Si el modo demo permite acceder sin membresía.** No existe modo demo en el panel administrativo. Busqué `DEMO_MODE`, `isDemo`, `NEXT_PUBLIC_DEMO` en todo el repo: lo único que aparece es `lib/mock-data.ts` (datos de ejemplo que todavía usan `/dashboard` y `/huespedes`, ver Sección 3 más abajo), que es independiente de la autenticación — no es una puerta de acceso, es una fuente de datos placeholder dentro de páginas que igual exigen pasar por `AdminGate` primero.

**5. Si existe algún usuario autenticado vinculado indirectamente a Kuhane.** No. Consulté `auth.users` directo en Supabase: **0 filas**. No es que el paso de vincular a `account_members` haya quedado pendiente después de crear el usuario — el usuario ni siquiera fue creado. Ninguno de los dos pasos manuales que describe `ONBOARDING.md` ("crear usuario en el Dashboard de Supabase" y "vincularlo en `account_members`") se ejecutó todavía.

**6. Si el panel puede utilizarse realmente hoy con autenticación.** El código en sí funciona end-to-end (probé la lógica leyendo las tres rutas involucradas, no ejecutando login real). Para una cuenta **nueva**, sí funcionaría hoy: `/registro` crea usuario + `accounts` + `account_members` en una sola llamada (`/api/auth/signup`, con service role, evita RLS a propósito para ese bootstrap) y deja a ese usuario dentro de inmediato. Pero para la cuenta piloto de **Kuhane** específicamente, nadie puede entrar todavía, porque nadie ejecutó el paso manual — y como además no hay ningún usuario en `auth.users`, tampoco hay una sesión "olvidada" o parcial dando vueltas.

**7. Si `account_members` vacía es paso pendiente, configuración intencional, bug, o falta de usuario admin.** Es lo primero: **un paso de onboarding manual pendiente**, documentado explícitamente como tal en `ONBOARDING.md` ("El primer usuario se vincula una sola vez, a mano" + los 2 pasos exactos con el `account_id` real de Kuhane). No es un bug — el código que depende de esta tabla funciona como está diseñado. No es config intencional del piloto — no hay ninguna nota que diga "dejar así a propósito". Es, simplemente, que ese paso de 2 minutos en el Dashboard de Supabase todavía no se hizo.

**Qué falta para destrabarlo (no ejecutado, solo diagnóstico):** crear el usuario de Andre en Supabase Dashboard → Authentication → Users, y correr el `INSERT` de una fila en `account_members` con ese `user_id` y el `account_id` de Kuhane (`057a625c-9036-4b1d-957b-8c436f71b4cd`), exactamente como describe `ONBOARDING.md`. Es una operación de datos, no de esquema — fuera del alcance de "documentación" de este Checkpoint, y de todas formas nunca se ejecuta sin que tú lo pidas explícitamente.

---

## 2. RESUMEN DE ARCHIVOS MODIFICADOS

Un solo archivo, solo documentación:

- **`db/schema.sql`** — reescrito completo para reflejar fielmente las 13 tablas reales, sus columnas/tipos/defaults/PK/FK/ON DELETE/CHECK, los 8 comentarios reales de columna/tabla que existen en Supabase, los índices reales, las 13 políticas RLS reales (documentadas una por una, sin generalizar), y un bloque final listando las 13 migraciones reales aplicadas (solo como referencia/comentario, no como archivos ejecutables).

Nada más se tocó. No se crearon archivos de migración (ver Sección 6).

---

## 3. RESUMEN DEL NUEVO `db/schema.sql`

Estructura, en orden:

1. **Cuentas y membresías** — `accounts`, `account_members` (con el aviso de 0 filas y su explicación, ver Sección 1).
2. **Propiedad, habitaciones y tarifas** — `properties`, `rooms` (con el comentario real sobre `base_rate_cents`), `rate_plans` (con nota de que existe pero tiene 0 filas y ningún módulo la usa todavía).
3. **Huéspedes y reservas** — `guests` (con `birth_date`, `document_id` y su comentario real), `reservations` (las 21 columnas reales, incluyendo las 10 que faltaban: `promo_code`, `stripe_checkout_session_id`, `stripe_payment_link`, `tour_interest`, `tour_notes`, `arrival_flight_time`, `arrival_flight_number`, `departure_flight_time`, `departure_flight_number`, `airport_transfer_notes` — con sus comentarios reales), y dos TODOs marcados explícitamente (default de `status` sigue en `'confirmed'` aunque el comentario ya habla de `'requested'`; sin protección de solapamiento todavía).
4. **`reservation_guests`** (tabla completa, antes inexistente en el archivo) — titular + acompañantes, con los 8 campos de dietas/movilidad y sus comentarios reales, más una nota explicando su FK a `accounts` con `ON DELETE NO ACTION` (distinta a todas las demás) y su índice real.
5. **Concierge IA** — `concierge_settings` (tabla completa, antes inexistente en el archivo): `system_prompt`, `business_facts`, `ai_provider`, `model`, `temperature`.
6. **Bandeja unificada** — `conversations`, `messages` (sin cambios respecto al archivo anterior, ya estaban bien documentadas).
7. **Automatizaciones** y **Banco de contenido** — sin cambios de fondo.
8. **RLS** — las 13 políticas reales, documentando explícitamente las 3 excepciones al patrón "Acceso por cuenta": `accounts`/`account_members` (solo SELECT) y `reservation_guests` (`service role only`, `qual: false` para todo, la más restrictiva de las 13).
9. **Extensiones** — nota de que solo están las de base + `pgcrypto`, y que `btree_gist` está disponible pero no instalada (relevante para Checkpoint D).
10. **Migraciones reales** — lista de las 13, como comentario de referencia.

---

## 4. CONFIRMACIÓN EXPLÍCITA DE QUE NO SE MODIFICÓ SUPABASE

Confirmado. En este Checkpoint solo se ejecutaron sentencias `SELECT` de lectura (contra `information_schema`, `pg_catalog`, `auth.users`, `pg_policies`, `pg_indexes`, `supabase_migrations.schema_migrations`) y las herramientas de solo-lectura `list_tables` / `list_migrations`. No se llamó ninguna herramienta de escritura (`apply_migration`, `execute_sql` con DDL/DML, etc.). El único archivo modificado fue `db/schema.sql`, dentro del repositorio local.

---

## 5. DIFERENCIAS PRINCIPALES ENTRE EL ANTIGUO Y EL NUEVO ESQUEMA DOCUMENTADO

| # | Antes (`db/schema.sql` viejo) | Ahora (real) | Riesgo que cerraba |
|---|---|---|---|
| 1 | No existía `concierge_settings` | Tabla completa documentada | 🔴 Alto — el motor del Concierge IA no tenía esquema de referencia |
| 2 | No existía `reservation_guests` | Tabla completa documentada (13 columnas) | 🔴 Alto — datos de identificación/dieta/movilidad de huéspedes sin documentar |
| 3 | `reservations` con 11 columnas | `reservations` con 21 columnas | 🔴 Alto — Stripe, vuelos/traslado, tours y promo_code no existían en el archivo |
| 4 | `guests` sin `birth_date`/`document_id` | Documentadas con su comentario real | 🟡 Medio |
| 5 | `status` documentado como `confirmed\|cancelled\|completed` | Documentado como `requested\|confirmed\|cancelled\|completed`, con el default real (`confirmed`) marcado como TODO | 🟡 Medio |
| 6 | RLS descrita como un solo patrón repetido | RLS con las 3 excepciones explícitas (`accounts`/`account_members` solo SELECT, `reservation_guests` service-role-only) | 🟡 Medio — antes se podía asumir que todas las tablas se comportan igual, y no es así |
| 7 | Sin mención de índices | Documentado que solo hay PK/UNIQUE automáticos + 1 índice explícito (`reservation_guests_reservation_id_idx`) — ninguno soporta búsquedas de disponibilidad | 🟢 Bajo (informativo, insumo directo para Checkpoint D) |
| 8 | Sin mención de `rate_plans` como tabla "viva pero sin uso" | Documentado que existe, tiene 0 filas y ningún módulo la usa hoy | 🟢 Bajo |
| 9 | Sin lista de migraciones | 13 migraciones reales listadas al final como referencia | 🟢 Bajo (documentación) |

---

## 6. ESTADO DEL HISTORIAL DE MIGRACIONES

13 migraciones reales, todas aplicadas y trackeadas limpiamente por Supabase, en orden cronológico desde `20260827103557_fase0_schema_multicliente` hasta `20260831223517_add_reservation_guests_rls_policy`. Ninguna existe como archivo `.sql` en este repositorio ni en git — solo dentro del tracking interno de Supabase.

---

## 7. RECOMENDACIÓN SOBRE VERSIONAR LAS MIGRACIONES HISTÓRICAS

**Sí es técnicamente posible recuperar el SQL exacto**, no solo el nombre y la fecha. Lo confirmé consultando la tabla interna `supabase_migrations.schema_migrations`, que además de `version` y `name` tiene una columna `statements` (arreglo) con el SQL real ejecutado en cada migración — verifiqué que las 13 filas tienen exactamente 1 statement guardado cada una (ninguna vacía). Es decir, el historial completo está ahí, recuperable sin adivinar ni reconstruir nada.

**¿Vale la pena versionarlo ahora?** Sí, y es de bajo riesgo hacerlo — no modifica la base real, solo copia texto ya aplicado a 13 archivos `.sql` dentro de `db/migrations/` (o la carpeta que seas prefieras), como registro histórico. Ventajas concretas: (a) si alguna vez hay que reconstruir el esquema desde cero en otro entorno, existe la receta exacta en vez de tener que re-derivarla de este `db/schema.sql`; (b) deja de depender exclusivamente del tracking interno de Supabase, que no está versionado en git; (c) es el paso natural antes de que cualquier migración nueva (la de Checkpoint D, por ejemplo) se sume al mismo patrón versionado.

No lo hice en este Checkpoint porque implica una decisión tuya (dónde guardarlas, con qué convención de nombres) y vos pediste explícitamente no generar ni tocar migraciones todavía — quedo esperando luz verde si querés que lo haga como paso aparte.

---

## 8. CUALQUIER NUEVO RIESGO DETECTADO

- **`account_members` y `auth.users` ambas en 0 filas** (ya reportado en Checkpoint A, ahora confirmado con más detalle en la Sección 1 de arriba: ni siquiera existe el usuario de Auth, no solo falta el vínculo). No bloquea Fase 1, pero si querés probar el panel de Kuhane en algún momento durante esta fase, ese paso manual de 2 minutos hay que hacerlo — y no se hizo porque no me lo pediste explícitamente.
- **`reservation_guests.account_id` tiene `ON DELETE NO ACTION`**, distinto a las otras 18 FKs hacia `accounts` (todas `CASCADE`). No es necesariamente un problema — de hecho, para una tabla con datos sensibles (documento de identidad, dieta, movilidad) puede ser más seguro que un borrado en cascada silencioso — pero como es inconsistente con el resto del esquema, no se sabe si fue deliberado. Ninguna reserva real existe todavía (`reservations` tiene 0 filas), así que hoy no tiene efecto práctico, pero lo dejo anotado para cuando se audite RLS/integridad en Checkpoint C.
- **`rate_plans` es una tabla "fantasma"**: existe, tiene RLS, pero 0 filas y ningún módulo del código la lee o la escribe. No es un riesgo de seguridad, pero si en algún momento se construye tarificación por temporada, ya existe el lugar — vale la pena saber que está ahí antes de crear una tabla nueva para lo mismo.

---

**DETENGO ACÁ, como pediste.** `db/schema.sql` ya refleja la realidad de Supabase; la base real sigue exactamente igual que antes de este Checkpoint. Quedo esperando tu aprobación para pasar al **Checkpoint C** (auditoría RLS).
