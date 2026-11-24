import type { Metadata } from "next";

import { LoginCard } from "./_components/login-card";

export const metadata: Metadata = {
  title: "Sign In | Better OTU",
  description:
    "Sign in with your @ontariotechu.net Google account to access Better OTU.",
};

export default function LoginPage() {
  return (
    <main className="flex w-full flex-1 flex-col items-center justify-center bg-canvas px-4 py-10 font-sans text-ink">
      <LoginCard />
    </main>
  );
}
