import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import { CHAMPS_PRODUCTION_CPT, FORMATS_DATE_CPT, LIBELLE_TYPE_IMPORT_CPT, prisma, TYPES_RELEVE_CPT, type TypeImportCpt } from "backend";

import { FormatsImport, type FormatRow } from "./FormatsImport";
import { FormatsRelevesProposes } from "./FormatsRelevesProposes";
import { NouveauFormatProduction } from "./NouveauFormatProduction";

/**
 * Paramètres de Gestion Compta : formats d'import (lot GC-3i). Lecture : `cpt.consulter` (layout, revérifiée ici). Écriture :
 * `cpt.parametrer`, revérifiée par chaque Server Action — le formulaire et les boutons masqués ne sont qu'un confort. Les taux de
 * taxe, comptes et conventions se règlent dans « Référentiels ».
 */
export default async function ParametresPage() {
  const session = await getSession();
  if (!session || !hasPermission(session, "cpt.consulter")) {
    redirect("/?error=acces_refuse_compta");
  }
  const peutEcrire = hasPermission(session, "cpt.parametrer");

  const formats = await prisma.cptFormatImport.findMany({ orderBy: [{ type: "asc" }, { parDefaut: "desc" }, { nom: "asc" }] });
  const rows: FormatRow[] = formats.map((f) => ({
    id: f.id,
    typeLibelle: LIBELLE_TYPE_IMPORT_CPT[f.type as TypeImportCpt] ?? f.type,
    nom: f.nom,
    ligneEntete: f.ligneEntete,
    nbColonnes: Array.isArray(f.colonnes) ? f.colonnes.length : 0,
    parDefaut: f.parDefaut,
    actif: f.actif,
  }));

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader
        title="Paramètres"
        description="Formats d'import des fichiers : quelle colonne du fichier alimente quel champ. Changer la présentation d'un fichier se règle ici, jamais dans le code."
      />

      <section className="space-y-3">
        <h2 className="text-base font-bold text-foreground">Formats d&apos;import</h2>
        <FormatsImport rows={rows} peutEcrire={peutEcrire} />
      </section>

      <FormatsRelevesProposes
        peutEcrire={peutEcrire}
        types={TYPES_RELEVE_CPT.map((type) => ({
          type,
          libelle: LIBELLE_TYPE_IMPORT_CPT[type],
          nbFormats: formats.filter((f) => f.type === type).length,
        }))}
      />

      {peutEcrire ? (
        <NouveauFormatProduction
          champs={CHAMPS_PRODUCTION_CPT.map((c) => ({ champ: c.champ, libelle: c.libelle, type: c.type, obligatoire: c.obligatoire }))}
          formatsDate={[...FORMATS_DATE_CPT]}
        />
      ) : (
        <p className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          La création et la modification des formats sont réservées aux comptes qui paramètrent le module.
        </p>
      )}
    </div>
  );
}
