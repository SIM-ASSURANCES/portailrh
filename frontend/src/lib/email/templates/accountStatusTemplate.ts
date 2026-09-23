import { baseEmailLayout } from "./baseEmailLayout";

interface AccountStatusEmailParams {
  fullName: string;
  email: string;
  isActive: boolean;
  actionUrl?: string;
  motif?: string | null;
}

/**
 * Génère le courriel notifiant un collaborateur de l'activation ou de la désactivation
 * de son compte utilisateur sur le Portail SIM Assurances.
 */
export function generateAccountStatusEmail({
  fullName,
  email,
  isActive,
  actionUrl,
  motif,
}: AccountStatusEmailParams): { subject: string; html: string; text: string } {
  const loginUrl = actionUrl || "http://localhost:3000/login";

  if (isActive) {
    const subject = "Votre compte Portail SIM Assurances a été réactivé";

    const contentHtml = `
      <div style="margin-bottom: 20px;">
        <span class="badge badge-success" style="display: inline-block; padding: 3px 10px; font-size: 11px; font-weight: 700; border-radius: 4px; text-transform: uppercase; background-color: #F0FDF4; color: #15803D; border: 1px solid #BBF7D0; letter-spacing: 0.4px;">
          Compte Actif
        </span>
      </div>

      <h2 style="color: #004B9C; margin-top: 0; margin-bottom: 14px; font-size: 18px; font-weight: 700; line-height: 1.3;">
        Bonjour ${fullName},
      </h2>

      <p style="color: #334155; font-size: 14.5px; margin: 0 0 14px 0; line-height: 1.6;">
        Nous vous informons que votre compte utilisateur sur le <strong>Portail SIM Assurances</strong> vient d'être réactivé par l'administration des Ressources Humaines.
      </p>

      <div style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-left: 3px solid #004B9C; border-radius: 4px; padding: 16px 18px; margin: 20px 0;">
        <h4 style="margin: 0 0 8px 0; color: #004B9C; font-size: 13.5px; font-weight: 700;">
          Vos accès sont de nouveau opérationnels :
        </h4>
        <ul style="margin: 0; padding-left: 18px; font-size: 13px; color: #475569; line-height: 1.55;">
          <li>Pointage quotidien de présence (horaires réglementaires 07h45 / 16h45).</li>
          <li>Gestion des demandes d'achats, trésorerie et avances de caisse.</li>
          <li>Accès aux dossiers et services internes de votre département.</li>
        </ul>
      </div>

      <div style="text-align: center; margin: 26px 0;">
        <a href="${loginUrl}" class="btn" style="display: inline-block; padding: 12px 26px; background-color: #004B9C; color: #FFFFFF !important; text-decoration: none; font-weight: 600; font-size: 14px; border-radius: 6px; letter-spacing: 0.2px;">
          Accéder à mon espace collaborateur
        </a>
      </div>

      <p style="font-size: 12px; color: #64748B; margin-top: 20px; border-top: 1px solid #F1F5F9; padding-top: 14px; line-height: 1.5;">
        Si vous éprouvez la moindre difficulté pour vous reconnecter avec vos identifiants (<code>${email}</code>), vous pouvez utiliser le lien « Mot de passe oublié » ou contacter les Ressources Humaines.
      </p>
    `;

    const html = baseEmailLayout({
      title: subject,
      preheader: `Votre compte utilisateur sur le Portail SIM Assurances a été réactivé.`,
      contentHtml,
    });

    const text = `Bonjour ${fullName},

Votre compte utilisateur sur le Portail SIM Assurances (${email}) a été réactivé avec succès.
Tous vos accès métier (pointage, trésorerie, documents) sont à nouveau opérationnels.

Vous pouvez vous connecter dès à présent à l'adresse suivante :
${loginUrl}

SIM Assurances Côte d'Ivoire
Direction des Ressources Humaines
`;

    return { subject, html, text };
  } else {
    // Cas : Compte désactivé / suspendu
    const subject = "Notification relative à votre accès au Portail SIM Assurances";

    const contentHtml = `
      <div style="margin-bottom: 20px;">
        <span class="badge badge-danger" style="display: inline-block; padding: 3px 10px; font-size: 11px; font-weight: 700; border-radius: 4px; text-transform: uppercase; background-color: #FEF2F2; color: #B91C1C; border: 1px solid #FECACA; letter-spacing: 0.4px;">
          Accès Suspendu
        </span>
      </div>

      <h2 style="color: #004B9C; margin-top: 0; margin-bottom: 14px; font-size: 18px; font-weight: 700; line-height: 1.3;">
        Bonjour ${fullName},
      </h2>

      <p style="color: #334155; font-size: 14.5px; margin: 0 0 14px 0; line-height: 1.6;">
        Nous vous informons que votre accès au <strong>Portail SIM Assurances</strong> a été temporairement suspendu par l'administration.
      </p>

      <div style="background-color: #FEF2F2; border: 1px solid #FECACA; border-left: 3px solid #DC2626; border-radius: 4px; padding: 16px 18px; margin: 20px 0;">
        <h4 style="margin: 0 0 6px 0; color: #991B1B; font-size: 13.5px; font-weight: 700;">
          Conséquences sur vos connexions :
        </h4>
        <p style="margin: 0; font-size: 13px; color: #7F1D1D; line-height: 1.55;">
          Vous ne pouvez plus ouvrir de session sur le portail d'entreprise jusqu'à nouvel ordre. Toutes vos sessions actives ont été déconnectées par mesure de sécurité.
        </p>
        ${motif ? `<p style="margin: 8px 0 0 0; font-size: 12.5px; color: #991B1B;"><strong>Motif :</strong> ${motif}</p>` : ""}
      </div>

      <div style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 4px; padding: 16px 18px; margin: 18px 0;">
        <h4 style="margin: 0 0 6px 0; color: #0F172A; font-size: 13.5px; font-weight: 700;">
          Besoin d'informations complémentaires ?
        </h4>
        <p style="margin: 0; font-size: 12.5px; color: #475569; line-height: 1.55;">
          Si vous avez des questions concernant cette décision, nous vous invitons à vous rapprocher directement de la <strong>Direction des Ressources Humaines</strong> de SIM Assurances ou de votre responsable hiérarchique.
        </p>
      </div>

      <p style="font-size: 11.5px; color: #94A3B8; margin-top: 20px; border-top: 1px solid #F1F5F9; padding-top: 14px; line-height: 1.5;">
        Identifiant du compte concerné : <code>${email}</code>
      </p>
    `;

    const html = baseEmailLayout({
      title: subject,
      preheader: `Votre accès au Portail SIM Assurances a été suspendu par l'administration.`,
      contentHtml,
    });

    const text = `Bonjour ${fullName},

Nous vous informons que votre accès au Portail SIM Assurances (${email}) a été suspendu par l'administration.
Toutes vos sessions actives antérieures ont été déconnectées par mesure de sécurité.

Si vous avez des questions, veuillez contacter la Direction des Ressources Humaines de SIM Assurances.

SIM Assurances Côte d'Ivoire
Direction des Ressources Humaines
`;

    return { subject, html, text };
  }
}
