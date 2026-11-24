import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";

import { chargerFicheClientCpt, jourTexteCpt, LIBELLE_TRANCHE_CREANCE_CPT, prisma } from "backend";

import { LIBELLE_FRACTIONNEMENT_CPT } from "@/components/compta/libellesCreances";
import { LIBELLE_TYPE_COMPTE_CPT } from "@/components/compta/libellesEncaissements";
import { getSession, hasPermission } from "@/lib/auth";
import { RelevePdfClient } from "@/lib/compta/RelevePdfClient";

/**
 * Relevé client en PDF (lot GC-7c). `GET /api/compta/clients/[id]/releve` : 401 sans session, 403 sans `cpt.consulter`, 404 client inconnu.
 * Mêmes chiffres que la fiche client (`chargerFicheClientCpt`) : aucun second calcul.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) return new NextResponse("Non authentifié.", { status: 401 });
  if (!hasPermission(session, "cpt.consulter")) return new NextResponse("Accès refusé.", { status: 403 });

  const maintenant = new Date();
  const fiche = await chargerFicheClientCpt(prisma, id, jourTexteCpt(maintenant));
  if (!fiche) return new NextResponse("Client introuvable.", { status: 404 });
  const t = fiche.totaux;

  const buffer = await renderToBuffer(
    <RelevePdfClient
      donnees={{
        nom: fiche.client.nom,
        telephone: fiche.client.telephone,
        partenaire: fiche.client.partenaireOrigine,
        edite: maintenant,
        primeEmise: Number(t.primeEmise),
        encaisseProuve: Number(t.encaisseProuve),
        resteDu: Number(t.resteDu),
        resteEnRetard: Number(t.resteEnRetard),
        anciennete: t.joursAnciennete === null ? "Aucune échéance échue impayée" : `${t.joursAnciennete} jour${t.joursAnciennete > 1 ? "s" : ""} (${t.tranche ? LIBELLE_TRANCHE_CREANCE_CPT[t.tranche] : ""})`,
        contrats: fiche.contrats.map((c) => ({
          numPolice: c.numPolice,
          produit: c.produitLibelle,
          fractionnement: LIBELLE_FRACTIONNEMENT_CPT[c.fractionnement] ?? c.fractionnement,
          resteDu: Number(c.synthese.resteDu) / 100,
          echeances: c.echeances.map((e) => ({ rang: e.rang, datePrevue: e.datePrevue, montantDu: Number(e.montantDu), montantRegle: Number(e.montantRegle), resteDu: Number(e.resteDu), libelleEtat: e.libelleEtat })),
        })),
        paiements: fiche.paiements.map((p) => ({
          dateValeur: p.dateValeur,
          canal: LIBELLE_TYPE_COMPTE_CPT[p.canal] ?? p.canal,
          reference: p.encaissementReference,
          numPolice: p.numPolice,
          rangEcheance: p.rangEcheance,
          montant: Number(p.montant),
        })),
      }}
    />
  );
  const nomFichier = `releve-${fiche.client.nom.normalize("NFD").replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "client"}.pdf`;
  return new NextResponse(new Uint8Array(buffer), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${nomFichier}"`, "Cache-Control": "no-store" },
  });
}
