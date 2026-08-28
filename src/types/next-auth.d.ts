import type { DefaultSession } from "next-auth";

// Étend les types par défaut d'Auth.js pour transporter les champs
// spécifiques au portail (fullName, rôle) à travers le JWT et la session.
declare module "next-auth" {
  interface User {
    id: string;
    fullName: string;
    email: string;
    role: string;
  }

  interface Session {
    user: {
      id: string;
      fullName: string;
      email: string;
    } & DefaultSession["user"];
    role: string;
  }
}

// "next-auth/jwt" ne fait que ré-exporter le type JWT de "@auth/core/jwt"
// (`export * from "@auth/core/jwt"`) : pour que le "declaration merging"
// TypeScript s'applique, l'augmentation doit cibler le module d'origine.
declare module "@auth/core/jwt" {
  interface JWT {
    id: string;
    fullName: string;
    role: string;
  }
}
