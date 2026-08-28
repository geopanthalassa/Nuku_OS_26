import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

// GET /api/public/rooms?account_id=...
// Endpoint público (lo llama la página /reservar, sin login) — expone solo
// lo que un visitante necesita ver para pedir una habitación: nombre,
// capacidad y tarifa. Nada de datos de huéspedes ni de otras cuentas.
export async function GET(req: Request) {
  const accountId = new URL(req.url).searchParams.get("account_id");
  if (!accountId) {
    return NextResponse.json({ error: "Falta el parámetro account_id." }, { status: 400 });
  }

  try {
    const supabase = getSupabaseServerClient();
    const { data: rooms, error } = await supabase
      .from("rooms")
      .select("id, name, capacity, base_rate_cents")
      .eq("account_id", accountId)
      .order("name", { ascending: true });

    if (error) throw new Error(error.message);

    const { data: account } = await supabase.from("accounts").select("currency").eq("id", accountId).maybeSingle();

    return NextResponse.json({ rooms: rooms ?? [], currency: account?.currency ?? "CLP" });
  } catch (err) {
    console.error("[api/public/rooms]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error desconocido" },
      { status: 500 }
    );
  }
}
