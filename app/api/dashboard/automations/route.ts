import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

// GET/POST /api/dashboard/automations?account_id=...
//
// Lo que usa la pantalla Automatizaciones del panel para leer y prender/
// apagar las automatizaciones REALES de una cuenta (antes leía de
// lib/mock-data.ts, ahora lee de la tabla `automations` en Supabase).
//
// Las 3 automatizaciones del plan (bienvenida_reserva, solicitud_resena,
// recordatorio_pago) se crean solas la primera vez que se pide esta ruta
// para una cuenta que todavía no tiene filas — así una cuenta nueva no
// arranca con la pantalla vacía.

const DEFAULT_AUTOMATIONS: Array<{ template_key: string; label: string; description: string }> = [
  {
    template_key: "bienvenida_reserva",
    label: "Bienvenida al confirmar reserva",
    description: "Envía datos de llegada y check-in apenas se confirma una reserva.",
  },
  {
    template_key: "solicitud_resena",
    label: "Solicitud de reseña",
    description: "Pide una reseña 24 horas después del check-out.",
  },
  {
    template_key: "recordatorio_pago",
    label: "Recordatorio de pago pendiente",
    description: "Avisa al huésped si el saldo sigue pendiente 48 horas antes de la llegada.",
  },
  {
    template_key: "cumpleanos",
    label: "Saludo de cumpleaños",
    description: "El día del cumpleaños del huésped (si lo dejó al reservar), le manda un saludo con descuento.",
  },
];

export async function GET(req: Request) {
  const accountId = new URL(req.url).searchParams.get("account_id");
  if (!accountId) {
    return NextResponse.json({ error: "Falta el parámetro account_id." }, { status: 400 });
  }

  try {
    const supabase = getSupabaseServerClient();

    const { data: existing, error } = await supabase
      .from("automations")
      .select("id, template_key, enabled, config")
      .eq("account_id", accountId)
      .order("template_key", { ascending: true });

    if (error) throw new Error(error.message);

    if (existing && existing.length > 0) {
      return NextResponse.json({ automations: existing.map(withLabel) });
    }

    // Primera vez para esta cuenta: sembrar las 3 automatizaciones por
    // defecto, todas activas.
    const { data: seeded, error: seedError } = await supabase
      .from("automations")
      .insert(DEFAULT_AUTOMATIONS.map((a) => ({ account_id: accountId, template_key: a.template_key })))
      .select("id, template_key, enabled, config");

    if (seedError) throw new Error(seedError.message);

    return NextResponse.json({ automations: (seeded ?? []).map(withLabel) });
  } catch (err) {
    console.error("[api/dashboard/automations GET]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error desconocido" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  const { account_id, id, enabled } = (body ?? {}) as Record<string, unknown>;
  if (typeof account_id !== "string" || typeof id !== "string" || typeof enabled !== "boolean") {
    return NextResponse.json(
      { error: "Faltan o son inválidos los campos obligatorios: account_id (string), id (string), enabled (boolean)." },
      { status: 400 }
    );
  }

  try {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase
      .from("automations")
      .update({ enabled })
      .eq("id", id)
      .eq("account_id", account_id); // doble filtro: nunca tocar una fila de otra cuenta

    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/dashboard/automations POST]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error desconocido" },
      { status: 500 }
    );
  }
}

function withLabel(row: { id: string; template_key: string; enabled: boolean; config: unknown }) {
  const meta = DEFAULT_AUTOMATIONS.find((a) => a.template_key === row.template_key);
  return {
    id: row.id,
    template_key: row.template_key,
    enabled: row.enabled,
    label: meta?.label ?? row.template_key,
    description: meta?.description ?? "",
  };
}
