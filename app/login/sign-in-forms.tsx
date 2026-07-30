// ============================================================
// app/login/sign-in-forms.tsx
//
// The two sign-in affordances, as Server Components wrapping server
// actions.
//
// Server actions rather than a client component calling next-auth's
// browser `signIn`: the credentials path then never ships the email or
// password through client JavaScript, and both forms keep working
// without hydration.
// ============================================================

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";

import { signIn } from "@/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function GithubSignInButton({ callbackUrl }: { callbackUrl?: string }) {
  async function signInWithGithub() {
    "use server";
    await signIn("github", { redirectTo: callbackUrl || "/dashboard" });
  }

  return (
    <form action={signInWithGithub}>
      <Button type="submit" className="w-full">
        Continue with GitHub
      </Button>
    </form>
  );
}

export function AdminPasswordForm({ callbackUrl }: { callbackUrl?: string }) {
  async function signInWithPassword(formData: FormData) {
    "use server";
    try {
      await signIn("credentials", {
        email: formData.get("email"),
        password: formData.get("password"),
        redirectTo: callbackUrl || "/dashboard",
      });
    } catch (error) {
      // signIn signals a successful redirect by throwing, so only a real
      // AuthError means the credentials were refused. Re-throwing
      // anything else keeps the redirect working.
      if (error instanceof AuthError) {
        redirect("/login?error=CredentialsSignin");
      }
      throw error;
    }
  }

  return (
    <form action={signInWithPassword} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="username" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      <Button type="submit" variant="secondary" className="w-full">
        Sign in with password
      </Button>
    </form>
  );
}
