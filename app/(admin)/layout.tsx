import AdminGate from "@/components/admin/AdminGate";
import Sidebar from "@/components/admin/Sidebar";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminGate>
      <div className="flex min-h-screen">
        <Sidebar />
        <div className="flex flex-1 flex-col">{children}</div>
      </div>
    </AdminGate>
  );
}
