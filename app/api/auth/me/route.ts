import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

// Dado el access_token de la sesión de Supabase Auth (lo manda AdminGate
// en el header Authorization), devuelve a qué cuenta pertenece ese
// usuario. Es el reemplazo real de lib/current-account.ts: antes el panel
// entero apuntaba siempre a Kuhane; ahora cada usuario ve su propia
// cuenta según lo que diga account_members.
export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  const supabase = getSupabaseServerClient();

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) {
    return NextResponse.json({ error: "Tu sesión ya no es válida. Inicia sesión de nuevo." }, { status: 401 });
  }

  const { data: membership, error: memberError } = await supabase
    .from("account_members")
    .select("account_id, role, accounts(name, slug, status)")
    .eq("user_id", userData.user.id)
    .limit(1)
    .maybeSingle();

  if (memberError) {
    return NextResponse.json({ error: memberError.message }, { status: 500 });
  }

  if (!membership) {
    return NextResponse.json(
      { error: "Tu usuario no está vinculado a ninguna cuenta de Nuku OS todavía. Contacta al soporte." },
      { status: 404 }
    );
  }

  const accountData = membership.accounts as unknown as { name?: string } | null;

  return NextResponse.json({
    account_id: membership.account_id,
    account_name: accountData?.name ?? null,
    role: membership.role,
    email: userData.user.email,
  });
}
