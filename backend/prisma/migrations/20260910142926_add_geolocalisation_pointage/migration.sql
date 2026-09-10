-- AlterEnum
ALTER TYPE "SourcePointage" ADD VALUE 'GEOLOCALISATION';

-- AlterTable
ALTER TABLE "ParametrageHoraire" ADD COLUMN     "bureauLatitude" DOUBLE PRECISION DEFAULT 5.3628189,
ADD COLUMN     "bureauLongitude" DOUBLE PRECISION DEFAULT -3.9374753,
ADD COLUMN     "geolocalisationActive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rayonAutorise" INTEGER NOT NULL DEFAULT 50;

-- AlterTable
ALTER TABLE "Pointage" ADD COLUMN     "geoDistance" INTEGER,
ADD COLUMN     "geoLatitude" DOUBLE PRECISION,
ADD COLUMN     "geoLongitude" DOUBLE PRECISION,
ADD COLUMN     "geoPrecision" DOUBLE PRECISION;
