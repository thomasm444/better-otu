import type { Metadata } from "next";

import { LoginCard } from "./_components/login-card";

export const metadata: Metadata = {
  title: "Sign In | Better OTU",
  description:
    "Sign in with your @ontariotechu.net Google account to access Better OTU.",
};

export default function LoginPage() {
  return (
    <main className="flex min-h-screen w-full flex-1 flex-col items-center justify-center bg-zinc-50 px-4 py-12 font-sans dark:bg-zinc-950">
      <LoginCard />
    </main>
  );
}
