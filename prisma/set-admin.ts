import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import bcrypt from "bcryptjs";

/**
 * Définit (ou met à jour) le compte administrateur du portail — à lancer
 * UNE FOIS après le premier `prisma db seed` en production, pour remplacer
 * le compte de test `admin@simassurances.test` / `password123` par les
 * vrais identifiants.
 *
 * Le seed lui-même n'est pas touché (c'est du code partagé qui refait des
 * `deleteMany`). Ce script agit après coup, sans rien effacer.
 *
 * Identifiants lus depuis l'environnement :
 *   ADMIN_EMAIL     (obligatoire)
 *   ADMIN_PASSWORD  (obligatoire, 8 caractères minimum)
 *   ADMIN_NAME      (optionnel, défaut "Administrateur")
 *
 * Exemple (dans le conteneur "app" via le terminal Dokploy) :
 *   ADMIN_EMAIL=admin@simassurances.com ADMIN_PASSWORD='Simas@2026' npx tsx prisma/set-admin.ts
 */
const SALT_ROUNDS = 10;

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim();
  const password = process.env.ADMIN_PASSWORD;
  const fullName = process.env.ADMIN_NAME?.trim() || "Administrateur";

  if (!email || !password) {
    throw new Error("ADMIN_EMAIL et ADMIN_PASSWORD sont obligatoires.");
  }
  if (password.length < 8) {
    throw new Error("ADMIN_PASSWORD doit faire au moins 8 caractères.");
  }

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  try {
    const roleAdmin = await prisma.role.findUnique({ where: { name: "Admin" } });
    if (!roleAdmin) {
      throw new Error(
        'Rôle "Admin" introuvable — lancez `npx prisma db seed` avant ce script.'
      );
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

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
          passwordHash,
          isActive: true,
          roleId: roleAdmin.id,
          invitationToken: null,
          invitationExpiresAt: null,
        },
      });
      console.log(`Compte administrateur mis à jour : ${updated.email}`);
    } else {
      const created = await prisma.user.create({
        data: { email, fullName, passwordHash, isActive: true, roleId: roleAdmin.id },
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
