-- CreateEnum
CREATE TYPE "NotificationPriority" AS ENUM ('CRITIQUE', 'IMPORTANT', 'INFO');

-- CreateEnum
CREATE TYPE "NotificationCategory" AS ENUM ('TRESORERIE', 'POINTAGE', 'RH', 'ADMIN', 'SYSTEME');

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "category" "NotificationCategory" NOT NULL DEFAULT 'SYSTEME',
ADD COLUMN     "emailSent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "priority" "NotificationPriority" NOT NULL DEFAULT 'INFO',
ADD COLUMN     "pushSent" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ParametrageHoraire" ADD COLUMN     "delaiAlerteOubliDepartMinutes" INTEGER NOT NULL DEFAULT 30;

-- CreateTable
CREATE TABLE "FcmToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "FcmToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FcmToken_token_key" ON "FcmToken"("token");

-- CreateIndex
CREATE INDEX "FcmToken_userId_idx" ON "FcmToken"("userId");

-- CreateIndex
CREATE INDEX "Notification_userId_estLue_createdAt_idx" ON "Notification"("userId", "estLue", "createdAt");

-- AddForeignKey
ALTER TABLE "FcmToken" ADD CONSTRAINT "FcmToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
