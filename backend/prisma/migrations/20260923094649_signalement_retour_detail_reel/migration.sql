-- CreateTable
CREATE TABLE "SignalementRetour" (
    "id" TEXT NOT NULL,
    "retourCaisseId" TEXT NOT NULL,
    "commentaire" TEXT NOT NULL,
    "signaleParId" TEXT NOT NULL,
    "signaleAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "estResolu" BOOLEAN NOT NULL DEFAULT false,
    "resoluParId" TEXT,
    "resoluAt" TIMESTAMP(3),

    CONSTRAINT "SignalementRetour_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "SignalementRetour" ADD CONSTRAINT "SignalementRetour_retourCaisseId_fkey" FOREIGN KEY ("retourCaisseId") REFERENCES "RetourCaisse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignalementRetour" ADD CONSTRAINT "SignalementRetour_signaleParId_fkey" FOREIGN KEY ("signaleParId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignalementRetour" ADD CONSTRAINT "SignalementRetour_resoluParId_fkey" FOREIGN KEY ("resoluParId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
