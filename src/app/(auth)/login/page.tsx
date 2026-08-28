import Image from "next/image";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";

import { Button, Input } from "@/components/ui";
import { signIn } from "@/lib/auth";

async function authenticate(formData: FormData) {
  "use server";

  try {
    const callbackUrl = String(formData.get("callbackUrl") || "/");
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo: callbackUrl.startsWith("/") ? callbackUrl : "/",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      const callbackUrl = String(formData.get("callbackUrl") || "/");
      redirect(`/login?error=1&callbackUrl=${encodeURIComponent(callbackUrl)}`);
    }
    throw error;
  }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  const { error, callbackUrl } = await searchParams;

  return (
    <div className="flex flex-1 items-center justify-center bg-app-bg px-4 py-12">
      <div className="w-full max-w-sm overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-center bg-primary px-6 py-5">
          <Image
            src="/logo-sim-blanc.webp"
            alt="SIM Assurances"
            width={190}
            height={28}
            priority
          />
        </div>

        <form action={authenticate} className="space-y-4 p-8">
          <div>
            <h1 className="text-lg font-bold text-slate-900">Connexion</h1>
            <p className="mt-1 text-sm text-slate-500">Portail interne SIM Assurances</p>
          </div>

          {error ? (
            <p className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">
              Email ou mot de passe incorrect.
            </p>
          ) : null}

          <Input label="Email" name="email" type="email" required autoComplete="email" />
          <Input
            label="Mot de passe"
            name="password"
            type="password"
            required
            autoComplete="current-password"
          />
          <input type="hidden" name="callbackUrl" value={callbackUrl ?? "/"} />

          <Button type="submit" className="w-full">
            Se connecter
          </Button>
        </form>
      </div>
    </div>
  );
}
