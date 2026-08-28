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
  bienvenida_reserva:
    "¡Hola {{guest_name}}! Tu reserva en {{account_name}} está confirmada para el {{check_in}}. Cualquier cosa que necesites antes de llegar, escríbenos por acá.",
  solicitud_resena:
    "¡Hola {{guest_name}}! Esperamos que hayas disfrutado tu estadía en {{account_name}}. ¿Nos dejarías una reseña? Significa mucho para nosotros.",
  recordatorio_pago:
    "Hola {{guest_name}}, te recordamos que tu reserva en {{account_name}} ({{check_in}} a {{check_out}}) tiene un saldo pendiente. Avísanos si tienes alguna duda.",
  cumpleanos:
    "¡Feliz cumpleaños, {{guest_name}}! Todo el equipo de {{account_name}} te manda un abrazo desde Rapa Nui — [descuento de cumpleaños por confirmar] para tu próxima estadía con nosotros.",
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
