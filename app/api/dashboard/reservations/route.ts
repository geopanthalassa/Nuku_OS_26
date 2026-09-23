import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { renderAutomationMessage } from "@/lib/automations";
import { checkAvailability, isOverlapConstraintError } from "@/lib/availability";
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
//
// Reservas manuales (nuevo): hasta ahora la ÚNICA forma de crear una fila
// en `reservations` era /api/reservations/request (el formulario público
// /reservar). Eso significa que una reserva por teléfono, WhatsApp,
// Booking.com o Airbnb, o un walk-in, no quedaba registrada en ningún
// lado — Andre lo detectó él mismo (7/9/2026: "no hay ningún espacio para
// reservar manualmente a los clientes, solo automatizado"). Esta ruta
// ahora también crea reservas: si el POST no trae "id", se interpreta
// como una reserva nueva en vez de una actualización. Reutiliza las
// mismas dos piezas que ya protegen /api/reservations/request contra
// choques de fechas: checkAvailability() (chequeo rápido, con mensaje
// amigable) y la exclusion constraint reservations_no_overlap de la base
// (garantía real, ver isOverlapConstraintError()).

export async function GET(req: Request) {
  try {
    const { accountId } = await requireAccountFromRequest(req);
    const supabase = getSupabaseServerClient();

    const { data, error } = await supabase
      .from("reservations")
      .select(
        "id, guest_id, check_in, check_out, status, channel, payment_status, promo_code, total_cents, stripe_payment_link, tour_interest, tour_notes, arrival_flight_time, arrival_flight_number, departure_flight_time, departure_flight_number, airport_transfer_notes, created_at, guests(full_name, email, phone), rooms(name, base_rate_cents), reservation_guests(id, full_name, document_id, nationality, is_primary, dietary_vegan, dietary_vegetarian, dietary_celiac, dietary_lactose_free, dietary_other, mobility_assistance, mobility_notes)"
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
const VALID_PAYMENT_STATUSES = ["pending", "paid", "refunded"];

// Canales que puede elegir el equipo al cargar una reserva a mano. "direct"
// queda afuera a propósito: esa es la que crea sola /api/reservations/request
// cuando alguien reserva por la página pública — si el equipo la usara acá
// también, dos reservas idénticas en canal dejarían de distinguirse.
const MANUAL_CHANNELS = ["phone", "whatsapp", "booking", "airbnb", "walk_in", "other"];

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

  // Sin "id": se está creando una reserva nueva a mano. Con "id": se está
  // actualizando una existente (comportamiento de siempre).
  if (typeof payload.id !== "string") {
    return createReservation(accountId, payload);
  }

  return updateReservation(accountId, payload);
}

async function updateReservation(accountId: string, payload: Record<string, unknown>) {
  const {
    id,
    status,
    arrival_flight_time,
    arrival_flight_number,
    departure_flight_time,
    departure_flight_number,
    airport_transfer_notes,
  } = payload;
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

async function createReservation(accountId: string, payload: Record<string, unknown>) {
  const {
    room_id,
    check_in,
    check_out,
    channel,
    status,
    payment_status,
    total_cents,
    promo_code,
    tour_interest,
    tour_notes,
    arrival_flight_time,
    arrival_flight_number,
    departure_flight_time,
    departure_flight_number,
    airport_transfer_notes,
    guest,
  } = payload;

  if (
    typeof room_id !== "string" ||
    typeof check_in !== "string" ||
    typeof check_out !== "string" ||
    typeof channel !== "string" ||
    typeof guest !== "object" ||
    guest === null
  ) {
    return NextResponse.json(
      {
        error:
          "Faltan o son inválidos los campos obligatorios: room_id, check_in, check_out, channel (strings) y guest (objeto).",
      },
      { status: 400 }
    );
  }

  if (!MANUAL_CHANNELS.includes(channel)) {
    return NextResponse.json(
      { error: `channel inválido. Debe ser uno de: ${MANUAL_CHANNELS.join(", ")}.` },
      { status: 400 }
    );
  }

  if (check_out <= check_in) {
    return NextResponse.json({ error: "check_out debe ser posterior a check_in." }, { status: 400 });
  }

  const resolvedStatus = typeof status === "string" && status.trim() ? status.trim() : "confirmed";
  if (!VALID_STATUSES.includes(resolvedStatus)) {
    return NextResponse.json(
      { error: `status inválido. Debe ser uno de: ${VALID_STATUSES.join(", ")}.` },
      { status: 400 }
    );
  }

  const resolvedPaymentStatus =
    typeof payment_status === "string" && payment_status.trim() ? payment_status.trim() : "pending";
  if (!VALID_PAYMENT_STATUSES.includes(resolvedPaymentStatus)) {
    return NextResponse.json(
      { error: `payment_status inválido. Debe ser uno de: ${VALID_PAYMENT_STATUSES.join(", ")}.` },
      { status: 400 }
    );
  }

  const guestInfo = guest as {
    full_name?: string;
    email?: string;
    phone?: string;
    birth_date?: string;
    document_id?: string;
    nationality?: string;
  };
  if (!guestInfo.full_name || typeof guestInfo.full_name !== "string" || !guestInfo.full_name.trim()) {
    return NextResponse.json({ error: "Falta guest.full_name." }, { status: 400 });
  }

  let totalCentsInput: number | null = null;
  if (total_cents !== undefined && total_cents !== null && total_cents !== "") {
    const n = Number(total_cents);
    if (!Number.isFinite(n) || n < 0) {
      return NextResponse.json({ error: "total_cents debe ser un número mayor o igual a 0." }, { status: 400 });
    }
    totalCentsInput = Math.round(n);
  }

  try {
    const supabase = getSupabaseServerClient();

    // La habitación tiene que ser de esta cuenta — igual que reservations,
    // el filtro es a mano porque este cliente usa la service role key (ver
    // lib/supabase/server.ts), que salta RLS.
    const { data: room, error: roomError } = await supabase
      .from("rooms")
      .select("id, base_rate_cents")
      .eq("id", room_id)
      .eq("account_id", accountId)
      .maybeSingle();
    if (roomError) throw new Error(roomError.message);
    if (!room) {
      return NextResponse.json({ error: "La habitación no existe o no pertenece a esta cuenta." }, { status: 400 });
    }

    // Mismo chequeo rápido que usa el formulario público antes de crear
    // nada — la garantía real contra condiciones de carrera es la
    // exclusion constraint de la base (ver el catch del insert, abajo).
    if (resolvedStatus === "requested" || resolvedStatus === "confirmed") {
      const availability = await checkAvailability({ accountId, roomId: room_id, checkIn: check_in, checkOut: check_out });
      if (!availability.available) {
        return NextResponse.json(
          { error: "Esa habitación ya está reservada para esas fechas. Revisa el calendario o elige otras fechas." },
          { status: 409 }
        );
      }
    }

    // Buscar huésped existente por email o teléfono dentro de la cuenta;
    // si no existe, crearlo. Si existe pero mandó datos nuevos que antes no
    // tenía (fecha de nacimiento, identificación), se los completamos —
    // mismo patrón que /api/reservations/request.
    let guestId: string;
    const filters = [
      guestInfo.email ? `email.eq.${guestInfo.email}` : null,
      guestInfo.phone ? `phone.eq.${guestInfo.phone}` : null,
    ].filter(Boolean) as string[];

    let existingGuest: {
      id: string;
      birth_date: string | null;
      document_id: string | null;
      nationality: string | null;
    } | null = null;
    if (filters.length > 0) {
      const { data } = await supabase
        .from("guests")
        .select("id, birth_date, document_id, nationality")
        .eq("account_id", accountId)
        .or(filters.join(","))
        .maybeSingle();
      existingGuest = data;
    }

    if (existingGuest) {
      guestId = existingGuest.id;
      const patch: Record<string, string> = {};
      if (!existingGuest.birth_date && guestInfo.birth_date) patch.birth_date = guestInfo.birth_date;
      if (!existingGuest.document_id && guestInfo.document_id) patch.document_id = guestInfo.document_id;
      if (!existingGuest.nationality && guestInfo.nationality) patch.nationality = guestInfo.nationality;
      if (Object.keys(patch).length > 0) {
        await supabase.from("guests").update(patch).eq("id", guestId);
      }
    } else {
      const { data: created, error } = await supabase
        .from("guests")
        .insert({
          account_id: accountId,
          full_name: guestInfo.full_name.trim(),
          email: guestInfo.email || null,
          phone: guestInfo.phone || null,
          birth_date: guestInfo.birth_date || null,
          document_id: guestInfo.document_id || null,
          nationality: guestInfo.nationality || null,
          source: channel,
        })
        .select("id")
        .single();
      if (error) throw new Error(`No se pudo crear el huésped: ${error.message}`);
      guestId = created.id;
    }

    // Si no mandaron un monto, lo estimamos con noches × tarifa de la
    // habitación (cuando hay tarifa cargada) — igual que el resto del panel,
    // queda editable después desde "Cobrar". Sin tarifa cargada, queda en
    // null ([POR CONFIRMAR]) en vez de inventar un precio.
    let totalCents = totalCentsInput;
    if (totalCents === null && room.base_rate_cents != null) {
      const n = Math.round((new Date(check_out).getTime() - new Date(check_in).getTime()) / (1000 * 60 * 60 * 24));
      if (n > 0) totalCents = room.base_rate_cents * n;
    }

    const { data: reservation, error: resError } = await supabase
      .from("reservations")
      .insert({
        account_id: accountId,
        room_id,
        guest_id: guestId,
        check_in,
        check_out,
        status: resolvedStatus,
        channel,
        payment_status: resolvedPaymentStatus,
        total_cents: totalCents,
        promo_code: typeof promo_code === "string" && promo_code.trim() ? promo_code.trim().toUpperCase() : null,
        tour_interest: tour_interest === true,
        tour_notes: typeof tour_notes === "string" && tour_notes.trim() ? tour_notes.trim() : null,
        arrival_flight_time:
          typeof arrival_flight_time === "string" && arrival_flight_time.trim() ? arrival_flight_time.trim() : null,
        arrival_flight_number:
          typeof arrival_flight_number === "string" && arrival_flight_number.trim()
            ? arrival_flight_number.trim().toUpperCase()
            : null,
        departure_flight_time:
          typeof departure_flight_time === "string" && departure_flight_time.trim()
            ? departure_flight_time.trim()
            : null,
        departure_flight_number:
          typeof departure_flight_number === "string" && departure_flight_number.trim()
            ? departure_flight_number.trim().toUpperCase()
            : null,
        airport_transfer_notes:
          typeof airport_transfer_notes === "string" && airport_transfer_notes.trim()
            ? airport_transfer_notes.trim()
            : null,
      })
      .select("id")
      .single();

    if (resError) {
      // Condición de carrera: alguien más reservó estas mismas fechas entre
      // el checkAvailability() de arriba y este insert. La exclusion
      // constraint reservations_no_overlap es la que realmente lo frenó —
      // acá solo lo traducimos a un mensaje claro (mismo patrón que
      // /api/reservations/request).
      if (isOverlapConstraintError(resError)) {
        return NextResponse.json(
          {
            error:
              "Esa habitación se acaba de reservar para esas fechas (alguien más la tomó justo antes). Revisa el calendario e intenta de nuevo.",
          },
          { status: 409 }
        );
      }
      throw new Error(`No se pudo crear la reserva: ${resError.message}`);
    }

    // Registrar al titular en reservation_guests — los mismos datos que
    // Kuhane necesita declarar para el ingreso a Rapa Nui. Si esto falla no
    // revertimos la reserva (ya quedó guardada, que es lo importante), solo
    // lo dejamos en el log para completar a mano después.
    const { error: guestsError } = await supabase.from("reservation_guests").insert({
      account_id: accountId,
      reservation_id: reservation.id,
      full_name: guestInfo.full_name.trim(),
      document_id: guestInfo.document_id || null,
      nationality: guestInfo.nationality || null,
      birth_date: guestInfo.birth_date || null,
      phone: guestInfo.phone || null,
      email: guestInfo.email || null,
      is_primary: true,
    });
    if (guestsError) {
      console.error("[api/dashboard/reservations POST create] no se pudo guardar el titular en reservation_guests", guestsError);
    }

    // Igual que al confirmar una reserva existente: si nace ya "confirmed",
    // armamos de una vez el mensaje de bienvenida para copiar y mandar.
    let welcomeMessage: string | null = null;
    if (resolvedStatus === "confirmed") {
      try {
        const rendered = await renderAutomationMessage({
          accountId,
          templateKey: "bienvenida_reserva",
          reservationId: reservation.id,
        });
        if (!rendered.skipped) welcomeMessage = rendered.message ?? null;
      } catch (renderErr) {
        console.error("[api/dashboard/reservations POST create] no se pudo armar el mensaje de bienvenida", renderErr);
      }
    }

    return NextResponse.json({ ok: true, reservation_id: reservation.id, welcome_message: welcomeMessage });
  } catch (err) {
    console.error("[api/dashboard/reservations POST create]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error desconocido" },
      { status: 500 }
    );
  }
}
