import { describe, expect, it } from "vitest";
import { prisma } from "./prisma";
import { contexteSignatureCourant, differerApresCommit, executerEnTransactionSignee, type OperationsSignature, type ParametresActionSignee } from "./signatureTransaction";
import { operationsActionSignee } from "./signatureDb";

// Faux client PostgreSQL : une transaction écrit dans un brouillon, validé seulement si la fonction réussit (sinon tout est jeté).
interface Base {
  actions: Record<string, unknown>[];
  historique: Record<string, unknown>[];
  retours: Record<string, unknown>[];
  effets: string[];
}

function fauxClient(options: { echecEnregistrement?: boolean; echecCompletion?: boolean } = {}) {
  const base: Base = { actions: [], historique: [], retours: [], effets: [] };
  const journalSql: string[] = [];
  let n = 0;
  const client = {
    async $transaction<R>(fn: (tx: unknown) => Promise<R>): Promise<R> {
      const brouillon: Base = { actions: [...base.actions], historique: [...base.historique], retours: [...base.retours], effets: [...base.effets] };
      const tx = {
        actionSignee: {
          create: async ({ data }: { data: Record<string, unknown> }) => {
            if (options.echecEnregistrement) throw new Error("insertion de la signature impossible");
            const ligne = { id: `as-${++n}`, ...data };
            brouillon.actions.push(ligne);
            return { id: ligne.id };
          },
          update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
            if (options.echecCompletion) throw new Error("mise à jour de la signature impossible");
            Object.assign(brouillon.actions.find((a) => a.id === where.id)!, data);
          },
        },
        historiqueEntry: {
          create: async ({ data }: { data: Record<string, unknown> }) => {
            brouillon.historique.push({ id: `h-${brouillon.historique.length + 1}`, ...data });
            return { id: "h" };
          },
        },
        retourCaisse: {
          create: async ({ data }: { data: Record<string, unknown> }) => {
            const id = `ret-${brouillon.retours.length + 1}`;
            brouillon.retours.push({ id, ...data });
            return { id };
          },
        },
        effet: { ecrire: async (nom: string) => void brouillon.effets.push(nom) },
        $executeRawUnsafe: async (sql: string) => void journalSql.push(sql),
      };
      const resultat = await fn(tx);
      base.actions = brouillon.actions;
      base.historique = brouillon.historique;
      base.retours = brouillon.retours;
      base.effets = brouillon.effets;
      return resultat;
    },
  };
  return { client, base, journalSql };
}

const params: ParametresActionSignee = { signatureId: "sig-v1", signataireId: "u1", auNomDeId: null, action: "decision_lignes", ip: "10.0.0.1" };
const ops = (o: Parameters<typeof operationsActionSignee>[0] = {}) => ({ ...operationsActionSignee(o), cibleAvant: async () => null }) as OperationsSignature<{ status: string }>;

/** Une « action » du portail : elle écrit via le client `prisma` partagé, comme le vrai code. */
async function actionQuiEcrit(nom: string) {
  // @ts-expect-error — le faux client expose `effet` ; seul le vrai client est typé
  await prisma.effet.ecrire(nom);
  await prisma.historiqueEntry.create({ data: { entity: "Demande", entityId: "d1", action: "validation_ligne", userId: "u1" } });
  return { status: "success" };
}

describe("atomicité de l'action signée (lot L bis)", () => {
  it("l'action et sa signature réussissent ensemble : la signature existe, l'historique y renvoie par identifiant", async () => {
    const { client, base } = fauxClient();
    const r = await executerEnTransactionSignee(client, ops(), params, () => actionQuiEcrit("A"));
    expect(r.status).toBe("success");
    expect(base.effets).toEqual(["A"]);
    expect(base.actions).toHaveLength(1);
    expect(base.historique).toHaveLength(1);
    expect(base.historique[0].actionSigneeId).toBe(base.actions[0].id);
  });

  it("si l'enregistrement de la signature échoue, l'action n'a pas lieu (elle n'est même pas lancée)", async () => {
    const { client, base } = fauxClient({ echecEnregistrement: true });
    let lancee = false;
    await expect(
      executerEnTransactionSignee(client, ops(), params, async () => {
        lancee = true;
        return actionQuiEcrit("A");
      })
    ).rejects.toThrow("insertion de la signature impossible");
    expect(lancee).toBe(false);
    expect(base.effets).toEqual([]);
    expect(base.historique).toEqual([]);
    expect(base.actions).toEqual([]);
  });

  it("si la signature ne peut pas être complétée après l'action, l'action est annulée avec elle", async () => {
    const { client, base } = fauxClient({ echecCompletion: true });
    const operations: OperationsSignature<{ status: string }> = {
      cibleAvant: async () => null,
      enregistrer: async (tx, p) => (await tx.actionSignee.create({ data: { action: p.action } })).id,
      completer: async (tx, id) => tx.actionSignee.update({ where: { id }, data: { entite: "x" } }),
    };
    await expect(executerEnTransactionSignee(client, operations, params, () => actionQuiEcrit("A"))).rejects.toThrow("mise à jour de la signature impossible");
    expect(base.effets).toEqual([]);
    expect(base.historique).toEqual([]);
    expect(base.actions).toEqual([]);
  });

  it("une action refusée (résultat sans succès) n'écrit rien du tout, ni signature ni effet partiel", async () => {
    const { client, base } = fauxClient();
    const r = await executerEnTransactionSignee(client, ops(), params, async () => {
      await actionQuiEcrit("partiel");
      return { status: "error", message: "refusé" } as { status: string; message: string };
    });
    expect(r).toMatchObject({ status: "error", message: "refusé" });
    expect(base.effets).toEqual([]);
    expect(base.historique).toEqual([]);
    expect(base.actions).toEqual([]);
  });

  it("une exception dans l'action annule tout et remonte", async () => {
    const { client, base } = fauxClient();
    await expect(
      executerEnTransactionSignee(client, ops(), params, async () => {
        await actionQuiEcrit("avant l'erreur");
        throw new Error("boum");
      })
    ).rejects.toThrow("boum");
    expect(base.effets).toEqual([]);
    expect(base.actions).toEqual([]);
  });

  it("deux actions du même compte, une après l'autre : chaque ligne d'historique garde l'identifiant de SA signature", async () => {
    const { client, base } = fauxClient();
    await executerEnTransactionSignee(client, ops(), { ...params, signatureId: "sig-v1" }, () => actionQuiEcrit("1"));
    await executerEnTransactionSignee(client, ops(), { ...params, signatureId: "sig-v2" }, () => actionQuiEcrit("2"));
    expect(base.actions.map((a) => a.signatureId)).toEqual(["sig-v1", "sig-v2"]);
    expect(base.historique.map((h) => h.actionSigneeId)).toEqual([base.actions[0].id, base.actions[1].id]);
  });

  it("un clic = une signature : une action signée appelée par une autre ne crée pas de second enregistrement", async () => {
    const { client, base } = fauxClient();
    await executerEnTransactionSignee(client, ops(), params, async () => {
      // l'action interne est elle aussi signée : elle s'exécute dans la transaction de l'action extérieure
      await executerEnTransactionSignee(client, ops(), { ...params, action: "autre" }, () => actionQuiEcrit("interne"));
      return actionQuiEcrit("externe");
    });
    expect(base.actions).toHaveLength(1);
    expect(base.historique.every((h) => h.actionSigneeId === base.actions[0].id)).toBe(true);
  });

  it("une $transaction imbriquée de l'action est un point de reprise ; son échec rattrapé n'annule pas le reste", async () => {
    const { client, base, journalSql } = fauxClient();
    const r = await executerEnTransactionSignee(client, ops(), params, async () => {
      await expect(
        prisma.$transaction(async () => {
          throw new Error("conflit de référence");
        })
      ).rejects.toThrow("conflit de référence");
      await prisma.$transaction(async () => void (await actionQuiEcrit("dans le point de reprise")));
      return { status: "success" };
    });
    expect(r.status).toBe("success");
    expect(base.effets).toEqual(["dans le point de reprise"]);
    expect(journalSql.filter((s) => s.startsWith("SAVEPOINT"))).toHaveLength(2);
    expect(journalSql.filter((s) => s.startsWith("ROLLBACK TO SAVEPOINT"))).toHaveLength(1);
  });

  it("des sections à point de reprise PARALLÈLES (ex. plusieurs notifications) ne s'entrelacent pas ; une imbriquée s'emboîte", async () => {
    const { client, journalSql } = fauxClient();
    const section = (nom: string, echoue = false) =>
      prisma.$transaction(async () => {
        await new Promise((r) => setTimeout(r, 5));
        if (nom === "B") await prisma.$transaction(async () => void (await new Promise((r) => setTimeout(r, 1))));
        if (echoue) throw new Error(`échec ${nom}`);
      });
    const r = await executerEnTransactionSignee(client, ops(), params, async () => {
      const issues = await Promise.allSettled([section("A", true), section("B"), section("C")]);
      expect(issues.map((i) => i.status)).toEqual(["rejected", "fulfilled", "fulfilled"]);
      return { status: "success" };
    });
    expect(r.status).toBe("success");
    // Chaque point de reprise est refermé AVANT l'ouverture du suivant (hors emboîtement de B) : jamais de ROLLBACK TO sur un point détruit.
    expect(journalSql).toEqual([
      "SAVEPOINT sp_signee_1",
      "ROLLBACK TO SAVEPOINT sp_signee_1",
      "RELEASE SAVEPOINT sp_signee_1",
      "SAVEPOINT sp_signee_2",
      "SAVEPOINT sp_signee_3",
      "RELEASE SAVEPOINT sp_signee_3",
      "RELEASE SAVEPOINT sp_signee_2",
      "SAVEPOINT sp_signee_4",
      "RELEASE SAVEPOINT sp_signee_4",
    ]);
  });

  it("l'entité créée par l'action (retour de caisse) devient l'entiteId de la signature", async () => {
    const { client, base } = fauxClient();
    const operations = operationsActionSignee<{ status: string }>({ entite: "RetourCaisse", creation: "retourCaisse" });
    const r = await executerEnTransactionSignee(
      client,
      { ...operations, cibleAvant: async () => null, completer: async (tx, id, avant, res, creations) => {
        const creee = creations.find((c) => c.modele === "retourCaisse");
        await tx.actionSignee.update({ where: { id }, data: { entite: "RetourCaisse", entiteId: creee?.id } });
        void avant; void res;
      } },
      params,
      async () => {
        await prisma.retourCaisse.create({ data: {} as never });
        return { status: "success" };
      }
    );
    expect(r.status).toBe("success");
    expect(base.retours).toHaveLength(1);
    expect(base.actions[0]).toMatchObject({ entite: "RetourCaisse", entiteId: base.retours[0].id });
  });
});

describe("envois différés après validation", () => {
  it("les envois d'une action validée partent après la validation, dans l'ordre", async () => {
    const { client } = fauxClient();
    const ordre: string[] = [];
    await executerEnTransactionSignee(client, ops(), params, async () => {
      expect(differerApresCommit(() => void ordre.push("notification"))).toBe(true);
      ordre.push("action");
      return { status: "success" };
    });
    expect(ordre).toEqual(["action", "notification"]);
  });

  it("une action annulée n'envoie rien", async () => {
    const { client } = fauxClient();
    const ordre: string[] = [];
    await executerEnTransactionSignee(client, ops(), params, async () => {
      differerApresCommit(() => void ordre.push("notification"));
      return { status: "error" };
    });
    expect(ordre).toEqual([]);
  });

  it("hors action signée rien n'est différé (l'appelant envoie tout de suite) et le client est le client ordinaire", async () => {
    expect(differerApresCommit(() => undefined)).toBe(false);
    expect(contexteSignatureCourant()).toBeUndefined();
  });

  it("après la fin de la transaction, une continuation retardataire n'utilise plus la transaction", async () => {
    const { client } = fauxClient();
    let tardif: (() => boolean) | undefined;
    await executerEnTransactionSignee(client, ops(), params, async () => {
      tardif = () => differerApresCommit(() => undefined);
      return { status: "success" };
    });
    expect(tardif!()).toBe(false);
  });
});
