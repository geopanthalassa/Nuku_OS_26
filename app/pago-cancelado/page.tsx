export default function PagoCanceladoPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-paper px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-rust-soft text-2xl text-rust">✕</div>
      <h1 className="font-display text-2xl text-ink">Pago no completado</h1>
      <p className="max-w-sm text-sm text-ink-soft">
        No se realizó ningún cobro. Si fue un error, podés pedirle al equipo de Kuhane que te mande el link de pago
        de nuevo.
      </p>
    </main>
  );
}
