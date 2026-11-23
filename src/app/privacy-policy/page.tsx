import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy | Better OTU",
  description:
    "Privacy Policy for Better OTU, explaining Google OAuth data collection, Supabase storage with Row Level Security, limited use commitments, and account deletion.",
};

const CONTACT_EMAIL_PLACEHOLDER = "frankant36@gmail.com";
const LAST_UPDATED_DATE = "November 23, 2026";

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-[#F7F8FC] bg-[radial-gradient(ellipse_80%_45%_at_50%_-10%,rgba(186,230,253,0.40),transparent_65%),radial-gradient(ellipse_55%_40%_at_92%_6%,rgba(221,214,254,0.32),transparent_60%)] font-sans text-slate-800 dark:bg-[#0B0F19] dark:bg-[radial-gradient(ellipse_80%_45%_at_50%_-10%,rgba(56,189,248,0.11),transparent_65%),radial-gradient(ellipse_55%_40%_at_92%_6%,rgba(167,139,250,0.10),transparent_60%)] dark:text-slate-100">
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/85 px-4 py-3 shadow-[0_1px_12px_rgba(15,23,42,0.04)] backdrop-blur-md dark:border-slate-800/80 dark:bg-slate-900/85">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200/90 bg-white/90 px-3 py-1.5 text-xs font-medium text-slate-700 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-colors hover:border-sky-300 hover:bg-sky-50/60 hover:text-sky-900 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none dark:border-slate-700/80 dark:bg-slate-800/85 dark:text-slate-200 dark:hover:border-sky-700 dark:hover:text-sky-200"
          >
            <span aria-hidden="true">&larr;</span>
            <span>Back to Home</span>
          </Link>
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Better OTU
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        <article className="overflow-hidden rounded-2xl border border-slate-200/85 bg-white/95 shadow-[0_2px_16px_rgba(15,23,42,0.05)] backdrop-blur-sm dark:border-slate-800/85 dark:bg-slate-900/90">
          <div className="border-b border-slate-200/80 bg-gradient-to-r from-sky-50/90 via-white/95 to-indigo-50/60 px-6 py-6 sm:px-8 dark:border-slate-800 dark:from-sky-950/35 dark:via-slate-900/95 dark:to-indigo-950/25">
            <p className="text-xs font-semibold tracking-wider text-sky-700 uppercase dark:text-sky-300">
              Legal &amp; Data Disclosures
            </p>
            <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl dark:text-slate-50">
              Privacy Policy
            </h1>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Last updated: {LAST_UPDATED_DATE}
            </p>
          </div>

          <div className="space-y-8 px-6 py-7 text-sm leading-relaxed text-slate-700 sm:px-8 sm:py-8 dark:text-slate-300">
            <section aria-labelledby="app-identity">
              <h2
                id="app-identity"
                className="text-base font-semibold text-slate-900 dark:text-slate-100"
              >
                1. App Identity &amp; Purpose
              </h2>
              <p className="mt-2">
                <strong>Better OTU</strong> is an independent, student-built web
                application designed to help Ontario Tech University students
                view campus room availability, plan course timetables, and map
                out multi-year degree requirements. Better OTU is not officially
                affiliated with, sponsored by, or endorsed by Ontario Tech
                University.
              </p>
            </section>

            <section aria-labelledby="data-collected">
              <h2
                id="data-collected"
                className="text-base font-semibold text-slate-900 dark:text-slate-100"
              >
                2. Google User Data Collected
              </h2>
              <p className="mt-2">
                When you sign in with your{" "}
                <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-800 dark:bg-slate-800 dark:text-slate-200">
                  @ontariotechu.net
                </code>{" "}
                Google account using Google OAuth (requesting only the{" "}
                <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-slate-800">
                  openid
                </code>
                ,{" "}
                <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-slate-800">
                  email
                </code>
                , and{" "}
                <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-slate-800">
                  profile
                </code>{" "}
                scopes), Better OTU receives and accesses only:
              </p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5">
                <li>Your display name</li>
                <li>
                  Your{" "}
                  <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-slate-800">
                    @ontariotechu.net
                  </code>{" "}
                  email address
                </li>
                <li>Your Google profile picture URL and unique account ID</li>
              </ul>
              <p className="mt-3">
                We <strong>never</strong> see, collect, or store your Google
                password, nor do we request access to your Gmail, Google Drive,
                Google Calendar, or other private Google Workspace content.
              </p>
            </section>

            <section aria-labelledby="data-usage">
              <h2
                id="data-usage"
                className="text-base font-semibold text-slate-900 dark:text-slate-100"
              >
                3. How Your Data Is Used &amp; Stored
              </h2>
              <p className="mt-2">
                Your email address and user ID are used solely to:
              </p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5">
                <li>
                  Authenticate your session and verify eligibility for{" "}
                  <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-slate-800">
                    @ontariotechu.net
                  </code>{" "}
                  student access
                </li>
                <li>
                  Save and sync your personal course selections, selected
                  timetable CRNs, blocked times, custom schedule blocks, and
                  degree planner progress across sessions
                </li>
              </ul>
              <p className="mt-3">
                Account records and saved planner data are stored in our{" "}
                <strong>Supabase</strong> (PostgreSQL) database and protected
                with <strong>Row Level Security (RLS)</strong> policies so that
                only your authenticated account can read or modify your own
                records. Authentication session cookies are strictly used to
                keep you signed in.
              </p>
            </section>

            <section aria-labelledby="limited-use">
              <h2
                id="limited-use"
                className="text-base font-semibold text-slate-900 dark:text-slate-100"
              >
                4. Data Sharing &amp; Google API Limited Use
              </h2>
              <p className="mt-2">
                We <strong>do not sell, rent, trade, or share</strong> your
                Google user data with any third parties, advertisers, or data
                brokers. We do not use your Google user data for targeted
                advertising or to train AI/ML models.
              </p>
              <p className="mt-3">
                Better OTU&apos;s use and transfer to any other app of
                information received from Google APIs adheres to the{" "}
                <a
                  href="https://developers.google.com/terms/api-services-user-data-policy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-sky-700 underline decoration-sky-300 underline-offset-2 transition-colors hover:text-sky-900 dark:text-sky-300 dark:decoration-sky-700 dark:hover:text-sky-200"
                >
                  Google API Services User Data Policy
                </a>
                , including the Limited Use requirements.
              </p>
            </section>

            <section aria-labelledby="retention-deletion">
              <h2
                id="retention-deletion"
                className="text-base font-semibold text-slate-900 dark:text-slate-100"
              >
                5. Data Retention &amp; Deletion
              </h2>
              <p className="mt-2">
                We keep your profile information and saved schedule/degree
                planner data only for as long as your Better OTU account remains
                active.
              </p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5">
                <li>
                  <strong>Revoke Google Access:</strong> You can revoke Better
                  OTU&apos;s access to your Google account at any time in your{" "}
                  <a
                    href="https://myaccount.google.com/permissions"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-sky-700 underline decoration-sky-300 underline-offset-2 transition-colors hover:text-sky-900 dark:text-sky-300 dark:decoration-sky-700 dark:hover:text-sky-200"
                  >
                    Google Account Permissions
                  </a>{" "}
                  settings.
                </li>
                <li>
                  <strong>Request Account &amp; Data Deletion:</strong> To
                  permanently delete your Better OTU account and all saved
                  course and degree data from our database, please contact us at{" "}
                  <a
                    href={`mailto:${CONTACT_EMAIL_PLACEHOLDER}?subject=${encodeURIComponent("Better OTU Account Deletion Request")}`}
                    className="font-medium text-sky-700 underline decoration-sky-300 underline-offset-2 transition-colors hover:text-sky-900 dark:text-sky-300 dark:decoration-sky-700 dark:hover:text-sky-200"
                  >
                    {CONTACT_EMAIL_PLACEHOLDER}
                  </a>{" "}
                  from your{" "}
                  <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-slate-800">
                    @ontariotechu.net
                  </code>{" "}
                  email address.
                </li>
              </ul>
            </section>

            <section
              aria-labelledby="contact"
              className="rounded-xl border border-slate-200/80 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-950/50"
            >
              <h2
                id="contact"
                className="text-sm font-semibold text-slate-900 dark:text-slate-100"
              >
                Questions or Privacy Requests
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                If you have questions about this Privacy Policy or how your data
                is handled, reach out at{" "}
                <a
                  href={`mailto:${CONTACT_EMAIL_PLACEHOLDER}`}
                  className="font-medium text-sky-700 underline underline-offset-2 hover:text-sky-900 dark:text-sky-300 dark:hover:text-sky-200"
                >
                  {CONTACT_EMAIL_PLACEHOLDER}
                </a>
                .
              </p>
            </section>

            <div className="flex items-center border-t border-slate-200/80 pt-5 dark:border-slate-800">
              <Link
                href="/"
                className="inline-flex items-center gap-1.5 rounded-xl bg-sky-600 px-4 py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-sky-700 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none dark:bg-sky-500 dark:hover:bg-sky-600"
              >
                <span aria-hidden="true">&larr;</span>
                <span>Back to Home</span>
              </Link>
            </div>
          </div>
        </article>
      </main>
    </div>
  );
}
