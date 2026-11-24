import Link from "next/link";
import { redirect } from "next/navigation";

import { PaginationCpt } from "@/components/compta/Pagination";
import { Button, Input, PageHeader } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import { listerClientsCpt, pageDemandeeCpt, prisma, TAILLE_PAGE_CLIENTS_CPT } from "backend";

/**
 * Clients (lot GC-7a) : recherche par début de mot (nom, téléphone, partenaire d'origine : l'index des référentiels) puis accès à la fiche.
 * Lecture seule : `cpt.consulter` (layout, revérifiée ici).
 */
export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const session = await getSession();
  if (!session || !hasPermission(session, "cpt.consulter")) redirect("/?error=acces_refuse_compta");

  const { q: saisie, page: pageBrute } = await searchParams;
  const q = (typeof saisie === "string" ? saisie : "").replace(/\s+/g, " ").trim().slice(0, 120);
  const page = pageDemandeeCpt(pageBrute);
  const { total, clients } = await listerClientsCpt(prisma, q, page);
  const nbPages = Math.max(1, Math.ceil(total / TAILLE_PAGE_CLIENTS_CPT));
  const lien = (p: number) => `/compta/clients?${new URLSearchParams({ ...(q ? { q } : {}), ...(p > 1 ? { page: String(p) } : {}) }).toString()}`;

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader title="Clients" description="Retrouver un client pour ouvrir sa fiche : contrats, échéances, paiements prouvés, retards." />
      <form method="get" className="flex flex-wrap items-end gap-3" data-recherche-clients>
        <div className="w-full sm:w-96">
          <Input name="q" label="Rechercher un client" defaultValue={q} placeholder="Nom, téléphone, partenaire d'origine…" />
        </div>
        <Button type="submit" variant="secondary">
          Rechercher
        </Button>
      </form>

      {clients.length === 0 ? (
        <p className="rounded-lg border border-border bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground" data-liste-vide>
          {q ? "Aucun client ne correspond à cette recherche." : "Aucun client enregistré : ils sont créés par l'import de la production."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-elevated">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Client</th>
                <th className="px-3 py-2">Téléphone</th>
                <th className="px-3 py-2">Partenaire d&apos;origine</th>
                <th className="px-3 py-2 text-right">Contrats</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id} className="border-b border-border last:border-0" data-client={c.nom}>
                  <td className="px-3 py-2 font-semibold">
                    <Link href={`/compta/clients/${c.id}`} className="text-primary hover:underline">
                      {c.nom}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">{c.telephone ?? "—"}</td>
                  <td className="px-3 py-2">{c.partenaireOrigine ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.nbContrats}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <PaginationCpt nom="client(s)" total={total} page={Math.min(page, nbPages)} nbPages={nbPages} precedent={page > 1 ? lien(page - 1) : null} suivant={page < nbPages ? lien(page + 1) : null} />
    </div>
  );
}
