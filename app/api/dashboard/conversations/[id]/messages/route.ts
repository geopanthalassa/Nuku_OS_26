import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

// GET /api/dashboard/conversations/:id/messages?account_id=...
// Hilo completo de una conversación, para la pantalla Bandeja. Se exige
// account_id y se filtra por él además del id de la conversación — así
// nunca se puede leer el hilo de una conversación de otra cuenta aunque se
// adivine el id.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const accountId = new URL(req.url).searchParams.get("account_id");
  if (!accountId) {
    return NextResponse.json({ error: "Falta el parámetro account_id." }, { status: 400 });
  }

  try {
    const supabase = getSupabaseServerClient();

    const { data: conversation, error: convError } = await supabase
      .from("conversations")
      .select("id")
      .eq("id", id)
      .eq("account_id", accountId)
      .maybeSingle();

    if (convError) throw new Error(convError.message);
    if (!conversation) {
      return NextResponse.json({ error: "Conversación no encontrada para esta cuenta." }, { status: 404 });
    }

    const { data: messages, error } = await supabase
      .from("messages")
      .select("id, direction, body, sent_by, created_at")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true });

    if (error) throw new Error(error.message);

    return NextResponse.json({ messages: messages ?? [] });
  } catch (err) {
    console.error("[api/dashboard/conversations/:id/messages GET]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error desconocido" },
      { status: 500 }
    );
  }
}
