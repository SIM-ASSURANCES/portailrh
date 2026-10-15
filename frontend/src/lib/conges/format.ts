import { formatJourCivil, jourCivilDepuisColonneDate } from "backend";

/** `AAAA-MM-JJ` → `JJ/MM/AAAA`. */
export function frDate(jour: string): string {
  const [a, m, j] = jour.split("-");
  return `${j}/${m}/${a}`;
}

/** Colonne `@db.Date` → `JJ/MM/AAAA` (lue en UTC, jamais décalée d'un jour). */
export function frDateColonne(d: Date): string {
  return frDate(jourCivilDepuisColonneDate(d));
}

/** Instant → `JJ/MM/AAAA` (jour local du serveur, comme le reste du module). */
export function frDateInstant(d: Date): string {
  return frDate(formatJourCivil(d));
}

export function frDateHeure(d: Date): string {
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${frDateInstant(d)} à ${h}:${m}`;
}

export function aujourdhui(): string {
  return formatJourCivil(new Date());
}

export function libelleJours(n: number): string {
  return `${n} jour${n > 1 ? "s" : ""}`;
}
