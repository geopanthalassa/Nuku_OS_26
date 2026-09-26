import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { renderAutomationMessage } from "@/lib/automations";
import { checkAvailability, isOverlapConstraintError } from "@/lib/availability";
import { findMatchingGuest, guestConflictMessage } from "@/lib/guest-match";
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
        // 25/9/2026: se agrega room_id (y el id dentro de rooms()) — antes
        // esta ruta solo traía el NOMBRE de la habitación embebido, así que
        // no había forma confiable de agrupar las reservas por habitación
        // desde el frontend. Lo necesita la vista nueva de Disponibilidad
        // (app/(admin)/disponibilidad/page.tsx) para saber a qué fila del
        // cuadro pertenece cada reserva. No rompe nada existente: es un
        // campo que se suma, no se saca ninguno.
        "id, room_id, guest_id, check_in, check_out, status, channel, payment_status, promo_code, total_cents, guest_count, internal_notes, stripe_payment_link, tour_interest, tour_notes, arrival_flight_time, arrival_flight_number, departure_flight_time, departure_flight_number, airport_transfer_notes, created_at, guests(full_name, email, phone), rooms(id, name, base_rate_cents), reservation_guests(id, full_name, document_id, nationality, birth_date, phone, email, is_primary, dietary_vegan, dietary_vegetarian, dietary_celiac, dietary_lactose_free, dietary_other, mobility_assistance, mobility_notes)"
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
    room_id,
    guest_count,
    arrival_flight_time,
    arrival_flight_number,
    departure_flight_time,
    departure_flight_number,
    airport_transfer_notes,
    // 26/9/2026: pedido de Andre — "Editar", en general toda la ficha. Hasta
    // ahora esta ruta solo dejaba tocar status/room_id/guest_count/vuelos;
    // el resto de los campos de la reserva (fechas, canal, pago, monto,
    // cupón, tours, comentarios internos) no se podían corregir una vez
    // creada la reserva. Todos son opcionales acá — solo se actualiza lo que
    // venga en el body.
    check_in,
    check_out,
    channel,
    payment_status,
    total_cents,
    promo_code,
    tour_interest,
    tour_notes,
    internal_notes,
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

  // 26/9/2026: pedido de Andre — una reserva a mano puede nacer sin
  // habitación (todavía no se sabe cuál va a quedar) y se le asigna después
  // desde acá. room_id === "" o null limpia la asignación; un id de
  // habitación válido la asigna. Igual que al crear, si la reserva está
  // "requested"/"confirmed" hay que volver a chequear disponibilidad antes
  // de asignar — nadie chequeó eso todavía porque hasta ahora no tenía
  // habitación.
  let roomIdPatch: string | null | undefined;
  if (typeof room_id === "string") {
    roomIdPatch = room_id.trim() === "" ? null : room_id.trim();
  } else if (room_id === null) {
    roomIdPatch = null;
  } else if (room_id !== undefined) {
    return NextResponse.json({ error: "room_id debe ser un string o null." }, { status: 400 });
  }

  let guestCountPatch: number | null | undefined;
  if (guest_count !== undefined) {
    if (guest_count === null || guest_count === "") {
      guestCountPatch = null;
    } else {
      const n = Number(guest_count);
      if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
        return NextResponse.json(
          { error: "guest_count debe ser un número entero mayor a 0 (o vacío para borrarlo)." },
          { status: 400 }
        );
      }
      guestCountPatch = n;
    }
  }

  // 26/9/2026: pedido de Andre — botón "Editar" para toda la ficha, no solo
  // el estado/habitación/vuelos. Estos campos son todos opcionales: solo se
  // actualiza lo que venga en el body. La validación de fechas cruzadas
  // (check_out > check_in) se hace más abajo, una vez que sabemos las
  // fechas actuales de la reserva para completar la que no vino en el patch.
  if (check_in !== undefined && typeof check_in !== "string") {
    return NextResponse.json({ error: "check_in debe ser un string (fecha)." }, { status: 400 });
  }
  if (check_out !== undefined && typeof check_out !== "string") {
    return NextResponse.json({ error: "check_out debe ser un string (fecha)." }, { status: 400 });
  }
  if (channel !== undefined && (typeof channel !== "string" || !MANUAL_CHANNELS.includes(channel) && channel !== "direct")) {
    return NextResponse.json(
      { error: `channel inválido. Debe ser uno de: ${MANUAL_CHANNELS.join(", ")}, direct.` },
      { status: 400 }
    );
  }
  if (payment_status !== undefined && (typeof payment_status !== "string" || !VALID_PAYMENT_STATUSES.includes(payment_status))) {
    return NextResponse.json(
      { error: `payment_status inválido. Debe ser uno de: ${VALID_PAYMENT_STATUSES.join(", ")}.` },
      { status: 400 }
    );
  }
  let totalCentsPatch: number | null | undefined;
  if (total_cents !== undefined) {
    if (total_cents === null || total_cents === "") {
      totalCentsPatch = null;
    } else {
      const n = Number(total_cents);
      if (!Number.isFinite(n) || n < 0) {
        return NextResponse.json({ error: "total_cents debe ser un número mayor o igual a 0." }, { status: 400 });
      }
      totalCentsPatch = Math.round(n);
    }
  }
  if (tour_interest !== undefined && typeof tour_interest !== "boolean") {
    return NextResponse.json({ error: "tour_interest debe ser true o false." }, { status: 400 });
  }

  const extraPatch: Record<string, unknown> = {};
  if (typeof channel === "string") extraPatch.channel = channel;
  if (typeof payment_status === "string") extraPatch.payment_status = payment_status;
  if (totalCentsPatch !== undefined) extraPatch.total_cents = totalCentsPatch;
  if (typeof promo_code === "string") extraPatch.promo_code = promo_code.trim() ? promo_code.trim().toUpperCase() : null;
  if (typeof tour_interest === "boolean") extraPatch.tour_interest = tour_interest;
  if (typeof tour_notes === "string") extraPatch.tour_notes = tour_notes.trim() || null;
  if (typeof internal_notes === "string") extraPatch.internal_notes = internal_notes.trim() || null;

  if (
    status === undefined &&
    roomIdPatch === undefined &&
    guestCountPatch === undefined &&
    check_in === undefined &&
    check_out === undefined &&
    Object.keys(flightPatch).length === 0 &&
    Object.keys(extraPatch).length === 0
  ) {
    return NextResponse.json(
      {
        error:
          "No hay nada para actualizar: manda al menos un campo de la reserva a cambiar.",
      },
      { status: 400 }
    );
  }

  try {
    const supabase = getSupabaseServerClient();

    // Se necesitan los datos actuales de la reserva casi siempre: para
    // completar la fecha que no vino en el patch (y poder validar
    // check_out > check_in), para saber el estado efectivo antes de
    // rechequear disponibilidad, y para confirmar que la reserva es de esta
    // cuenta.
    const { data: current, error: currentError } = await supabase
      .from("reservations")
      .select("check_in, check_out, status, room_id")
      .eq("id", id)
      .eq("account_id", accountId)
      .maybeSingle();
    if (currentError) throw new Error(currentError.message);
    if (!current) {
      return NextResponse.json({ error: "La reserva no existe o no pertenece a esta cuenta." }, { status: 404 });
    }

    const effectiveCheckIn = typeof check_in === "string" && check_in.trim() ? check_in.trim() : current.check_in;
    const effectiveCheckOut = typeof check_out === "string" && check_out.trim() ? check_out.trim() : current.check_out;
    if (effectiveCheckOut <= effectiveCheckIn) {
      return NextResponse.json({ error: "check_out debe ser posterior a check_in." }, { status: 400 });
    }

    const datesPatch: Record<string, string> = {};
    if (typeof check_in === "string" && check_in.trim()) datesPatch.check_in = check_in.trim();
    if (typeof check_out === "string" && check_out.trim()) datesPatch.check_out = check_out.trim();

    if (roomIdPatch) {
      // La habitación tiene que ser de esta cuenta.
      const { data: room, error: roomError } = await supabase
        .from("rooms")
        .select("id")
        .eq("id", roomIdPatch)
        .eq("account_id", accountId)
        .maybeSingle();
      if (roomError) throw new Error(roomError.message);
      if (!room) {
        return NextResponse.json({ error: "La habitación no existe o no pertenece a esta cuenta." }, { status: 400 });
      }
    }

    // Rechequear disponibilidad si: se está asignando/cambiando la
    // habitación, o se están moviendo las fechas de una reserva que ya tiene
    // habitación. Si no hay habitación (todavía) no hay nada que chequear.
    const effectiveRoomId = roomIdPatch !== undefined ? roomIdPatch : current.room_id;
    const datesChanged = Object.keys(datesPatch).length > 0;
    if (effectiveRoomId && (roomIdPatch !== undefined || datesChanged)) {
      const effectiveStatus = typeof status === "string" ? status : current.status;
      if (effectiveStatus === "requested" || effectiveStatus === "confirmed") {
        const availability = await checkAvailability({
          accountId,
          roomId: effectiveRoomId,
          checkIn: effectiveCheckIn,
          checkOut: effectiveCheckOut,
          excludeReservationId: id,
        });
        if (!availability.available) {
          return NextResponse.json(
            { error: "Esa habitación ya está reservada para esas fechas. Revisa el calendario o elige otra." },
            { status: 409 }
          );
        }
      }
    }

    const updatePayload: Record<string, unknown> = { ...flightPatch, ...extraPatch, ...datesPatch };
    if (typeof status === "string") updatePayload.status = status;
    if (roomIdPatch !== undefined) updatePayload.room_id = roomIdPatch;
    if (guestCountPatch !== undefined) updatePayload.guest_count = guestCountPatch;

    const { error } = await supabase
      .from("reservations")
      .update(updatePayload)
      .eq("id", id)
      .eq("account_id", accountId); // doble filtro: nunca tocar una fila de otra cuenta

    if (error) {
      // Condición de carrera: alguien asignó esa misma habitación/fechas
      // justo entre el checkAvailability() de arriba y este update.
      if (isOverlapConstraintError(error)) {
        return NextResponse.json(
          {
            error:
              "Esa habitación se acaba de reservar para esas fechas (alguien más la tomó justo antes). Revisa el calendario e intenta de nuevo.",
          },
          { status: 409 }
        );
      }
      throw new Error(error.message);
    }

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
    guest_count,
    arrival_flight_time,
    arrival_flight_number,
    departure_flight_time,
    departure_flight_number,
    airport_transfer_notes,
    guest,
  } = payload;

  if (
    typeof check_in !== "string" ||
    typeof check_out !== "string" ||
    typeof channel !== "string" ||
    typeof guest !== "object" ||
    guest === null
  ) {
    return NextResponse.json(
      {
        error:
          "Faltan o son inválidos los campos obligatorios: check_in, check_out, channel (strings) y guest (objeto).",
      },
      { status: 400 }
    );
  }

  // 26/9/2026: pedido de Andre — a veces todavía no se sabe qué habitación
  // va a quedar cuando se está cargando la reserva a mano (por teléfono,
  // por ejemplo). room_id ahora es opcional: se puede guardar sin
  // habitación y asignarla después desde Reservas (ver updateReservation
  // más abajo). Mientras no tenga habitación, no hay nada que chequear por
  // disponibilidad ni tarifa que estimar — eso se hace recién al asignarla.
  if (room_id !== undefined && room_id !== null && typeof room_id !== "string") {
    return NextResponse.json({ error: "room_id debe ser un string o null." }, { status: 400 });
  }
  const roomIdValue = typeof room_id === "string" && room_id.trim() ? room_id.trim() : null;

  let guestCountValue: number | null = null;
  if (guest_count !== undefined && guest_count !== null && guest_count !== "") {
    const n = Number(guest_count);
    if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
      return NextResponse.json(
        { error: "guest_count debe ser un número entero mayor a 0." },
        { status: 400 }
      );
    }
    guestCountValue = n;
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
    // lib/supabase/server.ts), que salta RLS. Si todavía no se eligió
    // habitación (roomIdValue null), no hay nada que buscar ni chequear acá
    // — se hace cuando se asigne después (ver updateReservation).
    let room: { id: string; base_rate_cents: number | null } | null = null;
    if (roomIdValue) {
      const { data: foundRoom, error: roomError } = await supabase
        .from("rooms")
        .select("id, base_rate_cents")
        .eq("id", roomIdValue)
        .eq("account_id", accountId)
        .maybeSingle();
      if (roomError) throw new Error(roomError.message);
      if (!foundRoom) {
        return NextResponse.json({ error: "La habitación no existe o no pertenece a esta cuenta." }, { status: 400 });
      }
      room = foundRoom;

      // Mismo chequeo rápido que usa el formulario público antes de crear
      // nada — la garantía real contra condiciones de carrera es la
      // exclusion constraint de la base (ver el catch del insert, abajo).
      if (resolvedStatus === "requested" || resolvedStatus === "confirmed") {
        const availability = await checkAvailability({
          accountId,
          roomId: roomIdValue,
          checkIn: check_in,
          checkOut: check_out,
        });
        if (!availability.available) {
          return NextResponse.json(
            { error: "Esa habitación ya está reservada para esas fechas. Revisa el calendario o elige otras fechas." },
            { status: 409 }
          );
        }
      }
    }

    // Buscar huésped existente por email o teléfono dentro de la cuenta;
    // si no existe, crearlo. Si existe pero mandó datos nuevos que antes no
    // tenía (fecha de nacimiento, identificación), se los completamos —
    // mismo patrón que /api/reservations/request.
    // 23/9/2026: si el correo/teléfono ya pertenece a OTRO nombre, ya no se
    // mezcla en silencio — se avisa con un error claro (ver lib/guest-match.ts).
    const match = await findMatchingGuest(
      supabase,
      accountId,
      guestInfo.full_name.trim(),
      guestInfo.email,
      guestInfo.phone
    );

    if (match.kind === "conflict") {
      return NextResponse.json({ error: guestConflictMessage(match.existingName, match.matchedBy) }, { status: 409 });
    }

    let guestId: string;
    if (match.kind === "existing") {
      guestId = match.guestId;
      const patch: Record<string, string> = {};
      if (!match.birthDate && guestInfo.birth_date) patch.birth_date = guestInfo.birth_date;
      if (!match.documentId && guestInfo.document_id) patch.document_id = guestInfo.document_id;
      if (!match.nationality && guestInfo.nationality) patch.nationality = guestInfo.nationality;
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
    if (totalCents === null && room && room.base_rate_cents != null) {
      const n = Math.round((new Date(check_out).getTime() - new Date(check_in).getTime()) / (1000 * 60 * 60 * 24));
      if (n > 0) totalCents = room.base_rate_cents * n;
    }

    const { data: reservation, error: resError } = await supabase
      .from("reservations")
      .insert({
        account_id: accountId,
        room_id: roomIdValue,
        guest_id: guestId,
        check_in,
        check_out,
        status: resolvedStatus,
        channel,
        payment_status: resolvedPaymentStatus,
        total_cents: totalCents,
        guest_count: guestCountValue,
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
