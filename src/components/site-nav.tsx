"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AuthButton } from "./auth-button";

const NAV_ITEMS = [
  { href: "/", label: "Home" },
  { href: "/course-schedules", label: "Schedule" },
  { href: "/degree-planner", label: "Planner" },
  { href: "/campus-map", label: "Map" },
] as const;

function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavChrome({
  pathname,
  rightSlot,
}: {
  pathname: string | null;
  rightSlot: React.ReactNode;
}) {
  return (
    <header className="sticky top-0 z-[1200] h-[var(--site-nav-height,2.75rem)] shrink-0 border-b border-black/[.08] bg-white/95 backdrop-blur-sm dark:border-white/[.12] dark:bg-zinc-950/95">
      <div className="mx-auto flex h-full max-w-[1600px] items-center justify-between gap-1.5 px-2 sm:gap-2 sm:px-5">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-5">
          <Link
            href="/"
            className="inline-flex shrink-0 items-center gap-2 text-xs font-semibold tracking-tight text-zinc-900 transition-colors hover:text-[#0077CA] sm:text-sm dark:text-zinc-100"
          >
            <Image
              src="/images/better-otu-logo-light.svg"
              alt=""
              width={28}
              height={28}
              priority
              className="block h-7 w-7 shrink-0 object-contain dark:hidden"
            />
            <Image
              src="/images/better-otu-logo-dark.svg"
              alt=""
              width={28}
              height={28}
              priority
              className="hidden h-7 w-7 shrink-0 object-contain dark:block"
            />
            <span>Better OTU</span>
          </Link>

          <nav
            aria-label="Primary navigation"
            className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:gap-1"
          >
            {NAV_ITEMS.map((item, idx) => {
              const active = pathname !== null && isActivePath(pathname, item.href);
              return (
                <div key={item.href} className="flex shrink-0 items-center">
                  {idx > 0 && (
                    <span
                      aria-hidden="true"
                      className="mx-0.5 hidden select-none text-xs text-zinc-300 dark:text-zinc-700 sm:inline"
                    >
                      ·
                    </span>
                  )}
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`rounded-md px-1.5 py-1 text-[11px] font-medium transition-colors whitespace-nowrap sm:px-2.5 sm:text-[13px] ${
                      active
                        ? "bg-[#003C71]/10 text-[#003C71] dark:bg-[#0077CA]/20 dark:text-sky-300"
                        : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/80 dark:hover:text-zinc-100"
                    }`}
                  >
                    {item.label}
                  </Link>
                </div>
              );
            })}
          </nav>
        </div>

        <div className="shrink-0">{rightSlot}</div>
      </div>
    </header>
  );
}

export function SiteNav() {
  const pathname = usePathname();
  const profileActive =
    pathname === "/profile" || pathname.startsWith("/profile/");

  return (
    <NavChrome
      pathname={pathname}
      rightSlot={<AuthButton compact isProfileActive={profileActive} />}
    />
  );
}

export function SiteNavFallback() {
  return (
    <NavChrome
      pathname={null}
      rightSlot={
        <div className="h-7 w-24 animate-pulse rounded-md bg-zinc-200 dark:bg-zinc-800" />
      }
    />
  );
}
