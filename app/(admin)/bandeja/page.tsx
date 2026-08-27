"use client";

import { useEffect, useRef, useState } from "react";
import TopBar from "@/components/admin/TopBar";
import Pill from "@/components/ui/Pill";
import { demoWorkspace } from "@/lib/mock-data";
import { CURRENT_ACCOUNT_ID } from "@/lib/current-account";

const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  email: "Correo",
  test: "Prueba",
};

// Canal + external_id fijos para el hilo de prueba del panel: así todos los
// mensajes que se manden desde acá quedan en UNA sola conversación en vez
// de crear una nueva cada vez (mismo patrón que usaría un canal real).
const TEST_CHANNEL = "test";
const TEST_EXTERNAL_ID = `panel-${CURRENT_ACCOUNT_ID}`;

type ConversationSummary = {
  id: string;
  channel: string;
  external_id: string | null;
  last_message_at: string | null;
  guest_name: string;
  last_message_body: string | null;
};

type Message = {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  sent_by: string;
  created_at: string;
};

function timeAgo(iso: string | null) {
  if (!iso) return "";
  const diffMs = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  if (hours < 1) return "hace unos minutos";
  if (hours < 24) return `hace ${hours} h`;
  return `hace ${Math.floor(hours / 24)} d`;
}

export default function BandejaPage() {
  const { account } = demoWorkspace;
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);

  async function loadConversations(selectAfter?: "test") {
    const res = await fetch(`/api/dashboard/conversations?account_id=${CURRENT_ACCOUNT_ID}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    setConversations(data.conversations);

    if (selectAfter === "test") {
      const testConv = (data.conversations as ConversationSummary[]).find(
        (c) => c.channel === TEST_CHANNEL && c.external_id === TEST_EXTERNAL_ID
      );
      if (testConv) setSelectedId(testConv.id);
    }
  }

  useEffect(() => {
    loadConversations().catch((err) => setError(err instanceof Error ? err.message : "Error desconocido"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setMessages(null);
      return;
    }
    fetch(`/api/dashboard/conversations/${selectedId}/messages?account_id=${CURRENT_ACCOUNT_ID}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setMessages(data.messages);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Error desconocido"));
  }, [selectedId]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendTestMessage() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    setDraft("");

    try {
      const res = await fetch("/api/concierge/inbound", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          account_id: CURRENT_ACCOUNT_ID,
          channel: TEST_CHANNEL,
          external_id: TEST_EXTERNAL_ID,
          guest_message: text,
          guest: { full_name: "Prueba desde el panel" },
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      await loadConversations("test");
      if (data.conversation_id) {
        const msgRes = await fetch(
          `/api/dashboard/conversations/${data.conversation_id}/messages?account_id=${CURRENT_ACCOUNT_ID}`
        );
        const msgData = await msgRes.json();
        if (!msgData.error) setMessages(msgData.messages);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo enviar el mensaje.");
      setDraft(text); // devolver el texto al input para no perderlo
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <TopBar account={account} title="Bandeja" />
      <main className="flex flex-1 gap-5 overflow-hidden p-6">
        <div className="flex w-72 shrink-0 flex-col overflow-hidden rounded-xl border border-line bg-surface">
          <div className="border-b border-line px-4 py-3 text-xs uppercase tracking-wide text-ink-faint">
            Conversaciones
          </div>
          <div className="flex-1 overflow-y-auto">
            {conversations === null && <p className="p-4 text-sm text-ink-faint">Cargando…</p>}
            {conversations?.length === 0 && (
              <p className="p-4 text-sm text-ink-faint">
                Todavía no hay conversaciones reales — probá el Concierge acá al lado para crear la primera.
              </p>
            )}
            {conversations?.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className={`block w-full border-b border-line px-4 py-3 text-left transition-colors ${
                  selectedId === c.id ? "bg-paper-alt" : "hover:bg-paper-alt"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Pill tone="neutral">{CHANNEL_LABEL[c.channel] ?? c.channel}</Pill>
                  <span className="text-sm font-medium">{c.guest_name}</span>
                </div>
                <div className="mt-1 truncate text-xs text-ink-faint">{c.last_message_body}</div>
                <div className="mt-0.5 text-[11px] text-ink-faint/70">{timeAgo(c.last_message_at)}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-line bg-surface">
          <div className="border-b border-line px-4 py-3 text-xs uppercase tracking-wide text-ink-faint">
            {selectedId ? "Hilo de la conversación" : "Probar el Concierge IA"}
          </div>

          {error && (
            <p className="mx-4 mt-3 rounded-lg border border-rust/30 bg-rust-soft px-4 py-2 text-sm text-rust">
              {error}
            </p>
          )}

          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {!selectedId && (!messages || messages.length === 0) && (
              <p className="text-sm text-ink-soft">
                Escribí acá abajo como si fueras un huésped. El mensaje pasa por el mismo motor que usaría
                WhatsApp o Instagram (<code>/api/concierge/inbound</code>) y responde con IA real, usando los datos
                cargados para esta cuenta en <code>concierge_settings</code>.
              </p>
            )}
            {messages?.map((m) => (
              <div key={m.id} className={`flex ${m.direction === "outbound" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-md rounded-2xl px-4 py-2.5 text-sm ${
                    m.direction === "outbound" ? "bg-terracotta text-paper" : "bg-paper-alt text-ink"
                  }`}
                >
                  {m.body}
                </div>
              </div>
            ))}
            <div ref={threadEndRef} />
          </div>

          <div className="flex items-center gap-2 border-t border-line p-3">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendTestMessage()}
              placeholder="Escribí un mensaje de huésped…"
              disabled={sending}
              className="flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-terracotta disabled:opacity-60"
            />
            <button
              onClick={sendTestMessage}
              disabled={sending || !draft.trim()}
              className="rounded-lg bg-terracotta px-4 py-2 text-sm font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {sending ? "Enviando…" : "Enviar"}
            </button>
          </div>
        </div>
      </main>
    </>
  );
}
