import {
  contexteAssaini,
  erreurCourte,
  incidentRepete,
  messageAssaini,
  prisma,
  type CodeJournal,
  type NiveauJournal,
  type SourceJournal,
} from "backend";

export interface IncidentTechnique {
  niveau: NiveauJournal;
  source: SourceJournal;
  code: CodeJournal;
  message: string;
  /** Identifiants seulement (liste blanche dans `contexteAssaini`) : jamais de contenu d'e-mail, de mot de passe ni de jeton. */
  contexte?: Record<string, unknown>;
}

interface DernierIncident {
  ecritA: Date;
  id: string;
  repetitions: number;
}

/** Dernière écriture par code, dans ce processus (anti-inondation : au plus une ligne par code et par minute). */
const derniers = new Map<string, DernierIncident>();

/**
 * Seul point d'écriture du journal technique (`/admin/journal-technique`). **Ne lève jamais** : si l'écriture échoue,
 * `console.error` seulement — journaliser un incident ne doit pas en créer un autre. Une répétition du même code dans la
 * minute n'ajoute pas de ligne : elle est comptée dans `contexte.repetitions` de la ligne existante.
 */
export async function journaliserIncident(incident: IncidentTechnique): Promise<void> {
  try {
    const maintenant = new Date();
    const precedent = derniers.get(incident.code) ?? null;
    const contexte = contexteAssaini(incident.contexte) ?? {};

    if (precedent && incidentRepete(precedent.ecritA, maintenant)) {
      precedent.repetitions += 1;
      await prisma.journalTechnique.update({
        where: { id: precedent.id },
        data: { contexte: { ...contexte, repetitions: precedent.repetitions } },
      });
      return;
    }

    const ligne = await prisma.journalTechnique.create({
      data: {
        niveau: incident.niveau,
        source: incident.source,
        code: incident.code,
        message: messageAssaini(incident.message),
        contexte: Object.keys(contexte).length > 0 ? contexte : undefined,
      },
      select: { id: true },
    });
    derniers.set(incident.code, { ecritA: maintenant, id: ligne.id, repetitions: 0 });
  } catch (e) {
    console.error(`[JournalTechnique] Écriture impossible (${incident.code}) :`, erreurCourte(e));
  }
}
