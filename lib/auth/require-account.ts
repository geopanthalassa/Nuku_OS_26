import { getSupabaseServerClient } from "@/lib/supabase/server";

// Checkpoint C (Fase 1) — antes de esto, las rutas de /api/dashboard/* (y
// algunas otras que tocan datos de negocio) confiaban en el account_id que
// mandaba el cliente, sin comprobar que la sesión real tuviera derecho a
// usarlo. Esta función es el reemplazo: reconstruye el mismo camino que ya
// usaba /api/auth/me (token → auth.getUser() → account_members → account_id)
// para que cada ruta de datos lo use también, en vez de confiar en el
// account_id que llega por query string o body.
//
// Uso: const { accountId } = await requireAccountFromRequest(req);
// y usar SIEMPRE ese accountId para filtrar/escribir — nunca el que haya
// mandado el cliente en la query o el body (si llega, se ignora a propósito).

export class UnauthorizedError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
    this.name = "UnauthorizedError";
  }
}

export type AuthedAccount = { accountId: string; userId: string; role: string };

export async function requireAccountFromRequest(req: Request): Promise<AuthedAccount> {
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    throw new UnauthorizedError("Falta el header Authorization con el token de sesión (Bearer ...).");
  }

  const supabase = getSupabaseServerClient();

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) {
    throw new UnauthorizedError("Tu sesión ya no es válida. Inicia sesión de nuevo.");
  }

  const { data: membership, error: memberError } = await supabase
    .from("account_members")
    .select("account_id, role")
    .eq("user_id", userData.user.id)
    .limit(1)
    .maybeSingle();

  if (memberError) throw new Error(memberError.message);
  if (!membership) {
    throw new UnauthorizedError(
      "Tu usuario no está vinculado a ninguna cuenta de Nuku OS todavía. Contacta al soporte.",
      403
    );
  }

  return { accountId: membership.account_id as string, userId: userData.user.id, role: membership.role as string };
}

// Para endpoints que reciben tanto a un usuario real del panel (con sesión)
// como a un sistema externo sin sesión (hoy: n8n, vía /api/concierge/inbound
// y /api/concierge/reply) — acepta CUALQUIERA de las dos:
//   1. Sesión real de Supabase Auth, cuya cuenta coincida con accountId.
//   2. El secreto compartido NUKU_INBOUND_SECRET en el header x-nuku-secret.
// Si NUKU_INBOUND_SECRET no está configurado, la opción 2 queda inhabilitada
// (falla cerrado, no abierto) — hay que configurarlo en Vercel para que n8n
// pueda llamar a estos endpoints.
export async function requireSessionOrSharedSecret(req: Request, accountId: string): Promise<void> {
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const account = await requireAccountFromRequest(req);
    if (account.accountId !== accountId) {
      throw new UnauthorizedError("El account_id no corresponde a la cuenta de tu sesión.", 403);
    }
    return;
  }

  const providedSecret = req.headers.get("x-nuku-secret");
  const expectedSecret = process.env.NUKU_INBOUND_SECRET;
  if (expectedSecret && providedSecret === expectedSecret) {
    return;
  }

  throw new UnauthorizedError(
    "No autorizado: manda un token de sesión válido (Authorization: Bearer ...) o el header x-nuku-secret correcto.",
    401
  );
}

export function unauthorizedResponseBody(err: unknown): { error: string; status: number } {
  if (err instanceof UnauthorizedError) return { error: err.message, status: err.status };
  return { error: err instanceof Error ? err.message : "Error desconocido", status: 500 };
}
