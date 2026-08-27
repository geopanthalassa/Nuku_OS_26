import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

// GET /api/dashboard/conversations?account_id=...
// Lista de conversaciones reales de una cuenta para la pantalla Bandeja,
// con el nombre del huésped y el último mensaje ya resueltos (para no
// tener que hacer N llamadas extra desde el cliente).
export async function GET(req: Request) {
  const accountId = new URL(req.url).searchParams.get("account_id");
  if (!accountId) {
    return NextResponse.json({ error: "Falta el parámetro account_id." }, { status: 400 });
  }

  try {
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
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error desconocido" },
      { status: 500 }
    );
  }
}
