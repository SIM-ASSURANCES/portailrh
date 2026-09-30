import {describe, expect, it} from "vitest"
import {getTrustedClientIp} from "../pointage-utils";


describe("getTrustedClientIp()", () => {
  it("doit renvoyer l'adresse IP lorsqu'il n'y a qu'une seule adresse dans X-Forwarded-For", () => {
    // préparer les en-têtes, appeler la fonction, vérifier
    const headers = new Headers();
    headers.append('X-Forwarded-For', '127.0.0.1');
    expect(getTrustedClientIp(headers)).toBe('127.0.0.1');
  });

  it("doit renvoyer la dernière adresse IP de la liste lorsque X-Forwarded-For en contient plusieurs", () => {
    const headers = new Headers();
    headers.append('X-Forwarded-For', '192.168.1.89, 202.203.203.1');
    expect(getTrustedClientIp(headers)).toBe('202.203.203.1');
  });

  it("doit nettoyer les espaces et virgules superflus autour de l'adresse IP", () => {
    const headers = new Headers();
    headers.append('X-Forwarded-For', '  192.168.1.32  ,');
    expect(getTrustedClientIp(headers)).toBe('192.168.1.32');
  });

  it("doit supprimer le préfixe IPv4-mapped IPv6 (::ffff:) pour renvoyer uniquement l'IPv4", () => {
    const headers = new Headers();
    headers.append('X-Forwarded-For', '::ffff:192.168.1.32');
    expect(getTrustedClientIp(headers)).toBe('192.168.1.32');
  });

  it("doit utiliser l'en-tête X-Real-IP si l'en-tête X-Forwarded-For est absent", () => {
    const headers = new Headers();
    headers.append('X-Real-IP', '192.168.1.46');
    expect(getTrustedClientIp(headers)).toBe('192.168.1.46');
  });

  it("doit renvoyer 'IP_INCONNUE' si aucun en-tête d'IP n'est fourni", () => {
    const headers = new Headers();
    expect(getTrustedClientIp(headers)).toBe('IP_INCONNUE');
  });
});
