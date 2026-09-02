import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

// Checkpoint C (Fase 1) — helper del lado del navegador para que cada
// fetch() del panel hacia /api/dashboard/* (y las otras rutas que ahora
// exigen sesión) mande el token real, en vez de solo el account_id. Ver
// lib/auth/require-account.ts para el lado del servidor que lo valida.
export async function authHeader(): Promise<Record<string, string>> {
  const { data } = await getSupabaseBrowserClient().auth.getSession();
  const token = data.session?.access_token;
  return token ? { authorization: `Bearer ${token}` } : {};
}
