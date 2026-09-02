import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Suppression des données transactionnelles (hors seed)...");

  // Supprimer les données de pointage
  await prisma.correctionPointage.deleteMany();
  await prisma.pointage.deleteMany();
  await prisma.absence.deleteMany();

  // Supprimer les données de trésorerie
  await prisma.journalCaisse.deleteMany();
  await prisma.depenseLigne.deleteMany();
  await prisma.retourCaisse.deleteMany();
  await prisma.reglement.deleteMany();
  await prisma.pieceJointe.deleteMany();
  await prisma.ligneDemande.deleteMany();
  await prisma.demande.deleteMany();

  // Supprimer l'historique
  await prisma.historiqueEntry.deleteMany();

  console.log("Les données transactionnelles ont été supprimées avec succès !");
  console.log("Les utilisateurs, rôles, permissions, catégories, objets et paramétrages horaires ont été conservés.");
}

main()
  .catch((e) => {
    console.error("Erreur lors de la suppression :", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
