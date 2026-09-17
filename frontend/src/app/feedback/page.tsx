import Link from "next/link";

import DashboardLayout from "@/app/(dashboard)/layout";
import { Icon } from "@/components/icons";
import { Badge, Button, Card, PageHeader } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import { getPublicFeedbacks } from "backend";

/**
 * Hub d'accueil du module FeedbackApp.
 * - Si l'utilisateur est connecté au portail : affiche le Hub d'actions au sein de la coquille DashboardLayout (Sidebar, Topbar).
 *   L'utilisateur peut alors choisir où il veut aller selon ses habilitations :
 *   1. "Laisser un feedback" (accessible à tous)
 *   2. "Mes critiques reçues" (si le rôle est configuré pour recevoir des feedbacks)
 *   3. "Modération des feedbacks" (si le profil a le droit feedback.moderer)
 * - Si aucun utilisateur n'est connecté : affiche la liste publique des messages anonymes.
 */
export default async function FeedbackPage() {
  const session = await getSession();

  if (session) {
    const canRecevoir = session.peutRecevoirFeedback === true;
    const canModerer = hasPermission(session, "feedback.moderer");

    return (
      <DashboardLayout>
        <div className="mx-auto max-w-7xl space-y-8">
          <PageHeader
            title="FeedbackApp"
            description="Espace d'échanges bienveillants et constructifs au sein de SIM Assurances."
          />

          {/* Hub de navigation interne — Choix de destination */}
          <section className="space-y-4">
            <h2 className="flex items-center gap-2.5 text-xl font-black tracking-tight text-foreground">
              <span className="h-5 w-1 rounded-full bg-primary" aria-hidden="true" />
              Où souhaitez-vous aller ?
            </h2>

            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
              {/* Option 1 : Laisser un feedback (accessible à tous les internes) */}
              <Link
                href="/feedback/nouveau"
                className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-border bg-surface p-6 shadow-elevated transition-all duration-200 hover:-translate-y-1 hover:border-primary/50 hover:shadow-elevated-lg motion-safe:active:scale-[0.99]"
              >
                <span className="absolute inset-x-0 top-0 h-1 bg-primary" aria-hidden="true" />
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <span className="inline-grid size-12 place-items-center rounded-xl bg-primary text-white shadow-md transition-transform duration-200 group-hover:scale-110">
                      <Icon name="pencil" className="size-6" />
                    </span>
                    <Badge variant="primary">Pour tous</Badge>
                  </div>
                  <h3 className="mt-5 text-xl font-bold text-foreground">Laisser un feedback</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    Rédiger et envoyer un message constructif et 100% anonyme à l&apos;attention d&apos;un collaborateur éligible.
                  </p>
                </div>
                <div className="mt-6 flex items-center gap-2 text-sm font-semibold text-primary transition-all group-hover:translate-x-1">
                  <span>Rédiger un retour</span>
                  <Icon name="arrow-right" className="size-4" />
                </div>
              </Link>

              {/* Option 2 : Mes critiques reçues (si éligible comme destinataire) */}
              {canRecevoir ? (
                <Link
                  href="/feedback/mes-retours"
                  className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-border bg-surface p-6 shadow-elevated transition-all duration-200 hover:-translate-y-1 hover:border-primary/50 hover:shadow-elevated-lg motion-safe:active:scale-[0.99]"
                >
                  <span className="absolute inset-x-0 top-0 h-1 bg-primary" aria-hidden="true" />
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      <span className="inline-grid size-12 place-items-center rounded-xl bg-primary text-white shadow-md transition-transform duration-200 group-hover:scale-110">
                        <Icon name="inbox" className="size-6" />
                      </span>
                      <Badge variant="neutral">Mon espace</Badge>
                    </div>
                    <h3 className="mt-5 text-xl font-bold text-foreground">Mes critiques reçues</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      Consulter les appréciations et retours constructifs qui vous sont personnellement adressés en toute confidentialité.
                    </p>
                  </div>
                  <div className="mt-6 flex items-center gap-2 text-sm font-semibold text-primary transition-all group-hover:translate-x-1">
                    <span>Consulter mes retours</span>
                    <Icon name="arrow-right" className="size-4" />
                  </div>
                </Link>
              ) : null}

              {/* Option 3 : Espace Modération (si droit feedback.moderer) */}
              {canModerer ? (
                <Link
                  href="/feedback/admin"
                  className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-border bg-surface p-6 shadow-elevated transition-all duration-200 hover:-translate-y-1 hover:border-amber-500/50 hover:shadow-elevated-lg motion-safe:active:scale-[0.99]"
                >
                  <span className="absolute inset-x-0 top-0 h-1 bg-amber-500" aria-hidden="true" />
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      <span className="inline-grid size-12 place-items-center rounded-xl bg-amber-500 text-white shadow-md transition-transform duration-200 group-hover:scale-110">
                        <Icon name="shield-check" className="size-6" />
                      </span>
                      <Badge variant="warning">RH & Direction</Badge>
                    </div>
                    <h3 className="mt-5 text-xl font-bold text-foreground">Modération des feedbacks</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      Superviser les flux de messages reçus, examiner les signalements et intervenir avec traçabilité complète.
                    </p>
                  </div>
                  <div className="mt-6 flex items-center gap-2 text-sm font-semibold text-amber-600 transition-all group-hover:translate-x-1 dark:text-amber-400">
                    <span>Accéder à la modération</span>
                    <Icon name="arrow-right" className="size-4" />
                  </div>
                </Link>
              ) : null}
            </div>
          </section>

          {/* Charte & Principes d'usage */}
          <section className="rounded-2xl border border-border bg-surface p-6 shadow-elevated">
            <div className="flex items-center gap-3">
              <span className="inline-grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
                <Icon name="info" className="size-5" />
              </span>
              <h3 className="text-base font-bold text-foreground">Les 3 principes fondamentaux de FeedbackApp</h3>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
              <div className="rounded-xl border border-border/60 bg-muted/30 p-4">
                <p className="font-semibold text-foreground">🔒 Anonymat total garanti</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Aucune donnée identifiante de l&apos;expéditeur n&apos;est transmise ou enregistrée. L&apos;anonymat est garanti par construction technique.
                </p>
              </div>
              <div className="rounded-xl border border-border/60 bg-muted/30 p-4">
                <p className="font-semibold text-foreground">🤝 Esprit constructif</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Chaque message a pour vocation d&apos;encourager la progression mutuelle et l&apos;épanouissement professionnel.
                </p>
              </div>
              <div className="rounded-xl border border-border/60 bg-muted/30 p-4">
                <p className="font-semibold text-foreground">🛡️ Modération bienveillante</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Les messages inappropriés peuvent être retirés par la RH ou la Direction avec un motif motivé, sans rupture d&apos;anonymat.
                </p>
              </div>
            </div>
          </section>
        </div>
      </DashboardLayout>
    );
  }

  // Si non connecté (visiteur public)
  const feedbacks = await getPublicFeedbacks();

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-12">
      <div className="mb-8 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold text-foreground">Messages constructifs</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Messages publics anonymes, affichés sans nom d&apos;auteur ni de destinataire.
          </p>
        </div>
        <Link href="/feedback/nouveau">
          <Button variant="primary">Laisser un message</Button>
        </Link>
      </div>

      {feedbacks.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucun message pour le moment.</p>
      ) : (
        <ul className="space-y-3">
          {feedbacks.map((feedback) => (
            <li key={feedback.id}>
              <Card className="space-y-2 p-4">
                <p className="whitespace-pre-wrap text-sm text-foreground">{feedback.content}</p>
                <p className="text-xs text-muted-foreground">
                  {feedback.submittedAt.toLocaleDateString("fr-FR", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
