// ".env" chargé depuis la racine du monorepo (voir CLAUDE.md "Monorepo
// backend/frontend").
import path from "node:path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import bcrypt from "bcryptjs";

/**
 * Crée le compte administrateur du portail s'il n'existe pas encore, et
 * rétablit `Role.estAdmin` sur le rôle "Admin". Lancé par le service `init`
 * après les migrations, donc à CHAQUE déploiement : il doit rester sans
 * effet de bord quand tout est déjà en place.
 *
 * Le seed lui-même n'est pas touché (c'est du code partagé qui refait des
 * `deleteMany`). Ce script agit après coup, sans rien effacer.
 *
 * Identifiants lus depuis l'environnement :
 *   ADMIN_EMAIL     (optionnel — absent avec ADMIN_PASSWORD : aucun compte touché)
 *   ADMIN_PASSWORD  (optionnel — 8 caractères minimum quand il est utilisé)
 *   ADMIN_NAME      (optionnel, défaut "Administrateur")
 *   ADMIN_FORCE_PASSWORD_RESET  ("true" pour réécrire le mot de passe d'un
 *                    admin existant ; sinon son mot de passe n'est JAMAIS
 *                    modifié, pour qu'un changement fait depuis /profil
 *                    survive aux déploiements suivants)
 *
 * Variables absentes : message dans les logs et sortie en code 0 — ne
 * jamais faire échouer `init`, sinon l'application ne démarre pas.
 *
 * Exemple (dans le conteneur "app" via le terminal Dokploy) :
 *   ADMIN_EMAIL=admin@exemple.com ADMIN_PASSWORD='<mot-de-passe>' npx tsx prisma/set-admin.ts
 */
const SALT_ROUNDS = 10;

async function hashPassword(password: string): Promise<string> {
  if (password.length < 8) {
    throw new Error("ADMIN_PASSWORD doit faire au moins 8 caractères.");
  }
  return bcrypt.hash(password, SALT_ROUNDS);
}

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim();
  const password = process.env.ADMIN_PASSWORD;
  const fullName = process.env.ADMIN_NAME?.trim() || "Administrateur";
  const forcePasswordReset = process.env.ADMIN_FORCE_PASSWORD_RESET === "true";

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  try {
    const roleAdmin = await prisma.role.findUnique({ where: { name: "Admin" } });
    if (!roleAdmin) {
      throw new Error(
        'Rôle "Admin" introuvable — lancez `npx prisma db seed` avant ce script.'
      );
    }

    // Rattrapage de Role.estAdmin (voir la migration
    // 20260910090000_role_admin_est_admin_rattrapage) : isAdmin() lit
    // désormais ce champ, et non plus le nom du rôle. Garantit que le rôle
    // "Admin" porte bien l'accès à l'administration, même sur une base seedée
    // avant l'existence de ce champ. Idempotent.
    if (!roleAdmin.estAdmin) {
      await prisma.role.update({ where: { id: roleAdmin.id }, data: { estAdmin: true } });
      console.log(`Rôle "Admin" : accès à l'administration (estAdmin) rétabli.`);
    }

    if (!email || !password) {
      console.log(
        "ADMIN_EMAIL ou ADMIN_PASSWORD absent : aucun compte administrateur créé ni modifié."
      );
      return;
    }

    // Compte Admin déjà présent (celui du seed, ou un précédent passage) :
    // on le met à jour ; sinon on le crée.
    const existingAdmin =
      (await prisma.user.findUnique({ where: { email } })) ??
      (await prisma.user.findFirst({ where: { roleId: roleAdmin.id } }));

    if (existingAdmin) {
      const updated = await prisma.user.update({
        where: { id: existingAdmin.id },
        data: {
          email,
          fullName,
          // Mot de passe conservé sauf demande explicite : sinon chaque
          // déploiement annulerait un changement fait depuis /profil.
          ...(forcePasswordReset ? { passwordHash: await hashPassword(password) } : {}),
          isActive: true,
          roleId: roleAdmin.id,
          invitationToken: null,
          invitationExpiresAt: null,
        },
      });
      console.log(
        forcePasswordReset
          ? `Compte administrateur mis à jour (mot de passe réinitialisé) : ${updated.email}`
          : `Compte administrateur mis à jour (mot de passe inchangé) : ${updated.email}`
      );
    } else {
      const created = await prisma.user.create({
        data: {
          email,
          fullName,
          passwordHash: await hashPassword(password),
          isActive: true,
          roleId: roleAdmin.id,
        },
      });
      console.log(`Compte administrateur créé : ${created.email}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Échec :", error instanceof Error ? error.message : error);
  process.exit(1);
});
