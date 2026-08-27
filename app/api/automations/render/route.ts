import { NextResponse } from "next/server";
import { renderAutomationMessage } from "@/lib/automations";

// POST /api/automations/render
//
// n8n llama acá cuando pasa el evento que dispara una automatización
// (reserva confirmada, X horas después del check-out, X horas antes de la
// llegada con saldo pendiente — el "cuándo" lo decide el workflow de n8n,
// con un nodo de espera o un trigger programado). Este endpoint responde
// SI corresponde mandar algo (según el interruptor on/off de la cuenta en
// /automatizaciones) y CON QUÉ texto exacto, usando los datos reales de la
// reserva. El envío en sí (WhatsApp, email) lo hace el workflow de n8n con
// la credencial de canal de esa cuenta.
//
// body: { account_id: string, template_key: string, reservation_id: string }
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido en el body de la petición." }, { status: 400 });
  }

  const { account_id, template_key, reservation_id } = (body ?? {}) as Record<string, unknown>;

  if (typeof account_id !== "string" || typeof template_key !== "string" || typeof reservation_id !== "string") {
    return NextResponse.json(
      {
        error:
          "Faltan o son inválidos los campos obligatorios: account_id, template_key, reservation_id (todos string).",
      },
      { status: 400 }
    );
  }

  try {
    const result = await renderAutomationMessage({
      accountId: account_id,
      templateKey: template_key,
      reservationId: reservation_id,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[api/automations/render]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error desconocido" },
      { status: 500 }
    );
  }
}
