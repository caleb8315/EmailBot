"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Citation {
  ref: string;
  source?: string;
  title?: string;
  url?: string;
}

type ChatMsg = { role: "user" | "bot"; text: string; createdAt: string; citations?: Citation[] };

function formatClock(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function renderTextWithCitations(text: string, citations: Citation[]): React.ReactNode[] {
  if (!citations.length) return [text];

  const parts: React.ReactNode[] = [];
  const refPattern = /\[E\d+\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = refPattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const ref = match[0];
    const cite = citations.find(c => c.ref === ref);
    if (cite?.url) {
      parts.push(
        <a key={`${ref}-${match.index}`} href={cite.url} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-0.5 text-[#00C2FF] hover:text-[#00FF41] font-mono text-[11px] font-bold transition"
          title={cite.title || cite.source || ref}
        >{ref}</a>
      );
    } else {
      parts.push(
        <span key={`${ref}-${match.index}`} className="text-[#00C2FF] font-mono text-[11px] font-bold"
          title={cite?.title || cite?.source || ref}
        >{ref}</span>
      );
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
}

export default function ChatPage() {
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [streamText, setStreamText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chat, streamText]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    const userMsg: ChatMsg = { role: "user", text, createdAt: new Date().toISOString() };
    setChat(prev => [...prev, userMsg]);
    setBusy(true);
    setStreamText("");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, stream: true }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || res.statusText);
      }

      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("text/event-stream") && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let accumulated = "";
        let citations: Citation[] = [];
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const payload = line.slice(6).trim();
            if (payload === "[DONE]") continue;

            try {
              const parsed = JSON.parse(payload);
              if (parsed.type === "text") {
                accumulated += parsed.content;
                setStreamText(accumulated);
              } else if (parsed.type === "citations") {
                citations = parsed.citations || [];
              }
            } catch {}
          }
        }

        setChat(prev => [
          ...prev,
          { role: "bot", text: accumulated || "(empty)", createdAt: new Date().toISOString(), citations },
        ]);
        setStreamText("");
      } else {
        const data = await res.json();
        setChat(prev => [
          ...prev,
          { role: "bot", text: data.reply || data.error || "No response", createdAt: new Date().toISOString(), citations: data.citations },
        ]);
      }
    } catch (err) {
      setChat(prev => [
        ...prev,
        { role: "bot", text: `Error: ${err instanceof Error ? err.message : String(err)}`, createdAt: new Date().toISOString() },
      ]);
    } finally {
      setBusy(false);
      setStreamText("");
    }
  }, [input, busy]);

  return (
    <div className="flex flex-col h-[calc(100vh-48px)] bg-[#050505]">
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {chat.length === 0 && !streamText && (
          <div className="text-center text-gray-600 text-xs py-20">
            <p className="text-[#00C2FF] font-mono font-bold text-sm mb-2 tracking-widest">J.E.F.F. COMMS</p>
            <p className="font-mono text-[11px]">Secure channel open. Ask about active threats, intelligence briefings, or strategic analysis.</p>
            <p className="font-mono text-[10px] text-gray-700 mt-2">Responses now cite live intel events with source links.</p>
          </div>
        )}
        {chat.map((msg, i) => {
          const isUser = msg.role === "user";
          return (
            <div key={i}>
              <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
                  isUser
                    ? "bg-[#00FF41]/10 border border-[#00FF41]/20 text-gray-200"
                    : "bg-[#0c0c0c] border border-white/5 text-gray-300"
                }`}>
                  <div className="flex items-center gap-2 mb-0.5 text-[10px] text-gray-500">
                    <span className="font-semibold uppercase tracking-wide">{isUser ? "You" : "Jeff"}</span>
                    <span>{formatClock(msg.createdAt)}</span>
                  </div>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">
                    {msg.citations?.length
                      ? renderTextWithCitations(msg.text, msg.citations)
                      : msg.text}
                  </p>
                </div>
              </div>
              {!isUser && msg.citations && msg.citations.length > 0 && (
                <div className="mt-1.5 ml-0 max-w-[85%]">
                  <div className="bg-[#0a0a0a] border border-white/5 rounded-xl px-3 py-2">
                    <p className="text-[9px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">SOURCES</p>
                    <div className="space-y-1">
                      {msg.citations.map((c, ci) => (
                        <div key={ci} className="flex items-center gap-2 text-[11px]">
                          <span className="text-[#00C2FF] font-mono font-bold shrink-0">{c.ref}</span>
                          {c.url ? (
                            <a href={c.url} target="_blank" rel="noopener noreferrer"
                              className="text-gray-400 hover:text-[#00C2FF] truncate transition">
                              {c.title || c.source || c.url}
                            </a>
                          ) : (
                            <span className="text-gray-500 truncate">{c.title || c.source || "intel event"}</span>
                          )}
                          {c.source && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-white/5 text-gray-600 shrink-0 uppercase">{c.source}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {streamText && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-2xl px-4 py-2.5 bg-[#0c0c0c] border border-white/5 text-gray-300">
              <div className="flex items-center gap-2 mb-0.5 text-[10px] text-gray-500">
                <span className="font-semibold uppercase tracking-wide">Jeff</span>
                <span className="animate-pulse">streaming...</span>
              </div>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{streamText}<span className="animate-pulse text-[#00FF41]">|</span></p>
            </div>
          </div>
        )}

        {busy && !streamText && (
          <div className="flex justify-start">
            <div className="rounded-2xl px-4 py-2.5 bg-[#0c0c0c] border border-white/5">
              <div className="flex gap-1.5">
                <span className="h-2 w-2 rounded-full bg-[#00FF41]/55 animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="h-2 w-2 rounded-full bg-[#00FF41]/55 animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="h-2 w-2 rounded-full bg-[#00FF41]/55 animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

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
