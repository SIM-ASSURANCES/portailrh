import Link from "next/link";
import { redirect } from "next/navigation";

import { Icon, type IconName } from "@/components/icons";
import { Badge, PageHeader } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import { prisma } from "backend";

/** Accueil du module Encaissements. Garde revérifiée ici, indépendamment du layout. */
export default async function EncaissementsAccueilPage() {
  const session = await getSession();
  if (!session || !hasPermission(session, "enc.consulter")) {
    redirect("/?error=acces_refuse_encaissements");
  }

  const peutConfirmer = hasPermission(session, "enc.confirmer_paiement");
  const [nbATraiter, nbAConfirmer] = await Promise.all([
    prisma.encSignalement.count({ where: { statut: "A_TRAITER" } }),
    peutConfirmer ? prisma.encEncaissement.count({ where: { statut: "A_CONFIRMER" } }) : Promise.resolve(0),
  ]);

  const liens: { href: string; icon: IconName; titre: string; texte: string; compteur?: number }[] = [
    {
      href: "/encaissements/a-verifier",
      icon: "alert-triangle",
      titre: "À vérifier",
      texte:
        nbATraiter === 0
          ? "Aucun signalement d'import à traiter."
          : `${nbATraiter.toLocaleString("fr-FR")} signalement(s) d'import à traiter.`,
      compteur: nbATraiter,
    },
    {
      href: "/encaissements/import",
      icon: "file-text",
      titre: "Import du fichier de production",
      texte: hasPermission(session, "enc.importer_production")
        ? "Importer le fichier mensuel et consulter les rapports d'import."
        : "Consulter l'historique et les rapports d'import.",
    },
  ];
  // Confirmation F5 (commit 6b) : Finance seulement.
  if (peutConfirmer) {
    liens.unshift({
      href: "/encaissements/a-confirmer",
      icon: "circle-check",
      titre: "Confirmation des paiements",
      texte:
        nbAConfirmer === 0
          ? "Aucun paiement à confirmer."
          : `${nbAConfirmer.toLocaleString("fr-FR")} paiement(s) du fichier à confirmer d'après les relevés.`,
      compteur: nbAConfirmer,
    });
  }
  if (hasPermission(session, "enc.parametrer")) {
    liens.push({ href: "/encaissements/branches", icon: "folder-tree", titre: "Branches", texte: "Ajouter ou désactiver une branche." });
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader
        title="Encaissements, taxes et commissions"
        description="Contrats, versements échelonnés, taxes, commissions et honoraires."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        {liens.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="card-shadow-hover group flex items-start gap-4 rounded-2xl border border-border bg-surface p-5 shadow-elevated transition-transform duration-200 motion-safe:hover:-translate-y-0.5"
          >
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
              <Icon name={l.icon} className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 font-bold text-foreground group-hover:text-primary">
                {l.titre}
                {l.compteur !== undefined ? (
                  <Badge variant={l.compteur > 0 ? "warning" : "success"}>{l.compteur.toLocaleString("fr-FR")}</Badge>
                ) : null}
              </span>
              <span className="mt-1 block text-sm text-muted-foreground">{l.texte}</span>
            </span>
          </Link>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Les autres écrans du module (saisie, relevés…) arrivent dans les lots suivants.</p>
    </div>
  );
}
