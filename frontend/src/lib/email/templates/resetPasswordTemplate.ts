import { baseEmailLayout } from "./baseEmailLayout";

export function generateResetPasswordEmail({
  fullName,
  resetUrl,
  expiresInMinutes = 60,
}: {
  fullName: string;
  resetUrl: string;
  expiresInMinutes?: number;
}): { subject: string; html: string; text: string } {
  const subject = "Réinitialisation de votre mot de passe — Portail SIM Assurances";

  const expiryText =
    expiresInMinutes >= 60
      ? `${Math.round(expiresInMinutes / 60)} heure${Math.round(expiresInMinutes / 60) > 1 ? "s" : ""}`
      : `${expiresInMinutes} minute${expiresInMinutes > 1 ? "s" : ""}`;

  const contentHtml = `
    <div style="margin-bottom: 24px;">
      <span class="badge badge-warning" style="display: inline-block; padding: 4px 14px; font-size: 11px; font-weight: 700; border-radius: 9999px; text-transform: uppercase; background-color: #FFFBEB; color: #B45309; border: 1px solid #FDE68A;">
        Demande de Réinitialisation
      </span>
    </div>

    <h2 style="color: #0B1B3D; margin-top: 0; margin-bottom: 16px; font-size: 20px; font-weight: 700;">
      Bonjour ${fullName},
    </h2>
    
    <p style="color: #334155; font-size: 15px; margin: 0 0 16px 0;">
      Nous avons reçu une demande de réinitialisation du mot de passe associé à votre compte sur le <strong>Portail SIM Assurances</strong>.
    </p>
    
    <p style="color: #334155; font-size: 15px; margin: 0 0 20px 0;">
      Pour choisir un nouveau mot de passe et rétablir votre accès sécurisé, veuillez cliquer sur le bouton ci-dessous :
    </p>
    
    <div style="text-align: center; margin: 30px 0;">
      <a href="${resetUrl}" class="btn" target="_blank" style="display: inline-block; padding: 13px 28px; background-color: #004B9C; color: #FFFFFF !important; text-decoration: none; font-weight: 600; font-size: 15px; border-radius: 8px; box-shadow: 0 3px 8px rgba(0, 75, 156, 0.35);">
        Réinitialiser mon mot de passe
      </a>
    </div>

    <div style="background-color: #FFFBEB; border: 1px solid #FDE68A; border-left: 4px solid #D97706; border-radius: 8px; padding: 16px 20px; margin: 24px 0;">
      <p style="margin: 0; font-size: 13px; color: #92400E; line-height: 1.6;">
        <strong>⏳ Information de sécurité importante :</strong><br>
        Ce lien de réinitialisation est strictement personnel, à usage unique et <strong>expirera dans ${expiryText}</strong>.<br>
        Une fois le mot de passe modifié, toutes vos sessions antérieures sur d'autres navigateurs seront déconnectées par précaution.
      </p>
    </div>

    <p style="font-size: 13px; color: #64748B; margin-top: 20px;">
      Si le bouton ne fonctionne pas, copiez et collez l'adresse suivante dans votre navigateur :<br>
      <a href="${resetUrl}" style="color: #004B9C; word-break: break-all; text-decoration: underline;">${resetUrl}</a>
    </p>

    <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 28px 0;" />

    <p style="font-size: 12px; color: #94A3B8; margin-bottom: 0; line-height: 1.5;">
      Si vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer ce message en toute sécurité : votre compte reste sous haute protection et votre mot de passe actuel demeure inchangé.
    </p>
  `;

  const html = baseEmailLayout({
    title: subject,
    preheader: `Lien de réinitialisation de mot de passe pour votre compte SIM Assurances (valable ${expiryText}).`,
    contentHtml,
  });

  const text = `Bonjour ${fullName},

Nous avons reçu une demande de réinitialisation de mot de passe pour votre compte sur le Portail SIM Assurances.

Pour réinitialiser votre mot de passe, ouvrez le lien suivant dans votre navigateur (valable ${expiryText}) :
${resetUrl}

Si vous n'avez pas demandé cette réinitialisation, veuillez ignorer cet email.

SIM Assurances Côte d'Ivoire
Direction des Ressources Humaines
`;

  return { subject, html, text };
}
