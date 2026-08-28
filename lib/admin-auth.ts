// Acceso al panel — Fase 0.
//
// Todavía no existe un sistema de autenticación real (eso llega con
// Supabase Auth, un usuario por cuenta). Por ahora hay un único usuario
// y clave para poder mostrar el panel sin dejarlo abierto a cualquiera
// que tenga el link. Esto NO es seguridad real: la clave vive en el
// código del cliente. Cuando haya más de un hostal usando Nuku OS, este
// archivo se reemplaza por login real contra Supabase Auth.
export const ADMIN_CREDENTIALS = {
  username: "kuhane_hostal",
  password: "123456",
};

const SESSION_KEY = "nuku_os_session";

export function checkCredentials(username: string, password: string): boolean {
  return (
    username.trim().toLowerCase() === ADMIN_CREDENTIALS.username.toLowerCase() &&
    password === ADMIN_CREDENTIALS.password
  );
}

export function setSession() {
  try {
    localStorage.setItem(SESSION_KEY, "1");
  } catch {
    // localStorage puede fallar en navegación privada — no es crítico acá.
  }
}

export function hasSession(): boolean {
  try {
    return localStorage.getItem(SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // no-op
  }
}
