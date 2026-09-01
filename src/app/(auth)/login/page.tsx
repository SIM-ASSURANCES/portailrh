import Image from "next/image";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";

import { Icon } from "@/components/icons";
import { Input } from "@/components/ui";
import { signIn } from "@/lib/auth";

import { LoginSubmitButton } from "./LoginSubmitButton";

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
    <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-app-bg px-4 py-12">
      {/* Décor discret : simple accent de la couleur institutionnelle, jamais
          une nouvelle couleur — dérivé de --color-primary via color-mix,
          purement décoratif (aucun contenu, aria-hidden). */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,color-mix(in_srgb,var(--color-primary)_10%,transparent),transparent_55%),radial-gradient(circle_at_85%_85%,color-mix(in_srgb,var(--color-primary)_6%,transparent),transparent_50%)]"
      />

      <div className="animate-fade-in-up relative w-full max-w-sm overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
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
            <h1 className="text-lg font-bold text-foreground">Connexion</h1>
            <p className="mt-1 text-sm text-muted-foreground">Portail interne SIM Assurances</p>
          </div>

          {error ? (
            <p className="animate-fade-in-up flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger">
              <Icon name="alert-triangle" className="mt-0.5 size-4 shrink-0" />
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

          <LoginSubmitButton />
        </form>
      </div>
    </div>
  );
}
