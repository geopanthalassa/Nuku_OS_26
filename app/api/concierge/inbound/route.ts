import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { generateConciergeReply } from "@/lib/concierge";

// POST /api/concierge/inbound
//
// Punto de entrada genérico para CUALQUIER canal (WhatsApp, Instagram,
// email, formulario web). La idea es que n8n reciba el mensaje del huésped
// por el canal que sea, lo normalice a este mismo formato, y llame acá con
// un nodo HTTP Request — este endpoint no sabe ni le importa de qué canal
// vino. El envío de la respuesta de vuelta al huésped (mandar el WhatsApp,
// el DM de Instagram, el email) es responsabilidad del workflow de n8n que
// llama a este endpoint, usando la credencial de canal de cada cliente. Ver
// n8n-templates/concierge-inbound.json.
//
// body:
//   account_id: string (uuid de accounts.id — identifica QUÉ cliente es)
//   channel: string ("whatsapp" | "instagram" | "email" | "web", etc.)
//   external_id?: string (id de la conversación en el canal de origen —
//                          ej. el número de WhatsApp o el thread de Instagram;
//                          se usa para no crear una conversación nueva en
//                          cada mensaje)
//   guest_message: string
//   guest?: { full_name?: string, email?: string, phone?: string }
//
// responde: { conversation_id: string, reply: string }
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido en el body de la petición." }, { status: 400 });
  }

  const { account_id, channel, external_id, guest_message, guest } = (body ?? {}) as Record<string, unknown>;

  if (typeof account_id !== "string" || typeof channel !== "string" || typeof guest_message !== "string") {
    return NextResponse.json(
      { error: "Faltan o son inválidos los campos obligatorios: account_id, channel, guest_message (todos string)." },
      { status: 400 }
    );
  }

  const guestInfo = (guest ?? {}) as { full_name?: string; email?: string; phone?: string };
  const externalId = typeof external_id === "string" ? external_id : null;

  try {
    const supabase = getSupabaseServerClient();
    const guestId = await findOrCreateGuest(supabase, account_id, channel, guestInfo);
    const conversationId = await findOrCreateConversation(supabase, account_id, channel, externalId, guestId);

    const { error: insertError } = await supabase.from("messages").insert({
      account_id,
      conversation_id: conversationId,
      direction: "inbound",
      body: guest_message,
      sent_by: guestInfo.full_name || "guest",
    });
    if (insertError) {
      throw new Error(`No se pudo guardar el mensaje entrante: ${insertError.message}`);
    }

    const { reply } = await generateConciergeReply({
      accountId: account_id,
      conversationId,
      guestMessage: guest_message,
    });

    return NextResponse.json({ conversation_id: conversationId, reply });
  } catch (err) {
    console.error("[api/concierge/inbound]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error desconocido" },
      { status: 500 }
    );
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function findOrCreateGuest(
  supabase: any,
  accountId: string,
  channel: string,
  guest: { full_name?: string; email?: string; phone?: string }
): Promise<string | null> {
  if (!guest.email && !guest.phone) return null;

  const filters = [
    guest.email ? `email.eq.${guest.email}` : null,
    guest.phone ? `phone.eq.${guest.phone}` : null,
  ].filter(Boolean) as string[];

  const { data: existing } = await supabase
    .from("guests")
    .select("id")
    .eq("account_id", accountId)
    .or(filters.join(","))
    .maybeSingle();

  if (existing) return existing.id as string;

  const { data: created, error } = await supabase
    .from("guests")
    .insert({
      account_id: accountId,
      full_name: guest.full_name || "Huésped sin nombre",
      email: guest.email ?? null,
      phone: guest.phone ?? null,
      source: channel,
    })
    .select("id")
    .single();

  if (error) throw new Error(`No se pudo crear el huésped: ${error.message}`);
  return created.id as string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function findOrCreateConversation(
  supabase: any,
  accountId: string,
  channel: string,
  externalId: string | null,
  guestId: string | null
): Promise<string> {
  if (externalId) {
    const { data: existing } = await supabase
      .from("conversations")
      .select("id")
      .eq("account_id", accountId)
      .eq("channel", channel)
      .eq("external_id", externalId)
      .maybeSingle();
    if (existing) return existing.id as string;
  }

  const { data: created, error } = await supabase
    .from("conversations")
    .insert({
      account_id: accountId,
      channel,
      external_id: externalId,
      guest_id: guestId,
    })
    .select("id")
    .single();

  if (error) throw new Error(`No se pudo crear la conversación: ${error.message}`);
  return created.id as string;
}
