-- CreateTable
CREATE TABLE "PermissionDelegation" (
    "id" TEXT NOT NULL,
    "beneficiaireId" TEXT NOT NULL,
    "donneurId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "estActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,

    CONSTRAINT "PermissionDelegation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PermissionDelegation_beneficiaireId_idx" ON "PermissionDelegation"("beneficiaireId");

-- CreateIndex
CREATE INDEX "PermissionDelegation_donneurId_idx" ON "PermissionDelegation"("donneurId");

-- CreateIndex
CREATE INDEX "PermissionDelegation_permissionId_idx" ON "PermissionDelegation"("permissionId");

-- AddForeignKey
ALTER TABLE "PermissionDelegation" ADD CONSTRAINT "PermissionDelegation_beneficiaireId_fkey" FOREIGN KEY ("beneficiaireId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PermissionDelegation" ADD CONSTRAINT "PermissionDelegation_donneurId_fkey" FOREIGN KEY ("donneurId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PermissionDelegation" ADD CONSTRAINT "PermissionDelegation_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PermissionDelegation" ADD CONSTRAINT "PermissionDelegation_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
