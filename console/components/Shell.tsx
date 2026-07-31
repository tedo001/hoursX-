"use client";

/** Authenticated app frame: sidebar navigation + content area. */

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { getToken, setToken } from "@/lib/api";

const NAV = [
  { href: "/", label: "Sessions" },
  { href: "/agents", label: "Agents" },
  { href: "/knowledge", label: "Knowledge" },
  { href: "/approvals", label: "Approvals" },
];

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!getToken()) router.replace("/login");
  }, [router]);

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 flex-col border-r border-ink-700 bg-ink-900 p-4">
        <Link href="/" className="mb-8 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-pulse-500 font-black text-ink-950">
            hX
          </span>
          <span className="text-lg font-bold tracking-tight">HoursX</span>
        </Link>
        <nav className="flex flex-1 flex-col gap-1">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-lg px-3 py-2 text-sm ${
                pathname === item.href
                  ? "bg-ink-800 font-semibold text-pulse-400"
                  : "text-slate-400 hover:bg-ink-800 hover:text-slate-200"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <button
          className="btn-ghost mt-4"
          onClick={() => {
            setToken(null);
            router.replace("/login");
          }}
        >
          Sign out
        </button>
      </aside>
      <main className="flex-1 overflow-y-auto p-8">{children}</main>
    </div>
  );
}
