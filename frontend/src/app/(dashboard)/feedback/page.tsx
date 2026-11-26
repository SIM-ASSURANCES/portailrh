import Link from "next/link";
import { redirect } from "next/navigation";

import { BRAND_ICON_PATHS, BRAND_ICON_VIEWBOX } from "@/components/ui/brandIcon";
import { Icon, type IconName } from "@/components/icons";
import { getSession, hasPermission } from "@/lib/auth";
import {
  CIBLE_CONDITIONS_TRAVAIL,
  clesQuotaDejaUtilisees,
  empreinteQuotaFeedback,
  getFeedbackRecipients,
  jourCourant,
  type FeedbackRecipientOption,
} from "backend";

import { FeedbackForm } from "./FeedbackForm";

export const metadata = {
  title: "FeedbackApp | SIM Assurances",
  description: "Avis anonymes et structurés — collaboration entre collègues et conditions de travail.",
};

/** Badge de réassurance (Anonyme / Constructif / Sécurisé) — même pattern
 * que `FinanceActionCard.tsx` (badge d'icône teinté), jamais un emoji brut. */
function ReassuranceCard({
  icon,
  tone,
  title,
  description,
}: {
  icon: IconName;
  tone: "primary" | "success" | "info";
  title: string;
  description: string;
}) {
  const toneClasses = {
    primary: "bg-primary-bg text-primary",
    success: "bg-success-bg text-success",
    info: "bg-info-bg text-info",
  }[tone];

  return (
    <div className="card-shadow-hover flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5 shadow-elevated transition-transform duration-200 ease-out-strong motion-safe:hover:-translate-y-0.5">
      <span className={`inline-grid size-11 place-items-center rounded-xl ${toneClasses}`}>
        <Icon name={icon} className="size-5" />
      </span>
      <div>
        <p className="text-sm font-bold text-foreground">{title}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

/** Bandeau hero — dégradé + texture de marque CONTENUS au bandeau lui-même
 * (voir globals.css `.brand-gradient-bg` pour pourquoi ce n'est jamais le
 * fond de toute la page). */
function FeedbackHero() {
  return (
    <div className="brand-gradient-bg relative overflow-hidden rounded-3xl px-6 py-10 text-white shadow-elevated-lg sm:px-10 sm:py-14">
      <svg
        viewBox={BRAND_ICON_VIEWBOX}
        className="pointer-events-none absolute -right-10 -top-10 size-56 opacity-[0.12] sm:size-72"
        aria-hidden="true"
      >
        {BRAND_ICON_PATHS.map((d) => (
          <path key={d} d={d} fill="currentColor" />
        ))}
      </svg>
      <div className="relative max-w-2xl">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold backdrop-blur-sm">
          <Icon name="lock" className="size-3.5" />
          Avis anonyme
        </span>
        <h1 className="mt-4 text-3xl font-black leading-tight tracking-tight sm:text-4xl">
          Votre avis compte,{" "}
          <span className="text-[#bfe0f7]">en toute confidentialité</span>
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/85 sm:text-[15px]">
          Notez votre collaboration avec un collègue ou partagez votre ressenti sur les conditions
          de travail chez SIM Assurances.
        </p>
        <p data-texte-anonymat className="mt-3 max-w-xl text-sm font-semibold leading-relaxed text-white sm:text-[15px]">
          Votre avis est anonyme : ni la RH, ni la Direction, ni personne d&apos;autre ne peut voir qui
          l&apos;a écrit. Pour limiter chaque personne à un avis par collègue et par jour, le portail
          conserve une trace technique chiffrée jusqu&apos;au lendemain, puis l&apos;efface
          automatiquement. Les avis sur les conditions de travail sont lus uniquement par la RH et la
          Direction générale.
        </p>
      </div>
    </div>
  );
}

/**
 * Ce que le compte connecté a déjà donné aujourd'hui, pour l'annoncer dans le formulaire (confort seulement : la Server
 * Action reste la seule autorité). Les empreintes sont calculées pour SON propre compte et ne quittent pas le serveur.
 */
async function avisDejaDonnesAujourdhui(userId: string, recipients: FeedbackRecipientOption[]) {
  const jour = jourCourant();
  try {
    const cibles = [...recipients.map((r) => r.id), CIBLE_CONDITIONS_TRAVAIL];
    const parCle = new Map(
      cibles.map((cible) => [
        empreinteQuotaFeedback({ secret: process.env.AUTH_SECRET, auteurId: userId, cible, jour }),
        cible,
      ])
    );
    const utilisees = await clesQuotaDejaUtilisees([...parCle.keys()], jour);
    const dejaDonnes = new Set([...utilisees].map((cle) => parCle.get(cle)));
    return {
      collegues: recipients.filter((r) => dejaDonnes.has(r.id)).map((r) => r.id),
      conditionsTravail: dejaDonnes.has(CIBLE_CONDITIONS_TRAVAIL),
    };
  } catch {
    // Jamais journalisé. Sans information, le formulaire reste ouvert et le serveur tranche à l'envoi.
    return { collegues: [], conditionsTravail: false };
  }
}

/**
 * Page du module FeedbackApp — hero, réassurance et formulaire (les deux onglets, voir `FeedbackForm.tsx`). Module
 * privé : la session est revérifiée ici, en plus du middleware. Les avis eux-mêmes ne sont listés nulle part sur cette
 * page (« Mes critiques reçues » pour le destinataire, modération pour les comptes habilités).
 */
export default async function FeedbackPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const canRecevoir = session.peutRecevoirFeedback === true;
  const canModerer = hasPermission(session, "feedback.moderer");
  const recipients = await getFeedbackRecipients(session.user.id);
  const dejaDonnes = await avisDejaDonnesAujourdhui(session.user.id, recipients);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-10">
      <FeedbackHero />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <ReassuranceCard
          icon="lock"
          tone="primary"
          title="Anonyme"
          description="Ni la RH, ni la Direction, ni personne d'autre ne peut voir qui a écrit un avis."
        />
        <ReassuranceCard
          icon="trending-up"
          tone="success"
          title="Constructif"
          description="Des questions fermées assemblées en un commentaire neutre et professionnel, jamais punitif."
        />
        <ReassuranceCard
          icon="shield-check"
          tone="info"
          title="Sécurisé"
          description="Les avis sur les conditions de travail sont lus uniquement par la RH et la Direction générale."
        />
      </div>

      {canRecevoir || canModerer ? (
        <div className="flex flex-wrap gap-3">
          {canRecevoir ? (
            <Link
              href="/feedback/mes-retours"
              className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-xs font-semibold text-foreground shadow-elevated transition-colors hover:border-primary/50 hover:text-primary"
            >
              <Icon name="message-square" className="size-3.5" />
              Mes critiques reçues
            </Link>
          ) : null}
          {canModerer ? (
            <Link
              href="/feedback/admin"
              className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-xs font-semibold text-foreground shadow-elevated transition-colors hover:border-primary/50 hover:text-primary"
            >
              <Icon name="shield-check" className="size-3.5" />
              Modération des feedbacks
            </Link>
          ) : null}
        </div>
      ) : null}

      <section id="soumettre-un-feedback" className="scroll-mt-6 space-y-4">
        <h2 className="flex items-center gap-2.5 text-xl font-black tracking-tight text-foreground">
          <span className="h-5 w-1 rounded-full bg-primary" aria-hidden="true" />
          Soumettre un feedback
        </h2>
        <div className="rounded-3xl border border-border bg-surface p-5 shadow-elevated sm:p-8">
          <FeedbackForm
            recipients={recipients}
            colleguesDejaEvalues={dejaDonnes.collegues}
            conditionsTravailDejaDonne={dejaDonnes.conditionsTravail}
          />
        </div>
      </section>
    </div>
  );
}
