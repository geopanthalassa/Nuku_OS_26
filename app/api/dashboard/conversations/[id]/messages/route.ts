import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { requireAccountFromRequest, unauthorizedResponseBody } from "@/lib/auth/require-account";

// GET /api/dashboard/conversations/:id/messages
// Hilo completo de una conversación, para la pantalla Bandeja. account_id
// se resuelve desde la sesión real (Checkpoint C, Fase 1 — ver
// lib/auth/require-account.ts) y se filtra por él además del id de la
// conversación — así nunca se puede leer el hilo de una conversación de
// otra cuenta aunque se adivine el id, ni mandando un account_id ajeno.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const { accountId } = await requireAccountFromRequest(req);
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
    const { error, status } = unauthorizedResponseBody(err);
    return NextResponse.json({ error }, { status });
  }
}
