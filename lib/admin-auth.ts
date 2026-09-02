// Fase 1 — el login real vive en Supabase Auth (ver app/login/page.tsx,
// app/registro/page.tsx y components/admin/AdminGate.tsx). Este archivo
// hasta hace poco tenía un usuario y clave fijos comparados en el
// cliente, con la sesión guardada en localStorage — eso NO era seguridad
// real, y ya no existe. Ahora solo queda como wrapper de logout para no
// tocar todos los imports existentes.
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

export async function logout(): Promise<void> {
  await getSupabaseBrowserClient().auth.signOut();
}
