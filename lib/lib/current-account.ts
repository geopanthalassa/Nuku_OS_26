// FASE 0 — TEMPORAL. Todavía no hay login real (Supabase Auth) conectado
// al panel, así que no hay forma de saber "qué cuenta es la que está mirando
// esta persona" a partir de una sesión. Mientras tanto, el panel entero
// apunta siempre a la cuenta de Kuhane (la única que existe hoy en
// Supabase). Esto es lo único hardcodeado a Kuhane en todo el código del
// panel — el resto (componentes, endpoints, lib/concierge.ts,
// lib/automations.ts) es genérico y ya funciona para cualquier account_id.
//
// Cuando se conecte Supabase Auth (ver ONBOARDING.md, sección 3), este
// archivo deja de existir y el account_id sale de la sesión del usuario
// logueado — no hay que tocar nada más.
export const CURRENT_ACCOUNT_ID = "057a625c-9036-4b1d-957b-8c436f71b4cd";
