import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Cliente de Supabase para uso EXCLUSIVO del lado del servidor (rutas API,
// nunca componentes de cliente). Usa la service role key, que salta las
// políticas de RLS — por eso cada función que la use debe filtrar siempre
// por account_id a mano, tal como hacen las políticas RLS para el resto de
// la app. Nunca importar este archivo desde un componente "use client".
//
// Variables de entorno requeridas (se configuran en Vercel, no en el
// código — así el mismo build sirve para cualquier cliente nuevo):
//   SUPABASE_URL              → Project URL del proyecto Supabase
//   SUPABASE_SERVICE_ROLE_KEY → service_role key (Settings → API)

let cached: SupabaseClient | null = null;

export function getSupabaseServerClient(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "Faltan las variables de entorno SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY. " +
        "Se configuran en Vercel (Project Settings → Environment Variables), no en el código."
    );
  }

  cached = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
