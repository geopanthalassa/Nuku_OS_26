import { NextResponse } from "next/server";
import { generateConciergeReply } from "@/lib/concierge";

// POST /api/concierge/reply
// Genera (y guarda) la respuesta del Concierge IA para un mensaje dentro de
// una conversación que YA existe. Pensado para uso interno del panel (por
// ejemplo, un botón "responder con IA" en Bandeja) o para automatizaciones
// que ya resolvieron account_id/conversation_id por su cuenta.
//
// Para el caso de uso normal — un mensaje que llega desde WhatsApp/
// Instagram/email y todavía no tiene conversación — usar
// /api/concierge/inbound en su lugar, que crea todo lo que falte.
//
// body: { account_id: string, conversation_id: string, guest_message: string }
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido en el body de la petición." }, { status: 400 });
  }

  const { account_id, conversation_id, guest_message } = (body ?? {}) as Record<string, unknown>;

  if (typeof account_id !== "string" || typeof conversation_id !== "string" || typeof guest_message !== "string") {
    return NextResponse.json(
      { error: "Faltan o son inválidos los campos obligatorios: account_id, conversation_id, guest_message (todos string)." },
      { status: 400 }
    );
  }

  try {
    const result = await generateConciergeReply({
      accountId: account_id,
      conversationId: conversation_id,
      guestMessage: guest_message,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[api/concierge/reply]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error desconocido" },
      { status: 500 }
    );
  }
}
