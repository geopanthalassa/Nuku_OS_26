import { NextResponse } from "next/server";
import { renderUpcomingArrivalReminders, renderUpcomingArrivalsStaffDigest } from "@/lib/automations";

// GET /api/automations/arrivals-in-3-days?account_id=...
//
// n8n llama a esto UNA VEZ POR DÍA (ver n8n-templates/recordatorio-llegada.json,
// un Schedule Trigger diario). Devuelve dos cosas separadas, cada una con su
// propio interruptor en /automatizaciones:
//
// - guest_messages: un mensaje por reserva, para mandarle a CADA huésped que
//   hace check-in en 3 días (recordatorio_llegada_huesped).
// - staff_digest: UN solo mensaje con el resumen de todas las llegadas de
//   ese día, para el equipo de Kuhane (recordatorio_llegada_equipo). Viene
//   como { skipped: true, reason } si esa automatización está apagada o no
//   hay llegadas ese día — n8n no debería mandar nada en ese caso.
export async function GET(req: Request) {
  const accountId = new URL(req.url).searchParams.get("account_id");
  if (!accountId) {
    return NextResponse.json({ error: "Falta el parámetro account_id." }, { status: 400 });
  }

  try {
    const [guestMessages, staffDigest] = await Promise.all([
      renderUpcomingArrivalReminders(accountId),
      renderUpcomingArrivalsStaffDigest(accountId),
    ]);
    return NextResponse.json({ guest_messages: guestMessages, staff_digest: staffDigest });
  } catch (err) {
    console.error("[api/automations/arrivals-in-3-days]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error desconocido" },
      { status: 500 }
    );
  }
}
