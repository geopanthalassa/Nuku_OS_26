import { getSupabaseServerClient } from "./supabase/server";

// Motor del Concierge IA — Fase 1 técnica.
//
// Este archivo es el ÚNICO lugar donde vive la lógica de "cómo responde
// la IA". Es genérico a propósito: no tiene nada de Kuhane escrito adentro.
// Lo que cambia entre un cliente y otro son los datos en las tablas
// `accounts` y `concierge_settings` — mismo código para todos, distinta fila
// por cuenta. Onboardear un cliente nuevo significa llenar esas dos tablas,
// no tocar este archivo.
//
// Requiere la variable de entorno ANTHROPIC_API_KEY (se pide en
// https://console.anthropic.com → API Keys, se carga como env var en Vercel).
// Si falta, la función lanza un error claro en vez de fallar en silencio.

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";
const MAX_HISTORY_MESSAGES = 20;
const MAX_REPLY_TOKENS = 600;

interface AccountRow {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  currency: string;
}

interface ConciergeSettingsRow {
  system_prompt: string | null;
  business_facts: Record<string, unknown> | null;
  model: string | null;
  temperature: number | null;
}

interface GenerateReplyInput {
  accountId: string;
  conversationId: string;
  guestMessage: string;
}

interface GenerateReplyResult {
  reply: string;
}

export async function generateConciergeReply({
  accountId,
  conversationId,
  guestMessage,
}: GenerateReplyInput): Promise<GenerateReplyResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Falta la variable de entorno ANTHROPIC_API_KEY. Se obtiene en console.anthropic.com y se carga en Vercel."
    );
  }

  const supabase = getSupabaseServerClient();

  const { data: account, error: accountError } = await supabase
    .from("accounts")
    .select("id, name, slug, timezone, currency")
    .eq("id", accountId)
    .single<AccountRow>();

  if (accountError || !account) {
    throw new Error(`Cuenta no encontrada (account_id=${accountId}): ${accountError?.message ?? "sin datos"}`);
  }

  const { data: settings } = await supabase
    .from("concierge_settings")
    .select("system_prompt, business_facts, model, temperature")
    .eq("account_id", accountId)
    .maybeSingle<ConciergeSettingsRow>();

  const { data: history } = await supabase
    .from("messages")
    .select("direction, body, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(MAX_HISTORY_MESSAGES);

  const systemPrompt = buildSystemPrompt(account, settings);
  const conversationMessages = (history ?? []).map((m: { direction: string; body: string }) => ({
    role: m.direction === "inbound" ? ("user" as const) : ("assistant" as const),
    content: m.body,
  }));
  conversationMessages.push({ role: "user", content: guestMessage });

  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: settings?.model || DEFAULT_MODEL,
      max_tokens: MAX_REPLY_TOKENS,
      temperature: settings?.temperature ?? 0.4,
      system: systemPrompt,
      messages: conversationMessages,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic API respondió ${res.status}: ${text}`);
  }

  const json = await res.json();
  const replyText: string =
    json.content?.find((block: { type: string; text?: string }) => block.type === "text")?.text ?? "";

  if (!replyText) {
    throw new Error("La API de Anthropic no devolvió texto de respuesta.");
  }

  const { error: insertError } = await supabase.from("messages").insert({
    account_id: accountId,
    conversation_id: conversationId,
    direction: "outbound",
    body: replyText,
    sent_by: "concierge_ai",
  });
  if (insertError) {
    throw new Error(`No se pudo guardar la respuesta en messages: ${insertError.message}`);
  }

  await supabase
    .from("conversations")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", conversationId);

  return { reply: replyText };
}

function buildSystemPrompt(account: AccountRow, settings: ConciergeSettingsRow | null): string {
  if (settings?.system_prompt && settings.system_prompt.trim()) {
    return settings.system_prompt.trim();
  }

  const facts = settings?.business_facts ?? {};
  const factEntries = Object.entries(facts);
  const factsText = factEntries.length
    ? factEntries.map(([key, value]) => `- ${key}: ${value}`).join("\n")
    : "- (todavía no se cargaron datos del alojamiento para esta cuenta)";

  const isRapaNui = account.timezone === "Pacific/Easter";
  const locationLine = isRapaNui
    ? "un alojamiento en Rapa Nui (Isla de Pascua), Chile"
    : "un alojamiento";

  return `Eres el concierge virtual de ${account.name}, ${locationLine}. Respondes mensajes de huéspedes (WhatsApp, Instagram, email o el formulario del sitio) de forma cálida, breve y precisa, en el mismo idioma en que te escriben.

Reglas importantes:
- Nunca inventes precios, disponibilidad exacta, políticas de cancelación ni datos que no aparezcan abajo. Si te preguntan algo que no sabes, dilo con honestidad y ofrece confirmarlo con el equipo humano.
- Sé conciso: la mayoría de las respuestas de un concierge real caben en 2-4 frases.
- Si el huésped quiere reservar o pagar, guíalo al canal de reservas oficial en vez de intentar cerrar la reserva tú mismo.

Datos confirmados de este alojamiento:
${factsText}`;
}
