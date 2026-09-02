# Fase 1 — Checkpoint C: Auditoría RLS

Fecha: 2026-09-02. Diagnóstico solo — **no se modificó ninguna política, no se ejecutó ningún cambio en Supabase.** Todo lo de abajo sale de leer las 13 políticas reales (ya documentadas en Checkpoint B) más el código completo de cada ruta que efectivamente lee o escribe estas tablas.

---

## HALLAZGO PRINCIPAL (antes de la tabla por tabla)

Esto es más importante que cualquier política individual, así que va primero.

**Ninguna ruta bajo `/api/dashboard/*`, ni `/api/concierge/inbound`, ni `/api/payments/create-checkout-session`, verifica quién está llamando.** Confirmé leyendo el código completo de las 9 rutas que tocan datos de negocio: ninguna lee un header `Authorization`, ninguna valida un token de sesión, ninguna llama a algo parecido a `/api/auth/me` para confirmar que el usuario autenticado realmente pertenece al `account_id` que está pidiendo. Reciben `account_id` como parámetro de la URL o campo del body, confían en él, y lo usan **solo** para filtrar la consulta (`.eq("account_id", accountId)`) — eso evita mezclar datos entre cuentas *si* el `account_id` es el correcto, pero no evita que cualquiera mande el `account_id` de otra cuenta.

Por qué esto importa más que las políticas RLS en sí: estas rutas usan `getSupabaseServerClient()` (service role), que **saltea RLS por diseño** — es la razón de ser de la service role key. Así que RLS hoy no está protegiendo estos flujos en absoluto; la única protección real es el filtro manual `.eq("account_id", ...)`, y ese filtro no sirve de nada si nadie comprueba que el llamante tiene derecho a usar ese `account_id`.

Relación usuario → membresía → hotel → recurso, tal como pediste que la diagnostique:
- **Hoy existe** para `/api/auth/me` (la única ruta que sí hace el camino completo: token → `auth.getUser()` → `account_members` → `account_id`).
- **No existe** para las 9 rutas de datos: reciben el último eslabón (`account_id`) directo, sin pasar por los anteriores (usuario, membresía).

Qué tan explotable es esto hoy, en la práctica: bajo, porque `account_id` es un UUID v4 (no adivinable a ojo) y hoy solo existe una cuenta real (Kuhane) con cero usuarios activos. Pero dejar de ser "bajo" no depende de arreglar nada en el código — depende solo de que exista un segundo cliente y de que un UUID se filtre por cualquier vía normal (una URL compartida, un log, un curl de ejemplo, alguien de tu propio equipo con acceso a dos cuentas). Con la arquitectura actual, conocer el `account_id` de otra cuenta ya alcanza para leer y escribir sus reservas, conversaciones, mensajes, automatizaciones y datos de huéspedes — y en el caso de `/api/payments/create-checkout-session`, para generar links de cobro de Stripe reales a nombre de esa cuenta.

Esto no es una política de RLS mal escrita — es una capa de autorización que falta *antes* de RLS, en el código de las rutas. Está fuera del alcance de "no debilitar RLS" (no toca RLS en absoluto) pero es exactamente el tipo de cambio de alto impacto que pediste explicar antes de tocar: lo dejo en la Sección "Propuesta" al final, sin implementar.

---

## AUDITORÍA TABLA POR TABLA (Paso 4, las 5 preguntas)

### Alojamientos / hoteles — `accounts`, `properties`, `rooms`, `rate_plans`

- **¿Tiene RLS?** Sí, las 4. `accounts` con policy de solo SELECT; las otras 3 con el patrón estándar "Acceso por cuenta" (ALL).
- **¿Cómo se determina el tenant?** Vía `account_members.user_id = auth.uid()` — pero como se explicó arriba, ningún camino real de la app pasa por esta política (todo usa service role). El tenant efectivo hoy se determina por el `account_id` que cada ruta recibe sin verificar.
- **¿Riesgo de cruce entre alojamientos?** Bajo hoy (una sola cuenta real), pero sí existe estructuralmente: `/api/public/rooms` es intencionalmente público (lo es por diseño, para `/reservar`) y no tiene ni necesita restricción — cualquiera puede ver habitaciones y tarifas de cualquier `account_id` que mande, lo cual es aceptable porque es exactamente lo que hace público. No encontré ninguna ruta que exponga `properties` o `rate_plans` fuera del panel.
- **¿Frontend correctamente restringido?** `rooms.page` (panel de habitaciones) no lo revisé en detalle en este Checkpoint porque no hay una ruta `/api/dashboard/rooms` — Reservas usa `rooms` solo como relación anidada de `reservations`. No hay riesgo adicional distinto al ya descrito arriba.
- **¿Falta alguna política?** No a nivel RLS. Lo que falta es la capa de autorización de la Sección "Hallazgo principal", que es previa a RLS.

### Usuarios — `account_members`

- **¿Tiene RLS?** Sí, solo SELECT ("Ve sus propias membresías", `user_id = auth.uid()`).
- **¿Cómo se determina el tenant?** No aplica — esta tabla ES la que define el tenant de cada usuario, no cuelga de uno.
- **¿Riesgo de cruce?** No until que haya escritura vía cliente — hoy solo se escribe desde `/api/auth/signup` (service role, con su propia lógica de creación). No hay ninguna ruta que permita a un usuario agregar/quitar miembros de una cuenta todavía (ni falta hacerlo en Fase 1).
- **¿Frontend correctamente restringido?** Sí — es la única tabla que el frontend (`AdminGate` vía `/api/auth/me`) sí consulta siguiendo el camino completo usuario→membresía.
- **¿Falta alguna política?** No para el alcance actual (no hay gestión de miembros desde el panel todavía).

### Reservas — `reservations`, `reservation_guests`

- **¿Tiene RLS?** `reservations` sí, patrón estándar. `reservation_guests` sí, pero con la política "service role only" (`qual: false` para todo) — la más restrictiva de las 13, ya documentada en Checkpoint B.
- **¿Cómo se determina el tenant?** Igual que el resto: en teoría por `account_members`, en la práctica por el `account_id` recibido sin verificar en `/api/dashboard/reservations`, `/api/dashboard/reservation-guests`, `/api/reservations/request` y `/api/payments/create-checkout-session`.
- **¿Riesgo de cruce entre alojamientos?** Es la categoría de mayor impacto si el "Hallazgo principal" llegara a explotarse: acá viven los datos más sensibles (documento de identidad, fechas de nacimiento, alergias, movilidad, montos, links de pago de Stripe). `reservation_guests` en particular junta identificación + salud/movilidad de personas reales.
- **¿Frontend correctamente restringido?** El panel (`reservas/page.tsx`) sí manda siempre el `accountId` correcto (viene de `useCurrentAccount()`, que a su vez viene del login real) — el problema no es el frontend del panel, es que las rutas de API no comprueban que el `account_id` recibido corresponda a la sesión que está llamando. `/api/reservations/request` es intencionalmente público (cualquiera puede pedir una reserva sin login, como en cualquier sitio de hotelería) — ahí el riesgo no es de lectura, sino que alguien podría escribir reservas/datos de huéspedes falsos contra el `account_id` de otro cliente si lo conociera.
- **¿Falta alguna política?** La política de `reservation_guests` ("service role only") es, sin quererlo, la más protectora de las 13 — pero solo protege contra el cliente anon/browser, no contra las rutas de servidor, que la saltean igual. Ver Sección "Propuesta".

### Huéspedes — `guests`

- **¿Tiene RLS?** Sí, patrón estándar.
- **¿Cómo se determina el tenant?** Igual patrón: `account_id` recibido sin verificar en `/api/concierge/inbound`, `/api/reservations/request`, `/api/public/leads`.
- **¿Riesgo de cruce?** `/api/public/leads` es intencionalmente público y de otro dominio (CORS abierto a propósito, documentado en el propio código) — cualquiera puede crear un lead en cualquier `account_id`; es una superficie de abuso menor (spam de leads falsos) más que de fuga de datos, porque solo permite *insertar*, no leer.
- **¿Frontend correctamente restringido?** Mismo patrón que Reservas.
- **¿Falta alguna política?** No a nivel RLS.

### Conversaciones y Mensajes — `conversations`, `messages`

- **¿Tiene RLS?** Sí, ambas, patrón estándar.
- **¿Cómo se determina el tenant?** Igual patrón: sin verificar en `/api/dashboard/conversations`, `/api/dashboard/conversations/[id]/messages`, `/api/concierge/inbound`.
- **¿Riesgo de cruce?** `/api/concierge/inbound` es el caso más delicado de toda la auditoría: es un endpoint POST **sin ninguna autenticación**, pensado para ser llamado por n8n con la credencial de canal de cada cliente — pero tal como está escrito hoy, no exige ningún secreto compartido ni token. Cualquiera que lo llame directo (sin pasar por n8n) puede: crear huéspedes y conversaciones en cualquier `account_id`, insertar mensajes falsos, y — el punto más caro — disparar una respuesta real del Concierge IA (llamada real a la API de Anthropic, con costo real) para cualquier cuenta, sin límite visible de rate-limiting.
- **¿Frontend correctamente restringido?** El panel (Bandeja) sí manda el `accountId` correcto por las mismas razones que Reservas. El problema es `/api/concierge/inbound`, que ni siquiera es "frontend" — es la puerta de entrada pensada para n8n, y hoy está abierta a cualquiera.
- **¿Falta alguna política?** A nivel RLS no. Lo que falta es autenticación de servicio a servicio en `/api/concierge/inbound` (un secreto compartido por cuenta, o al menos uno global) — no es una política de Postgres, es autenticación de API.

### Automatizaciones — `automations`

- **¿Tiene RLS?** Sí, patrón estándar.
- **¿Cómo se determina el tenant?** Sin verificar en `/api/dashboard/automations` (mismo patrón).
- **¿Riesgo de cruce?** Bajo impacto relativo — esta tabla solo guarda interruptores on/off y texto de plantilla, sin datos personales de huéspedes. Igual queda expuesta al mismo patrón: alguien con el `account_id` de otra cuenta podría prender/apagar sus automatizaciones o cambiar el texto que le llega a sus huéspedes.
- **¿Frontend correctamente restringido?** Mismo patrón que el resto.
- **¿Falta alguna política?** No a nivel RLS.

### Configuración — `concierge_settings`

- **¿Tiene RLS?** Sí, patrón estándar.
- **¿Cómo se determina el tenant?** No hay ninguna ruta `/api/dashboard/concierge-settings` todavía — hoy solo se lee/escribe desde `lib/concierge.ts` (llamado por `/api/concierge/inbound` y `/api/concierge/reply`), siempre con el `account_id` recibido sin verificar por esas mismas rutas.
- **¿Riesgo de cruce?** Es sensible porque contiene `system_prompt` y `business_facts` (todo lo que el bot puede decir en nombre del hostal) — alguien que llame `/api/concierge/inbound` con el `account_id` de otra cuenta no puede leer esta tabla directo, pero sí puede interactuar con el bot de esa cuenta y ver indirectamente qué sabe.
- **¿Frontend correctamente restringido?** No hay pantalla del panel que edite esto todavía (se carga a mano por SQL, según `ONBOARDING.md`), así que no hay superficie de frontend que auditar por ahora.
- **¿Falta alguna política?** No a nivel RLS.

---

## PROPUESTA (sin implementar — para tu aprobación)

**Política actual:** ninguna verificación de identidad en las rutas de datos; el `account_id` recibido se usa tal cual.

**Problema:** el `account_id` funciona hoy como si fuera una credencial, sin serlo — cualquiera que lo conozca puede leer/escribir esos datos, incluyendo pagos y datos personales de huéspedes.

**Política propuesta (para decidir en Checkpoint C o dejarla para más adelante, como prefieras):** agregar a cada ruta de `/api/dashboard/*` el mismo patrón que ya existe en `/api/auth/me` — exigir el `access_token` de la sesión, resolver el `account_id` real desde `account_members`, e ignorar (o validar contra) cualquier `account_id` que venga del cliente. Para `/api/concierge/inbound`, agregar un secreto compartido por cuenta o global que n8n mande en un header, ya que ese endpoint no tiene sesión de usuario por diseño (lo llama un webhook, no una persona).

**Impacto de implementarlo:** cambios en 9 archivos de rutas + el código del panel que las llama (para mandar el token en vez de/además del `account_id`) — no toca el esquema, no toca RLS, no requiere migración. Es un cambio de código, no de base de datos. Por su tamaño, no lo hice en este Checkpoint sin tu aprobación explícita, tal como pediste para cambios de seguridad significativos.

---

**DETENGO ACÁ.** No se modificó RLS, no se modificó ninguna ruta, no se ejecutó nada en Supabase — solo diagnóstico, como en A y B. Quedo esperando tu decisión sobre la propuesta de arriba (implementarla ahora, dejarla para después, o ajustarla) y tu aprobación para pasar al **Checkpoint D** (diseño de disponibilidad y prevención de conflictos de reservas).
