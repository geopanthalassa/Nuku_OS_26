import { getSupabaseServerClient } from "./supabase/server";

// Motor de automatizaciones — Fase 1 técnica.
//
// Igual que el Concierge (ver lib/concierge.ts), este archivo es genérico:
// no sabe nada de Kuhane en particular. Las 3 automatizaciones que ya se
// ven en el panel (Automatizaciones) tienen acá un texto por defecto, pero
// cada cuenta puede pisarlo con su propio texto guardando
// `config.message_template` en la tabla `automations` — sin tocar código.
// n8n es quien decide CUÁNDO disparar (reserva confirmada, 24h después del
// check-out, 48h antes de la llegada si sigue impago); este archivo solo
// decide QUÉ texto mandar, y respeta el interruptor on/off de cada cuenta.

const DEFAULT_TEMPLATES: Record<string, string> = {
  // 26/9/2026: pedido de Andre — el saludo del mensaje de bienvenida pasa de
  // "¡Hola!" a "Iorana" (saludo en rapa nui), el resto del texto queda igual.
  bienvenida_reserva:
    "Iorana {{guest_name}}! Tu reserva en {{account_name}} está confirmada para el {{check_in}}. Cualquier cosa que necesites antes de llegar, escríbenos por acá.",
  solicitud_resena:
    "¡Hola {{guest_name}}! Esperamos que hayas disfrutado tu estadía en {{account_name}}. ¿Nos dejarías una reseña? Significa mucho para nosotros.",
  recordatorio_pago:
    "Hola {{guest_name}}, te recordamos que tu reserva en {{account_name}} ({{check_in}} a {{check_out}}) tiene un saldo pendiente. Avísanos si tienes alguna duda.",
  cumpleanos:
    "¡Feliz cumpleaños, {{guest_name}}! Todo el equipo de {{account_name}} te manda un abrazo desde Rapa Nui — [descuento de cumpleaños por confirmar] para tu próxima estadía con nosotros.",
  // 27/9/2026: pedido de Andre — dos avisos separados 3 días antes de la
  // llegada (no uno solo): uno interno para el equipo de Kuhane (se prepara
  // sabiendo quién llega) y otro para el huésped, recordándole el documento
  // que debe mostrar en el aeropuerto para embarcar hacia Rapa Nui.
  //
  // [DOCUMENTO A CONFIRMAR]: todavía no me dijiste qué documento exacto hay
  // que mostrar (¿reserva/voucher de Kuhane? ¿algo de PDI/turismo?) — dejo
  // el texto con ese espacio marcado en vez de inventarlo; cuando me digas
  // cuál es lo reemplazo acá.
  recordatorio_llegada_huesped:
    "Iorana {{guest_name}}! En 3 días, el {{check_in}}, te esperamos en {{account_name}} ({{room_name}}). Recuerda llevar [DOCUMENTO A CONFIRMAR] para mostrar en el aeropuerto al embarcar hacia Rapa Nui. Cualquier duda de último momento, escríbenos por acá.",
};

interface RenderInput {
  accountId: string;
  templateKey: string;
  reservationId: string;
}

interface RenderResult {
  skipped: boolean;
  reason?: string;
  message?: string;
}

export async function renderAutomationMessage({
  accountId,
  templateKey,
  reservationId,
}: RenderInput): Promise<RenderResult> {
  const supabase = getSupabaseServerClient();

  const { data: automation } = await supabase
    .from("automations")
    .select("enabled, config")
    .eq("account_id", accountId)
    .eq("template_key", templateKey)
    .maybeSingle();

  if (automation && automation.enabled === false) {
    return { skipped: true, reason: "Automatización desactivada para esta cuenta." };
  }

  const { data: reservation, error: resError } = await supabase
    .from("reservations")
    .select("id, check_in, check_out, guests(full_name), accounts(name)")
    .eq("id", reservationId)
    .eq("account_id", accountId)
    .single();

  if (resError || !reservation) {
    throw new Error(`Reserva no encontrada (reservation_id=${reservationId}): ${resError?.message ?? "sin datos"}`);
  }

  const configTemplate = (automation?.config as { message_template?: string } | null)?.message_template;
  const template = configTemplate || DEFAULT_TEMPLATES[templateKey];

  if (!template) {
    throw new Error(
      `No hay plantilla de mensaje para template_key="${templateKey}" (ni configurada en la cuenta ni por defecto).`
    );
  }

  // Supabase embebe relaciones como array u objeto según la versión del
  // cliente/PostgREST — se contemplan ambos casos.
  const guestRel = (reservation as { guests?: { full_name?: string } | { full_name?: string }[] }).guests;
  const accountRel = (reservation as { accounts?: { name?: string } | { name?: string }[] }).accounts;
  const guestName = (Array.isArray(guestRel) ? guestRel[0]?.full_name : guestRel?.full_name) ?? "huésped";
  const accountName = (Array.isArray(accountRel) ? accountRel[0]?.name : accountRel?.name) ?? "";

  const message = template
    .replaceAll("{{guest_name}}", guestName)
    .replaceAll("{{account_name}}", accountName)
    .replaceAll("{{check_in}}", reservation.check_in ?? "")
    .replaceAll("{{check_out}}", reservation.check_out ?? "");

  return { skipped: false, message };
}

interface BirthdayMessage {
  guest_id: string;
  guest_name: string;
  message: string;
}

// A diferencia de renderAutomationMessage (que cuelga de UNA reserva),
// el cumpleaños cuelga del HUÉSPED — puede no tener ninguna reserva activa.
// n8n llama a esto una vez por día (ver n8n-templates/cumpleanos.json) y
// este archivo hace todo el trabajo: buscar a quién le toca hoy, respetar
// el interruptor de la cuenta, y armar el texto de cada uno.
export async function renderTodaysBirthdayMessages(accountId: string): Promise<BirthdayMessage[]> {
  const supabase = getSupabaseServerClient();

  const { data: automation } = await supabase
    .from("automations")
    .select("enabled, config")
    .eq("account_id", accountId)
    .eq("template_key", "cumpleanos")
    .maybeSingle();

  if (automation && automation.enabled === false) return [];

  const { data: account } = await supabase.from("accounts").select("name").eq("id", accountId).single();
  const accountName = account?.name ?? "";

  const { data: guests, error } = await supabase
    .from("guests")
    .select("id, full_name, birth_date")
    .eq("account_id", accountId)
    .not("birth_date", "is", null);

  if (error) throw new Error(`No se pudo leer huéspedes: ${error.message}`);

  const today = new Date();
  const todayMonth = today.getUTCMonth() + 1;
  const todayDay = today.getUTCDate();

  const template =
    (automation?.config as { message_template?: string } | null)?.message_template || DEFAULT_TEMPLATES.cumpleanos;

  return (guests ?? [])
    .filter((g) => {
      if (!g.birth_date) return false;
      const [, month, day] = g.birth_date.split("-").map(Number);
      return month === todayMonth && day === todayDay;
    })
    .map((g) => ({
      guest_id: g.id,
      guest_name: g.full_name,
      message: template.replaceAll("{{guest_name}}", g.full_name).replaceAll("{{account_name}}", accountName),
    }));
}

interface ArrivalReminderMessage {
  reservation_id: string;
  guest_id: string;
  guest_name: string;
  message: string;
}

// Fecha calendario "dentro de 3 días" (no horas) — mismo criterio simple que
// usa el cumpleaños con UTC, para que no dependa de en qué huso horario
// corre el servidor. La comparten las dos funciones de abajo para que el
// aviso interno y el mensaje al huésped hablen siempre del mismo día.
function dateInThreeDays(): string {
  const target = new Date();
  target.setUTCDate(target.getUTCDate() + 3);
  return target.toISOString().slice(0, 10); // YYYY-MM-DD
}

type ArrivalRow = {
  id: string;
  check_in: string | null;
  check_out: string | null;
  guests?: { id?: string; full_name?: string; phone?: string; email?: string } | Array<{
    id?: string;
    full_name?: string;
    phone?: string;
    email?: string;
  }>;
  rooms?: { name?: string } | { name?: string }[];
};

function firstOf<T>(rel: T | T[] | undefined): T | undefined {
  return Array.isArray(rel) ? rel[0] : rel;
}

async function findArrivalsInThreeDays(accountId: string) {
  const supabase = getSupabaseServerClient();
  const targetDate = dateInThreeDays();

  // Solo reservas "confirmed" — una cancelada o completada no debe generar
  // ni el aviso al equipo ni el recordatorio al huésped.
  const { data: reservations, error } = await supabase
    .from("reservations")
    .select("id, check_in, check_out, guests(id, full_name, phone, email), rooms(name)")
    .eq("account_id", accountId)
    .eq("check_in", targetDate)
    .eq("status", "confirmed");

  if (error) throw new Error(`No se pudieron leer las reservas: ${error.message}`);

  return { targetDate, reservations: (reservations ?? []) as ArrivalRow[] };
}

// Mensaje al HUÉSPED, 3 días antes de su check-in — le recuerda el
// documento que debe mostrar en el aeropuerto para embarcar hacia Rapa Nui
// (ver nota en DEFAULT_TEMPLATES.recordatorio_llegada_huesped: el texto
// exacto del documento está pendiente de confirmar con Andre). n8n llama a
// esto una vez por día (ver n8n-templates/recordatorio-llegada.json).
export async function renderUpcomingArrivalReminders(accountId: string): Promise<ArrivalReminderMessage[]> {
  const supabase = getSupabaseServerClient();

  const { data: automation } = await supabase
    .from("automations")
    .select("enabled, config")
    .eq("account_id", accountId)
    .eq("template_key", "recordatorio_llegada_huesped")
    .maybeSingle();

  if (automation && automation.enabled === false) return [];

  const { data: account } = await supabase.from("accounts").select("name").eq("id", accountId).single();
  const accountName = account?.name ?? "";

  const { reservations } = await findArrivalsInThreeDays(accountId);

  const template =
    (automation?.config as { message_template?: string } | null)?.message_template ||
    DEFAULT_TEMPLATES.recordatorio_llegada_huesped;

  return reservations.map((r) => {
    const guest = firstOf(r.guests);
    const room = firstOf(r.rooms);
    const guestName = guest?.full_name ?? "huésped";

    const message = template
      .replaceAll("{{guest_name}}", guestName)
      .replaceAll("{{account_name}}", accountName)
      .replaceAll("{{check_in}}", r.check_in ?? "")
      .replaceAll("{{check_out}}", r.check_out ?? "")
      .replaceAll("{{room_name}}", room?.name ?? "tu habitación");

    return {
      reservation_id: r.id,
      guest_id: guest?.id ?? "",
      guest_name: guestName,
      message,
    };
  });
}

interface ArrivalsStaffDigestResult {
  skipped: boolean;
  reason?: string;
  message?: string;
}

// Aviso INTERNO para el equipo de Kuhane, 3 días antes de cada llegada —
// un solo mensaje con la lista de quién llega ese día, en qué habitación y
// cómo contactarlo, para que el equipo se organice (traslado, preparar la
// habitación, etc.). A diferencia del mensaje al huésped, este no necesita
// ningún dato por confirmar: es solo la información que ya tenemos en
// Reservas, ordenada en un texto. El envío (a qué WhatsApp/email del
// equipo) lo define el workflow de n8n, no esta cuenta — ver
// n8n-templates/recordatorio-llegada.json.
export async function renderUpcomingArrivalsStaffDigest(accountId: string): Promise<ArrivalsStaffDigestResult> {
  const supabase = getSupabaseServerClient();

  const { data: automation } = await supabase
    .from("automations")
    .select("enabled")
    .eq("account_id", accountId)
    .eq("template_key", "recordatorio_llegada_equipo")
    .maybeSingle();

  if (automation && automation.enabled === false) {
    return { skipped: true, reason: "Automatización desactivada para esta cuenta." };
  }

  const { targetDate, reservations } = await findArrivalsInThreeDays(accountId);

  if (reservations.length === 0) {
    return { skipped: true, reason: `No hay llegadas confirmadas para el ${targetDate}.` };
  }

  const lines = reservations.map((r) => {
    const guest = firstOf(r.guests);
    const room = firstOf(r.rooms);
    const guestName = guest?.full_name ?? "huésped sin nombre";
    const contacto = [guest?.phone, guest?.email].filter(Boolean).join(" / ") || "sin contacto registrado";
    return `- ${guestName} — ${room?.name ?? "habitación sin asignar"} — hasta ${r.check_out ?? "?"} — ${contacto}`;
  });

  const message = `Llegadas en 3 días (${targetDate}):\n${lines.join("\n")}`;

  return { skipped: false, message };
}
