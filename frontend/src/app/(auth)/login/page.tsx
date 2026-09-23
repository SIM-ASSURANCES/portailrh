import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";

import { Icon } from "@/components/icons";
import { Input } from "@/components/ui";
import { getSession, signIn } from "@/lib/auth";
import { headers } from "next/headers";
import { checkRateLimit } from "@/lib/rate-limit";

import { AuthShell } from "../AuthShell";
import { LoginSubmitButton } from "./LoginSubmitButton";

async function authenticate(formData: FormData) {
  "use server";

  // Normalisé pour la seule clé de limitation de débit : "Admin@x" et
  // "admin@x " partagent ainsi le même quota (sinon, varier la casse
  // offrait des tentatives supplémentaires). La recherche du compte, elle,
  // est normalisée dans authorize() (src/lib/auth.ts).
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const headersList = await headers();
  const rawIp = headersList.get("x-forwarded-for") || "IP_INCONNUE";
  const ip = rawIp.replace(/^::ffff:/, "");

  // Limite à 5 tentatives par minute par IP+email
  const rlKey = `login_${ip}_${email}`;
  if (!checkRateLimit(rlKey, 5, 60 * 1000)) {
    const callbackUrl = String(formData.get("callbackUrl") || "/");
    redirect(`/login?error=2&callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }

  try {
    const rawCallbackUrl = String(formData.get("callbackUrl") || "/");
    const callbackUrl =
      rawCallbackUrl.startsWith("/") && !rawCallbackUrl.startsWith("/login")
        ? rawCallbackUrl
        : "/";
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      // "Se souvenir de moi" (voir CLAUDE.md "Se souvenir de moi") : une
      // case à cocher non cochée n'apparaît PAS dans `formData` (comportement
      // natif HTML des checkbox) — `=== "on"` couvre les deux cas sans avoir
      // besoin de tester l'absence explicitement.
      rememberMe: formData.get("rememberMe") === "on" ? "true" : "false",
      redirectTo: callbackUrl,
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
  searchParams: Promise<{
    error?: string;
    callbackUrl?: string;
    activated?: string;
    reset?: string;
  }>;
}) {
  const session = await getSession();
  if (session) {
    redirect("/");
  }

  const { error, callbackUrl, activated, reset } = await searchParams;

  return (
    <AuthShell tagline="Gérez vos demandes, validations et règlements de trésorerie depuis un espace unique et sécurisé.">
      <form action={authenticate} className="space-y-4">
        <div>
          <h1 className="text-xl font-bold text-foreground">Connexion</h1>
          <p className="mt-1 text-sm text-muted-foreground">Portail interne SIM Assurances</p>
        </div>

        {/* Déconnexion automatique après inactivité (voir CLAUDE.md
            "Déconnexion automatique après inactivité") — message distinct
            de l'échec de connexion, `error` réutilisé avec une valeur
            dédiée plutôt qu'un nouveau paramètre séparé (même convention
            que `activated` ci-dessous, un paramètre par cas de figure).
            Trois branches désormais : inactivité (orange, avertissement),
            limite de tentatives dépassée (rouge, `error=2`, voir
            `checkRateLimit` ci-dessus), puis le cas générique (identifiants
            invalides). */}
        {error === "inactivite" ? (
          <p className="animate-fade-in-up flex items-start gap-2 rounded-md border border-warning-border bg-warning-bg px-3 py-2 text-sm text-warning">
            <Icon name="alert-triangle" className="mt-0.5 size-4 shrink-0" />
            Vous avez été déconnecté après une période d&apos;inactivité.
          </p>
        ) : error === "2" ? (
          <p className="animate-fade-in-up flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger">
            <Icon name="alert-triangle" className="mt-0.5 size-4 shrink-0" />
            Trop de tentatives. Veuillez réessayer dans une minute.
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

        {reset === "success" ? (
          <p className="animate-fade-in-up flex items-start gap-2 rounded-md border border-success-border bg-success-bg px-3 py-2 text-sm text-success">
            <Icon name="check-circle" className="mt-0.5 size-4 shrink-0" />
            Votre mot de passe a été réinitialisé avec succès. Vous pouvez maintenant vous connecter.
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

        {/* "Se souvenir de moi" + Lien "Mot de passe oublié ?" */}
        <div className="flex items-center justify-between text-sm">
          <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
            <input
              type="checkbox"
              name="rememberMe"
              className="h-4 w-4 rounded border-border accent-primary"
            />
            Se souvenir de moi
          </label>
          <Link
            href="/forgot-password"
            className="text-xs font-medium text-primary hover:underline"
          >
            Mot de passe oublié ?
          </Link>
        </div>

        <LoginSubmitButton />
      </form>
    </AuthShell>
  );
}
