import Link from "next/link";

import DashboardLayout from "@/app/(dashboard)/layout";
import { BRAND_ICON_PATHS, BRAND_ICON_VIEWBOX } from "@/components/ui/brandIcon";
import { Icon, type IconName } from "@/components/icons";
import { EmptyState } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import { getFeedbackRecipients, getPublicFeedbacks } from "backend";

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
          100% anonyme, par construction
        </span>
        <h1 className="mt-4 text-3xl font-black leading-tight tracking-tight sm:text-4xl">
          Votre avis compte,{" "}
          <span className="text-[#bfe0f7]">en toute confidentialité</span>
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/85 sm:text-[15px]">
          Notez votre collaboration avec un collègue ou partagez votre ressenti sur les conditions
          de travail chez SIM Assurances — quelques clics, jamais un mot tapé, jamais une trace de
          qui vous êtes.
        </p>
      </div>
    </div>
  );
}

function PublicFeedbackCard({ content, submittedAt }: { content: string; submittedAt: Date }) {
  return (
    <div className="card-shadow-hover relative overflow-hidden rounded-2xl border border-border bg-surface p-5 shadow-elevated transition-transform duration-200 ease-out-strong motion-safe:hover:-translate-y-0.5">
      <span className="absolute inset-y-0 left-0 w-1.5 bg-info" aria-hidden="true" />
      <div className="flex items-start gap-3 pl-2">
        <span className="mt-0.5 inline-grid size-8 shrink-0 place-items-center rounded-full bg-info-bg text-info">
          <Icon name="message-square" className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{content}</p>
          <p className="mt-2 text-xs font-medium text-muted-foreground">
            {submittedAt.toLocaleDateString("fr-FR", { year: "numeric", month: "long", day: "numeric" })}
          </p>
        </div>
      </div>
    </div>
  );
}

async function FeedbackPageContent({
  quickLinks,
}: {
  quickLinks?: { canRecevoir: boolean; canModerer: boolean };
}) {
  const [recipients, feedbacks] = await Promise.all([getFeedbackRecipients(), getPublicFeedbacks()]);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-10 px-4 py-10 sm:px-6">
      <FeedbackHero />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <ReassuranceCard
          icon="lock"
          tone="primary"
          title="Anonyme"
          description="Aucune IP, aucun cookie, aucun texte libre : structurellement impossible de remonter à vous."
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
          description="Les critiques sur un collègue restent privées ; seules RH, Direction et Admin peuvent les modérer."
        />
      </div>

      {quickLinks && (quickLinks.canRecevoir || quickLinks.canModerer) ? (
        <div className="flex flex-wrap gap-3">
          {quickLinks.canRecevoir ? (
            <Link
              href="/feedback/mes-retours"
              className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-xs font-semibold text-foreground shadow-elevated transition-colors hover:border-primary/50 hover:text-primary"
            >
              <Icon name="message-square" className="size-3.5" />
              Mes critiques reçues
            </Link>
          ) : null}
          {quickLinks.canModerer ? (
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
          <FeedbackForm recipients={recipients} />
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="flex items-center gap-2.5 text-xl font-black tracking-tight text-foreground">
          <span className="h-5 w-1 rounded-full bg-info" aria-hidden="true" />
          Avis sur l&apos;entreprise
        </h2>
        <p className="-mt-2 text-sm text-muted-foreground">
          Avis publics et anonymes sur les conditions de travail chez SIM Assurances. Les critiques
          sur un collaborateur restent, elles, toujours privées.
        </p>

        {feedbacks.length === 0 ? (
          <EmptyState
            icon="message-square"
            message="Aucun avis pour le moment — soyez la première personne à en partager un."
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {feedbacks.map((feedback) => (
              <PublicFeedbackCard key={feedback.id} content={feedback.content} submittedAt={feedback.submittedAt} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * Page d'accueil du module FeedbackApp — hero, réassurance, formulaire de
 * soumission (les deux onglets, voir `FeedbackForm.tsx`) et liste publique
 * des avis "Conditions de travail" partagent désormais TOUS la même page,
 * pour visiteur anonyme ET employé connecté (voir CLAUDE.md "FeedbackApp —
 * refonte visuelle de la soumission"). Les liens rapides "Mes critiques
 * reçues"/"Modération" (hérités du Hub de Thierry) restent affichés en
 * haut pour un compte connecté éligible, mais n'occupent plus toute la
 * page : ce n'est plus qu'une des sections, pas la page entière.
 */
export default async function FeedbackPage() {
  const session = await getSession();

  if (session) {
    const quickLinks = {
      canRecevoir: session.peutRecevoirFeedback === true,
      canModerer: hasPermission(session, "feedback.moderer"),
    };

    return (
      <DashboardLayout>
        <FeedbackPageContent quickLinks={quickLinks} />
      </DashboardLayout>
    );
  }

  return (
    <div className="relative flex-1 overflow-hidden bg-surface">
      <FeedbackPageContent />
    </div>
  );
}
