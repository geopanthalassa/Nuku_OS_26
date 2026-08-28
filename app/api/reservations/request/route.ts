import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

// POST /api/reservations/request
//
// Lo que dispara el botón "Solicitar esta habitación" en /reservar. Fase 0:
// no cobra ni confirma nada — crea el huésped (si no existía) y una fila en
// `reservations` con status "requested", para que quede un registro real en
// vez de perderse en el aire como pasaba antes. El equipo de Kuhane confirma
// a mano por WhatsApp/email y en ese momento cambia el status a "confirmed"
// (eso dispara, más adelante, la automatización de bienvenida vía n8n).
//
// body: {
//   account_id, room_id, check_in, check_out,
//   guest: { full_name, email?, phone?, birth_date? },
//   promo_code?
// }
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  const { account_id, room_id, check_in, check_out, guest, promo_code } = (body ?? {}) as Record<string, unknown>;

  if (
    typeof account_id !== "string" ||
    typeof room_id !== "string" ||
    typeof check_in !== "string" ||
    typeof check_out !== "string" ||
    typeof guest !== "object" ||
    guest === null
  ) {
    return NextResponse.json(
      {
        error:
          "Faltan o son inválidos los campos obligatorios: account_id, room_id, check_in, check_out (strings) y guest (objeto).",
      },
      { status: 400 }
    );
  }

  const guestInfo = guest as { full_name?: string; email?: string; phone?: string; birth_date?: string };
  if (!guestInfo.full_name || typeof guestInfo.full_name !== "string") {
    return NextResponse.json({ error: "Falta guest.full_name." }, { status: 400 });
  }

  try {
    const supabase = getSupabaseServerClient();

    // Buscar huésped existente por email o teléfono dentro de la cuenta;
    // si no existe, crearlo. Si existe pero mandó una fecha de nacimiento
    // nueva y antes no la tenía, se la completamos.
    let guestId: string;
    const filters = [
      guestInfo.email ? `email.eq.${guestInfo.email}` : null,
      guestInfo.phone ? `phone.eq.${guestInfo.phone}` : null,
    ].filter(Boolean) as string[];

    let existingGuest = null;
    if (filters.length > 0) {
      const { data } = await supabase
        .from("guests")
        .select("id, birth_date")
        .eq("account_id", account_id)
        .or(filters.join(","))
        .maybeSingle();
      existingGuest = data;
    }

    if (existingGuest) {
      guestId = existingGuest.id;
      if (!existingGuest.birth_date && guestInfo.birth_date) {
        await supabase.from("guests").update({ birth_date: guestInfo.birth_date }).eq("id", guestId);
      }
    } else {
      const { data: created, error } = await supabase
        .from("guests")
        .insert({
          account_id,
          full_name: guestInfo.full_name,
          email: guestInfo.email || null,
          phone: guestInfo.phone || null,
          birth_date: guestInfo.birth_date || null,
          source: "web",
        })
        .select("id")
        .single();
      if (error) throw new Error(`No se pudo crear el huésped: ${error.message}`);
      guestId = created.id;
    }

    const { data: reservation, error: resError } = await supabase
      .from("reservations")
      .insert({
        account_id,
        room_id,
        guest_id: guestId,
        check_in,
        check_out,
        status: "requested",
        channel: "direct",
        payment_status: "pending",
        promo_code: typeof promo_code === "string" && promo_code.trim() ? promo_code.trim().toUpperCase() : null,
      })
      .select("id")
      .single();

    if (resError) throw new Error(`No se pudo crear la solicitud de reserva: ${resError.message}`);

    return NextResponse.json({ reservation_id: reservation.id, guest_id: guestId });
  } catch (err) {
    console.error("[api/reservations/request]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error desconocido" },
      { status: 500 }
    );
  }
}
