import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { renderAutomationMessage } from "@/lib/automations";
import { requireAccountFromRequest, unauthorizedResponseBody } from "@/lib/auth/require-account";

// GET/POST /api/dashboard/reservations
//
// Lo que usa la pantalla Reservas del panel — antes mostraba datos de
// ejemplo (lib/mock-data.ts), ahora lee/escribe la tabla `reservations`
// real de Supabase. El paso importante que agrega esta ruta es el cambio
// de estado: cuando una reserva pasa de "requested" a "confirmed" (el
// equipo la validó por WhatsApp/email), automáticamente arma el texto de
// bienvenida con el mismo motor que usará n8n más adelante — así, aunque
// todavía no hay un envío automático conectado, el equipo ya tiene el
// mensaje listo para copiar y mandar a mano mientras tanto.
//
// Checkpoint C (Fase 1): el account_id ya NO se toma del query string ni
// del body — se resuelve siempre desde la sesión real (ver
// lib/auth/require-account.ts), para que nadie pueda leer/escribir
// reservas de otra cuenta mandando un account_id ajeno.

export async function GET(req: Request) {
  try {
    const { accountId } = await requireAccountFromRequest(req);
    const supabase = getSupabaseServerClient();

    const { data, error } = await supabase
      .from("reservations")
      .select(
        "id, check_in, check_out, status, channel, payment_status, promo_code, total_cents, stripe_payment_link, tour_interest, tour_notes, arrival_flight_time, arrival_flight_number, departure_flight_time, departure_flight_number, airport_transfer_notes, created_at, guests(full_name, email, phone), rooms(name, base_rate_cents), reservation_guests(id, full_name, document_id, is_primary, dietary_vegan, dietary_vegetarian, dietary_celiac, dietary_lactose_free, dietary_other, mobility_assistance, mobility_notes)"
      )
      .eq("account_id", accountId)
      .order("check_in", { ascending: true });

    if (error) throw new Error(error.message);

    const { data: account } = await supabase.from("accounts").select("currency").eq("id", accountId).single();

    return NextResponse.json({ reservations: data ?? [], currency: account?.currency ?? "CLP" });
  } catch (err) {
    console.error("[api/dashboard/reservations GET]", err);
    const { error, status } = unauthorizedResponseBody(err);
    return NextResponse.json({ error }, { status });
  }
}

const VALID_STATUSES = ["requested", "confirmed", "cancelled", "completed"];

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
    status,
    arrival_flight_time,
    arrival_flight_number,
    departure_flight_time,
    departure_flight_number,
    airport_transfer_notes,
  } = (body ?? {}) as Record<string, unknown>;
  if (typeof id !== "string") {
    return NextResponse.json(
      { error: "Falta o es inválido el campo obligatorio: id (string)." },
      { status: 400 }
    );
  }
  if (status !== undefined && typeof status !== "string") {
    return NextResponse.json({ error: "status debe ser un string." }, { status: 400 });
  }
  if (typeof status === "string" && !VALID_STATUSES.includes(status)) {
    return NextResponse.json(
      { error: `status inválido. Debe ser uno de: ${VALID_STATUSES.join(", ")}.` },
      { status: 400 }
    );
  }

  // Además del cambio de estado, esta ruta también deja editar los datos de
  // traslado al aeropuerto (hora/número de vuelo) desde el panel — el
  // huésped puede no haberlos dejado al reservar, o confirmarlos/cambiarlos
  // más cerca de la fecha, y el equipo lo actualiza acá.
  const flightPatch: Record<string, string | null> = {};
  if (typeof arrival_flight_time === "string") flightPatch.arrival_flight_time = arrival_flight_time.trim() || null;
  if (typeof arrival_flight_number === "string")
    flightPatch.arrival_flight_number = arrival_flight_number.trim().toUpperCase() || null;
  if (typeof departure_flight_time === "string")
    flightPatch.departure_flight_time = departure_flight_time.trim() || null;
  if (typeof departure_flight_number === "string")
    flightPatch.departure_flight_number = departure_flight_number.trim().toUpperCase() || null;
  if (typeof airport_transfer_notes === "string")
    flightPatch.airport_transfer_notes = airport_transfer_notes.trim() || null;

  if (status === undefined && Object.keys(flightPatch).length === 0) {
    return NextResponse.json(
      { error: "No hay nada para actualizar: manda status y/o los campos de traslado al aeropuerto." },
      { status: 400 }
    );
  }

  try {
    const supabase = getSupabaseServerClient();
    const updatePayload: Record<string, unknown> = { ...flightPatch };
    if (typeof status === "string") updatePayload.status = status;

    const { error } = await supabase
      .from("reservations")
      .update(updatePayload)
      .eq("id", id)
      .eq("account_id", accountId); // doble filtro: nunca tocar una fila de otra cuenta

    if (error) throw new Error(error.message);

    // Al confirmar, armamos el mensaje de bienvenida ya mismo (mismo motor
    // que usará n8n) para que el equipo lo pueda copiar y mandar a mano
    // mientras el envío automático todavía no está conectado. Si algo
    // falla acá (automatización apagada, sin plantilla, etc.) no rompe el
    // cambio de estado — el status ya quedó guardado igual.
    let welcomeMessage: string | null = null;
    if (status === "confirmed") {
      try {
        const rendered = await renderAutomationMessage({
          accountId,
          templateKey: "bienvenida_reserva",
          reservationId: id,
        });
        if (!rendered.skipped) welcomeMessage = rendered.message ?? null;
      } catch (renderErr) {
        console.error("[api/dashboard/reservations POST] no se pudo armar el mensaje de bienvenida", renderErr);
      }
    }

    return NextResponse.json({ ok: true, welcome_message: welcomeMessage });
  } catch (err) {
    console.error("[api/dashboard/reservations POST]", err);
    const { error, status: statusCode } = unauthorizedResponseBody(err);
    return NextResponse.json({ error }, { status: statusCode });
  }
}
