import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

// POST /api/public/leads
//
// A diferencia del resto de las rutas /api/public/*, esta la llama el
// SITIO DE KUHANE (otro dominio, kuhanehostal.com), no una página de Nuku
// OS — por eso lleva encabezados CORS. La usa el botón flotante de
// WhatsApp: si el visitante deja su número antes de abrir el chat, queda
// guardado como huésped/lead en Supabase (source: "whatsapp_widget") para
// poder hacer remarketing más adelante, incluso si nunca llega a reservar.
//
// body: { account_id, phone, source? }

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400, headers: CORS_HEADERS });
  }

  const { account_id, phone, source } = (body ?? {}) as Record<string, unknown>;
  if (typeof account_id !== "string" || typeof phone !== "string" || !phone.trim()) {
    return NextResponse.json(
      { error: "Faltan o son inválidos los campos obligatorios: account_id (string), phone (string)." },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  try {
    const supabase = getSupabaseServerClient();
    const cleanPhone = phone.trim();

    const { data: existing } = await supabase
      .from("guests")
      .select("id")
      .eq("account_id", account_id)
      .eq("phone", cleanPhone)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ ok: true, guest_id: existing.id }, { headers: CORS_HEADERS });
    }

    const { data: created, error } = await supabase
      .from("guests")
      .insert({
        account_id,
        full_name: "Contacto de WhatsApp", // todavía no tenemos el nombre — se completa cuando confirme una reserva
        phone: cleanPhone,
        source: typeof source === "string" && source.trim() ? source.trim() : "whatsapp_widget",
      })
      .select("id")
      .single();

    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true, guest_id: created.id }, { headers: CORS_HEADERS });
  } catch (err) {
    console.error("[api/public/leads]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error desconocido" },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
