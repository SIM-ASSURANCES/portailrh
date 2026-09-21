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
    <div style="margin-bottom: 20px;">
      <span class="badge badge-warning" style="display: inline-block; padding: 3px 10px; font-size: 11px; font-weight: 700; border-radius: 4px; text-transform: uppercase; background-color: #FFFBEB; color: #B45309; border: 1px solid #FDE68A; letter-spacing: 0.4px;">
        Sécurité du Compte
      </span>
    </div>

    <h2 style="color: #004B9C; margin-top: 0; margin-bottom: 14px; font-size: 18px; font-weight: 700; line-height: 1.3;">
      Bonjour ${fullName},
    </h2>
    
    <p style="color: #334155; font-size: 14.5px; margin: 0 0 14px 0; line-height: 1.6;">
      Nous avons reçu une demande de réinitialisation du mot de passe associé à votre compte sur le <strong>Portail SIM Assurances</strong>.
    </p>
    
    <p style="color: #334155; font-size: 14.5px; margin: 0 0 20px 0; line-height: 1.6;">
      Pour choisir un nouveau mot de passe et rétablir votre accès sécurisé, veuillez cliquer sur le bouton ci-dessous :
    </p>
    
    <div style="text-align: center; margin: 26px 0;">
      <a href="${resetUrl}" class="btn" target="_blank" style="display: inline-block; padding: 12px 26px; background-color: #004B9C; color: #FFFFFF !important; text-decoration: none; font-weight: 600; font-size: 14px; border-radius: 6px; letter-spacing: 0.2px;">
        Réinitialiser mon mot de passe
      </a>
    </div>

    <div style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-left: 3px solid #51AEE2; border-radius: 4px; padding: 14px 18px; margin: 22px 0;">
      <p style="margin: 0; font-size: 13px; color: #334155; line-height: 1.55;">
        <strong style="color: #004B9C;">Information de sécurité :</strong><br>
        Ce lien de réinitialisation est strictement personnel, à usage unique et <strong>expirera dans ${expiryText}</strong>.<br>
        Une fois le mot de passe modifié, toutes vos sessions actives sur d'autres appareils seront déconnectées.
      </p>
    </div>

    <p style="font-size: 12.5px; color: #64748B; margin-top: 18px; line-height: 1.5;">
      Si le bouton ne s'affiche pas correctement, vous pouvez copier et coller l'adresse suivante dans votre navigateur :<br>
      <a href="${resetUrl}" style="color: #004B9C; word-break: break-all; text-decoration: underline;">${resetUrl}</a>
    </p>

    <p style="font-size: 11.5px; color: #94A3B8; margin-top: 20px; border-top: 1px solid #F1F5F9; padding-top: 14px; line-height: 1.5;">
      Si vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer ce message en toute sécurité : votre compte demeure protégé et votre mot de passe actuel reste inchangé.
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
