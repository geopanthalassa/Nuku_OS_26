import { redirect } from "next/navigation";

// Esta pantalla vieja (placeholder "Entrar como Kuhane Etno-Hostal") quedó
// reemplazada por /login (ver app/login/page.tsx), que ahora sí pide
// usuario y clave de verdad — ver lib/admin-auth.ts. La raíz del sitio
// manda directo ahí para que no queden dos pantallas de entrada distintas.
export default function RootPage() {
  redirect("/login");
}
