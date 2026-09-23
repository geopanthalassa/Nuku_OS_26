import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

// GET /api/public/rooms?account_id=...&check_in=YYYY-MM-DD&check_out=YYYY-MM-DD
// Endpoint público (lo llama la página /reservar, sin login) — expone solo
// lo que un visitante necesita ver para pedir una habitación: nombre,
// capacidad y tarifa. Nada de datos de huéspedes ni de otras cuentas.
//
// check_in/check_out (opcionales): pedido de Andre (23/9/2026) — "cuando
// las habitaciones estan ocupadas para ciertas fechas nisiquiera deberian
// aparecer para reservar, no deben ser una opcion". Antes esta ruta
// devolvía siempre TODAS las habitaciones de la cuenta y la disponibilidad
// recién se chequeaba al enviar el formulario. Ahora, si vienen ambas
// fechas, se excluyen acá mismo las habitaciones que ya tengan una reserva
// "requested" o "confirmed" que se cruce con ese rango — mismo criterio de
// choque que checkAvailability() (lib/availability.ts), reimplementado acá
// como una sola consulta para no hacer N llamadas (una por habitación).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const accountId = url.searchParams.get("account_id");
  const checkIn = url.searchParams.get("check_in");
  const checkOut = url.searchParams.get("check_out");
  if (!accountId) {
    return NextResponse.json({ error: "Falta el parámetro account_id." }, { status: 400 });
  }

  try {
    const supabase = getSupabaseServerClient();
    const { data: rooms, error } = await supabase
      .from("rooms")
      .select("id, name, capacity, base_rate_cents")
      .eq("account_id", accountId)
      .order("name", { ascending: true });

    if (error) throw new Error(error.message);

    let availableRooms = rooms ?? [];

    if (checkIn && checkOut && checkOut > checkIn) {
      const { data: overlapping, error: overlapError } = await supabase
        .from("reservations")
        .select("room_id")
        .eq("account_id", accountId)
        .in("status", ["requested", "confirmed"])
        .lt("check_in", checkOut)
        .gt("check_out", checkIn);

      if (overlapError) throw new Error(overlapError.message);

      const occupiedRoomIds = new Set((overlapping ?? []).map((r) => r.room_id));
      availableRooms = availableRooms.filter((r) => !occupiedRoomIds.has(r.id));
    }

    const { data: account } = await supabase.from("accounts").select("currency").eq("id", accountId).maybeSingle();

    return NextResponse.json({ rooms: availableRooms, currency: account?.currency ?? "CLP" });
  } catch (err) {
    console.error("[api/public/rooms]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error desconocido" },
      { status: 500 }
    );
  }
}
