"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase";

const PRIMARY_NAV = [
  { href: "/ops", label: "Ops", icon: "M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7Zm10-1a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z" },
  { href: "/intel", label: "Intel", icon: "M12 2a5.5 5.5 0 0 0-4 9.5V15a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-3.5A5.5 5.5 0 0 0 12 2ZM9 18h6M10 21h4" },
  { href: "/chat", label: "Chat", icon: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" },
  { href: "/settings", label: "Settings", icon: "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" },
] as const;

export default function IntelNav() {
  const pathname = usePathname();

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  };

  const isActive = (href: string) => {
    if (href === "/ops") return pathname === "/ops" || pathname === "/map" || pathname === "/";
    if (href === "/intel") return pathname === "/intel" || pathname === "/mind" || pathname === "/hypotheses" || pathname === "/arcs" || pathname === "/dreamtime" || pathname === "/predictions";
    return pathname === href;
  };

  return (
    <>
      {/* Mobile bottom nav — 4 items */}
      <nav
        className="fixed inset-x-0 bottom-0 z-50 border-t border-[#00C2FF]/25 bg-[#050505]/95 backdrop-blur-2xl md:hidden"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.5rem)" }}
      >
        <div className="grid grid-cols-4 gap-0.5 px-4 pt-2">
          {PRIMARY_NAV.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-col items-center gap-0.5 py-1.5 transition-colors ${
                  active ? "text-[#00FF41]" : "text-[#A3A3A3]/50"
                }`}
              >
                <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d={item.icon} />
                </svg>
                <span className="text-[10px] font-medium">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Desktop top nav */}
      <nav className="hidden md:block sticky top-0 z-50 border-b border-[#00C2FF]/20 bg-[#050505]/90 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 flex items-center gap-1 h-11">
          <Link href="/ops" className="text-[#00FF41] font-mono font-bold text-sm mr-6 tracking-tight">
            JEFF INTEL
          </Link>
          {PRIMARY_NAV.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  active
                    ? "bg-[#00FF41]/10 text-[#00FF41]"
                    : "text-[#A3A3A3]/60 hover:text-[#A3A3A3] hover:bg-white/5"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
          <div className="flex-1" />
          <button
            onClick={handleSignOut}
            className="px-3 py-1.5 rounded-md text-xs font-medium text-[#A3A3A3]/40 hover:text-red-400 hover:bg-red-500/5 transition-colors"
          >
            Sign out
          </button>
        </div>
      </nav>
    </>
  );
}
