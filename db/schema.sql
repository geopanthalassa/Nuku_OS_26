-- Nuku OS — esquema base (Fase 0)
-- Multi-cliente desde el día uno: "accounts" es un hostal. Todo lo demás
-- cuelga de un account_id, y las políticas de RLS impiden que una cuenta
-- vea los datos de otra. Kuhane será la primera fila de `accounts`, no un
-- caso especial en el código.
--
-- Pensado para Supabase (Postgres + auth.users + Row Level Security).
-- Este archivo es el punto de partida: se aplica cuando exista un proyecto
-- Supabase real conectado. Mientras tanto, la app corre con datos de
-- ejemplo en /lib/mock-data.ts para poder construir y revisar la interfaz
-- sin depender de credenciales.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- Cuentas (cada hostal es una cuenta)
-- ---------------------------------------------------------------------
create table accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,                    -- ej. "Kuhane Etno-Hostal"
  slug text unique not null,              -- ej. "kuhane"
  timezone text not null default 'Pacific/Easter',
  currency text not null default 'CLP',
  status text not null default 'trial',   -- trial | active | paused
  created_at timestamptz not null default now()
);

-- Usuarios del panel, vinculados a auth.users de Supabase y a una cuenta.
-- Una misma persona podría pertenecer a más de una cuenta a futuro
-- (ej. tu papá administrando Kuhane, tú con acceso a varias cuentas como
-- operador de Nuku OS) — por eso es una tabla de relación, no una columna.
create table account_members (
  account_id uuid not null references accounts(id) on delete cascade,
  user_id uuid not null,                  -- referencia a auth.users(id)
  role text not null default 'owner',     -- owner | staff | nuku_admin
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
  base_rate_cents bigint,                 -- null = [POR CONFIRMAR]
  created_at timestamptz not null default now()
);

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
  created_at timestamptz not null default now()
);

create table reservations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  room_id uuid not null references rooms(id) on delete cascade,
  guest_id uuid not null references guests(id) on delete cascade,
  check_in date not null,
  check_out date not null,
  status text not null default 'confirmed', -- confirmed | cancelled | completed
  channel text not null default 'direct',   -- direct | booking | airbnb | ...
  total_cents bigint,
  payment_status text not null default 'pending', -- pending | paid | refunded
  created_at timestamptz not null default now(),
  constraint reservation_dates check (check_out > check_in)
);

-- ---------------------------------------------------------------------
-- Concierge / Bandeja unificada
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
-- de qué automatizaciones tiene activas cada cuenta)
-- ---------------------------------------------------------------------
create table automations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  template_key text not null,             -- ej. "welcome_message", "review_request"
  enabled boolean not null default true,
  config jsonb not null default '{}',
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
-- Row Level Security — cada cuenta solo ve sus propios datos.
-- Mismo patrón en cada tabla que cuelga de account_id: un usuario ve una
-- fila solo si es miembro de la cuenta dueña de esa fila.
-- ---------------------------------------------------------------------

alter table accounts enable row level security;
create policy "Ve las cuentas de las que es miembro"
  on accounts for select
  using (id in (select account_id from account_members where user_id = auth.uid()));
-- Sin política de insert/update/delete todavía: crear o cerrar una cuenta
-- es una operación administrativa (Fase 6, "empaquetar para vender"), no
-- algo que un usuario normal deba poder hacer desde el cliente.

alter table account_members enable row level security;
create policy "Ve sus propias membresías"
  on account_members for select
  using (user_id = auth.uid());

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
