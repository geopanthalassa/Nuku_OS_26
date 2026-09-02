import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

// Registro self-serve de un cliente NUEVO de Nuku OS: crea su usuario de
// Supabase Auth, su fila en `accounts`, y lo vincula como owner en
// `account_members` — las tres cosas que ONBOARDING.md describía como
// "hay que cargarlas a mano". Ahora las carga el propio cliente.
//
// Importante: esta ruta es para cuentas NUEVAS. La cuenta de Kuhane (la
// piloto, con datos reales ya cargados) no pasa por acá — su primer
// usuario se vincula a mano una vez, para no crear una Kuhane duplicada
// vacía. Ver la nota en ONBOARDING.md.
function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
  return base || "hostal";
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);

  const hostalName = typeof body?.hostal_name === "string" ? body.hostal_name.trim() : "";
  const ownerName = typeof body?.owner_name === "string" ? body.owner_name.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!hostalName || !email || !password) {
    return NextResponse.json(
      { error: "Faltan datos: nombre del alojamiento, email y contraseña son obligatorios." },
      { status: 400 }
    );
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "La contraseña debe tener al menos 8 caracteres." }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();

  const { data: created, error: createUserError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: ownerName ? { owner_name: ownerName } : undefined,
  });

  if (createUserError || !created?.user) {
    const message = createUserError?.message?.toLowerCase().includes("already")
      ? "Ya existe una cuenta con ese email."
      : (createUserError?.message ?? "No se pudo crear el usuario.");
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const userId = created.user.id;

  try {
    const baseSlug = slugify(hostalName);
    let slug = baseSlug;
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data: existing } = await supabase.from("accounts").select("id").eq("slug", slug).maybeSingle();
      if (!existing) break;
      slug = `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`;
    }

    const { data: account, error: accountError } = await supabase
      .from("accounts")
      .insert({ name: hostalName, slug, status: "trial" })
      .select("id")
      .single();
    if (accountError || !account) {
      throw new Error(accountError?.message ?? "No se pudo crear la cuenta.");
    }

    const { error: memberError } = await supabase
      .from("account_members")
      .insert({ account_id: account.id, user_id: userId, role: "owner" });
    if (memberError) throw new Error(memberError.message);

    const { error: settingsError } = await supabase
      .from("concierge_settings")
      .insert({ account_id: account.id, business_facts: {} });
    if (settingsError) throw new Error(settingsError.message);

    return NextResponse.json({ ok: true, account_id: account.id });
  } catch (err) {
    // Si algo falla después de crear el usuario de Auth, lo borramos para
    // no dejar un usuario huérfano sin cuenta asociada.
    await supabase.auth.admin.deleteUser(userId).catch(() => {});
    const message = err instanceof Error ? err.message : "No se pudo completar el registro.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
