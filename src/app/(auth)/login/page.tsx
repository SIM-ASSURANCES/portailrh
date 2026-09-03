import Image from "next/image";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";

import { Icon } from "@/components/icons";
import { BrandBackdrop, Input } from "@/components/ui";
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
    <div className="relative flex flex-1 items-center justify-center overflow-hidden border-[3px] border-primary bg-surface px-4 py-12">
      {/* Papier à en-tête institutionnel (page de connexion = première
          impression) : fond blanc + filigrane du pictogramme + filet
          dégradé en bas, voir CLAUDE.md "Logo vectoriel et fond de marque".
          Le bandeau du logo dans la carte ci-dessous reste en aplat uni :
          jamais le filigrane directement derrière le logo, pour ne jamais
          nuire à sa lisibilité (règle de la charte graphique). */}
      <BrandBackdrop className="absolute inset-0 h-full w-full" />

      <div className="animate-fade-in-up relative w-full max-w-sm overflow-hidden rounded-2xl border border-border bg-surface shadow-elevated">
        <div className="flex items-center justify-center bg-primary px-6 py-5">
          <Image
            src="/logo-sim-blanc.svg"
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
