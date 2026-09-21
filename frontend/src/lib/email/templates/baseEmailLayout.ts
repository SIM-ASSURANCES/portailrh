/**
 * Gabarit HTML de base pour tous les courriels institutionnels de SIM Assurances.
 *
 * Conforme à la Charte Graphique Officielle SIM Assurances CI :
 * - Typographie e-mail : CALIBRI (Charte p. 12 : "Elle sera utilisée par défaut pour les communications par mail")
 * - Couleur Corporate Principale : Pantone 004B9C (#004B9C - R 0, V 75, B 156)
 * - Couleur Secondaire : Pantone 51AEE2 (#51AEE2 - R 81, V 174, B 226)
 * - Style visuel : Épuré, sobre, institutionnel, sans démarcation visuelle excessive (inspiré de la Papeterie p. 14 et de la Signature e-mail p. 15)
 * - Coordonnées officielles : Lot 195 Cité ATCI Riviera Faya, 08 BPM 4141 Abidjan 08, Tél (+225) 27 22 551 955 / 07 08 451 449
 */
export function baseEmailLayout({
  title,
  preheader,
  contentHtml,
  appUrl,
}: {
  title: string;
  preheader?: string;
  contentHtml: string;
  appUrl?: string;
}): string {
  const baseUrl = appUrl || process.env.NEXTAUTH_URL || process.env.AUTH_URL || "http://localhost:3000";

  return `<!DOCTYPE html>
<html lang="fr" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="x-apple-disable-message-reformatting">
  <title>${title}</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
  <style>
    /* Réinitialisation & typographie officielle (Charte p. 12 : CALIBRI pour les communications par mail) */
    body {
      margin: 0 !important;
      padding: 0 !important;
      background-color: #F8FAFC !important;
      font-family: Calibri, -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
      color: #1E293B;
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
    }
    table {
      border-spacing: 0;
      border-collapse: collapse;
      mso-table-lspace: 0pt;
      mso-table-rspace: 0pt;
    }
    td {
      padding: 0;
    }
    img {
      border: 0;
      -ms-interpolation-mode: bicubic;
    }
    .wrapper {
      width: 100%;
      table-layout: fixed;
      background-color: #F8FAFC;
      padding: 24px 10px;
    }
    .main-table {
      max-width: 600px;
      margin: 0 auto;
      background-color: #FFFFFF;
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid #E2E8F0;
      box-shadow: 0 2px 6px rgba(0, 75, 156, 0.04);
    }
    .btn {
      display: inline-block;
      padding: 12px 26px;
      background-color: #004B9C;
      color: #FFFFFF !important;
      text-decoration: none;
      font-weight: 600;
      font-size: 14px;
      border-radius: 6px;
      font-family: Calibri, -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
      letter-spacing: 0.2px;
    }
    .btn-danger {
      background-color: #DC2626 !important;
    }
    .btn-success {
      background-color: #004B9C !important;
    }
    .badge {
      display: inline-block;
      padding: 3px 10px;
      font-size: 11px;
      font-weight: 700;
      border-radius: 4px;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      font-family: Calibri, -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
    }
    .badge-primary {
      background-color: #EAF2FA;
      color: #004B9C;
      border: 1px solid #C5DCF4;
    }
    .badge-success {
      background-color: #F0FDF4;
      color: #15803D;
      border: 1px solid #BBF7D0;
    }
    .badge-danger {
      background-color: #FEF2F2;
      color: #B91C1C;
      border: 1px solid #FECACA;
    }
    .badge-warning {
      background-color: #FFFBEB;
      color: #B45309;
      border: 1px solid #FDE68A;
    }
    @media only screen and (max-width: 600px) {
      .wrapper {
        padding: 8px !important;
      }
      .content-padding {
        padding: 22px 18px !important;
      }
      .header-padding {
        padding: 20px 18px !important;
      }
      .footer-padding {
        padding: 20px 18px !important;
      }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #F8FAFC; font-family: Calibri, -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; color: #1E293B;">
  ${preheader ? `
  <div style="display: none; font-size: 1px; color: #F8FAFC; line-height: 1px; max-height: 0px; max-width: 0px; opacity: 0; overflow: hidden; mso-hide: all;">
    ${preheader}
  </div>` : ""}

  <div class="wrapper" style="width: 100%; background-color: #F8FAFC; padding: 24px 10px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td align="center">
          <table role="presentation" class="main-table" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; width: 100%; background-color: #FFFFFF; border-radius: 8px; overflow: hidden; border: 1px solid #E2E8F0; box-shadow: 0 2px 6px rgba(0, 75, 156, 0.04);">
            
            <!-- LISERÉ SUPÉRIEUR INSTITUTIONNEL (Pantone 004B9C & 51AEE2) -->
            <tr>
              <td style="height: 4px; background: #004B9C; background: linear-gradient(90deg, #004B9C 0%, #004B9C 72%, #51AEE2 72%, #51AEE2 100%); line-height: 4px; font-size: 4px;">
                &nbsp;
              </td>
            </tr>

            <!-- EN-TÊTE ÉPURÉ CONFORME À LA CHARTE GRAPHIQUE (Fond blanc sobre, logo officiel) -->
            <tr>
              <td class="header-padding" style="background-color: #FFFFFF; padding: 22px 36px 18px 36px; border-bottom: 1px solid #F1F5F9;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <!-- LOGOTYPE OFFICIEL SIM ASSURANCES (embarqué en CID inline pour affichage direct Outlook/Gmail sans blocage) -->
                    <td align="left" valign="middle" style="padding-right: 12px;">
                      <a href="${baseUrl}" target="_blank" style="text-decoration: none; display: inline-block;">
                        <img 
                          src="cid:sim-logo" 
                          alt="SIM ASSURANCES" 
                          width="190" 
                          height="28" 
                          border="0"
                          style="display: block; width: 190px; max-width: 100%; height: auto; border: 0; outline: none; text-decoration: none; font-family: Calibri, 'Segoe UI', Arial, sans-serif; font-size: 17px; font-weight: 800; color: #004B9C; letter-spacing: 0.5px;"
                        />
                      </a>
                    </td>
                    <!-- SOUS-TITRE APPLICATION / PORTAIL -->
                    <td align="right" valign="middle">
                      <span style="font-family: Calibri, 'Segoe UI', Arial, sans-serif; font-size: 11px; font-weight: 600; color: #64748B; text-transform: uppercase; letter-spacing: 0.5px;">
                        Portail RH & Métier
                      </span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- CONTENU DU COURRIEL (Fond blanc, typographie Calibri, aéré et lisible) -->
            <tr>
              <td class="content-padding" style="padding: 32px 36px; background-color: #FFFFFF; font-family: Calibri, -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; font-size: 15px; line-height: 1.6; color: #334155;">
                ${contentHtml}
              </td>
            </tr>

            <!-- PIED DE PAGE INSTITUTIONNEL (Conforme à la Charte p. 15 "Signatures e-mail") -->
            <tr>
              <td class="footer-padding" style="background-color: #F8FAFC; padding: 22px 36px; border-top: 1px solid #E2E8F0; font-family: Calibri, -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; font-size: 12px; line-height: 1.55; color: #64748B;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td valign="top" style="padding-bottom: 12px;">
                      <strong style="color: #004B9C; font-size: 13px;">SIM Assurances Côte d'Ivoire</strong><br>
                      <span style="color: #475569;">Lot 195, Cité ATCI Riviera Faya, Abidjan • 08 BPM 4141 Abidjan 08</span><br>
                      <span style="color: #475569;">Tél : (+225) 27 22 551 955 / 07 08 451 449 • <a href="https://www.simassurances.com" target="_blank" style="color: #004B9C; text-decoration: none; font-weight: 600;">www.simassurances.com</a></span>
                    </td>
                  </tr>
                  <tr>
                    <td style="border-top: 1px solid #E2E8F0; padding-top: 10px; font-size: 11px; color: #94A3B8;">
                      Ce courriel automatique vous a été transmis via le portail interne sécurisé de SIM Assurances. Merci de ne pas y répondre directement.
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </div>
</body>
</html>`;
}
