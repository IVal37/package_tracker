import { redirect } from "next/navigation";
import { SignInForm } from "@/components/sign-in-form";
import { Wordmark } from "@/components/wordmark";
import { getCurrentUser } from "@/lib/auth/session";
import { signInWithEmail, signInWithGoogle } from "./actions";

const ERRORS: Record<string, string> = {
  auth: "That sign-in link didn't work. Please request a new one.",
  google: "We couldn't start Google sign-in. Please try again.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await getCurrentUser()) redirect("/");

  const { error } = await searchParams;
  const message = error ? ERRORS[error] : undefined;

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4">
      <Wordmark />
      {message && (
        <p
          role="alert"
          className="rounded-md bg-red-50 p-3 text-sm text-red-700"
        >
          {message}
        </p>
      )}
      <SignInForm action={signInWithEmail} />
      <div className="text-center text-xs text-slate-400">or</div>
      <form action={signInWithGoogle}>
        <button
          type="submit"
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-medium hover:bg-slate-50"
        >
          Continue with Google
        </button>
      </form>
    </main>
  );
}
