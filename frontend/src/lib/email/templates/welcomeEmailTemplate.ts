import { baseEmailLayout } from "./baseEmailLayout";

interface WelcomeEmailParams {
  fullName: string;
  email: string;
  roleName: string;
  serviceName?: string | null;
  actionUrl: string;
  isInvitation?: boolean;
}

export function generateWelcomeEmail({
  fullName,
  email,
  roleName,
  serviceName,
  actionUrl,
  isInvitation = false,
}: WelcomeEmailParams): { subject: string; html: string; text: string } {
  const subject = "Bienvenue sur le Portail SIM Assurances — Vos accès et documentation";

  // Documentation spécifique selon le rôle
  const roleLower = roleName.toLowerCase();
  const isRH = roleLower.includes("rh");
  const isFinance = roleLower.includes("finan") || roleLower.includes("caisse");
  const isDG = roleLower.includes("dg") || roleLower.includes("direction");
  const isAdmin = roleLower.includes("admin");

  const docPointage = `
    <div style="border-left: 4px solid #004B9C; background-color: #F8FAFC; padding: 14px 18px; margin-bottom: 16px; border-radius: 0 8px 8px 0; border: 1px solid #E2E8F0; border-left-width: 4px; border-left-color: #004B9C;">
      <h4 style="margin: 0 0 6px 0; color: #004B9C; font-size: 14px; font-weight: 700;">⏱️ Module Pointage RH</h4>
      <p style="margin: 0 0 8px 0; font-size: 13px; color: #334155;">
        Le suivi de votre présence s'effectue quotidiennement sur le portail :
      </p>
      <ul style="margin: 0; padding-left: 18px; font-size: 13px; color: #475569; line-height: 1.5;">
        <li><strong>Arrivée réglementaire :</strong> Pointage attendu à partir de <strong>07h45</strong>.</li>
        <li><strong>Départ réglementaire :</strong> Pointage de fin de journée à partir de <strong>16h45</strong>.</li>
        <li><strong>Modes de pointage autorisés :</strong> Depuis votre ordinateur connecté au réseau de l'agence ou par QR code avec géolocalisation sur smartphone.</li>
        <li><strong>Gestion des retards :</strong> Tout pointage après l'heure limite exige la saisie d'un motif soumis à validation RH.</li>
      </ul>
    </div>
  `;

  const docTresorerie = `
    <div style="border-left: 4px solid #059669; background-color: #F8FAFC; padding: 14px 18px; margin-bottom: 16px; border-radius: 0 8px 8px 0; border: 1px solid #E2E8F0; border-left-width: 4px; border-left-color: #059669;">
      <h4 style="margin: 0 0 6px 0; color: #059669; font-size: 14px; font-weight: 700;">💳 Module Trésorerie & Demandes d'Achat</h4>
      <p style="margin: 0 0 8px 0; font-size: 13px; color: #334155;">
        Gestion dématérialisée et transparente des achats de l'entreprise :
      </p>
      <ul style="margin: 0; padding-left: 18px; font-size: 13px; color: #475569; line-height: 1.5;">
        <li><strong>Création de demande :</strong> Soumettez vos demandes avec devis, articles détaillés et sélection de l'enveloppe budgétaire.</li>
        <li><strong>Circuit d'approbation :</strong> Suivi en temps réel de la validation par la Finance et la Direction Générale.</li>
        <li><strong>Règlement & Reçu :</strong> Téléchargez votre bon de caisse dès confirmation du paiement.</li>
        <li><strong>Retour de caisse obligatoire :</strong> Pour toute avance reçue, justifiez les dépenses avec factures dans « Retours à déclarer ».</li>
      </ul>
    </div>
  `;

  let specificRoleDoc = "";

  if (isRH) {
    specificRoleDoc = `
      <div style="border-left: 4px solid #7C3AED; background-color: #F8FAFC; padding: 14px 18px; margin-bottom: 16px; border-radius: 0 8px 8px 0; border: 1px solid #E2E8F0; border-left-width: 4px; border-left-color: #7C3AED;">
        <h4 style="margin: 0 0 6px 0; color: #7C3AED; font-size: 14px; font-weight: 700;">🛡️ Vos Prérogatives Ressources Humaines (RH)</h4>
        <ul style="margin: 0; padding-left: 18px; font-size: 13px; color: #475569; line-height: 1.5;">
          <li><strong>Supervision des présences :</strong> Tableau de bord des collaborateurs présents, retardataires et absents.</li>
          <li><strong>Gestion des anomalies :</strong> Régularisation exceptionnelle des pointages et traitement des motifs.</li>
          <li><strong>Calendrier :</strong> Paramétrage des jours fériés légaux et des règles de pointage.</li>
          <li><strong>Reporting :</strong> Export pour la préparation de la paie.</li>
        </ul>
      </div>
    `;
  } else if (isFinance) {
    specificRoleDoc = `
      <div style="border-left: 4px solid #D97706; background-color: #F8FAFC; padding: 14px 18px; margin-bottom: 16px; border-radius: 0 8px 8px 0; border: 1px solid #E2E8F0; border-left-width: 4px; border-left-color: #D97706;">
        <h4 style="margin: 0 0 6px 0; color: #D97706; font-size: 14px; font-weight: 700;">📊 Vos Prérogatives Finance & Trésorerie</h4>
        <ul style="margin: 0; padding-left: 18px; font-size: 13px; color: #475569; line-height: 1.5;">
          <li><strong>Catégorisation & Enveloppes :</strong> Affectation budgétaire et contrôle des plafonds de dépenses.</li>
          <li><strong>Décaissements :</strong> Exécution des règlements (espèces caisse ou chèque/virement) et génération des reçus.</li>
          <li><strong>Contrôle des retours :</strong> Pointage physique des factures acquittées et réintégration des reliquats.</li>
          <li><strong>Journal de Caisse :</strong> Traçabilité infalsifiable de l'ensemble des mouvements financiers.</li>
        </ul>
      </div>
    `;
  } else if (isDG) {
    specificRoleDoc = `
      <div style="border-left: 4px solid #B45309; background-color: #F8FAFC; padding: 14px 18px; margin-bottom: 16px; border-radius: 0 8px 8px 0; border: 1px solid #E2E8F0; border-left-width: 4px; border-left-color: #B45309;">
        <h4 style="margin: 0 0 6px 0; color: #B45309; font-size: 14px; font-weight: 700;">🏛️ Vos Prérogatives Direction Générale (DG)</h4>
        <ul style="margin: 0; padding-left: 18px; font-size: 13px; color: #475569; line-height: 1.5;">
          <li><strong>Arbitrage Décisionnel :</strong> Validation finale des engagements de dépenses et commandes.</li>
          <li><strong>Clôture Financière :</strong> Approbation définitive de la conformité des retours de caisse.</li>
          <li><strong>Vision Consolidée :</strong> Tableaux de bord stratégiques de gestion des ressources.</li>
        </ul>
      </div>
    `;
  } else if (isAdmin) {
    specificRoleDoc = `
      <div style="border-left: 4px solid #DC2626; background-color: #F8FAFC; padding: 14px 18px; margin-bottom: 16px; border-radius: 0 8px 8px 0; border: 1px solid #E2E8F0; border-left-width: 4px; border-left-color: #DC2626;">
        <h4 style="margin: 0 0 6px 0; color: #DC2626; font-size: 14px; font-weight: 700;">⚙️ Vos Prérogatives Administrateur</h4>
        <ul style="margin: 0; padding-left: 18px; font-size: 13px; color: #475569; line-height: 1.5;">
          <li><strong>Gestion des utilisateurs :</strong> Création, activation, désactivation et sécurité des accès.</li>
          <li><strong>Rôles & Permissions :</strong> Attribution granulaire des autorisations par module.</li>
          <li><strong>Audit & Journalisation :</strong> Traçabilité des opérations sensibles sur l'ensemble de la plateforme.</li>
        </ul>
      </div>
    `;
  } else {
    specificRoleDoc = `
      <div style="border-left: 4px solid #004B9C; background-color: #F8FAFC; padding: 14px 18px; margin-bottom: 16px; border-radius: 0 8px 8px 0; border: 1px solid #E2E8F0; border-left-width: 4px; border-left-color: #004B9C;">
        <h4 style="margin: 0 0 6px 0; color: #004B9C; font-size: 14px; font-weight: 700;">👤 Vos Droits Collaborateur</h4>
        <p style="margin: 0; font-size: 13px; color: #475569; line-height: 1.5;">
          Vous avez accès à votre espace pour enregistrer vos pointages de présence, consulter l'historique de vos heures et émettre vos demandes d'achat professionnelles.
        </p>
      </div>
    `;
  }

  const actionButtonText = isInvitation
    ? "Activer mon compte & Définir mon mot de passe"
    : "Accéder au Portail SIM Assurances";

  const contentHtml = `
    <div style="margin-bottom: 24px;">
      <span class="badge badge-primary" style="display: inline-block; padding: 4px 14px; font-size: 11px; font-weight: 700; border-radius: 9999px; text-transform: uppercase; background-color: #E0F2FE; color: #0369A1; border: 1px solid #BAE6FD;">
        Bienvenue
      </span>
    </div>

    <h2 style="color: #0B1B3D; margin-top: 0; margin-bottom: 16px; font-size: 20px; font-weight: 700;">
      Bienvenue sur le Portail SIM Assurances !
    </h2>
    
    <p style="color: #334155; font-size: 15px; margin: 0 0 16px 0;">
      Bonjour <strong>${fullName}</strong>,
    </p>
    
    <p style="color: #334155; font-size: 15px; margin: 0 0 20px 0;">
      Votre compte d'accès à la plateforme interne de <strong>SIM Assurances</strong> a été créé avec succès.
    </p>
    
    <!-- CARTE RÉCAPITULATIVE DU PROFIL -->
    <div style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 20px 24px; margin: 24px 0;">
      <h3 style="margin-top: 0; margin-bottom: 14px; font-size: 14px; font-weight: 700; color: #0B1B3D;">
        📌 Récapitulatif de votre profil :
      </h3>
      <table style="width: 100%; font-size: 14px; border-collapse: collapse;">
        <tr>
          <td style="padding: 6px 0; color: #64748B; width: 140px;">Nom complet :</td>
          <td style="padding: 6px 0; font-weight: 600; color: #0F172A;">${fullName}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748B;">Identifiant (Email) :</td>
          <td style="padding: 6px 0; font-weight: 600; color: #004B9C;">${email}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748B;">Rôle attribué :</td>
          <td style="padding: 6px 0;">
            <span style="display: inline-block; padding: 3px 10px; font-size: 11px; font-weight: 700; border-radius: 9999px; background-color: #E0F2FE; color: #0369A1;">
              ${roleName}
            </span>
          </td>
        </tr>
        ${serviceName ? `
        <tr>
          <td style="padding: 6px 0; color: #64748B;">Service :</td>
          <td style="padding: 6px 0; font-weight: 600; color: #0F172A;">${serviceName}</td>
        </tr>
        ` : ""}
      </table>
    </div>

    <!-- BOUTON D'ACTION PRINCIPALE -->
    <div style="text-align: center; margin: 30px 0;">
      <a href="${actionUrl}" class="btn" target="_blank" style="display: inline-block; padding: 13px 28px; background-color: #004B9C; color: #FFFFFF !important; text-decoration: none; font-weight: 600; font-size: 15px; border-radius: 8px; box-shadow: 0 3px 8px rgba(0, 75, 156, 0.35);">
        ${actionButtonText}
      </a>
    </div>

    ${isInvitation ? `
    <div style="background-color: #FFFBEB; border: 1px solid #FDE68A; border-left: 4px solid #D97706; border-radius: 8px; padding: 14px 18px; margin: 20px 0;">
      <p style="margin: 0; font-size: 13px; color: #92400E; line-height: 1.5;">
        ℹ️ <strong>Activation requise :</strong> Ce lien d'invitation est valable pendant 7 jours. Il vous permettra de définir votre mot de passe pour finaliser l'activation de votre compte.
      </p>
    </div>
    ` : `
    <p style="font-size: 13px; color: #64748B; text-align: center;">
      Vous pouvez vous connecter dès à présent avec le mot de passe initial qui vous a été transmis.
    </p>
    `}

    <h3 style="color: #0B1B3D; margin-top: 36px; margin-bottom: 16px; font-size: 16px; font-weight: 700; border-bottom: 2px solid #E2E8F0; padding-bottom: 8px;">
      📖 Guide Pratique & Documentation de vos Modules
    </h3>

    ${docPointage}
    ${docTresorerie}
    ${specificRoleDoc}

    <div style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 16px 20px; margin-top: 24px;">
      <h4 style="margin: 0 0 6px 0; font-size: 13px; color: #0B1B3D; font-weight: 700;">🔒 Recommandations de sécurité :</h4>
      <p style="margin: 0; font-size: 12px; color: #64748B; line-height: 1.5;">
        Vos identifiants sont strictement personnels. Ne communiquez jamais votre mot de passe à un tiers, même un administrateur. En cas d'oubli, la fonction « Mot de passe oublié » vous permettra de réinitialiser vos accès à tout moment.
      </p>
    </div>
  `;

  const html = baseEmailLayout({
    title: subject,
    preheader: `Bienvenue ${fullName} — Vos accès au portail interne SIM Assurances.`,
    contentHtml,
  });

  const text = `Bienvenue sur le Portail SIM Assurances, ${fullName} !

Votre compte d'accès a été créé avec les informations suivantes :
- Nom : ${fullName}
- Email : ${email}
- Rôle : ${roleName}
${serviceName ? `- Service : ${serviceName}` : ""}

Pour accéder au portail :
${actionUrl}

Modules disponibles selon vos droits :
- Pointage RH : Pointage quotidien dès 07h45 (arrivée) et 16h45 (départ).
- Trésorerie & Achats : Création de demandes d'achat et justification des retours de caisse.

SIM Assurances Côte d'Ivoire
Direction des Ressources Humaines
`;

  return { subject, html, text };
}
