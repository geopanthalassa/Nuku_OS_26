# Onboarding de un cliente nuevo a Nuku OS

Este documento es la respuesta larga a "¿qué hay que tocar para vender esto
a un hostal que no es Kuhane?". Corto: con lo que hay hoy (Fase 1 técnica),
un cliente nuevo se agrega llenando 3 cosas — nada de código.

## 1. Datos de la empresa (Supabase)

Todo cliente vive como una fila en la tabla `accounts`, más filas
relacionadas — **no como un proyecto Supabase aparte** (ver la sección
"¿Un Supabase por cliente?" más abajo para el porqué).

Mínimo para que un cliente nuevo funcione:

```sql
insert into accounts (name, slug, timezone, currency, status)
values ('Nombre del hostal', 'slug-del-hostal', 'America/Santiago', 'CLP', 'trial');

insert into concierge_settings (account_id, business_facts)
values ('<id de la fila anterior>', '{"habitaciones": "...", "check-in": "...", "wifi": "..."}');
```

`concierge_settings.business_facts` es lo que el Concierge IA usa para no
inventar nada: cuanto más completo, menos genérico responde. Se puede
cargar como un JSON simple (clave: dato) o, más adelante, dar una pantalla
en el panel para que el propio cliente lo edite sin tocar SQL — eso es
trabajo de interfaz, no de motor, y se puede sumar cuando convenga.

## 2. Automatizaciones (n8n)

Ver `n8n-templates/README.md`. En corto: se duplican los workflows,
se pega el `account_id` de este cliente, se conectan sus credenciales de
WhatsApp/Instagram/email, se activa.

## 3. Acceso al panel (pendiente — Fase 2)

Hoy el panel (`/dashboard`, `/reservas`, etc.) entra directo sin login real
("Entrar como Kuhane Etno-Hostal"). El esquema ya tiene `account_members`
listo para Supabase Auth (un usuario puede pertenecer a más de una cuenta),
pero conectar el login real y hacer que cada pantalla lea de Supabase en vez
de `lib/mock-data.ts` es la próxima pieza grande — no estaba pedida todavía
y es un cambio más grande que el motor de IA, así que quedó afuera de esta
vuelta a propósito. Se puede priorizar cuando digas.

## ¿Un Supabase por cliente?

Mencionaste "la supabase necesaria" para cada cliente — vale la pena ser
explícito sobre la decisión que ya está tomada en el esquema actual y por
qué, para que la cambiemos a propósito si no es lo que querías:

**Lo que hay hoy: un solo proyecto Supabase, multi-cliente.** Cada hostal
es una fila en `accounts`, y las políticas de RLS (Row Level Security)
impiden que una cuenta vea los datos de otra a nivel de base de datos, no
solo de código. Es el patrón estándar de SaaS B2B (así trabajan Notion,
Linear, la mayoría de este tipo de producto): más barato de operar (un solo
proyecto, no N), un solo lugar para aplicar mejoras de esquema, y la
separación de datos es igual de real porque la hace Postgres, no la
disciplina del código.

**La alternativa — un proyecto Supabase por cliente** — da aislamiento
físico total (útil si algún cliente grande lo exige por contrato, o si en
algún momento un cliente quiere ser dueño de su propia infraestructura), a
cambio de: crear y mantener un proyecto por cliente, aplicar cada migración
N veces en vez de una, y credenciales/variables de entorno separadas por
cliente en vez de compartidas. Es más trabajo operativo por cada cliente
nuevo, no menos.

Mi recomendación es seguir con el esquema multi-cliente compartido que ya
está armado y aplicado (ver `db/schema.sql` + la migración
`concierge_settings`), y dejar "Supabase dedicado" como una opción para un
cliente puntual que lo pida explícitamente, no como el default. Si preferís
lo contrario, es un cambio de infraestructura razonable de hacer, pero
mejor decidirlo ahora que agregar clientes sobre el esquema compartido y
migrar después.

## Qué se construyó en esta vuelta (Fase 1 técnica)

- `db` — tabla `concierge_settings` (qué sabe y cómo responde el Concierge
  de cada cuenta), aplicada al proyecto Supabase real (`nuku-os`, ya
  conectado). Se sembró una fila real para Kuhane (nombre real, sin datos
  de negocio todavía — los mismos que siguen `[POR CONFIRMAR]` en el sitio).
- `lib/concierge.ts` + `/api/concierge/reply` + `/api/concierge/inbound` —
  el motor de IA real: llama a la API de Anthropic con el prompt armado
  desde los datos de cada cuenta, guarda la conversación en Supabase.
  Genérico: mismo código para cualquier cliente.
- `lib/automations.ts` + `/api/automations/render` — arma el texto de las
  3 automatizaciones que ya se ven en el panel, respetando el interruptor
  on/off de cada cuenta y permitiendo texto personalizado por cliente.
- `n8n-templates/` — los workflows de n8n que conectan lo anterior con
  WhatsApp/Instagram/email en la práctica.

## Qué falta para que esto funcione en producción, hoy mismo

Tres variables de entorno en Vercel (`SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY` — ver `.env.example`) y
conectar al menos un canal real (WhatsApp Business API es la opción más
usada por hostales chicos en Chile) dentro de un workflow de n8n. Sin
credenciales de canal, el motor de IA ya funciona end-to-end si se le
pega directo por HTTP (se puede probar así antes de conectar WhatsApp).
