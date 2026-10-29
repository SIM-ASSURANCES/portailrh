// Lot L bis — une action SIGNÉE et sa signature s'écrivent dans la MÊME transaction PostgreSQL : soit les deux existent, soit aucune.
//
// Les actions du portail utilisent le client `prisma` partagé (et parfois leurs propres `prisma.$transaction`). Plutôt que de réécrire
// chacune, la transaction de l'action signée est dite « ambiante » : un `AsyncLocalStorage` la porte, et le client `prisma` exporté par
// `./prisma` redirige alors toutes ses requêtes vers elle (`contexteSignatureCourant`). Dedans :
//   - une `$transaction` imbriquée devient un POINT DE REPRISE (SAVEPOINT) : un échec intérieur rattrapé par l'action n'abîme pas
//     le reste de la transaction (même comportement qu'avant pour l'appelant) ;
//   - toute ligne d'historique créée reçoit l'identifiant de l'action signée (`HistoriqueEntry.actionSigneeId`) : c'est le lien
//     par identifiant entre l'événement et sa signature (plus de fenêtre de temps) ;
//   - les envois vers l'extérieur (notification, push, e-mail, flux temps réel) sont DIFFÉRÉS après la validation de la transaction
//     (`differerApresCommit`) : une action annulée n'envoie rien.
//
// Ce fichier ne dépend ni de `./prisma` ni de Next.js : le client est passé en paramètre (tests sans base).

import { AsyncLocalStorage } from "node:async_hooks";
import type { CibleResolue } from "./signatureDb";

/** Client de transaction tel que l'action le voit (le vrai `Prisma.TransactionClient`, éventuellement enveloppé). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TxSignee = any;

export interface ContexteSignatureTx {
  /** Client de transaction ENVELOPPÉ (injection de `actionSigneeId` dans l'historique). */
  tx: TxSignee;
  /** Identifiant de la ligne `ActionSignee` de cette action (écrite au début de la transaction). */
  actionSigneeId: string;
  /** Faux dès que la transaction est terminée : une continuation « oubliée » retombe alors sur le client ordinaire. */
  actif: boolean;
  /** Travaux à lancer APRÈS la validation (jamais si la transaction est annulée). */
  apresCommit: Array<() => void | Promise<void>>;
  /** Compteur des points de reprise imbriqués. */
  points: number;
  /** File des sections à point de reprise : deux sections parallèles sur la même connexion s'entrelaceraient (un `ROLLBACK TO` détruit les points plus récents). */
  file: Promise<void>;
  /** Entités suivies créées par l'action (voir `MODELES_SUIVIS`), dans l'ordre de création. */
  creations: Array<{ modele: string; id: string }>;
}

/** Modèles dont la création est repérée : l'événement signé est une entité CRÉÉE par l'action (retour, retour externe…). */
export const MODELES_SUIVIS: ReadonlySet<string> = new Set(["retourCaisse", "retourExterne", "retourExceptionnel", "remboursementRetour", "reglement"]);

const stockage = new AsyncLocalStorage<ContexteSignatureTx>();
/** Contexte dont une section à point de reprise est en cours dans la chaîne asynchrone courante (réentrance : une section imbriquée passe tout de suite). */
const sectionEnCours = new AsyncLocalStorage<ContexteSignatureTx>();

/** Contexte de la transaction signée en cours, sinon `undefined` (le client `prisma` est alors le client ordinaire). */
export function contexteSignatureCourant(): ContexteSignatureTx | undefined {
  const c = stockage.getStore();
  return c && c.actif ? c : undefined;
}

/**
 * Diffère `travail` après la validation de la transaction signée en cours et renvoie `true`. Hors transaction signée : renvoie
 * `false` sans rien faire (l'appelant l'exécute lui-même, tout de suite).
 */
export function differerApresCommit(travail: () => void | Promise<void>): boolean {
  const c = contexteSignatureCourant();
  if (!c) return false;
  c.apresCommit.push(travail);
  return true;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Enveloppe du client de transaction
// ---------------------------------------------------------------------------------------------------------------------------

function lier<T>(valeur: T, cible: object): T {
  return typeof valeur === "function" ? (valeur as unknown as (...a: unknown[]) => unknown).bind(cible) as unknown as T : valeur;
}

/** Ajoute `actionSigneeId` aux données d'une écriture d'historique (sans écraser une valeur déjà posée). */
function marquer(donnees: unknown, id: string): unknown {
  if (Array.isArray(donnees)) return donnees.map((d) => marquer(d, id));
  if (donnees && typeof donnees === "object") {
    const d = donnees as Record<string, unknown>;
    return d.actionSigneeId === undefined ? { ...d, actionSigneeId: id } : d;
  }
  return donnees;
}

function delegueHistorique(brut: Record<string, unknown>, id: () => string): unknown {
  return new Proxy(brut, {
    get(cible, prop) {
      if (prop === "create" || prop === "createMany" || prop === "createManyAndReturn") {
        return (args: { data: unknown }) => (cible[prop] as (a: unknown) => unknown)({ ...args, data: marquer(args.data, id()) });
      }
      return lier(Reflect.get(cible, prop, cible), cible);
    },
  });
}

/** Délégué d'un modèle suivi : retient l'identifiant de chaque entité créée. */
function delegueSuivi(brut: Record<string, unknown>, modele: string, creations: ContexteSignatureTx["creations"]): unknown {
  return new Proxy(brut, {
    get(cible, prop) {
      if (prop === "create") {
        return async (args: unknown) => {
          const cree = (await (cible.create as (a: unknown) => Promise<{ id?: string }>)(args)) as { id?: string };
          if (cree && typeof cree.id === "string") creations.push({ modele, id: cree.id });
          return cree;
        };
      }
      return lier(Reflect.get(cible, prop, cible), cible);
    },
  });
}

/**
 * Enveloppe le client de transaction : `historiqueEntry` reçoit l'identifiant de l'action signée à la création ; les modèles suivis
 * (`MODELES_SUIVIS`) retiennent les identifiants des entités créées.
 */
export function envelopperTransaction(brut: TxSignee, id: () => string, creations: ContexteSignatureTx["creations"] = []): TxSignee {
  return new Proxy(brut, {
    get(cible, prop) {
      if (prop === "historiqueEntry") return delegueHistorique(Reflect.get(cible, prop, cible) as Record<string, unknown>, id);
      if (typeof prop === "string" && MODELES_SUIVIS.has(prop)) return delegueSuivi(Reflect.get(cible, prop, cible) as Record<string, unknown>, prop, creations);
      return lier(Reflect.get(cible, prop, cible), cible);
    },
  });
}

/**
 * `prisma.$transaction(...)` appelée DANS une transaction signée : forme fonction = point de reprise (SAVEPOINT), l'échec intérieur
 * est annulé puis relancé à l'appelant (comme une vraie transaction imbriquée) ; forme tableau = exécution dans l'ordre.
 */
export function transactionImbriquee(ctx: ContexteSignatureTx) {
  return async (argument: unknown): Promise<unknown> => {
    const tx = ctx.tx;
    if (typeof argument !== "function") {
      const resultats: unknown[] = [];
      for (const p of argument as Iterable<PromiseLike<unknown>>) resultats.push(await p);
      return resultats;
    }
    const executer = async () => {
      const nom = `sp_signee_${++ctx.points}`;
      await tx.$executeRawUnsafe(`SAVEPOINT ${nom}`);
      try {
        const r = await (argument as (t: TxSignee) => Promise<unknown>)(tx);
        await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${nom}`);
        return r;
      } catch (erreur) {
        try {
          await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${nom}`);
          await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${nom}`);
        } catch {
          // Connexion perdue : l'erreur d'origine est la seule utile.
        }
        throw erreur;
      }
    };
    // Section imbriquée dans la chaîne de la section en cours : elle s'exécute tout de suite (vrai emboîtement).
    if (sectionEnCours.getStore() === ctx) return executer();
    // Sinon (sections parallèles, ex. plusieurs notifications) : une à la fois, dans l'ordre d'arrivée.
    const precedente = ctx.file;
    let liberer!: () => void;
    ctx.file = new Promise<void>((r) => (liberer = r));
    await precedente;
    try {
      return await sectionEnCours.run(ctx, executer);
    } finally {
      liberer();
    }
  };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Exécution d'une action signée
// ---------------------------------------------------------------------------------------------------------------------------

export interface ClientTransactionnel {
  $transaction<R>(fn: (tx: TxSignee) => Promise<R>, options?: { timeout?: number; maxWait?: number }): Promise<R>;
}

/** Ce que l'enregistrement de la signature a besoin de savoir (tout est résolu avant l'ouverture de la transaction, sauf la cible). */
export interface ParametresActionSignee {
  signatureId: string;
  signataireId: string;
  auNomDeId: string | null;
  action: string;
  ip: string;
  entite?: string | null;
  entiteId?: string | null;
}

export interface OperationsSignature<T = unknown> {
  /** Écrit la ligne `ActionSignee` (dans la transaction) et renvoie son identifiant. */
  enregistrer(tx: TxSignee, p: ParametresActionSignee & { cible: CibleResolue | null }): Promise<string>;
  /** Cible connue avant l'action (lue dans la transaction). */
  cibleAvant(tx: TxSignee): Promise<CibleResolue | null>;
  /** Après le succès : complète la ligne (cible connue seulement après, entité créée par l'action). */
  completer(tx: TxSignee, actionSigneeId: string, avant: CibleResolue | null, resultat: T, creations: ContexteSignatureTx["creations"]): Promise<void>;
}

/** Délai maximal d'une action signée complète (toutes ses requêtes tiennent dans la transaction). */
export const DELAI_TRANSACTION_SIGNEE_MS = 120_000;

class ResultatSansSucces<T> extends Error {
  constructor(public readonly resultat: T) {
    super("Action non aboutie : transaction annulée.");
  }
}

/**
 * Exécute `executer` ET l'enregistrement de sa signature dans une seule transaction.
 *  1. la ligne `ActionSignee` est écrite EN PREMIER : si elle échoue, l'action n'a pas lieu ;
 *  2. `executer` tourne dans la transaction ambiante (voir l'en-tête du fichier) ;
 *  3. un résultat qui n'est pas un succès annule tout (aucune écriture partielle) ;
 *  4. après la validation, les envois différés partent.
 * Appelée DANS une transaction signée (action qui en appelle une autre) : exécute simplement `executer` — un clic = une signature.
 */
export async function executerEnTransactionSignee<T extends { status: string }>(
  client: ClientTransactionnel,
  ops: OperationsSignature<T>,
  p: ParametresActionSignee,
  executer: () => Promise<T>
): Promise<T> {
  if (contexteSignatureCourant()) return executer();

  const ctx: ContexteSignatureTx = { tx: null, actionSigneeId: "", actif: true, apresCommit: [], points: 0, file: Promise.resolve(), creations: [] };
  let resultat: T | undefined;
  try {
    await client.$transaction(
      async (brut) => {
        ctx.tx = envelopperTransaction(brut, () => ctx.actionSigneeId, ctx.creations);
        const avant = await ops.cibleAvant(ctx.tx);
        ctx.actionSigneeId = await ops.enregistrer(ctx.tx, { ...p, cible: avant });
        resultat = await stockage.run(ctx, executer);
        if (resultat.status !== "success") throw new ResultatSansSucces(resultat);
        await ops.completer(ctx.tx, ctx.actionSigneeId, avant, resultat, ctx.creations);
      },
      { timeout: DELAI_TRANSACTION_SIGNEE_MS, maxWait: 10_000 }
    );
  } catch (erreur) {
    ctx.actif = false;
    if (erreur instanceof ResultatSansSucces) return erreur.resultat as T;
    throw erreur;
  }
  ctx.actif = false;
  for (const travail of ctx.apresCommit) {
    try {
      await travail();
    } catch (erreur) {
      console.error("[signature] envoi différé après validation en échec :", erreur);
    }
  }
  return resultat as T;
}
