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
      // "Se souvenir de moi" (voir CLAUDE.md "Se souvenir de moi") : une
      // case à cocher non cochée n'apparaît PAS dans `formData` (comportement
      // natif HTML des checkbox) — `=== "on"` couvre les deux cas sans avoir
      // besoin de tester l'absence explicitement.
      rememberMe: formData.get("rememberMe") === "on" ? "true" : "false",
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
  searchParams: Promise<{ error?: string; callbackUrl?: string; activated?: string }>;
}) {
  const { error, callbackUrl, activated } = await searchParams;

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

          {/* Déconnexion automatique après inactivité (voir CLAUDE.md
              "Déconnexion automatique après inactivité") — message distinct
              de l'échec de connexion, `error` réutilisé avec une valeur
              dédiée plutôt qu'un nouveau paramètre séparé (même convention
              que `activated` ci-dessous, un paramètre par cas de figure). */}
          {error === "inactivite" ? (
            <p className="animate-fade-in-up flex items-start gap-2 rounded-md border border-warning-border bg-warning-bg px-3 py-2 text-sm text-warning">
              <Icon name="alert-triangle" className="mt-0.5 size-4 shrink-0" />
              Vous avez été déconnecté après une période d&apos;inactivité.
            </p>
          ) : error ? (
            <p className="animate-fade-in-up flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger">
              <Icon name="alert-triangle" className="mt-0.5 size-4 shrink-0" />
              Email ou mot de passe incorrect.
            </p>
          ) : null}

          {/* Invitation par lien finalisée avec succès (voir CLAUDE.md
              "Invitation par lien") — redirection directe depuis
              `activerInvitationAction`, jamais un toast affiché sur une
              page publique quittée immédiatement après. */}
          {activated ? (
            <p className="animate-fade-in-up flex items-start gap-2 rounded-md border border-success-border bg-success-bg px-3 py-2 text-sm text-success">
              <Icon name="check-circle" className="mt-0.5 size-4 shrink-0" />
              Compte activé avec succès. Vous pouvez maintenant vous connecter.
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

          {/* "Se souvenir de moi" (voir CLAUDE.md) : décochée par défaut
              (session courte, 1 jour) — jamais pré-cochée, cohérent avec le
              principe "sécurisé par défaut" du reste du portail. */}
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              name="rememberMe"
              className="h-4 w-4 rounded border-border accent-primary"
            />
            Se souvenir de moi
          </label>

          <LoginSubmitButton />
        </form>
      </div>
    </div>
  );
}
