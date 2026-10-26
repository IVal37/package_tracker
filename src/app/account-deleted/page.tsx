import Link from "next/link";
import { ClearOfflineCache } from "@/components/clear-offline-cache";
import { Wordmark } from "@/components/wordmark";

/** Where a deleted account lands. Public: there is no session any more. */
export default async function AccountDeletedPage({
  searchParams,
}: {
  searchParams: Promise<{ signin?: string | string[] }>;
}) {
  const { signin } = await searchParams;
  const signInKept = signin === "kept";

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-4">
      {/* Nothing of the deleted account should stay on this device. */}
      <ClearOfflineCache />
      <Wordmark />
      <h1 className="text-lg font-semibold">Your account is deleted</h1>
      <p className="text-sm text-slate-600">
        Your packages, orders, forwarded emails, alert settings and devices have
        been removed from Wayfind.
      </p>
      {signInKept && (
        <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
          Your sign-in could not be removed just now. It holds no data, and we
          have been told so we can remove it. Signing in again would start a
          new, empty account.
        </p>
      )}
      <Link href="/sign-in" className="text-sm text-link hover:underline">
        Back to sign-in
      </Link>
    </main>
  );
}
