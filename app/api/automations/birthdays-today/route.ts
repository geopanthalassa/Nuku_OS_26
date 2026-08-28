import { NextResponse } from "next/server";
import { renderTodaysBirthdayMessages } from "@/lib/automations";

// GET /api/automations/birthdays-today?account_id=...
// n8n llama a esto UNA VEZ POR DÍA (ver n8n-templates/cumpleanos.json,
// un Schedule Trigger diario). Devuelve el texto ya armado para cada
// huésped que cumple años hoy — n8n itera la lista y manda cada mensaje
// por el canal que corresponda (WhatsApp/email).
export async function GET(req: Request) {
  const accountId = new URL(req.url).searchParams.get("account_id");
  if (!accountId) {
    return NextResponse.json({ error: "Falta el parámetro account_id." }, { status: 400 });
  }

  try {
    const messages = await renderTodaysBirthdayMessages(accountId);
    return NextResponse.json({ messages });
  } catch (err) {
    console.error("[api/automations/birthdays-today]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error desconocido" },
      { status: 500 }
    );
  }
}
