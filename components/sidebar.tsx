"use client";

/**
 * Sidebar Navigation
 *
 * Text-only nav with active state and workspace section.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  BarChart3,
  Inbox,
  Megaphone,
  CalendarDays,
  ScrollText,
  Settings,
  Stethoscope,
} from "lucide-react";

function XLogo(props: { className?: string; strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={props.className}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.657l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

const navItems = [
  { label: "Boshqaruv paneli", href: "/dashboard", icon: LayoutDashboard },
  { label: "Umumiy ko'rinish", href: "/overview", icon: BarChart3 },
  { label: "Kiruvchi xabarlar", href: "/inbox", icon: Inbox },
  { label: "Kampaniyalar", href: "/campaigns", icon: Megaphone },
  { label: "Avtopost", href: "/posts", icon: CalendarDays },
  { label: "X", href: "/x", icon: XLogo },
  { label: "DM jurnali", href: "/logs", icon: ScrollText },
  { label: "Sozlamalar", href: "/settings", icon: Settings },
  { label: "Diagnostika", href: "/diagnostics", icon: Stethoscope },
];

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceName: string;
}

export default function Sidebar({
  isOpen,
  onClose,
  workspaceName,
}: SidebarProps) {
  const pathname = usePathname();

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`
          fixed top-0 left-0 z-50 h-dvh w-64 max-w-[85vw] shrink-0 bg-surface border-r border-border flex flex-col
          transition-transform duration-200 ease-out
          lg:h-full lg:translate-x-0 lg:static lg:z-auto
          ${isOpen ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        {/* Same reason as the top bar: the drawer is full height, so the
            wordmark would otherwise land under the status bar. */}
        <div
          className="px-6 py-5 border-b border-border"
          style={{ paddingTop: "calc(1.25rem + env(safe-area-inset-top))" }}
        >
          <Link href="/dashboard" className="text-base font-semibold">
            OpenReply
          </Link>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const isActive =
              pathname === item.href || pathname.startsWith(item.href + "/");
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                aria-current={isActive ? "page" : undefined}
                className={`
                  flex items-center gap-3 px-3 py-2.5 rounded text-sm
                  ${
                    isActive
                      ? "bg-surface-hover text-foreground font-medium"
                      : "text-muted hover:text-foreground hover:bg-surface-hover"
                  }
                `}
              >
                <Icon className="h-4 w-4 shrink-0" strokeWidth={2} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="px-5 py-4 border-t border-border">
          <p className="text-sm text-foreground truncate">{workspaceName}</p>
          <p className="text-xs text-muted">O'z serverida</p>
        </div>
      </aside>
    </>
  );
}
