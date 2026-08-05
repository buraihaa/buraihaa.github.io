import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { SignInForm } from "./sign-in-form";

export default async function SignInPage() {
  // Already signed in? Nothing to do here.
  const session = await auth();
  if (session?.user) redirect("/");

  return (
    <main className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-md flex-col justify-center px-4 py-12">
      <div className="rounded-2xl border border-hairline bg-canvas p-6 shadow-sm sm:p-8">
        <h1 className="text-display font-semibold text-ink">Birds Only!</h1>
        <div className="mt-6">
          <SignInForm />
        </div>
      </div>
    </main>
  );
}
