/**
 * Mêmes valeurs hexadécimales exactes que les tokens sémantiques de
 * `globals.css` (bg-primary, text-info, border-neutral...) — @react-pdf/renderer
 * ne peut pas lire les classes Tailwind du projet, donc dupliquées ici
 * littéralement plutôt que réinventées, pour un rendu cohérent avec le reste
 * du portail. Factorisé (Phase E) : partagé par `ReceiptDocument.tsx`
 * (Ticket 9) et `BonDeCaisseDocument.tsx` (Phase E), même identité visuelle.
 */
export const COLORS = {
  primary: "#004b9c",
  primaryForeground: "#ffffff",
  info: "#1d78ab",
  infoBg: "#f1f9fd",
  infoBorder: "#cbe7f6",
  neutral: "#475569",
  neutralBg: "#f1f5f9",
  neutralBorder: "#e2e8f0",
  border: "#e2e8f0",
  mutedForeground: "#64748b",
  foreground: "#0f172a",
  warning: "#bf470c",
  success: "#16a34a",
};
