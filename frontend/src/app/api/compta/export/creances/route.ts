import { NextResponse } from "next/server";

import {
  chargerEtatCreancesCpt,
  jourTexteCpt,
  LIBELLE_TRANCHE_CREANCE_CPT,
  lireFiltresCreancesCpt,
  listerPartenairesFiltreCreancesCpt,
  parcourirEcheancesProchesCpt,
  prisma,
  texteDepuisCentimes,
  type ColonneExportCpt,
  type LigneExportCpt,
} from "backend";

import { getSession, hasPermission } from "@/lib/auth";
import { exporterEnFlux, type FormatExportCpt, TYPE_MIME_EXPORT_CPT } from "@/lib/compta/exportFlux";

/**
 * Export de l'état des créances (lot GC-7b), en flux. `GET /api/compta/export/creances?vue=debiteurs|echeances&format=csv|xlsx` + les MÊMES
 * filtres que l'écran (`q`, `partenaire`, `tranche`, `vue` pour les échéances). Accès `cpt.consulter` (401 sans session, 403 sans la
 * permission). Les lignes sont celles de l'écran : même source (`cptCreancesDb.ts`), aucun second calcul.
 */
const COLONNES_DEBITEURS: ColonneExportCpt[] = [
  { cle: "debiteur", titre: "Débiteur", type: "texte", largeur: 30 },
  { cle: "type", titre: "Type", type: "texte" },
  { cle: "contrats", titre: "Contrats avec reste dû", type: "entier" },
  { cle: "primeEmise", titre: "Prime émise (FCFA)", type: "montant" },
  { cle: "encaisse", titre: "Encaissé prouvé (FCFA)", type: "montant" },
  { cle: "declare", titre: "Déclaré payé non prouvé (FCFA)", type: "montant" },
  { cle: "resteDu", titre: "Reste dû (FCFA)", type: "montant" },
  { cle: "resteEchu", titre: "Dont échu (FCFA)", type: "montant" },
  { cle: "depuisLe", titre: "Dû depuis le", type: "date" },
  { cle: "jours", titre: "Ancienneté (jours)", type: "entier" },
  { cle: "tranche", titre: "Tranche", type: "texte", largeur: 20 },
  { cle: "relance", titre: "Relance proposée", type: "texte" },
];
const COLONNES_ECHEANCES: ColonneExportCpt[] = [
  { cle: "datePrevue", titre: "Date prévue", type: "date" },
  { cle: "police", titre: "Police", type: "texte", largeur: 18 },
  { cle: "client", titre: "Client", type: "texte", largeur: 30 },
  { cle: "partenaire", titre: "Partenaire", type: "texte", largeur: 24 },
  { cle: "rang", titre: "Échéance n°", type: "entier" },
  { cle: "du", titre: "Dû (FCFA)", type: "montant" },
  { cle: "regle", titre: "Réglé (FCFA)", type: "montant" },
  { cle: "reste", titre: "Reste (FCFA)", type: "montant" },
  { cle: "etat", titre: "État", type: "texte", largeur: 26 },
];
const euros = (centimes: bigint) => Number(texteDepuisCentimes(centimes));

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (!hasPermission(session, "cpt.consulter")) return NextResponse.json({ error: "Action non autorisée." }, { status: 403 });

  const url = new URL(request.url);
  const format = url.searchParams.get("format") ?? "csv";
  if (format !== "xlsx" && format !== "csv") return NextResponse.json({ error: "Format inconnu (xlsx ou csv)." }, { status: 400 });
  const vue = url.searchParams.get("vue") ?? "debiteurs";
  if (vue !== "debiteurs" && vue !== "echeances") return NextResponse.json({ error: "Vue inconnue (debiteurs ou echeances)." }, { status: 400 });

  const partenaires = await listerPartenairesFiltreCreancesCpt(prisma);
  const filtres = lireFiltresCreancesCpt(Object.fromEntries(url.searchParams), partenaires.map((p) => p.id));
  const aujourdhui = jourTexteCpt(new Date());

  let colonnes: ColonneExportCpt[];
  let lignes: AsyncIterable<LigneExportCpt> | Iterable<LigneExportCpt>;
  if (vue === "debiteurs") {
    colonnes = COLONNES_DEBITEURS;
    const etat = await chargerEtatCreancesCpt(prisma, filtres, aujourdhui);
    lignes = etat.debiteurs.map(
      (d): LigneExportCpt => ({
        debiteur: d.debiteur.nom,
        type: d.debiteur.type === "PARTENAIRE" ? "Partenaire" : "Client",
        contrats: d.contrats.length,
        primeEmise: euros(d.primeEmise),
        encaisse: euros(d.encaisseProuve),
        declare: euros(d.declarePayeNonProuve),
        resteDu: euros(d.resteDu),
        resteEchu: euros(d.resteEchu),
        depuisLe: d.depuisLe,
        jours: d.joursAnciennete,
        tranche: d.tranche ? LIBELLE_TRANCHE_CREANCE_CPT[d.tranche] : "",
        relance: d.relanceProposee ? "Oui" : "Non",
      })
    );
  } else {
    colonnes = COLONNES_ECHEANCES;
    const source = parcourirEcheancesProchesCpt(prisma, filtres, aujourdhui);
    lignes = (async function* () {
      for await (const e of source) {
        yield { datePrevue: e.datePrevue, police: e.numPolice, client: e.clientNom, partenaire: e.partenaireNom, rang: e.rang, du: Number(e.montantDu), regle: Number(e.montantRegle), reste: Number(e.resteDu), etat: e.libelleEtat };
      }
    })();
  }
  const flux = exporterEnFlux({ format: format as FormatExportCpt, nomFeuille: vue === "debiteurs" ? "Créances" : "Échéances", colonnes, lignes });
  return new Response(flux, {
    headers: {
      "Content-Type": TYPE_MIME_EXPORT_CPT[format as FormatExportCpt],
      "Content-Disposition": `attachment; filename="creances-${vue}-${aujourdhui}.${format}"`,
      "Cache-Control": "no-store",
    },
  });
}
