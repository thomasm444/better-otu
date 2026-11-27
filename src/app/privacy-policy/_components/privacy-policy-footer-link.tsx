"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";

/**
 * Auth-aware footer action on the Privacy Policy page.
 * Unauthenticated visitors see "Sign in" linking to `/login`;
 * signed-in users see "Back to Home" linking to `/`.
 */
export function PrivacyPolicyFooterLink() {
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    let active = true;

    supabase.auth.getUser().then(({ data }) => {
      if (!active) return;
      setSignedIn(Boolean(data.user));
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setSignedIn(Boolean(session?.user));
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  return (
    <Link
      href={signedIn ? "/" : "/login"}
      className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-xs font-medium text-brand-fg transition-colors hover:bg-brand-hover focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
    >
      <span aria-hidden="true">&larr;</span>
      <span>{signedIn ? "Back to Home" : "Sign in"}</span>
    </Link>
  );
}
