import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { requireAccountFromRequest, unauthorizedResponseBody } from "@/lib/auth/require-account";

// GET/POST/DELETE /api/dashboard/team
//
// Deja que un owner de la cuenta invite a otra persona con su propio email
// y contraseña, que entra al MISMO panel/datos de la cuenta — no es una
// cuenta aparte, es un segundo login vinculado al mismo account_id.
//
// Pedido de Andre (22/9/2026): quiere poder entrar tanto con su email
// personal (geopanthalassa@gmail.com) como con el del negocio
// (kuhanehostal@gmail.com), los dos abriendo el mismo Kuhane. Como
// Supabase Auth es un email = un usuario, y el dashboard de Supabase no
// deja editar el email de un usuario existente, la forma de lograr eso es
// un SEGUNDO usuario vinculado a la misma cuenta en account_members — no
// reemplazar el primero. De paso, esto sirve para el día que Kuhane (o
// cualquier cliente futuro) quiera darle su propio login a alguien del
// equipo.
//
// account_members.user_id no tiene FK real a auth.users (ver
// db/schema.sql), así que PostgREST no puede embeber el email en un
// select — se resuelve a mano con supabase.auth.admin.listUsers().
//
// Solo un "owner" de la cuenta puede listar/agregar/quitar miembros. El
// rol hoy no restringe nada más en el código (las políticas RLS de las
// demás tablas no distinguen owner de staff), pero para esta acción sí lo
// exigimos acá explícitamente.

export async function GET(req: Request) {
  try {
    const { accountId } = await requireAccountFromRequest(req);
    const supabase = getSupabaseServerClient();

    const { data: members, error } = await supabase
      .from("account_members")
      .select("user_id, role, created_at")
      .eq("account_id", accountId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);

    const { data: usersPage, error: usersError } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    if (usersError) throw new Error(usersError.message);
    const emailById = new Map(usersPage.users.map((u) => [u.id, u.email ?? null]));

    const result = (members ?? []).map((m) => ({
      user_id: m.user_id as string,
      role: m.role as string,
      created_at: m.created_at as string,
      email: emailById.get(m.user_id as string) ?? null,
    }));

    return NextResponse.json({ members: result });
  } catch (err) {
    console.error("[api/dashboard/team GET]", err);
    const { error, status } = unauthorizedResponseBody(err);
    return NextResponse.json({ error }, { status });
  }
}

const ADDABLE_ROLES = ["owner", "staff"];

export async function POST(req: Request) {
  let accountId: string;
  let requesterRole: string;
  try {
    const authed = await requireAccountFromRequest(req);
    accountId = authed.accountId;
    requesterRole = authed.role;
  } catch (err) {
    const { error, status } = unauthorizedResponseBody(err);
    return NextResponse.json({ error }, { status });
  }

  if (requesterRole !== "owner") {
    return NextResponse.json(
      { error: "Solo un owner de la cuenta puede agregar personas al equipo." },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  const { email, password, role } = (body ?? {}) as Record<string, unknown>;
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!normalizedEmail) {
    return NextResponse.json({ error: "Falta el email." }, { status: 400 });
  }
  if (typeof password !== "string" || password.length < 8) {
    return NextResponse.json({ error: "La contraseña debe tener al menos 8 caracteres." }, { status: 400 });
  }
  const resolvedRole = typeof role === "string" && role ? role : "staff";
  if (!ADDABLE_ROLES.includes(resolvedRole)) {
    return NextResponse.json(
      { error: `role inválido. Debe ser uno de: ${ADDABLE_ROLES.join(", ")}.` },
      { status: 400 }
    );
  }

  const supabase = getSupabaseServerClient();

  const { data: created, error: createUserError } = await supabase.auth.admin.createUser({
    email: normalizedEmail,
    password,
    email_confirm: true,
  });
  if (createUserError || !created?.user) {
    const message = createUserError?.message?.toLowerCase().includes("already")
      ? "Ya existe un usuario con ese email en Nuku OS."
      : (createUserError?.message ?? "No se pudo crear el usuario.");
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const { error: memberError } = await supabase
    .from("account_members")
    .insert({ account_id: accountId, user_id: created.user.id, role: resolvedRole });
  if (memberError) {
    // No dejamos un usuario de Auth huérfano sin cuenta asociada.
    await supabase.auth.admin.deleteUser(created.user.id).catch(() => {});
    return NextResponse.json({ error: memberError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, user_id: created.user.id });
}

export async function DELETE(req: Request) {
  let accountId: string;
  let requesterRole: string;
  let requesterUserId: string;
  try {
    const authed = await requireAccountFromRequest(req);
    accountId = authed.accountId;
    requesterRole = authed.role;
    requesterUserId = authed.userId;
  } catch (err) {
    const { error, status } = unauthorizedResponseBody(err);
    return NextResponse.json({ error }, { status });
  }

  if (requesterRole !== "owner") {
    return NextResponse.json(
      { error: "Solo un owner de la cuenta puede quitar personas del equipo." },
      { status: 403 }
    );
  }

  const userId = new URL(req.url).searchParams.get("user_id");
  if (!userId) return NextResponse.json({ error: "Falta el parámetro user_id." }, { status: 400 });
  if (userId === requesterUserId) {
    return NextResponse.json({ error: "No puedes quitarte a ti mismo del equipo desde acá." }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  // Solo se quita el vínculo con esta cuenta -- no se borra el usuario de
  // Auth (podría tener acceso a otra cuenta, o querer conservarlo igual).
  const { error } = await supabase
    .from("account_members")
    .delete()
    .eq("account_id", accountId)
    .eq("user_id", userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
