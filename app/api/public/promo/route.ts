import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

// GET /api/public/promo?code=XXX&account_id=...
//
// Endpoint público (lo llama el sitio del hostal, sin login) para el campo
// "¿Tenés un código promocional?" del panel de reserva — la persona escribe
// un código y esto le confirma en el momento si es válido o no, tal como
// pidió Andre (7/9/2026): "desde nuku_OS se pueden crear los cupones y al
// momento de ponerlos en kuhane se ve si son validos o no".
//
// A diferencia de /api/public/rooms (que llama /reservar, parte de este
// mismo sitio), a este lo llama kuhane-web desde OTRO origen
// (kuhane.vercel.app / el dominio final) — por eso necesita headers CORS
// explícitos, si no el navegador lo bloquea antes de que llegue acá.
//
// Ojo con el alcance: esto NO aplica el descuento solo. La reserva sigue
// pasando por WhatsApp/email para confirmar (ver reserva.helper en
// site-content.ts de kuhane-web), y el cobro real lo hace el staff a mano
// con el botón "Cobrar" del panel de Reservas (ver STRIPE.md) — ahí es
// donde alguien mira el promo_code guardado en la reserva y aplica el
// descuento. Este endpoint solo responde válido/inválido + los datos
// mínimos para mostrarlo (nunca el id interno del cupón ni datos de otras
// cuentas).

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code")?.trim().toUpperCase();
  const accountId = url.searchParams.get("account_id");

  if (!accountId) {
    return NextResponse.json(
      { error: "Falta el parámetro account_id." },
      { status: 400, headers: CORS_HEADERS }
    );
  }
  if (!code) {
    return NextResponse.json({ valid: false }, { headers: CORS_HEADERS });
  }

  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("promo_codes")
      .select("discount_type, discount_value, description, active, valid_from, valid_until, max_uses, uses_count")
      .eq("account_id", accountId)
      .eq("code", code)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ valid: false }, { headers: CORS_HEADERS });

    const today = new Date().toISOString().slice(0, 10);
    const withinWindow =
      (!data.valid_from || data.valid_from <= today) && (!data.valid_until || data.valid_until >= today);
    const hasUsesLeft = data.max_uses == null || data.uses_count < data.max_uses;
    const valid = data.active && withinWindow && hasUsesLeft;

    if (!valid) return NextResponse.json({ valid: false }, { headers: CORS_HEADERS });

    return NextResponse.json(
      {
        valid: true,
        discountType: data.discount_type,
        discountValue: data.discount_value,
        description: data.description,
      },
      { headers: CORS_HEADERS }
    );
  } catch (err) {
    console.error("[api/public/promo]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error desconocido" },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
