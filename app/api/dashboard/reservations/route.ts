import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { renderAutomationMessage } from "@/lib/automations";

// GET/POST /api/dashboard/reservations?account_id=...
//
// Lo que usa la pantalla Reservas del panel — antes mostraba datos de
// ejemplo (lib/mock-data.ts), ahora lee/escribe la tabla `reservations`
// real de Supabase. El paso importante que agrega esta ruta es el cambio
// de estado: cuando una reserva pasa de "requested" a "confirmed" (el
// equipo la validó por WhatsApp/email), automáticamente arma el texto de
// bienvenida con el mismo motor que usará n8n más adelante — así, aunque
// todavía no hay un envío automático conectado, el equipo ya tiene el
// mensaje listo para copiar y mandar a mano mientras tanto.

export async function GET(req: Request) {
  const accountId = new URL(req.url).searchParams.get("account_id");
  if (!accountId) {
    return NextResponse.json({ error: "Falta el parámetro account_id." }, { status: 400 });
  }

  try {
    const supabase = getSupabaseServerClient();

    const { data, error } = await supabase
      .from("reservations")
      .select(
        "id, check_in, check_out, status, channel, payment_status, promo_code, total_cents, stripe_payment_link, tour_interest, tour_notes, created_at, guests(full_name, email, phone), rooms(name, base_rate_cents), reservation_guests(full_name, document_id, is_primary)"
      )
      .eq("account_id", accountId)
      .order("check_in", { ascending: true });

    if (error) throw new Error(error.message);

    const { data: account } = await supabase.from("accounts").select("currency").eq("id", accountId).single();

    return NextResponse.json({ reservations: data ?? [], currency: account?.currency ?? "CLP" });
  } catch (err) {
    console.error("[api/dashboard/reservations GET]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error desconocido" },
      { status: 500 }
    );
  }
}

const VALID_STATUSES = ["requested", "confirmed", "cancelled", "completed"];

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  const { account_id, id, status } = (body ?? {}) as Record<string, unknown>;
  if (typeof account_id !== "string" || typeof id !== "string" || typeof status !== "string") {
    return NextResponse.json(
      { error: "Faltan o son inválidos los campos obligatorios: account_id (string), id (string), status (string)." },
      { status: 400 }
    );
  }
  if (!VALID_STATUSES.includes(status)) {
    return NextResponse.json(
      { error: `status inválido. Debe ser uno de: ${VALID_STATUSES.join(", ")}.` },
      { status: 400 }
    );
  }

  try {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase
      .from("reservations")
      .update({ status })
      .eq("id", id)
      .eq("account_id", account_id); // doble filtro: nunca tocar una fila de otra cuenta

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
          accountId: account_id,
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
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error desconocido" },
      { status: 500 }
    );
  }
}
