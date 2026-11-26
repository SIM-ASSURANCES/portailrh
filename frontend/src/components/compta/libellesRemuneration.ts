import { formaterMontantCpt } from "./libellesProduction";

/** Montant en centimes (calculs de la rémunération) → « 12 000 ». */
export const montantCentimesCpt = (centimes: bigint): string => formaterMontantCpt(Number(centimes) / 100);

/** Date AAAA-MM-JJ → JJ/MM/AAAA. */
export const dateIsoAfficheeCpt = (iso: string): string => iso.split("-").reverse().join("/");
