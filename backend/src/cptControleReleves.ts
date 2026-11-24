// Contrôle mensuel des relevés par compte (Gestion Compta, lot GC-4e ; docs/PLAN_GESTION_COMPTA.md, GC-4 :
// « crédits du relevé = primes + virements internes reçus + autres crédits »).
//
// PUR : l'appelant fournit les totaux déjà agrégés en base ; ce fichier les rapproche. Pour un compte et un mois :
//   crédits du relevé  =  primes rattachées  +  primes à rattacher  +  autres crédits (« pas une prime »)  +  virements internes reçus
// Un écart non nul signale une incohérence entre ce que dit le relevé et ce que contiennent les encaissements : il se traite, il ne
// se masque pas. Les transactions test ne comptent pas dans les crédits d'un relevé (voir `cptImportReleve.ts`).
//
// Indépendant d'Encaissements : aucun import d'un fichier `enc*`.

const ZERO = BigInt(0);

/** Total des crédits d'un compte pour un mois (somme des `CptReleve.totalCredits` de ce compte et de ce mois). */
export interface CreditsReleveMensuel {
  compteId: string;
  /** `AAAA-MM-01`. */
  periode: string;
  nbReleves: number;
  /** Centimes. */
  totalCredits: bigint;
}

/** Agrégat des encaissements d'un compte et d'un mois (via leur relevé), par type de flux crédité. */
export interface VentilationEncaissementsMensuelle {
  compteId: string;
  /** `AAAA-MM-01`. */
  periode: string;
  typeFlux: "ENCAISSEMENT" | "VIREMENT_INTERNE_ENTRANT";
  /** Σ montant, centimes. */
  montant: bigint;
  /** Σ reste à rattacher, centimes. */
  resteARattacher: bigint;
  /** Σ part « pas une prime », centimes. */
  montantPasUnePrime: bigint;
}

export interface LigneControleMensuel {
  compteId: string;
  periode: string;
  nbReleves: number;
  creditsReleve: bigint;
  /** Part de crédits déjà rattachée à des échéances (montant − reste − pas une prime). */
  primesRattachees: bigint;
  /** Part de crédits qui attend encore un rattachement. */
  primesARattacher: bigint;
  /** Part classée « pas une prime » (autres crédits). */
  autresCredits: bigint;
  virementsInternesRecus: bigint;
  /** creditsReleve − (les quatre parts ci-dessus) ; zéro quand tout concorde. */
  ecart: bigint;
  coherent: boolean;
}

/** Une ligne par (compte, mois) qui a au moins un relevé, du mois le plus récent au plus ancien, puis par compte. */
export function controleMensuelReleves(credits: readonly CreditsReleveMensuel[], ventilations: readonly VentilationEncaissementsMensuelle[]): LigneControleMensuel[] {
  const cle = (compteId: string, periode: string) => `${compteId}|${periode}`;
  const parCle = new Map<string, LigneControleMensuel>();

  for (const c of credits) {
    const k = cle(c.compteId, c.periode);
    const existante = parCle.get(k);
    if (existante) {
      existante.nbReleves += c.nbReleves;
      existante.creditsReleve += c.totalCredits;
    } else {
      parCle.set(k, {
        compteId: c.compteId,
        periode: c.periode,
        nbReleves: c.nbReleves,
        creditsReleve: c.totalCredits,
        primesRattachees: ZERO,
        primesARattacher: ZERO,
        autresCredits: ZERO,
        virementsInternesRecus: ZERO,
        ecart: ZERO,
        coherent: true,
      });
    }
  }

  for (const v of ventilations) {
    const ligne = parCle.get(cle(v.compteId, v.periode));
    if (!ligne) continue; // des encaissements sans relevé de ce mois : rien à rapprocher
    if (v.typeFlux === "VIREMENT_INTERNE_ENTRANT") {
      ligne.virementsInternesRecus += v.montant;
    } else {
      ligne.primesARattacher += v.resteARattacher;
      ligne.autresCredits += v.montantPasUnePrime;
      ligne.primesRattachees += v.montant - v.resteARattacher - v.montantPasUnePrime;
    }
  }

  const lignes = [...parCle.values()];
  for (const l of lignes) {
    l.ecart = l.creditsReleve - l.primesRattachees - l.primesARattacher - l.autresCredits - l.virementsInternesRecus;
    l.coherent = l.ecart === ZERO;
  }
  return lignes.sort((a, b) => (a.periode === b.periode ? (a.compteId < b.compteId ? -1 : 1) : a.periode < b.periode ? 1 : -1));
}
