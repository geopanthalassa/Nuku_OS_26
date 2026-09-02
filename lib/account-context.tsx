"use client";

import { createContext, useContext } from "react";

// Fase 1 — la cuenta activa del panel ya no es una constante hardcodeada
// (ver lib/current-account.ts para el porqué histórico): sale de la
// sesión real de Supabase Auth, resuelta una vez por AdminGate y expuesta
// acá para que cualquier pantalla del panel la lea con useCurrentAccount().
export type CurrentAccount = {
  accountId: string | null;
  accountName: string | null;
  role: string | null;
  email: string | null;
};

const EMPTY_ACCOUNT: CurrentAccount = {
  accountId: null,
  accountName: null,
  role: null,
  email: null,
};

export const AccountContext = createContext<CurrentAccount>(EMPTY_ACCOUNT);

export function useCurrentAccount(): CurrentAccount {
  return useContext(AccountContext);
}
