import { getSupabaseServerClient } from "@/lib/supabase/server";

// 23/9/2026: capa única y reutilizable para "¿este correo/teléfono ya
// pertenece a un huésped registrado?" — pensada para que la usen
// /api/reservations/request (formulario público) y
// /api/dashboard/reservations (botón "+ Nueva reserva" del panel), que
// antes tenían cada uno su propia copia de esta lógica.
//
// Antes de este cambio, si alguien reservaba con un correo o teléfono que
// ya existía en `guests`, el sistema reutilizaba ese huésped en silencio
// SIN actualizar el nombre — así que una reserva nueva a nombre de "Pedro"
// podía terminar mostrándose como "Maria" en el panel si compartía el
// teléfono con una reserva anterior de Maria. Andre lo detectó probando
// (23/9/2026) y pidió que en vez de mezclarlos en silencio, el sistema
// avise con un error claro — "este correo/teléfono ya está registrado a
// nombre de otro huésped" — para que el equipo (o el propio huésped en el
// formulario público) decida si es la misma persona (y ponga el mismo
// nombre) o es alguien distinto (y use otro dato de contacto).
//
// Se considera "el mismo huésped" cuando el nombre coincide (sin importar
// mayúsculas/minúsculas ni espacios de más) — no exige tilde exacta ni
// nombre completo idéntico carácter por carácter, para no ser demasiado
// estricto con alguien que reserva de nuevo y tipea su nombre un poco
// distinto.
const normalizeName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export type GuestMatchResult =
  | { kind: "new" }
  | {
      kind: "existing";
      guestId: string;
      birthDate: string | null;
      documentId: string | null;
      nationality: string | null;
    }
  | { kind: "conflict"; existingName: string; matchedBy: "email" | "phone" | "email_and_phone" };

export async function findMatchingGuest(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  accountId: string,
  fullName: string,
  email?: string | null,
  phone?: string | null
): Promise<GuestMatchResult> {
  const filters = [email ? `email.eq.${email}` : null, phone ? `phone.eq.${phone}` : null].filter(
    Boolean
  ) as string[];

  if (filters.length === 0) return { kind: "new" };

  const { data } = await supabase
    .from("guests")
    .select("id, full_name, email, phone, birth_date, document_id, nationality")
    .eq("account_id", accountId)
    .or(filters.join(","))
    .maybeSingle();

  if (!data) return { kind: "new" };

  if (normalizeName(data.full_name) !== normalizeName(fullName)) {
    const emailMatches = Boolean(email) && data.email === email;
    const phoneMatches = Boolean(phone) && data.phone === phone;
    const matchedBy = emailMatches && phoneMatches ? "email_and_phone" : emailMatches ? "email" : "phone";
    return { kind: "conflict", existingName: data.full_name, matchedBy };
  }

  return {
    kind: "existing",
    guestId: data.id,
    birthDate: data.birth_date,
    documentId: data.document_id,
    nationality: data.nationality,
  };
}

// Mensaje de error listo para devolver tal cual en la respuesta de la API
// — lo usan las dos rutas para no repetir el texto.
export function guestConflictMessage(existingName: string, matchedBy: "email" | "phone" | "email_and_phone") {
  const fieldLabel =
    matchedBy === "email" ? "Este correo" : matchedBy === "phone" ? "Este teléfono" : "Este correo y teléfono";
  return `${fieldLabel} ya está registrado a nombre de ${existingName}. Si es la misma persona, escribe el nombre igual; si es otra persona, usa un correo o teléfono distinto.`;
}
