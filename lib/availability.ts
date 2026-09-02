import { getSupabaseServerClient } from "@/lib/supabase/server";

// Fase 1, Checkpoint E — capa única y reutilizable para responder "¿está
// disponible esta habitación estas fechas?". Pensada para que la usen
// /api/reservations/request (ya lo hace), y más adelante Calendario, el
// Concierge IA (como tool real, para no inventar disponibilidad) y
// cualquier "crear reserva manual" que se agregue al panel — en vez de
// que cada lugar reimplemente su propia versión del chequeo.
//
// Esto es SOLO la capa de aplicación: da una respuesta rápida y un
// mensaje de error amigable en el caso común. La garantía real contra
// condiciones de carrera es la exclusion constraint `reservations_no_overlap`
// en la base (ver migración add_reservations_no_overlap_exclusion) — si dos
// solicitudes casi simultáneas pasan ambas este chequeo, la base frena a la
// segunda igual. Ver isOverlapConstraintError() para ese caso.

export type AvailabilityParams = {
  accountId: string;
  roomId: string;
  checkIn: string; // "YYYY-MM-DD"
  checkOut: string; // "YYYY-MM-DD"
  // Al editar una reserva existente (ej. cambiar fechas desde el panel),
  // para que no choque consigo misma.
  excludeReservationId?: string;
};

export type AvailabilityResult =
  | { available: true }
  | {
      available: false;
      conflictingReservationId: string;
      conflictingCheckIn: string;
      conflictingCheckOut: string;
    };

// Mismos estados que "ocupan" la habitación en la exclusion constraint de
// la base — deben mantenerse sincronizados. 'requested' ocupa a propósito
// (decisión documentada en FASE1_CHECKPOINT_D_DISENO_DISPONIBILIDAD.md):
// una solicitud sin confirmar todavía bloquea el calendario, para que no
// se acepten dos solicitudes de las mismas fechas.
const OCCUPYING_STATUSES = ["requested", "confirmed"] as const;

export async function checkAvailability(params: AvailabilityParams): Promise<AvailabilityResult> {
  const { accountId, roomId, checkIn, checkOut, excludeReservationId } = params;
  const supabase = getSupabaseServerClient();

  // Misma condición de conflicto ya acordada: nueva.check_in < existente.
  // check_out AND nueva.check_out > existente.check_in.
  let query = supabase
    .from("reservations")
    .select("id, check_in, check_out")
    .eq("account_id", accountId)
    .eq("room_id", roomId)
    .in("status", OCCUPYING_STATUSES)
    .lt("check_in", checkOut)
    .gt("check_out", checkIn)
    .limit(1);

  if (excludeReservationId) {
    query = query.neq("id", excludeReservationId);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  if (data && data.length > 0) {
    return {
      available: false,
      conflictingReservationId: data[0].id,
      conflictingCheckIn: data[0].check_in,
      conflictingCheckOut: data[0].check_out,
    };
  }

  return { available: true };
}

// SQLSTATE 23P01 = exclusion_violation. Es lo que devuelve Postgres cuando
// la constraint reservations_no_overlap frena un insert/update — el caso
// de la condición de carrera que checkAvailability() por sí sola no puede
// atrapar (dos solicitudes casi simultáneas, ambas pasan el chequeo antes
// de que cualquiera termine de escribir).
export function isOverlapConstraintError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  return code === "23P01";
}
