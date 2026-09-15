import NextAuth from 'next-auth';
import { authConfig } from '@/lib/auth.config';

export default NextAuth(authConfig).auth;

export const config = {
  // https://nextjs.org/docs/app/building-your-application/routing/middleware#matcher
  //
  // FeedbackApp (voir CLAUDE.md "FeedbackApp" / auth.config.ts,
  // `isFeedbackPublicRoute`) : `feedback$`/`feedback/nouveau$` sont exclus
  // ICI, du matcher lui-même — pas seulement autorisés dans le callback
  // `authorized`. Un chemin autorisé par `authorized` passe quand même par
  // le wrapper `NextAuth(...).auth`, qui pose ses propres cookies
  // (`authjs.csrf-token`, `authjs.callback-url`) sur CHAQUE requête qu'il
  // traite, y compris une requête finalement autorisée — constaté
  // empiriquement (`Set-Cookie` présent même avec `authorized` renvoyant
  // `true`). Seule l'exclusion du matcher empêche le middleware de
  // s'exécuter, donc de poser un cookie, satisfaisant la règle absolue
  // "aucun cookie pour un visiteur anonyme". Ancrés avec `$` (pas de
  // préfixe libre) pour ne jamais bypasser l'auth d'une future route
  // authentifiée du module, ex: `/feedback/interne` (Tranche B).
  matcher: [
    '/((?!api/auth|_next/static|_next/image|favicon\\.ico|feedback$|feedback/nouveau$|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
