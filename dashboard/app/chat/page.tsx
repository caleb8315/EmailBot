"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type ChatMsg = { role: "user" | "bot"; text: string; createdAt: string };

function formatClock(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function ChatPage() {
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chat]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    const userMsg: ChatMsg = { role: "user", text, createdAt: new Date().toISOString() };
    setChat(prev => [...prev, userMsg]);
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json();
      setChat(prev => [
        ...prev,
        { role: "bot", text: data.reply || data.error || "No response", createdAt: new Date().toISOString() },
      ]);
    } catch (err) {
      setChat(prev => [
        ...prev,
        { role: "bot", text: `Error: ${err instanceof Error ? err.message : String(err)}`, createdAt: new Date().toISOString() },
      ]);
    } finally {
      setBusy(false);
    }
  }, [input, busy]);

  return (
    <div className="flex flex-col h-[calc(100vh-48px)] bg-[#050505]">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {chat.length === 0 && (
          <div className="text-center text-gray-600 text-xs py-20">
            <p className="text-[#00C2FF] font-mono font-bold text-sm mb-2 tracking-widest">J.E.F.F. COMMS</p>
            <p className="font-mono text-[11px]">Secure channel open. Ask about active threats, intelligence briefings, or strategic analysis.</p>
          </div>
        )}
        {chat.map((msg, i) => {
          const isUser = msg.role === "user";
          return (
            <div key={i} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
                isUser
                  ? "bg-[#00FF41]/10 border border-[#00FF41]/20 text-gray-200"
                  : "bg-[#0c0c0c] border border-white/5 text-gray-300"
              }`}>
                <div className="flex items-center gap-2 mb-0.5 text-[10px] text-gray-500">
                  <span className="font-semibold uppercase tracking-wide">{isUser ? "You" : "Jeff"}</span>
                  <span>{formatClock(msg.createdAt)}</span>
                </div>
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.text}</p>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <div className="border-t border-white/5 bg-[#0c0c0c] px-4 py-3">
        <div className="flex gap-2 max-w-3xl mx-auto">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Enter command or query..."
            className="flex-1 bg-[#050505] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-[#00FF41]/30"
            disabled={busy}
          />
          <button
            onClick={send}
            disabled={busy || !input.trim()}
            className="px-4 py-2.5 rounded-xl bg-[#00FF41]/10 text-[#00FF41] text-sm font-bold disabled:opacity-30 transition hover:bg-[#00FF41]/20"
          >
            {busy ? "..." : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
