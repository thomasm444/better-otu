import type { Metadata } from "next";

import { PrivacyPolicyFooterLink } from "./_components/privacy-policy-footer-link";

export const metadata: Metadata = {
  title: "Privacy Policy | Better OTU",
  description:
    "Privacy Policy for Better OTU, explaining Google OAuth data collection, Supabase storage with Row Level Security, limited use commitments, and account deletion.",
};

const CONTACT_EMAIL_PLACEHOLDER = "frankant36@gmail.com";
const LAST_UPDATED_DATE = "November 23, 2026";

export default function PrivacyPolicyPage() {
  return (
    <div className="flex-1 bg-canvas font-sans text-ink">
      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        <article className="overflow-hidden rounded-2xl border border-line bg-surface shadow-[var(--shadow-sm)]">
          <div className="border-b border-line-subtle bg-surface-subtle/50 px-6 py-6 sm:px-8">
            <p className="text-xs font-medium text-accent-ink">
              Legal &amp; Data Disclosures
            </p>
            <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-ink sm:text-3xl">
              Privacy Policy
            </h1>
            <p className="mt-2 text-xs text-ink-muted">
              Last updated: {LAST_UPDATED_DATE}
            </p>
          </div>

          <div className="space-y-8 px-6 py-7 text-sm leading-relaxed text-ink-secondary sm:px-8 sm:py-8">
            <section aria-labelledby="app-identity">
              <h2
                id="app-identity"
                className="text-base font-semibold text-ink"
              >
                1. App Identity &amp; Purpose
              </h2>
              <p className="mt-2">
                <strong className="font-semibold text-ink">Better OTU</strong>{" "}
                is an independent, student-built web application designed to
                help Ontario Tech University students view campus room
                availability, plan course timetables, and map out multi-year
                degree requirements. Better OTU is not officially affiliated
                with, sponsored by, or endorsed by Ontario Tech University.
              </p>
            </section>

            <section aria-labelledby="data-collected">
              <h2
                id="data-collected"
                className="text-base font-semibold text-ink"
              >
                2. Google User Data Collected
              </h2>
              <p className="mt-2">
                When you sign in with your{" "}
                <code className="rounded bg-surface-subtle px-1.5 py-0.5 font-mono text-xs font-medium text-ink">
                  @ontariotechu.net
                </code>{" "}
                Google account using Google OAuth (requesting only the{" "}
                <code className="rounded bg-surface-subtle px-1 py-0.5 font-mono text-xs text-ink">
                  openid
                </code>
                ,{" "}
                <code className="rounded bg-surface-subtle px-1 py-0.5 font-mono text-xs text-ink">
                  email
                </code>
                , and{" "}
                <code className="rounded bg-surface-subtle px-1 py-0.5 font-mono text-xs text-ink">
                  profile
                </code>{" "}
                scopes), Better OTU receives and accesses only:
              </p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5">
                <li>Your display name</li>
                <li>
                  Your{" "}
                  <code className="rounded bg-surface-subtle px-1 py-0.5 font-mono text-xs text-ink">
                    @ontariotechu.net
                  </code>{" "}
                  email address
                </li>
                <li>Your Google profile picture URL and unique account ID</li>
              </ul>
              <p className="mt-3">
                We <strong className="font-semibold text-ink">never</strong>{" "}
                see, collect, or store your Google password, nor do we request
                access to your Gmail, Google Drive, Google Calendar, or other
                private Google Workspace content.
              </p>
            </section>

            <section aria-labelledby="data-usage">
              <h2
                id="data-usage"
                className="text-base font-semibold text-ink"
              >
                3. How Your Data Is Used &amp; Stored
              </h2>
              <p className="mt-2">
                Your email address and user ID are used solely to:
              </p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5">
                <li>
                  Authenticate your session and verify eligibility for{" "}
                  <code className="rounded bg-surface-subtle px-1 py-0.5 font-mono text-xs text-ink">
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
                <strong className="font-semibold text-ink">Supabase</strong>{" "}
                (PostgreSQL) database and protected with{" "}
                <strong className="font-semibold text-ink">
                  Row Level Security (RLS)
                </strong>{" "}
                policies so that only your authenticated account can read or
                modify your own records. Authentication session cookies are
                strictly used to keep you signed in.
              </p>
            </section>

            <section aria-labelledby="limited-use">
              <h2
                id="limited-use"
                className="text-base font-semibold text-ink"
              >
                4. Data Sharing &amp; Google API Limited Use
              </h2>
              <p className="mt-2">
                We{" "}
                <strong className="font-semibold text-ink">
                  do not sell, rent, trade, or share
                </strong>{" "}
                your Google user data with any third parties, advertisers, or
                data brokers. We do not use your Google user data for targeted
                advertising or to train AI/ML models.
              </p>
              <p className="mt-3">
                Better OTU&apos;s use and transfer to any other app of
                information received from Google APIs adheres to the{" "}
                <a
                  href="https://developers.google.com/terms/api-services-user-data-policy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-accent-ink underline decoration-accent-line underline-offset-2 transition-colors hover:text-ink"
                >
                  Google API Services User Data Policy
                </a>
                , including the Limited Use requirements.
              </p>
            </section>

            <section aria-labelledby="retention-deletion">
              <h2
                id="retention-deletion"
                className="text-base font-semibold text-ink"
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
                  <strong className="font-semibold text-ink">
                    Revoke Google Access:
                  </strong>{" "}
                  You can revoke Better OTU&apos;s access to your Google account
                  at any time in your{" "}
                  <a
                    href="https://myaccount.google.com/permissions"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-accent-ink underline decoration-accent-line underline-offset-2 transition-colors hover:text-ink"
                  >
                    Google Account Permissions
                  </a>{" "}
                  settings.
                </li>
                <li>
                  <strong className="font-semibold text-ink">
                    Request Account &amp; Data Deletion:
                  </strong>{" "}
                  To permanently delete your Better OTU account and all saved
                  course and degree data from our database, please contact us at{" "}
                  <a
                    href={`mailto:${CONTACT_EMAIL_PLACEHOLDER}?subject=${encodeURIComponent("Better OTU Account Deletion Request")}`}
                    className="font-medium text-accent-ink underline decoration-accent-line underline-offset-2 transition-colors hover:text-ink"
                  >
                    {CONTACT_EMAIL_PLACEHOLDER}
                  </a>{" "}
                  from your{" "}
                  <code className="rounded bg-surface-subtle px-1 py-0.5 font-mono text-xs text-ink">
                    @ontariotechu.net
                  </code>{" "}
                  email address.
                </li>
              </ul>
            </section>

            <section
              aria-labelledby="contact"
              className="rounded-xl border border-line bg-surface-subtle/60 p-4"
            >
              <h2
                id="contact"
                className="text-sm font-semibold text-ink"
              >
                Questions or Privacy Requests
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                If you have questions about this Privacy Policy or how your data
                is handled, reach out at{" "}
                <a
                  href={`mailto:${CONTACT_EMAIL_PLACEHOLDER}`}
                  className="font-medium text-accent-ink underline decoration-accent-line underline-offset-2 hover:text-ink"
                >
                  {CONTACT_EMAIL_PLACEHOLDER}
                </a>
                .
              </p>
            </section>

            <div className="flex items-center border-t border-line-subtle pt-5">
              <PrivacyPolicyFooterLink />
            </div>
          </div>
        </article>
      </main>
    </div>
  );
}
