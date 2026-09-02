-- Nuku OS — esquema real (sincronizado en Checkpoint B, Fase 1 de estabilización)
--
-- ESTE ARCHIVO ES DOCUMENTACIÓN. No se ejecuta contra producción: Supabase
-- ya tiene las 13 tablas de abajo aplicadas, vía sus propias migraciones
-- (ver "Migraciones reales" al final de este archivo). La fuente de verdad
-- es y sigue siendo Supabase + su historial de migraciones — este archivo
-- solo debe reflejarla fielmente para que un desarrollador o una IA puedan
-- entender el sistema sin tener que conectarse a Supabase primero.
--
-- Última sincronización: 2026-09-02, contra el proyecto Supabase real
-- "nuku-os" (ref oraucziymsqqzaoskizf), leyendo directamente information_
-- schema / pg_catalog (columnas, tipos, defaults, constraints, índices,
-- políticas RLS) — no inferido del código ni de la versión anterior de
-- este archivo.
--
-- Proyecto multi-cliente desde el día uno: "accounts" es un hostal. Todo
-- lo demás cuelga de un account_id, y las políticas de RLS impiden que una
-- cuenta vea los datos de otra. Kuhane es hoy la única fila de `accounts`
-- (cuenta piloto), no un caso especial en el código ni en el esquema.

create extension if not exists "pgcrypto";
create extension if not exists "btree_gist" schema extensions; -- necesaria para el EXCLUDE de reservations_no_overlap, ver más abajo

-- ---------------------------------------------------------------------
-- Cuentas y membresías
-- ---------------------------------------------------------------------

create table accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,                     -- ej. "Kuhane Etno-Hostal"
  slug text not null,                     -- ej. "kuhane"
  timezone text not null default 'Pacific/Easter',
  currency text not null default 'CLP',
  status text not null default 'trial',   -- trial | active | paused (valores usados en código; no hay CHECK que los obligue)
  created_at timestamptz not null default now(),
  constraint accounts_slug_key unique (slug)
);

-- Usuarios del panel, vinculados a auth.users de Supabase y a una cuenta.
-- Es tabla de relación (no una columna en accounts) porque una misma
-- persona podría pertenecer a más de una cuenta a futuro.
--
-- ⚠️ ESTADO REAL AL SINCRONIZAR (2026-09-02): esta tabla tiene 0 filas, y
-- auth.users (de Supabase Auth) también tiene 0 filas — no existe ningún
-- usuario creado todavía, ni siquiera el de Kuhane. Ver la sección
-- "VERIFICACIÓN DE ACCESO Y ONBOARDING" entregada en el chat de Checkpoint
-- B para el detalle completo: en el estado actual, nadie puede entrar al
-- panel de administración (ni de Kuhane ni de ninguna cuenta), porque no
-- hay ningún usuario de Auth ni ninguna membresía. No es un bug de código
-- — es un paso de onboarding manual (documentado en ONBOARDING.md) que
-- todavía no se ejecutó para Kuhane, y nadie ha usado /registro tampoco.
create table account_members (
  account_id uuid not null references accounts(id) on delete cascade,
  user_id uuid not null,                  -- referencia lógica a auth.users(id) — sin FK real (auth.users vive en otro schema)
  role text not null default 'owner',     -- owner | staff | nuku_admin (valores usados en código; sin CHECK)
  created_at timestamptz not null default now(),
  primary key (account_id, user_id)
);

-- ---------------------------------------------------------------------
-- Propiedad, habitaciones y tarifas
-- ---------------------------------------------------------------------

create table properties (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  name text not null,
  address text,
  created_at timestamptz not null default now()
);

create table rooms (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  property_id uuid not null references properties(id) on delete cascade,
  name text not null,                     -- ej. "Habitación Ariki"
  capacity int not null default 2,
  base_rate_cents bigint,                 -- null = sin precio real todavía
  created_at timestamptz not null default now()
);

comment on column rooms.base_rate_cents is
  'Tarifa de referencia por noche. Para 5 de las 7 habitaciones viene de un snapshot real de Booking.com (29-ago-2026, posible tarifa de temporada alta/poca disponibilidad) — confirmar con Kuhane si es representativa. Habitación Doble Estándar y Triple Estándar siguen sin precio real.';

create table rate_plans (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  room_id uuid not null references rooms(id) on delete cascade,
  name text not null default 'Tarifa estándar',
  price_cents bigint not null,
  valid_from date,
  valid_to date,
  created_at timestamptz not null default now()
);
-- Nota: existe en el esquema real y no está deprecada, pero hoy tiene 0
-- filas — ningún módulo del panel la lee ni la escribe todavía (Reservas y
-- la reserva pública usan rooms.base_rate_cents directamente).

-- ---------------------------------------------------------------------
-- Huéspedes y reservas
-- ---------------------------------------------------------------------

create table guests (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  full_name text not null,
  email text,
  phone text,
  source text,                            -- directo | booking | instagram | ...
  notes text,
  created_at timestamptz not null default now(),
  birth_date date,
  document_id text                        -- ver comentario abajo
);

comment on column guests.document_id is
  'RUT o número de pasaporte del huésped principal (obligatorio ingresar a Rapa Nui)';

create table reservations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  room_id uuid not null references rooms(id) on delete cascade,
  guest_id uuid not null references guests(id) on delete cascade,
  check_in date not null,
  check_out date not null,
  status text not null default 'confirmed',
  channel text not null default 'direct', -- direct | booking | airbnb | ...
  total_cents bigint,
  payment_status text not null default 'pending', -- pending | paid | refunded
  created_at timestamptz not null default now(),
  promo_code text,
  stripe_checkout_session_id text,
  stripe_payment_link text,
  tour_interest boolean not null default false,
  tour_notes text,
  arrival_flight_time time,
  arrival_flight_number text,
  departure_flight_time time,
  departure_flight_number text,
  airport_transfer_notes text,
  constraint reservation_dates check (check_out > check_in)
);

comment on column reservations.status is
  'requested | confirmed | cancelled | completed — solicitud pública sin confirmar todavía = requested';
comment on column reservations.stripe_checkout_session_id is
  'id de la Checkout Session de Stripe generada para cobrar esta reserva (null hasta que el equipo genere un link de pago)';
comment on column reservations.stripe_payment_link is
  'URL de pago de Stripe que se le manda al huésped por WhatsApp/email';
comment on column reservations.tour_interest is
  'El huésped marcó que quiere info sobre tours/experiencias al reservar';
comment on column reservations.tour_notes is
  'Texto libre del huésped sobre qué tours/experiencias le interesan (buceo, cabalgatas, etc.)';
comment on column reservations.arrival_flight_time is
  'Hora estimada de llegada del vuelo (para coordinar el traslado desde el aeropuerto Mataveri) — opcional, se puede confirmar más cerca de la fecha.';
comment on column reservations.departure_flight_time is
  'Hora estimada de salida del vuelo (para coordinar el traslado de vuelta al aeropuerto) — opcional.';

-- TODO / FUTURA MIGRACIÓN: el comentario de `status` ya incluye 'requested'
-- como valor válido (para que una solicitud pública quede sin confirmar
-- hasta que el equipo la revise), pero el DEFAULT de la columna sigue
-- siendo 'confirmed'. Documentamos la realidad tal cual está — no se
-- cambia el default en este Checkpoint. Cambiarlo es una decisión de
-- producto (¿toda reserva nueva nace "confirmed" o "requested"?) que debe
-- aprobarse explícitamente antes de tocarlo.
--
-- Checkpoint E (Fase 1): protección real contra dobles reservas. Un
-- EXCLUDE constraint de Postgres — no una validación de la aplicación —
-- impide que dos filas de la misma room_id tengan rangos de fecha que se
-- crucen, para reservas 'requested' o 'confirmed' ('cancelled' y
-- 'completed' no ocupan). daterange(check_in, check_out, '[)') modela
-- exactamente la condición ya acordada: nueva.check_in < existente.
-- check_out AND nueva.check_out > existente.check_in — con el límite '[)',
-- dos reservas que comparten el día de check-out/check-in no chocan.
-- Decisión de que 'requested' también ocupe: documentada en
-- FASE1_CHECKPOINT_D_DISENO_DISPONIBILIDAD.md. Es atómico y a prueba de
-- condiciones de carrera (lo garantiza Postgres, no la aplicación) — ver
-- lib/availability.ts para la capa de aplicación que da el mensaje de
-- error amigable antes de llegar a este punto.
alter table reservations
  add constraint reservations_no_overlap
  exclude using gist (
    room_id with =,
    daterange(check_in, check_out, '[)') with &&
  )
  where (status in ('requested', 'confirmed'));

-- Todas las personas incluidas en una reserva (titular + acompañantes),
-- con los datos que Kuhane necesita declarar para el ingreso a Rapa Nui.
create table reservation_guests (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id), -- sin ON DELETE explícito (NO ACTION) — ver nota abajo
  reservation_id uuid not null references reservations(id) on delete cascade,
  full_name text not null,
  document_id text,
  birth_date date,
  phone text,
  email text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  dietary_vegan boolean not null default false,
  dietary_vegetarian boolean not null default false,
  dietary_celiac boolean not null default false,
  dietary_lactose_free boolean not null default false,
  dietary_other text,
  mobility_assistance boolean not null default false,
  mobility_notes text
);

comment on table reservation_guests is
  'Todas las personas incluidas en una reserva (titular + acompañantes) con los datos que Kuhane necesita declarar para el ingreso a Rapa Nui';
comment on column reservation_guests.dietary_vegan is 'Marcado por el huésped al reservar: dieta vegana';
comment on column reservation_guests.dietary_vegetarian is 'Marcado por el huésped al reservar: dieta vegetariana';
comment on column reservation_guests.dietary_celiac is 'Marcado por el huésped al reservar: celíaco / sin gluten';
comment on column reservation_guests.dietary_lactose_free is 'Marcado por el huésped al reservar: intolerancia a la lactosa';
comment on column reservation_guests.dietary_other is 'Texto libre: otras alergias o preferencias alimentarias no cubiertas por las categorías fijas';
comment on column reservation_guests.mobility_assistance is 'El huésped indicó que necesita algún tipo de asistencia de movilidad (silla de ruedas, dificultad para caminar, etc.)';
comment on column reservation_guests.mobility_notes is 'Texto libre con el detalle de la asistencia de movilidad necesaria';

create index reservation_guests_reservation_id_idx on reservation_guests (reservation_id);

-- Nota sobre reservation_guests.account_id: a diferencia de todas las
-- demás FK hacia accounts(id) (que son ON DELETE CASCADE), esta es
-- ON DELETE NO ACTION — borrar una cuenta con reservation_guests
-- asociados fallaría en vez de arrastrar el borrado. No se sabe si es
-- intencional o un descuido de la migración que la creó; no se modifica
-- en este Checkpoint. Ver también la política RLS excepcional de esta
-- tabla, documentada en la sección RLS más abajo.

-- ---------------------------------------------------------------------
-- Concierge IA — configuración por cuenta
-- ---------------------------------------------------------------------

-- Lo que el Concierge IA de cada cuenta sabe y cómo debe responder. Es la
-- fuente de verdad que lib/concierge.ts usa para armar el system prompt:
-- mientras más completo business_facts, menos genérico responde, y el
-- propio prompt le prohíbe inventar datos que no estén acá.
create table concierge_settings (
  account_id uuid primary key references accounts(id) on delete cascade,
  system_prompt text,                     -- override completo del prompt base; null = usar el prompt genérico + business_facts
  business_facts jsonb not null default '{}', -- JSON libre: horarios, wifi, políticas, habitaciones, etc. — lo único que el bot puede citar como hecho
  ai_provider text not null default 'anthropic',
  model text not null default 'claude-sonnet-4-5-20250929',
  temperature numeric not null default 0.4,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Bandeja unificada (conversaciones multi-canal)
-- ---------------------------------------------------------------------

create table conversations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  guest_id uuid references guests(id) on delete set null,
  channel text not null,                  -- whatsapp | instagram | email
  external_id text,                       -- id del hilo en la API externa
  last_message_at timestamptz,
  created_at timestamptz not null default now()
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  direction text not null,                -- inbound | outbound
  body text not null,
  sent_by text not null default 'system', -- system | staff | guest
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Automatizaciones (definidas visualmente en n8n; acá solo el registro
-- de qué automatizaciones tiene activas cada cuenta y su texto)
-- ---------------------------------------------------------------------

create table automations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  template_key text not null,             -- ej. "bienvenida_reserva", "solicitud_resena", "recordatorio_pago", "cumpleanos"
  enabled boolean not null default true,
  config jsonb not null default '{}',     -- puede incluir message_template (texto personalizado por cuenta)
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Banco de contenido (UGC)
-- ---------------------------------------------------------------------

create table content_assets (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  source text not null default 'instagram',
  source_handle text,
  media_url text,
  permission_status text not null default 'requested', -- requested | granted | denied
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
-- El patrón dominante (10 de las 13 tablas) es: un usuario ve/edita una
-- fila si es miembro (account_members) de la cuenta dueña de esa fila.
-- Pero NO todas las tablas siguen exactamente ese patrón — hay 3
-- excepciones reales y deliberadas, documentadas explícitamente abajo en
-- vez de generalizadas.

-- accounts y account_members: excepción #1 — política de solo SELECT.
-- No existe policy de insert/update/delete en ninguna de las dos: crear
-- una cuenta nueva pasa por /api/auth/signup (service role, bypassea RLS),
-- y vincular un usuario a account_members es el paso manual descrito en
-- ONBOARDING.md (también con service role). Un usuario del panel nunca
-- inserta ni modifica estas dos tablas directamente.
alter table accounts enable row level security;
create policy "Ve las cuentas de las que es miembro"
  on accounts for select
  using (id in (select account_id from account_members where user_id = auth.uid()));

alter table account_members enable row level security;
create policy "Ve sus propias membresías"
  on account_members for select
  using (user_id = auth.uid());

-- Patrón estándar — mismo qual en las 10 tablas siguientes, cmd = ALL:
--   using (account_id in (select account_id from account_members where user_id = auth.uid()))
alter table properties enable row level security;
create policy "Acceso por cuenta — properties"
  on properties for all
  using (account_id in (select account_id from account_members where user_id = auth.uid()));

alter table rooms enable row level security;
create policy "Acceso por cuenta — rooms"
  on rooms for all
  using (account_id in (select account_id from account_members where user_id = auth.uid()));

alter table rate_plans enable row level security;
create policy "Acceso por cuenta — rate_plans"
  on rate_plans for all
  using (account_id in (select account_id from account_members where user_id = auth.uid()));

alter table guests enable row level security;
create policy "Acceso por cuenta — guests"
  on guests for all
  using (account_id in (select account_id from account_members where user_id = auth.uid()));

alter table reservations enable row level security;
create policy "Acceso por cuenta — reservations"
  on reservations for all
  using (account_id in (select account_id from account_members where user_id = auth.uid()));

alter table conversations enable row level security;
create policy "Acceso por cuenta — conversations"
  on conversations for all
  using (account_id in (select account_id from account_members where user_id = auth.uid()));

alter table messages enable row level security;
create policy "Acceso por cuenta — messages"
  on messages for all
  using (account_id in (select account_id from account_members where user_id = auth.uid()));

alter table automations enable row level security;
create policy "Acceso por cuenta — automations"
  on automations for all
  using (account_id in (select account_id from account_members where user_id = auth.uid()));

alter table content_assets enable row level security;
create policy "Acceso por cuenta — content_assets"
  on content_assets for all
  using (account_id in (select account_id from account_members where user_id = auth.uid()));

alter table concierge_settings enable row level security;
create policy "Acceso por cuenta — concierge_settings"
  on concierge_settings for all
  using (account_id in (select account_id from account_members where user_id = auth.uid()));

-- reservation_guests: excepción #2, la más restrictiva de las 13 —
-- "service role only". qual = false y with_check = false para TODOS los
-- comandos (ALL), lo que significa que ningún usuario autenticado del
-- panel (ni siquiera uno con membresía válida en la cuenta dueña) puede
-- leer ni escribir esta tabla directamente vía el cliente browser/anon —
-- solo el backend con la service role key (lib/supabase/server.ts) puede
-- tocarla, y ese backend ya filtra por account_id a mano en el código.
-- No se sabe con certeza si esto es intencional (los datos de esta tabla
-- son sensibles: documento de identidad, alergias, movilidad — más
-- sensibles que el resto) o un descuido de la migración
-- add_reservation_guests_rls_policy. Queda marcado para confirmar/decidir
-- explícitamente en el Checkpoint C (auditoría RLS) — no se modifica acá.
alter table reservation_guests enable row level security;
create policy "service role only"
  on reservation_guests for all
  using (false)
  with_check (false);

-- ---------------------------------------------------------------------
-- Extensiones instaladas (además de pgcrypto y btree_gist, ya creadas arriba)
-- ---------------------------------------------------------------------
-- pg_stat_statements, supabase_vault, uuid-ossp, plpgsql — instaladas por
-- defecto en todo proyecto Supabase, no específicas de Nuku OS.
--
-- btree_gist (instalada en Checkpoint E, migración
-- enable_btree_gist_extension, después movida al schema `extensions` por
-- consistencia con pgcrypto/uuid-ossp — migración
-- move_btree_gist_to_extensions_schema): es la extensión estándar de
-- Postgres que permite declarar el EXCLUDE constraint
-- `reservations_no_overlap` de arriba, sobre rangos de fecha.

-- ---------------------------------------------------------------------
-- Migraciones reales aplicadas en Supabase (no como archivos en este
-- repo todavía — ver sección "Migraciones" del reporte de Checkpoint B)
-- ---------------------------------------------------------------------
-- 20260827103557  fase0_schema_multicliente
-- 20260827212503  concierge_settings
-- 20260827234020  add_guest_birthday_and_request_fields
-- 20260827234047  add_reservation_promo_code
-- 20260828124746  kuhane_real_address_and_rooms
-- 20260828125513  kuhane_rooms_by_type_not_unit
-- 20260828130802  add_stripe_columns_to_reservations
-- 20260828134512  fix_room_names_no_sea_view
-- 20260828143741  add_reservation_guests_and_tour_interest
-- 20260829022922  set_real_room_prices_from_booking
-- 20260830225345  add_flight_transfer_fields_to_reservations
-- 20260831020555  add_dietary_and_mobility_fields_to_reservation_guests
-- 20260831223517  add_reservation_guests_rls_policy
-- (Checkpoint E, 2026-09-02)  enable_btree_gist_extension
-- (Checkpoint E, 2026-09-02)  add_reservations_no_overlap_exclusion
-- (Checkpoint E, 2026-09-02)  move_btree_gist_to_extensions_schema
