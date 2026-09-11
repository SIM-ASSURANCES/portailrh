import { unstable_cache } from "next/cache";
import { prisma } from "backend";

export const getCachedParametrageHoraire = unstable_cache(
  async () => {
    return await prisma.parametrageHoraire.findFirst({
      where: { isActive: true },
    });
  },
  ["parametrageHoraire"],
  { tags: ["parametrageHoraire"], revalidate: 86400 } // 24 heures
);
