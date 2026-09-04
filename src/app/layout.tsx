import type { Metadata } from "next";
import { Geist_Mono, Montserrat } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

// Police institutionnelle SIM Assurances : appliquée comme police par
// défaut du projet (titres et texte courant) via --font-sans, voir
// globals.css. Black (900) réservé aux gros titres.
const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
  // Charte SIM Assurances : Montserrat pour toute la communication
  // institutionnelle et commerciale (dont ce portail). 500/600 ajoutés
  // pour que `font-medium` / `font-semibold` rendent une vraie graisse.
  weight: ["300", "400", "500", "600", "700", "900"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SIM Assurances — Portail",
  description: "Portail interne SIM Assurances",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="fr"
      className={`${montserrat.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        {children}
        {/* Couleurs alignées sur les tokens sémantiques du portail (plutôt
            que le thème richColors par défaut de sonner, qui utilise sa
            propre palette rouge/vert/bleu) — mêmes teintes que les Badge de
            statut ailleurs dans l'app, pour une cohérence visuelle totale.
            Toast "success" en bleu institutionnel SIM Assurances
            (`primary-bg`/`primary`, même style pâle + texte teinté que les
            trois autres) plutôt que le vert d'origine — changement demandé
            explicitement par l'utilisateur, voir CLAUDE.md "Toasts de
            succès en bleu". Erreur/info/warning restent dans leurs teintes
            d'alerte d'origine : une confirmation ("ça a marché") doit
            rester visuellement distincte d'un échec ("ça a échoué"). */}
        <Toaster
          position="top-right"
          closeButton
          toastOptions={{
            classNames: {
              toast: "font-sans !rounded-lg !shadow-md",
              success: "!bg-primary-bg !text-primary !border-primary-border",
              error: "!bg-danger-bg !text-danger !border-danger-border",
              info: "!bg-info-bg !text-info !border-info-border",
              warning: "!bg-warning-bg !text-warning !border-warning-border",
            },
          }}
        />
      </body>
    </html>
  );
}
