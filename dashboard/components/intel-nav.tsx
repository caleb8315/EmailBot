"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/ops", label: "Ops", icon: "M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7Zm10-1a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z" },
  { href: "/mind", label: "Mind", icon: "M12 2a5.5 5.5 0 0 0-4 9.5V15a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-3.5A5.5 5.5 0 0 0 12 2ZM9 18h6M10 21h4" },
  { href: "/map", label: "Map", icon: "M12 21c-4.97-4.97-8-8.65-8-12A8 8 0 0 1 20 9c0 3.35-3.03 7.03-8 12Zm0-9.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" },
  { href: "/hypotheses", label: "Hypos", icon: "M9 3v2m6-2v2M4 7h16M4 7v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7M9 11h6M9 15h4" },
  { href: "/arcs", label: "Arcs", icon: "M4 12h4l3-9 2 18 3-9h4" },
  { href: "/dreamtime", label: "Dream", icon: "M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" },
  { href: "/", label: "Home", icon: "M3 10.8 12 3l9 7.8M5.2 9.7V20a1 1 0 0 0 1 1h4v-6h4v6h3.8a1 1 0 0 0 1-1V9.7" },
] as const;

export default function IntelNav() {
  const pathname = usePathname();

  return (
    <>
      {/* Mobile bottom nav */}
      <nav
        className="fixed inset-x-0 bottom-0 z-50 border-t border-[#00C2FF]/25 bg-[#050505]/95 backdrop-blur-2xl md:hidden"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.5rem)" }}
      >
        <div className="grid grid-cols-6 gap-0.5 px-2 pt-2">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href;
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
                <span className="text-[9px] font-medium">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Desktop top nav */}
      <nav className="hidden md:block sticky top-0 z-50 border-b border-[#00C2FF]/20 bg-[#050505]/90 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-6 flex items-center gap-1 h-12">
          <Link href="/" className="text-[#00FF41] font-mono font-bold text-sm mr-6 tracking-tight">
            JEFF
          </Link>
          {NAV_ITEMS.filter(i => i.href !== "/").map((item) => {
            const active = pathname === item.href;
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
          <Link
            href="/predictions"
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              pathname === "/predictions"
                ? "bg-[#00FF41]/10 text-[#00FF41]"
                : "text-[#A3A3A3]/60 hover:text-[#A3A3A3] hover:bg-white/5"
            }`}
          >
            Predictions
          </Link>
        </div>
      </nav>
    </>
  );
}
