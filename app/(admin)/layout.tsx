import AdminGate from "@/components/admin/AdminGate";
import Sidebar from "@/components/admin/Sidebar";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminGate>
      {/* 25/9/2026: min-h-screen flex-col en celular (menú arriba, contenido
          abajo) y flex-row recién en "lg" (menú al costado, como estaba) —
          ver el comentario en components/admin/Sidebar.tsx. min-w-0 +
          overflow-x-hidden en el contenido es un freno extra para que
          ninguna pantalla ancha (ej. el cuadro de Disponibilidad) empuje la
          página entera de costado en un celular angosto. */}
      <div className="flex min-h-screen flex-col lg:flex-row">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col overflow-x-hidden">{children}</div>
      </div>
    </AdminGate>
  );
}
