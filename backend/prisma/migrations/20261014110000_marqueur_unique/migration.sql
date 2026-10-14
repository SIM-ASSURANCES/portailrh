-- Marqueurs « une seule fois » (clôture initiale des justifications et absences en attente, premier passage du
-- planificateur en production). Table jamais purgée. Rejouable.
CREATE TABLE IF NOT EXISTS "MarqueurUnique" (
    "cle" TEXT NOT NULL,
    "creeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bilan" JSONB,

    CONSTRAINT "MarqueurUnique_pkey" PRIMARY KEY ("cle")
);
