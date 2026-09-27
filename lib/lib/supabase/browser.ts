import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Cliente de Supabase para el NAVEGADOR — usa la clave pública (anon), la
// única autorizada para vivir en código de cliente. Se usa exclusivamente
// para Supabase Auth (login, registro, sesión). Las lecturas y escrituras
// de datos de negocio siguen pasando por las rutas /api/dashboard/* del
// servidor, que usan la service role key y filtran por account_id a mano
// (ver lib/supabase/server.ts) — este cliente nunca consulta tablas
// directamente.
//
// Variables de entorno requeridas (públicas, se configuran en Vercel):
//   NEXT_PUBLIC_SUPABASE_URL
//   NEXT_PUBLIC_SUPABASE_ANON_KEY

let cached: SupabaseClient | null = null;

export function getSupabaseBrowserClient(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Faltan las variables de entorno NEXT_PUBLIC_SUPABASE_URL y/o NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
        "Se configuran en Vercel (Project Settings → Environment Variables), no en el código."
    );
  }

  cached = createClient(url, anonKey);
  return cached;
}
