"use client";

import { useActionState } from "react";
import { LockKeyhole } from "lucide-react";

import { Button } from "@/components/ui/button";
import { authenticate } from "./actions";

const inputClass =
  "h-11 w-full rounded-md border border-hairline bg-canvas px-3 text-[15px] text-ink " +
  "placeholder:text-ink-mute outline-none transition-colors focus:border-brand " +
  "focus:ring-2 focus:ring-brand/25";

export function SignInForm() {
  const [errorMessage, formAction, isPending] = useActionState(
    authenticate,
    undefined,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input
        id="username"
        name="username"
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        required
        placeholder="Username"
        aria-label="Username"
        className={inputClass}
      />

      <input
        id="password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        placeholder="Password"
        aria-label="Password"
        className={inputClass}
      />

      {errorMessage && (
        <p role="alert" className="text-caption text-red-600">
          {errorMessage}
        </p>
      )}

      <Button
        type="submit"
        disabled={isPending}
        className="mt-1 h-11 w-full rounded-full text-[15px]"
      >
        <LockKeyhole className="size-4" />
        {isPending ? "Flying in…" : "Fly In"}
      </Button>
    </form>
  );
}
