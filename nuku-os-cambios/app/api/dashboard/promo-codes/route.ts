import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { requireAccountFromRequest, unauthorizedResponseBody } from "@/lib/auth/require-account";

// GET/POST/PATCH/DELETE /api/dashboard/promo-codes
//
// CRUD de códigos promocionales para el panel de Nuku OS ("Cupones").
// account_id siempre sale de la sesión (requireAccountFromRequest), nunca
// del body/query — mismo patrón de seguridad que /api/dashboard/reservations
// (Checkpoint C). La validación pública que usa el sitio del hostal vive
// aparte, en /api/public/promo (sin sesión, solo lectura, sin exponer esta
// ruta administrativa).

export async function GET(req: Request) {
  try {
    const { accountId } = await requireAccountFromRequest(req);
    const supabase = getSupabaseServerClient();

    const { data, error } = await supabase
      .from("promo_codes")
      .select(
        "id, code, description, discount_type, discount_value, active, valid_from, valid_until, max_uses, uses_count, created_at"
      )
      .eq("account_id", accountId)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);

    return NextResponse.json({ promoCodes: data ?? [] });
  } catch (err) {
    console.error("[api/dashboard/promo-codes GET]", err);
    const { error, status } = unauthorizedResponseBody(err);
    return NextResponse.json({ error }, { status });
  }
}

const DISCOUNT_TYPES = ["percent", "fixed_amount"];

export async function POST(req: Request) {
  let accountId: string;
  try {
    accountId = (await requireAccountFromRequest(req)).accountId;
  } catch (err) {
    const { error, status } = unauthorizedResponseBody(err);
    return NextResponse.json({ error }, { status });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  const { code, description, discount_type, discount_value, valid_from, valid_until, max_uses } =
    (body ?? {}) as Record<string, unknown>;

  if (typeof code !== "string" || !code.trim()) {
    return NextResponse.json({ error: "Falta el código (campo code, string)." }, { status: 400 });
  }
  const normalizedCode = code.trim().toUpperCase();

  const dType = typeof discount_type === "string" ? discount_type : "percent";
  if (!DISCOUNT_TYPES.includes(dType)) {
    return NextResponse.json(
      { error: `discount_type inválido. Debe ser uno de: ${DISCOUNT_TYPES.join(", ")}.` },
      { status: 400 }
    );
  }
  const dValue = typeof discount_value === "number" ? discount_value : Number(discount_value ?? 0);
  if (!Number.isFinite(dValue) || dValue < 0) {
    return NextResponse.json({ error: "discount_value debe ser un número mayor o igual a 0." }, { status: 400 });
  }
  if (dType === "percent" && dValue > 100) {
    return NextResponse.json({ error: "Un descuento por porcentaje no puede ser mayor a 100." }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("promo_codes")
    .insert({
      account_id: accountId,
      code: normalizedCode,
      description: typeof description === "string" ? description.trim() || null : null,
      discount_type: dType,
      discount_value: dValue,
      valid_from: typeof valid_from === "string" && valid_from ? valid_from : null,
      valid_until: typeof valid_until === "string" && valid_until ? valid_until : null,
      max_uses: typeof max_uses === "number" ? max_uses : max_uses ? Number(max_uses) : null,
    })
    .select(
      "id, code, description, discount_type, discount_value, active, valid_from, valid_until, max_uses, uses_count, created_at"
    )
    .single();

  if (error) {
    // unique (account_id, code) -- mensaje claro en vez del error crudo de Postgres.
    const msg = error.code === "23505" ? `Ya existe un código "${normalizedCode}" para esta cuenta.` : error.message;
    return NextResponse.json({ error: msg }, { status: error.code === "23505" ? 409 : 500 });
  }

  return NextResponse.json({ promoCode: data });
}

// PATCH: activar/desactivar un código, o editar sus campos.
export async function PATCH(req: Request) {
  let accountId: string;
  try {
    accountId = (await requireAccountFromRequest(req)).accountId;
  } catch (err) {
    const { error, status } = unauthorizedResponseBody(err);
    return NextResponse.json({ error }, { status });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  const { id, active } = (body ?? {}) as Record<string, unknown>;
  if (typeof id !== "string") {
    return NextResponse.json({ error: "Falta el campo id (string)." }, { status: 400 });
  }
  if (typeof active !== "boolean") {
    return NextResponse.json({ error: "Falta el campo active (boolean)." }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from("promo_codes")
    .update({ active })
    .eq("id", id)
    .eq("account_id", accountId); // por si acaso -- ya filtra RLS, pero explícito acá también.

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  let accountId: string;
  try {
    accountId = (await requireAccountFromRequest(req)).accountId;
  } catch (err) {
    const { error, status } = unauthorizedResponseBody(err);
    return NextResponse.json({ error }, { status });
  }

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Falta el parámetro id." }, { status: 400 });

  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("promo_codes").delete().eq("id", id).eq("account_id", accountId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
