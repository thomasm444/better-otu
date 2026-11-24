"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AuthButton } from "./auth-button";

const NAV_ITEMS = [
  { href: "/", label: "Home" },
  { href: "/course-schedules", label: "Schedule" },
  { href: "/campus-map", label: "Map" },
  { href: "/degree-planner", label: "Planner" },
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
  const isHome = pathname === "/";
  const isLoginPage =
    pathname !== null &&
    (pathname === "/login" || pathname.startsWith("/login/"));

  const brandContent = (
    <>
      <Image
        src="/images/better-otu-logo-light.svg"
        alt=""
        width={24}
        height={24}
        priority
        className="block h-6 w-6 shrink-0 object-contain dark:hidden"
      />
      <Image
        src="/images/better-otu-logo-dark.svg"
        alt=""
        width={24}
        height={24}
        priority
        className="hidden h-6 w-6 shrink-0 object-contain dark:block"
      />
      <span>Better OTU</span>
    </>
  );

  return (
    <header
      className={
        isHome
          ? "relative z-[1200] h-[var(--site-nav-height,2.75rem)] min-h-[var(--site-nav-height,2.75rem)] w-full shrink-0 bg-canvas font-sans"
          : "sticky top-0 z-[1200] h-[var(--site-nav-height,2.75rem)] min-h-[var(--site-nav-height,2.75rem)] w-full shrink-0 border-b border-line-subtle bg-surface/95 font-sans backdrop-blur-sm"
      }
    >
      <div className="mx-auto flex h-full w-full max-w-[1600px] items-center justify-between gap-2 px-3 sm:px-6">
        {!isHome && (
          <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-6">
            {isLoginPage ? (
              <div className="inline-flex h-7 shrink-0 items-center gap-2 text-xs font-medium leading-none tracking-tight text-ink sm:text-sm">
                {brandContent}
              </div>
            ) : (
              <Link
                href="/"
                className="inline-flex h-7 shrink-0 items-center gap-2 rounded-md text-xs font-medium leading-none tracking-tight text-ink transition-colors hover:text-accent-ink focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none sm:text-sm"
              >
                {brandContent}
              </Link>
            )}

            {!isLoginPage && (
              <nav
                aria-label="Primary navigation"
                className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                {NAV_ITEMS.map((item) => {
                  const active =
                    pathname !== null && isActivePath(pathname, item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={`inline-flex h-7 shrink-0 items-center rounded-md px-2 text-xs font-medium leading-none whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none sm:px-2.5 sm:text-[13px] ${
                        active
                          ? "bg-accent-soft text-accent-ink ring-1 ring-inset ring-accent-line"
                          : "text-ink-secondary hover:bg-surface-subtle hover:text-ink"
                      }`}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </nav>
            )}
          </div>
        )}

        {!isLoginPage && (
          <div className="ml-auto flex shrink-0 items-center">{rightSlot}</div>
        )}
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
        <div className="h-7 w-24 rounded-md bg-surface-subtle" />
      }
    />
  );
}
