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
  const subject = "Bienvenue sur le Portail SIM Assurances — Activation et Documentation de vos accès";

  // Documentation spécifique selon le rôle
  const roleLower = roleName.toLowerCase();
  const isRH = roleLower.includes("rh");
  const isFinance = roleLower.includes("finan") || roleLower.includes("caisse");
  const isDG = roleLower.includes("dg") || roleLower.includes("direction");
  const isAdmin = roleLower.includes("admin");

  const docPointage = `
    <div class="module-box">
      <h4 style="margin: 0 0 6px 0; color: #004B9C; font-size: 15px;">⏱️ Module Pointage RH</h4>
      <p style="margin: 0 0 8px 0; font-size: 13px; color: #334155;">
        Le suivi de votre présence s'effectue quotidiennement sur le portail :
      </p>
      <ul style="margin: 0; padding-left: 18px; font-size: 13px; color: #475569;">
        <li><strong>Arrivée réglementaire :</strong> Pointage attendu à partir de <strong>07h45</strong>.</li>
        <li><strong>Départ réglementaire :</strong> Pointage de fin de journée à partir de <strong>16h45</strong>.</li>
        <li><strong>Modes de pointage autorisés :</strong> Depuis votre ordinateur connecté au réseau Wi-Fi du bureau ou par QR code avec géolocalisation sur votre smartphone.</li>
        <li><strong>Gestion des retards :</strong> Tout pointage après l'heure limite exige la saisie d'un motif obligatoire soumis à validation RH.</li>
      </ul>
    </div>
  `;

  const docTresorerie = `
    <div class="module-box" style="border-left-color: #059669;">
      <h4 style="margin: 0 0 6px 0; color: #059669; font-size: 15px;">💳 Module Trésorerie & Demandes d'Achat</h4>
      <p style="margin: 0 0 8px 0; font-size: 13px; color: #334155;">
        Gestion transparente et dématérialisée des achats de l'entreprise :
      </p>
      <ul style="margin: 0; padding-left: 18px; font-size: 13px; color: #475569;">
        <li><strong>Création de demande :</strong> Soumettez vos demandes avec devis, articles détaillés et choix de la catégorie budgétaire.</li>
        <li><strong>Circuit d'approbation :</strong> Suivez en temps réel la validation par la Finance et la Direction Générale.</li>
        <li><strong>Règlement & Reçu :</strong> Téléchargez votre reçu ou bon de caisse dès confirmation du paiement.</li>
        <li><strong>Retour de caisse obligatoire :</strong> Pour toute avance reçue, vous devez déclarer et justifier les dépenses avec factures à l'appui dans l'espace "Retours à déclarer".</li>
      </ul>
    </div>
  `;

  let specificRoleDoc = "";

  if (isRH) {
    specificRoleDoc = `
      <div class="module-box" style="border-left-color: #7C3AED;">
        <h4 style="margin: 0 0 6px 0; color: #7C3AED; font-size: 15px;">🛡️ Vos Prérogatives Ressources Humaines (RH)</h4>
        <ul style="margin: 0; padding-left: 18px; font-size: 13px; color: #475569;">
          <li><strong>Supervision des présences :</strong> Consultation en direct du tableau de bord des présents, retardataires et absents.</li>
          <li><strong>Gestion des anomalies :</strong> Correction exceptionnelle des pointages et traitement des motifs de retard.</li>
          <li><strong>Calendrier :</strong> Paramétrage des jours fériés légaux et des plages d'horaires autorisées.</li>
          <li><strong>Reporting :</strong> Export mensuel et hebdomadaire des heures travaillées pour la paie.</li>
        </ul>
      </div>
    `;
  } else if (isFinance) {
    specificRoleDoc = `
      <div class="module-box" style="border-left-color: #D97706;">
        <h4 style="margin: 0 0 6px 0; color: #D97706; font-size: 15px;">📊 Vos Prérogatives Finance & Trésorerie</h4>
        <ul style="margin: 0; padding-left: 18px; font-size: 13px; color: #475569;">
          <li><strong>Catégorisation & Enveloppes :</strong> Affectation budgétaire et contrôle des plafonds par catégorie.</li>
          <li><strong>Décaissements :</strong> Exécution des règlements (espèces caisse ou virement/chèque bancaire) avec génération des bons de caisse.</li>
          <li><strong>Contrôle des retours :</strong> Réception physique des reliquats d'espèces et pointage des factures jointes.</li>
          <li><strong>Journal de Caisse :</strong> Traçabilité infalsifiable de toutes les entrées/sorties et solde d'ouverture.</li>
        </ul>
      </div>
    `;
  } else if (isDG) {
    specificRoleDoc = `
      <div class="module-box" style="border-left-color: #B45309;">
        <h4 style="margin: 0 0 6px 0; color: #B45309; font-size: 15px;">🏛️ Vos Prérogatives Direction Générale (DG)</h4>
        <ul style="margin: 0; padding-left: 18px; font-size: 13px; color: #475569;">
          <li><strong>Arbitrage Décisionnel :</strong> Approbation finale des demandes d'achat et engagements de dépenses.</li>
          <li><strong>Verrou de Clôture :</strong> Validation définitive de la régularisation financière des dossiers.</li>
          <li><strong>Vision Globale :</strong> Tableaux de bord de trésorerie consolidés et suivi analytique par catégorie.</li>
        </ul>
      </div>
    `;
  } else if (isAdmin) {
    specificRoleDoc = `
      <div class="module-box" style="border-left-color: #DC2626;">
        <h4 style="margin: 0 0 6px 0; color: #DC2626; font-size: 15px;">⚙️ Vos Prérogatives Administrateur</h4>
        <ul style="margin: 0; padding-left: 18px; font-size: 13px; color: #475569;">
          <li><strong>Gestion des utilisateurs :</strong> Création manuelle, invitations sécurisées et activation des comptes.</li>
          <li><strong>Rôles & Permissions :</strong> Attribution granulaire des droits par module.</li>
          <li><strong>Audit & Sécurité :</strong> Journalisation complète des événements système et traçabilité des opérations.</li>
        </ul>
      </div>
    `;
  } else {
    // Rôle collaborateur standard
    specificRoleDoc = `
      <div class="module-box" style="border-left-color: #2563EB;">
        <h4 style="margin: 0 0 6px 0; color: #2563EB; font-size: 15px;">👤 Vos Droits Collaborateur</h4>
        <p style="margin: 0; font-size: 13px; color: #475569;">
          Vous avez accès à votre espace personnel pour pointer votre présence, consulter l'historique de vos heures et émettre vos demandes d'achat professionnelles.
        </p>
      </div>
    `;
  }

  const actionButtonText = isInvitation
    ? "Activer mon compte & Définir mon mot de passe"
    : "Accéder au Portail SIM Assurances";

  const contentHtml = `
    <h2 style="color: #0F172A; margin-top: 0; font-size: 20px;">Bienvenue sur le Portail SIM Assurances !</h2>
    
    <p>Bonjour <strong>${fullName}</strong>,</p>
    
    <p>Votre compte d'accès à la plateforme interne de <strong>SIM Assurances</strong> a été créé avec succès par l'administrateur.</p>
    
    <div class="card">
      <h3 style="margin-top: 0; margin-bottom: 12px; font-size: 15px; color: #0B1B3D;">📌 Récapitulatif de votre profil :</h3>
      <table style="width: 100%; font-size: 14px; border-collapse: collapse;">
        <tr>
          <td style="padding: 6px 0; color: #64748B; width: 140px;">Nom complet :</td>
          <td style="padding: 6px 0; font-weight: 600; color: #0F172A;">${fullName}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748B;">Identifiant (Email) :</td>
          <td style="padding: 6px 0; font-weight: 600; color: #0F172A;">${email}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748B;">Rôle attribué :</td>
          <td style="padding: 6px 0;"><span class="badge">${roleName}</span></td>
        </tr>
        ${serviceName ? `
        <tr>
          <td style="padding: 6px 0; color: #64748B;">Service :</td>
          <td style="padding: 6px 0; font-weight: 600; color: #0F172A;">${serviceName}</td>
        </tr>
        ` : ""}
      </table>
    </div>

    <div style="text-align: center; margin: 28px 0;">
      <a href="${actionUrl}" class="btn" target="_blank">
        ${actionButtonText}
      </a>
    </div>

    ${isInvitation ? `
    <p style="font-size: 13px; color: #D97706; background-color: #FEF3C7; padding: 10px 14px; border-radius: 6px;">
      ℹ️ <strong>Activation requise :</strong> Ce lien d'invitation est valable pendant 7 jours. Il vous permettra de choisir votre mot de passe pour activer définitivement votre compte.
    </p>
    ` : `
    <p style="font-size: 13px; color: #64748B;">
      Vous pouvez vous connecter dès à présent avec le mot de passe qui vous a été communiqué.
    </p>
    `}

    <h3 style="color: #0B1B3D; margin-top: 32px; font-size: 17px; border-bottom: 2px solid #E2E8F0; padding-bottom: 8px;">
      📖 Guide Pratique & Documentation de vos Modules
    </h3>

    ${docPointage}
    ${docTresorerie}
    ${specificRoleDoc}

    <div class="card" style="margin-top: 24px;">
      <h4 style="margin: 0 0 6px 0; font-size: 13px; color: #0B1B3D;">🔒 Recommandations de sécurité :</h4>
      <p style="margin: 0; font-size: 12px; color: #64748B;">
        Vos identifiants sont strictement personnels. Ne communiquez jamais votre mot de passe à un tiers, même un administrateur. En cas d'oubli, vous pourrez utiliser la fonction "Mot de passe oublié" disponible sur la page de connexion.
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

SIM Assurances CI
`;

  return { subject, html, text };
}
