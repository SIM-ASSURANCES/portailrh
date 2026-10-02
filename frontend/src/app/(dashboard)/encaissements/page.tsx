import Link from "next/link";
import { redirect } from "next/navigation";

import { Icon, type IconName } from "@/components/icons";
import { PageHeader } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";

/** Accueil du module Encaissements. Garde revérifiée ici, indépendamment du layout. */
export default async function EncaissementsAccueilPage() {
  const session = await getSession();
  if (!session || !hasPermission(session, "enc.consulter")) {
    redirect("/?error=acces_refuse_encaissements");
  }

  const liens: { href: string; icon: IconName; titre: string; texte: string }[] = [
    {
      href: "/encaissements/import",
      icon: "file-text",
      titre: "Import du fichier de production",
      texte: hasPermission(session, "enc.importer_production")
        ? "Importer le fichier mensuel et consulter les rapports d'import."
        : "Consulter l'historique et les rapports d'import.",
    },
  ];
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
            <span>
              <span className="block font-bold text-foreground group-hover:text-primary">{l.titre}</span>
              <span className="mt-1 block text-sm text-muted-foreground">{l.texte}</span>
            </span>
          </Link>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Les autres écrans du module (fiche police, confirmation, relevés…) arrivent dans les lots suivants.</p>
    </div>
  );
}
