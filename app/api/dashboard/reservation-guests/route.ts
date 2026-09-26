import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { requireAccountFromRequest, unauthorizedResponseBody } from "@/lib/auth/require-account";

// POST /api/dashboard/reservation-guests
//
// Deja editar, desde el panel, los datos de una persona ya guardada en
// `reservation_guests` (nombre, RUT/pasaporte, nacionalidad, fecha de
// nacimiento, teléfono, email, preferencias de desayuno, asistencia de
// movilidad) y también AGREGAR una persona nueva a una reserva que declaró
// más huéspedes de los que se cargaron uno por uno todavía. Existe porque
// no todas las reservas entran por /reservar (formulario público): las que
// llegan por Booking, Airbnb o directo por WhatsApp/teléfono no pasan por
// ese formulario, así que el equipo necesita poder cargar estos datos a
// mano una vez que confirma la reserva.
//
// Checkpoint C (Fase 1): el account_id se resuelve desde la sesión real,
// no desde el body — ver lib/auth/require-account.ts.
//
// body (editar, con "id"): {
//   id (reservation_guests.id),
//   full_name?, document_id?, nationality?, birth_date?, phone?, email?: string,
//   dietary_vegan?, dietary_vegetarian?, dietary_celiac?, dietary_lactose_free?: boolean,
//   dietary_other?: string,
//   mobility_assistance?: boolean,
//   mobility_notes?: string,
// }
//
// body (agregar, sin "id"): {
//   reservation_id, full_name (obligatorios),
//   document_id?, nationality?, birth_date?, phone?, email?: string,
//   is_primary?: boolean,
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

  const payload = (body ?? {}) as Record<string, unknown>;

  if (typeof payload.id !== "string") {
    return createReservationGuest(accountId, payload);
  }
  return updateReservationGuest(accountId, payload);
}

// 26/9/2026: pedido de Andre — si la reserva dice, por ejemplo, 3 huéspedes,
// poder agregar los datos de cada uno de a poco (no solo el titular). Se
// valida que la reserva sea de esta cuenta antes de insertar.
async function createReservationGuest(accountId: string, payload: Record<string, unknown>) {
  const { reservation_id, full_name, document_id, nationality, birth_date, phone, email, is_primary } = payload;

  if (typeof reservation_id !== "string" || typeof full_name !== "string" || !full_name.trim()) {
    return NextResponse.json(
      { error: "Faltan o son inválidos los campos obligatorios: reservation_id y full_name." },
      { status: 400 }
    );
  }

  try {
    const supabase = getSupabaseServerClient();

    const { data: reservation, error: resError } = await supabase
      .from("reservations")
      .select("id")
      .eq("id", reservation_id)
      .eq("account_id", accountId)
      .maybeSingle();
    if (resError) throw new Error(resError.message);
    if (!reservation) {
      return NextResponse.json({ error: "La reserva no existe o no pertenece a esta cuenta." }, { status: 404 });
    }

    const { data: created, error } = await supabase
      .from("reservation_guests")
      .insert({
        account_id: accountId,
        reservation_id,
        full_name: full_name.trim(),
        document_id: typeof document_id === "string" && document_id.trim() ? document_id.trim() : null,
        nationality: typeof nationality === "string" && nationality.trim() ? nationality.trim() : null,
        birth_date: typeof birth_date === "string" && birth_date.trim() ? birth_date.trim() : null,
        phone: typeof phone === "string" && phone.trim() ? phone.trim() : null,
        email: typeof email === "string" && email.trim() ? email.trim() : null,
        is_primary: is_primary === true,
      })
      .select(
        "id, full_name, document_id, nationality, birth_date, phone, email, is_primary, dietary_vegan, dietary_vegetarian, dietary_celiac, dietary_lactose_free, dietary_other, mobility_assistance, mobility_notes"
      )
      .single();
    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true, guest: created });
  } catch (err) {
    console.error("[api/dashboard/reservation-guests POST create]", err);
    const { error, status } = unauthorizedResponseBody(err);
    return NextResponse.json({ error }, { status });
  }
}

async function updateReservationGuest(accountId: string, payload: Record<string, unknown>) {
  const {
    id,
    full_name,
    document_id,
    nationality,
    birth_date,
    phone,
    email,
    dietary_vegan,
    dietary_vegetarian,
    dietary_celiac,
    dietary_lactose_free,
    dietary_other,
    mobility_assistance,
    mobility_notes,
  } = payload;

  if (typeof id !== "string") {
    return NextResponse.json(
      { error: "Falta o es inválido el campo obligatorio: id (string)." },
      { status: 400 }
    );
  }

  const patch: Record<string, boolean | string | null> = {};
  // 26/9/2026: antes esta ruta solo dejaba tocar dieta/movilidad — ahora
  // también deja corregir los datos básicos de la persona (nombre,
  // identificación, etc.), parte del botón "Editar" de toda la ficha.
  if (typeof full_name === "string" && full_name.trim()) patch.full_name = full_name.trim();
  if (typeof document_id === "string") patch.document_id = document_id.trim() || null;
  if (typeof nationality === "string") patch.nationality = nationality.trim() || null;
  if (typeof birth_date === "string") patch.birth_date = birth_date.trim() || null;
  if (typeof phone === "string") patch.phone = phone.trim() || null;
  if (typeof email === "string") patch.email = email.trim() || null;
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
    console.error("[api/dashboard/reservation-guests POST update]", err);
    const { error, status } = unauthorizedResponseBody(err);
    return NextResponse.json({ error }, { status });
  }
}
