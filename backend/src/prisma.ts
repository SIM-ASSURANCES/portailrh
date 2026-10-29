import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";
import { contexteSignatureCourant, transactionImbriquee } from "./signatureTransaction";

// En dev, le hot-reload de Next.js réexécute ce module à chaque changement.
// On garde le client sur `globalThis` pour ne pas ouvrir un nouveau pool de
// connexions PostgreSQL à chaque rechargement.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

const client = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = client;
}

/**
 * Le client partagé. Hors transaction signée (lot L bis), c'est exactement le client Prisma. Pendant l'exécution d'une action signée
 * (`executerEnTransactionSignee`), il redirige TOUTES ses requêtes vers la transaction de l'action : l'action et l'enregistrement de
 * sa signature réussissent ou échouent ensemble, sans toucher au code de l'action. Voir `signatureTransaction.ts`.
 */
export const prisma: PrismaClient = new Proxy(client, {
  get(cible, prop) {
    const ctx = contexteSignatureCourant();
    if (ctx && typeof prop === "string") {
      if (prop === "$transaction") return transactionImbriquee(ctx);
      const dansTx = Reflect.get(ctx.tx, prop, ctx.tx);
      if (dansTx !== undefined) return typeof dansTx === "function" ? dansTx.bind(ctx.tx) : dansTx;
    }
    const valeur = Reflect.get(cible, prop, cible);
    return typeof valeur === "function" ? valeur.bind(cible) : valeur;
  },
});
