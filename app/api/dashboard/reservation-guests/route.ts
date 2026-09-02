import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { requireAccountFromRequest, unauthorizedResponseBody } from "@/lib/auth/require-account";

// POST /api/dashboard/reservation-guests
//
// Deja editar, desde el panel, las preferencias de desayuno (vegano,
// vegetariano, celíaco, sin lactosa, otra) y la asistencia de movilidad de
// una persona ya guardada en `reservation_guests`. Existe porque no todas
// las reservas entran por /reservar (formulario público): las que llegan
// por Booking, Airbnb o directo por WhatsApp/teléfono no pasan por ese
// formulario, así que el equipo necesita poder cargar estos datos a mano
// una vez que confirma la reserva.
//
// Checkpoint C (Fase 1): el account_id se resuelve desde la sesión real,
// no desde el body — ver lib/auth/require-account.ts.
//
// body: {
//   id (reservation_guests.id),
//   dietary_vegan?, dietary_vegetarian?, dietary_celiac?, dietary_lactose_free?: boolean,
//   dietary_other?: string,
//   mobility_assistance?: boolean,
//   mobility_notes?: string,
// }
export async function POST(req: Request) {
  let accountId: string;
  try {
    accountId = (await requireAccountFromRequest(req)).accountId;
  } catch (err) {
    const { error, status } = unauthorizedResponseBody(err);
    return NextResponse.json({ error }, { status });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  const {
    id,
    dietary_vegan,
    dietary_vegetarian,
    dietary_celiac,
    dietary_lactose_free,
    dietary_other,
    mobility_assistance,
    mobility_notes,
  } = (body ?? {}) as Record<string, unknown>;

  if (typeof id !== "string") {
    return NextResponse.json(
      { error: "Falta o es inválido el campo obligatorio: id (string)." },
      { status: 400 }
    );
  }

  const patch: Record<string, boolean | string | null> = {};
  if (typeof dietary_vegan === "boolean") patch.dietary_vegan = dietary_vegan;
  if (typeof dietary_vegetarian === "boolean") patch.dietary_vegetarian = dietary_vegetarian;
  if (typeof dietary_celiac === "boolean") patch.dietary_celiac = dietary_celiac;
  if (typeof dietary_lactose_free === "boolean") patch.dietary_lactose_free = dietary_lactose_free;
  if (typeof dietary_other === "string") patch.dietary_other = dietary_other.trim() || null;
  if (typeof mobility_assistance === "boolean") patch.mobility_assistance = mobility_assistance;
  if (typeof mobility_notes === "string") patch.mobility_notes = mobility_notes.trim() || null;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No hay nada para actualizar." }, { status: 400 });
  }

  try {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase
      .from("reservation_guests")
      .update(patch)
      .eq("id", id)
      .eq("account_id", accountId); // doble filtro: nunca tocar una fila de otra cuenta

    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/dashboard/reservation-guests POST]", err);
    const { error, status } = unauthorizedResponseBody(err);
    return NextResponse.json({ error }, { status });
  }
}
