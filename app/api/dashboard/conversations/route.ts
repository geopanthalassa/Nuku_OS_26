import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { requireAccountFromRequest, unauthorizedResponseBody } from "@/lib/auth/require-account";

// GET /api/dashboard/conversations
// Lista de conversaciones reales de una cuenta para la pantalla Bandeja,
// con el nombre del huésped y el último mensaje ya resueltos (para no
// tener que hacer N llamadas extra desde el cliente).
//
// Checkpoint C (Fase 1): account_id resuelto desde la sesión real, no
// desde el query string — ver lib/auth/require-account.ts.
export async function GET(req: Request) {
  try {
    const { accountId } = await requireAccountFromRequest(req);
    const supabase = getSupabaseServerClient();

    const { data: conversations, error } = await supabase
      .from("conversations")
      .select("id, channel, external_id, last_message_at, guests(full_name)")
      .eq("account_id", accountId)
      .order("last_message_at", { ascending: false, nullsFirst: false });

    if (error) throw new Error(error.message);

    const result = await Promise.all(
      (conversations ?? []).map(async (c) => {
        const { data: lastMessage } = await supabase
          .from("messages")
          .select("body, direction, created_at")
          .eq("conversation_id", c.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const guestRel = (c as { guests?: { full_name?: string } | { full_name?: string }[] }).guests;
        const guestName = (Array.isArray(guestRel) ? guestRel[0]?.full_name : guestRel?.full_name) ?? "Sin nombre";

        return {
          id: c.id,
          channel: c.channel,
          external_id: c.external_id,
          last_message_at: c.last_message_at,
          guest_name: guestName,
          last_message_body: lastMessage?.body ?? null,
        };
      })
    );

    return NextResponse.json({ conversations: result });
  } catch (err) {
    console.error("[api/dashboard/conversations GET]", err);
    const { error, status } = unauthorizedResponseBody(err);
    return NextResponse.json({ error }, { status });
  }
}
