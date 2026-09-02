# Auditoría de Nuku OS — estado actual y plan hacia "Plan 2: Conectar"

Fecha: septiembre 2026 · Repo auditado: `nuku-desayunos` (el más reciente de los que existen en el entorno de trabajo) · Alcance: solo lectura, sin cambios de código.

Resumen en una frase antes de entrar al detalle: **Nuku OS está más avanzado de lo que el nombre "Fase 0" en algunos textos sugiere.** El panel de administración ya tiene autenticación real, y Reservas, Calendario, Desayunos, Bandeja y Automatizaciones ya leen y escriben datos reales en Supabase (no mock) — solo Huéspedes sigue en datos de ejemplo. El Concierge IA ya llama a la API de Anthropic de verdad. Lo que falta para "Plan 2" no es reconstruir nada de esto: es conectar canales reales (hoy cero conectados) y llenar un puñado de huecos concretos, la mayoría del mismo tamaño y forma que patrones que ya existen en el código.

---

## A. LO QUE YA EXISTE Y DEBEMOS CONSERVAR

**Stack técnico** — Next.js 16 (App Router, Turbopack) + React 19 + TypeScript + Tailwind CSS v4, Supabase (Postgres + Auth + Row Level Security) ya conectado a un proyecto real, Stripe (Checkout Sessions, modo `payment`) con webhook ya integrado, API de Anthropic para el Concierge. Nada de esto necesita cambiar de base.

**Multi-tenant desde el diseño, no como parche** — `accounts` es una fila por hostal, y absolutamente todo lo demás (`rooms`, `guests`, `reservations`, `conversations`, `messages`, `automations`, `account_members`) cuelga de `account_id`, con Row Level Security activo tabla por tabla (`db/schema.sql`, sección de políticas). Este es exactamente el patrón que pide la sección E de este pedido — ya está construido, no hay que rehacerlo. Kuhane es una fila en `accounts` (id `057a625c-9036-4b1d-957b-8c436f71b4cd`), no un caso especial en ningún archivo de lógica.

**Autenticación real del panel (Fase 1, completa)** — `/login` y `/registro` son formularios reales contra Supabase Auth (no el usuario/clave fijo que había antes). `account_members` decide a qué cuenta pertenece cada usuario. `AdminGate` + `AccountContext` resuelven la cuenta activa vía `/api/auth/me` y la exponen a todo el panel con `useCurrentAccount()`. Un cliente nuevo se registra solo, sin que nadie toque SQL (`/api/auth/signup` crea usuario + cuenta + vínculo en una sola llamada).

**Cinco de los seis módulos del panel ya leen/escriben Supabase real**, no `lib/mock-data.ts`:
- **Reservas** (`/reservas`) — lista real desde `reservations`, cambio de estado (`requested → confirmed/cancelled/completed`), arma el mensaje de bienvenida automáticamente al confirmar, botón "Cobrar" que genera un link de pago de Stripe real.
- **Calendario** (`/calendario`) — vista de llegadas/salidas por día pensada específicamente para el traslado al aeropuerto (Kuhane busca y lleva a cada huésped), con edición de hora/número de vuelo.
- **Desayunos** (`/desayunos`) — ficha diaria de quién está alojado y sus restricciones alimentarias/movilidad, con vista de impresión.
- **Bandeja** (`/bandeja`) — lista de conversaciones + hilo, y un canal de prueba que ya habla con el Concierge IA real.
- **Automatizaciones** (`/automatizaciones`) — interruptores on/off por cuenta, guardados de verdad en la tabla `automations`.

**El Concierge IA ya es real, no una maqueta** — `lib/concierge.ts` llama a la API de Anthropic (`claude-sonnet-4-5-20250929` por defecto, configurable por cuenta), arma el prompt del sistema con los datos reales de cada cuenta (`concierge_settings.business_facts`), guarda cada mensaje en Supabase, y **ya tiene escrita la regla de no inventar** ("Nunca inventes precios, disponibilidad exacta, políticas de cancelación...") directo en el system prompt. Es genérico por diseño: no hay una sola línea específica de Kuhane adentro. Dos endpoints ya construidos y listos para recibir cualquier canal: `/api/concierge/inbound` (mensaje nuevo, crea huésped/conversación si hace falta) y `/api/concierge/reply` (responder dentro de una conversación que ya existe).

**El motor de automatizaciones ya separa el "qué texto" del "cuándo dispararlo"** — `lib/automations.ts` arma el mensaje (con variables tipo `{{guest_name}}`) respetando el interruptor de cada cuenta y permitiendo texto personalizado por cliente vía `automations.config.message_template`. El "cuándo" (reserva confirmada, 24h post-checkout, cumpleaños de hoy) lo decide n8n desde afuera, llamando a `/api/automations/render` o `/api/automations/birthdays-today`. Esta separación es exactamente la arquitectura de eventos que pide la sección H — ya existe, solo hay que sumarle más eventos (ver sección C).

**`n8n-templates/`** — dos plantillas reales (`concierge-inbound.json`, `automation-reserva-confirmada.json`) con instrucciones explícitas de onboarding: se duplica el workflow por cliente, se pega su `account_id`, se conecta su credencial de canal. Es el patrón "un adapter por canal, un núcleo único" que pide la sección D — ya esbozado, aunque vive en n8n y no en este repo.

**Identidad visual y componentes de UI ya construidos y consistentes** — paleta terracotta/olive/sage/rust, tipografía `font-display`/`font-mono-ui`, componentes reutilizables (`Pill`, `KpiCard`, `Sidebar`, `TopBar`). No hay necesidad de tocar nada de esto.

---

## B. LO QUE YA EXISTE PERO DEBE EVOLUCIONAR

**Bandeja → centro unificado de conversaciones.** Hoy es, en la práctica, un probador manual del Concierge: un solo canal fijo (`"test"`, un `external_id` por cuenta) con un input de texto que simula un mensaje de huésped. El motor detrás (`/api/concierge/inbound`) ya es genérico y no sabe de qué canal vino un mensaje — eso es justo lo que se necesita. Lo que falta no es rehacer esta pantalla (su forma ya es correcta: lista de conversaciones + hilo + envío), sino construir los adapters reales que le hablen desde afuera (WhatsApp, Instagram, email) en vez de solo el botón de prueba del panel.

**Huéspedes → el módulo menos evolucionado, el único que sigue en datos de ejemplo.** `/huespedes` lee 100% de `demoWorkspace` (`lib/mock-data.ts`), no de Supabase, mientras que la tabla `guests` real ya existe y ya se llena solita desde tres lugares distintos (`/reservar`, `/api/concierge/inbound`, `/api/public/leads`). Para que sea la base de un CRM real hace falta: (1) conectar la pantalla a `guests` real, (2) una ficha por huésped que cruce reservas + conversaciones + preferencias ya guardadas en `reservation_guests`, (3) mostrar `guests.birth_date` — ya se guarda y ya lo usa la automatización de cumpleaños, pero hoy no aparece en ningún lado del panel.

**Reservas → el motor de datos es real y más completo de lo esperado, pero el dinero sigue siendo 100% manual.** El staff escribe el monto a mano cada vez que genera un link de pago, aunque `rooms.base_rate_cents` ya existe y se podría calcular solo. No hay ningún chequeo de disponibilidad real: dos reservas pueden solaparse en la misma habitación sin que nada lo impida (lo confirmé leyendo el código — ni `reservations/request/route.ts` ni ningún otro lugar valida fechas contra reservas existentes). `promo_code` es hoy texto libre sin validación ni tabla propia — es exactamente lo que estábamos construyendo cuando llegó este pedido de auditoría (quedó en pausa, a la espera de que confirmes cómo seguir después de este diagnóstico).

**Automatizaciones → el motor es real, pero nada se dispara solo todavía.** Depende de que n8n llame a los endpoints, y n8n no tiene ningún canal real conectado (confirmado: `.env.example` deja las credenciales vacías por diseño, y no hay ninguna credencial de WhatsApp/Instagram/email en ningún lado del repo). El evento "cumpleaños" ya está completo de punta a punta en el código — pero es invisible para el equipo porque Huéspedes no muestra `birth_date` (ver arriba). Los eventos que pide la sección H para lo COMERCIAL (nuevo lead, consulta sin respuesta, lead caliente, seguimiento pendiente, reserva incompleta) y parte de lo POST ESTADÍA (solicitar UGC, enviar cupón) no existen todavía en `DEFAULT_AUTOMATIONS` ni en `lib/automations.ts`.

**Concierge / Bot → funciona de punta a punta, le falta "ver" datos reales en vivo.** Ya no es un mock: responde con Claude de verdad, usando los datos que se cargaron a mano en `concierge_settings.business_facts` para esa cuenta. La limitación real es que ese contexto es estático (un JSON que alguien tiene que mantener actualizado a mano) — el bot no puede hoy consultar disponibilidad real de una fecha específica ni cotizar en vivo, porque no tiene *tool use* (function calling) conectado a Supabase. Ver detalle en la sección G.

---

## C. LO QUE FALTA PARA EL PLAN 2

Usando tu propia definición — *"un sistema que centraliza conversaciones, conecta canales, utiliza IA para atender clientes, captura leads y automatiza seguimientos"* — esto es lo que falta, ya filtrado de lo que ya existe:

1. **Adapters de canal reales** (WhatsApp Business API, Instagram Graph API, email/SMTP): hoy cero conectados. Existe el diseño de cómo se conectarían (n8n + variables de entorno documentadas), pero ninguno está armado todavía.
2. **Formato de mensaje unificado, formalizado en código**: el concepto ya existe de hecho (`conversations` + `messages`, con `account_id`, `channel`, `external_id`, `direction`), pero no está escrito como un tipo explícito en `lib/types.ts`. Ver propuesta concreta en la sección D — no requiere tabla nueva.
3. **CRM real (Huéspedes)** — ver sección B.
4. **Automatizaciones comerciales** (lead caliente, seguimiento pendiente, reserva incompleta) y las dos que faltan de post-estadía (UGC, cupón) — no existen todavía en ningún lado del código.
5. **Captura de leads más allá del widget de WhatsApp**: `/api/public/leads` solo cubre el botón flotante del sitio de Kuhane. No hay forma hoy de capturar un lead desde Instagram/Facebook, ni de detectar "conversación sin respuesta" (aunque los datos para calcularlo — `last_message_at`, `direction` — ya existen en `messages`/`conversations`).
6. **Tool use real para el bot** (function calling contra Supabase) — para que consulte disponibilidad/precio real en vez de un texto estático que hay que mantener a mano.
7. **Disponibilidad real / bloqueo de fechas** — sin esto, ni el Concierge puede confiar en lo que dice, ni un checkout de pago automático es seguro (riesgo de doble reserva, confirmado como hueco real en este mismo audit).

---

## D. ARQUITECTURA RECOMENDADA

Buena noticia: tu diagrama conceptual (`CANALES → CHANNEL ADAPTERS → BANDEJA CENTRAL → CONVERSATION ENGINE → IA/BOT → SUPABASE → CRM/RESERVAS/AUTOMATIZACIONES`) **ya es, en términos generales, cómo está construido Nuku OS hoy** — no hace falta una arquitectura nueva, hace falta terminar de conectar los eslabones que faltan:

- **CANALES**: Web ya activo (`/reservar`, el widget de leads de Kuhane). WhatsApp/Instagram/Facebook/Email: sin conectar.
- **CHANNEL ADAPTERS**: el patrón ya existe como concepto — workflows de n8n, uno por canal por cliente, cada uno normalizando su formato de origen antes de llamar a Nuku OS (ver `n8n-templates/README.md`). Falta construir los adapters de WhatsApp/Instagram/Email en sí; hoy solo existe el "adapter de prueba" hardcodeado dentro del panel (el input de texto en Bandeja).
- **BANDEJA CENTRAL**: ya es, de hecho, el punto de convergencia único — `conversations` + `messages` no distinguen lógica por canal, y `/api/concierge/inbound` ya es genérico (no le importa si el mensaje vino de WhatsApp o de un formulario web). Recomiendo **no crear una tabla nueva** para esto — sería duplicar lo que ya existe. En su lugar, formalizar el tipo en TypeScript:

  ```ts
  // lib/types.ts — formaliza lo que las columnas de conversations/messages
  // ya representan de hecho, para que cada adapter de n8n construya
  // exactamente esto antes de llamar a /api/concierge/inbound.
  export type UnifiedMessage = {
    accountId: string;        // = hotel_id — ya existe como account_id en todo el esquema
    conversationId?: string;  // opcional: si no existe, /api/concierge/inbound la crea
    channel: "whatsapp" | "instagram" | "email" | "web";
    externalId?: string;      // id del hilo en el canal de origen
    sender: { fullName?: string; email?: string; phone?: string };
    message: string;
    timestamp: string;
  };
  ```

  Cada adapter (el nodo de n8n de cada canal) arma este objeto y se lo pasa a `/api/concierge/inbound` — que ya guarda exactamente estos campos. Ningún canal necesita su propio bot: el motor (`lib/concierge.ts`) ya es uno solo.
- **CONVERSATION ENGINE**: `/api/concierge/inbound` + `/api/concierge/reply` — ya construidos, ya genéricos.
- **IA / BOT**: `lib/concierge.ts` — ya construido; necesita tool use (sección G).
- **SUPABASE**: ya es la fuente de verdad real — ni el bot ni n8n guardan memoria propia, todo pasa por Supabase antes y después de cada respuesta.
- **CRM / HUÉSPEDES / RESERVAS / AUTOMATIZACIONES**: Reservas y Automatizaciones ya reales; Huéspedes es la pieza que falta conectar (sección B).

**Conclusión de esta sección**: no recomiendo ningún cambio de arquitectura. Recomiendo cerrar los huecos puntuales de arriba sobre la arquitectura que ya existe.

---

## E. MULTI-TENANT

Ya es verdad hoy, no un plan a futuro: `accounts` + `account_members` + RLS por tabla (`db/schema.sql`), confirmado en el panel de administración completo (login, cuenta activa, todas las consultas filtradas por `account_id`, doble filtro `account_id` + `id` en cada update para que un usuario nunca pueda tocar la fila de otra cuenta). El patrón de credenciales de canal por cliente también ya es correcto: viven en n8n (una copia del workflow por cliente, con sus propias credenciales), no en la base de datos de Nuku OS — así que agregar Hotel B o Hotel C no significa tocar código, significa: una fila nueva en `accounts` (ya self-serve vía `/registro`), y duplicar los workflows de n8n con su `account_id` y sus credenciales.

**Único punto pendiente, ya documentado en `ONBOARDING.md` y confirmado en el código**: la ruta pública `/reservar` sigue apuntando siempre a la cuenta de Kuhane (`lib/current-account.ts`, `CURRENT_ACCOUNT_ID` hardcodeado). Esto es correcto para el piloto — pero cada cliente nuevo va a necesitar su propia URL o subdominio de reservas antes de poder recibir solicitudes de sus propios huéspedes. No bloquea el panel administrativo (que ya es multi-cuenta), solo bloquea vender el "sitio de reservas" a un segundo cliente.

---

## F. SUPABASE

El proyecto real ya existe y ya está conectado (confirmado por el hecho de que Reservas/Calendario/Desayunos/Bandeja/Automatizaciones ya leen datos reales, no mock). **Hallazgo importante que hay que corregir pronto**: `db/schema.sql`, el archivo que vive en el repo como "la fuente de verdad del esquema", **está desactualizado respecto a lo que el código realmente usa** — probablemente porque cambios de esquema se aplicaron directo en el panel de Supabase en algún momento, sin volver a escribirlos en este archivo. Faltan en `db/schema.sql`:

- La tabla `concierge_settings` completa (la usa `lib/concierge.ts`, `/api/auth/signup`, y la documenta `ONBOARDING.md` como "ya aplicada al proyecto real").
- La tabla `reservation_guests` completa (usada extensivamente: `reservas`, `calendario`, `desayunos`, `/api/reservations/request`, `/api/dashboard/reservation-guests`).
- Columnas en `guests`: `birth_date`, `document_id`.
- Columnas en `reservations`: `promo_code`, `stripe_checkout_session_id`, `stripe_payment_link`, `tour_interest`, `tour_notes`, `arrival_flight_time`, `arrival_flight_number`, `departure_flight_time`, `departure_flight_number`, `airport_transfer_notes`.
- El valor real de `reservations.status` no coincide con el archivo: el código usa activamente `"requested"` como estado inicial (`api/reservations/request/route.ts`, `VALID_STATUSES`, toda la UI de Reservas), pero `db/schema.sql` documenta el default como `'confirmed'` y ni siquiera menciona `"requested"` en su comentario de enum.

Esto no es un problema de que el sistema esté roto — está funcionando con datos reales ahora mismo. El problema es que **si hoy tuvieras que reconstruir la base de datos desde el repo, no te daría lo que realmente existe en producción**. Antes de seguir sumando tablas (como `promo_codes`, que ya estaba en curso), recomiendo un paso corto: sacar el esquema real desde Supabase (`pg_dump --schema-only`, o el propio diff de Supabase) y reconciliar `db/schema.sql` para que vuelva a ser confiable — así cada tabla nueva que sumemos para el Plan 2 parte de una base honesta.

**Para lo que falta del Plan 2**, mi recomendación es reutilizar entidades existentes en vez de duplicar:
- No hace falta ninguna tabla nueva para "Bandeja unificada" — `conversations`/`messages` ya tienen la forma correcta (ver sección D).
- "Consulta sin respuesta" / "lead caliente" se pueden calcular de los datos que ya existen (`messages.direction` + `conversations.last_message_at`) en vez de una tabla nueva — recomiendo probar esto antes de agregar estructura.
- `promo_codes` + una tabla de destinatarios habilitados por código (para cupones personalizados tipo "cumpleaños") sigue siendo, a mi juicio, la pieza correcta cuando retomemos ese trabajo — no compite con nada de lo de acá.

---

## G. EL BOT EXISTENTE

1. **Cómo funciona hoy**: recibe un mensaje → arma el prompt del sistema con los datos de la cuenta (`concierge_settings.business_facts`, o un `system_prompt` completo si alguien lo cargó a mano) → agrega el historial de esa conversación (hasta 20 mensajes) → llama a la API de Anthropic (`claude-sonnet-4-5-20250929` por defecto) → guarda la respuesta en `messages` y actualiza `conversations.last_message_at`.
2. **Qué información usa**: nombre y huso horario de la cuenta (para saber si es Rapa Nui), `concierge_settings.business_facts` (un JSON libre tipo clave-valor: habitaciones, check-in, wifi, etc.), y el historial reciente de esa conversación puntual. Nada más — no consulta `rooms` ni `reservations` en tiempo real todavía.
3. **¿Se puede reutilizar como Concierge?** Sí — ya lo es. No hay que reemplazarlo, solo extenderlo.
4. **Qué necesita para conectarse con datos reales en vivo**: tool use (function calling) contra Supabase, en vez de depender de que alguien mantenga `business_facts` actualizado a mano para cada dato que cambia seguido (disponibilidad, precio de una fecha puntual).
5. **Qué necesita para usar herramientas/funciones**: técnicamente, es un cambio acotado — pasar un parámetro `tools` en la misma llamada a la API de Anthropic que ya existe en `lib/concierge.ts` (mismo endpoint, mismo archivo), con funciones controladas tipo `check_availability(check_in, check_out)` o `get_room_rates()` que el propio código ejecute contra Supabase antes de devolver la respuesta final. No es un cambio de arquitectura, es una extensión del mismo motor.
6. **Qué falta para conectarlo a canales externos**: nada del lado del bot en sí — lo que falta es el adapter de cada canal (n8n + credenciales reales), como se explicó en la sección D. El bot ya no le importa de dónde vino el mensaje.

---

## H. AUTOMATIZACIONES

La arquitectura de eventos/triggers para RESERVA ya existe y funciona: `bienvenida_reserva`, `solicitud_resena`, `recordatorio_pago`, `cumpleanos` — cada una con plantilla por defecto (editable por cuenta), interruptor on/off real en Supabase, y el "cuándo" resuelto por n8n (trigger programado o evento) llamando a `/api/automations/render` o `/api/automations/birthdays-today`.

Para lo COMERCIAL (nuevo lead, consulta sin respuesta, lead caliente, seguimiento pendiente, reserva incompleta) y lo que falta de POST ESTADÍA (solicitar UGC, enviar cupón — "solicitar reseña" ya existe), la extensión es del mismo tamaño y forma que lo que ya hay: sumar entradas nuevas a `DEFAULT_AUTOMATIONS` (`app/api/dashboard/automations/route.ts`) y a `DEFAULT_TEMPLATES` (`lib/automations.ts`), con su `template_key` correspondiente. Ninguna de estas necesita credenciales de canal para quedar preparada en código — sí las necesita para dispararse de verdad, una vez que n8n esté conectado a un canal real. No construí nada de esto todavía, como pediste; queda listo para cuando lo apruebes.

---

## I. CREDENCIALES E INTEGRACIONES

Lo que falta, tal como está documentado en `.env.example`, `STRIPE.md` y `ONBOARDING.md` (todas vacías/pendientes en el repo, por diseño — se cargan en Vercel, no en el código):

| Variable / credencial | Para qué | Estado |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Todo el panel y las rutas `/api/*` | Probablemente ya cargadas en Vercel (el panel ya lee datos reales) — confirmar directo ahí |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `/login`, `/registro` (Supabase Auth desde el navegador) | Confirmar en Vercel |
| `ANTHROPIC_API_KEY` | Concierge IA | Necesaria para que `/api/concierge/*` no falle |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Checkout + confirmación de pago | Cuenta de Stripe (modo test) — ver conversación previa sobre `STRIPE.md` |
| Credencial de WhatsApp Business API | Adapter de WhatsApp en n8n | No conectada |
| Credencial de Instagram Graph API | Adapter de Instagram en n8n | No conectada |
| SMTP | Adapter de email en n8n | No conectada |
| `NUKU_OS_BASE_URL` (variable de n8n, no de Vercel) | Que los workflows de n8n sepan a qué URL llamar | No confirmado si está cargada |

**Sobre el patrón "adapter reemplazable sin tocar el resto del código"**: ya existe, pero vive en n8n, no en TypeScript. Mientras n8n sea quien hable con cada canal, no hace falta construir un `WhatsAppIntegrationService`/`MockIntegrationService` dentro de Nuku OS — el propio n8n ya cumple ese rol (un workflow por canal, reemplazable sin tocar el código de Next.js). Si en algún momento decidieran mover esa lógica de canal AL código de Nuku OS (en vez de n8n), ahí sí recomendaría ese patrón de servicios mockeables — hoy no hace falta, sería construir dos veces lo mismo.

---

## J. RESUMEN Y RIESGOS

**Diagnóstico en una línea**: Nuku OS ya tiene el 80% del "cómo" para el Plan 2 — autenticación real, multi-tenant real, motor de conversación genérico, motor de automatizaciones genérico, Concierge IA real. Lo que falta es sobre todo "qué le falta conectar" (canales) y "qué pantalla sigue en modo demo" (Huéspedes), no una reconstrucción.

**Riesgos técnicos concretos, de mayor a menor urgencia**:
1. **`db/schema.sql` desactualizado respecto al esquema real en Supabase** (sección F) — riesgo de que cualquier trabajo futuro (incluyendo Claude en una sesión nueva) parta de información falsa sobre qué columnas/tablas existen. Recomiendo corregirlo antes de sumar las tablas de `promo_codes`.
2. **Sin chequeo de disponibilidad real** — dos reservas pueden solaparse en la misma habitación sin que nada lo detecte. Ya lo habíamos identificado en la conversación sobre pagos con cupón; sigue pendiente.
3. **`reservation_guests` y `concierge_settings` no aparecen en `db/schema.sql`**, así que no puedo confirmar desde el código si tienen RLS activo como el resto de las tablas — vale la pena verificarlo directo en Supabase.
4. **Huéspedes en modo demo** — cualquier decisión comercial que dependa de ver el CRM real todavía no tiene datos reales ahí.
5. **`/reservar` público fijo a Kuhane** — no bloquea nada hoy (Kuhane es el único cliente), pero hay que resolverlo antes de vender a un segundo hostal.

**Nada de esto requiere una reconstrucción.** Quedo a la espera de tu aprobación para tocar cualquier código — este documento es solo el diagnóstico que pediste.
