import { PrismaClient } from "./src/generated/prisma";
const prisma = new PrismaClient();
async function main() {
  const todayStart = new Date();
  todayStart.setHours(0,0,0,0);
  const p = await prisma.pointage.findMany({ 
    where: { heure: { gte: todayStart } },
    select: { type: true, heure: true, heurePrevue: true }
  });
  console.log(JSON.stringify(p, null, 2));
}
main();
