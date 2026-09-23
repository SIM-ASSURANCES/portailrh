# Guide Pratique & Fonctionnel du Pointage RH — SIM Assurances

> **Bienvenue sur le guide utilisateur du portail de pointage.**  
> Ce document explique simplement, sans jargon technique, comment fonctionne le système de pointage au quotidien, quels sont vos droits, comment justifier un retard ou une absence, et comment l'équipe RH gère les présences.
>
> Pour les spécifications techniques et l'architecture logicielle, consulter : [POINTAGE_ARCHITECTURE.md](file:///c:/Users/dmass/Documents/portailrh/docs/POINTAGE_ARCHITECTURE.md).

---

## 📌 En Bref : L'Essentiel en 1 Minute

| Question | Réponse en clair |
|---|---|
| **Qui doit pointer ?** | Tous les collaborateurs de SIM Assurances disposant d'un compte actif sur le portail. |
| **Quels sont les horaires de référence ?** | **Matin** : 07h45 – 12h15 \| **Après-midi** : 13h15 – 16h45. |
| **Combien de fois par jour ?** | **2 fois** : une fois à l'arrivée (le matin) et une fois au départ (le soir). |
| **Comment pointer ?** | Soit depuis votre **ordinateur au bureau**, soit en scannant le **QR Code officiel** avec votre smartphone, soit via **géolocalisation GPS** en secours. |
| **Que se passe-t-il après 07h45 ?** | Vous êtes considéré en retard : le système vous demande d'indiquer obligatoirement un motif explicatif. |
| **Que se passe-t-il si je n'ai pas pointé de la journée ?** | À la fin de la journée (après 16h45), une absence automatique `À contrôler` est créée pour que les RH puissent vérifier votre situation. |

---

## 📱 Les 3 Façons de Pointer

```
                  ┌────────────────────────────────────────┐
                  │          JE SUIS AU BUREAU             │
                  └──────────────────┬─────────────────────┘
                                     │
         ┌───────────────────────────┼───────────────────────────┐
         ▼                           ▼                           ▼
 ┌───────────────┐           ┌───────────────┐           ┌───────────────┐
 │   Option 1    │           │   Option 2    │           │   Option 3    │
 │ Sur mon PC    │           │ Mon Smartphone│           │ Secours GPS   │
 │ (Navigateur)  │           │   (QR Code)   │           │  (Sans Wi-Fi) │
 └───────┬───────┘           └───────┬───────┘           └───────┬───────┘
         │                           │                           │
         ▼                           ▼                           ▼
Connecté au Wi-Fi            Scannez l'affiche           Si coupure Wi-Fi,
SIM Assurances               à l'accueil avec            le GPS valide que
(Validation IP)              votre caméra                vous êtes au bureau
```

### 1. Sur votre ordinateur professionnel (Option standard)
- Ouvrez votre navigateur sur le portail : [http://portail.simassurances.ci/pointage](http://portail.simassurances.ci/pointage).
- Dès que votre PC est relié au réseau Wi-Fi ou au câble Ethernet du bureau, le bouton vert de pointage est disponible.
- Cliquez simplement sur **"Valider mon Arrivée"** ou **"Valider mon Départ"**.

### 2. Avec votre smartphone via le QR Code officiel (Le plus rapide)
- Ouvrez l'appareil photo de votre smartphone ou une application de scan.
- Scannez le **QR Code officiel** affiché à l'accueil ou à l'entrée des bureaux.
- Vous êtes instantanément redirigé vers l'écran de pointage sécurisé sur votre téléphone.
- Cliquez sur le bouton de confirmation : c'est enregistré !

### 3. En secours par Géolocalisation GPS (Si le Wi-Fi ne marche pas)
- Si la connexion Internet de l'entreprise est ralentie ou si vous utilisez la 4G/5G de votre téléphone portable :
- Le portail vous propose automatiquement d'utiliser la **géolocalisation**.
- Acceptez l'autorisation de localisation de votre navigateur : le système vérifie que vous êtes physiquement dans le périmètre du bureau (rayon de 50 mètres) et valide votre pointage.

> [!WARNING]
> **Attention aux tentatives hors bureau** : Si vous tentez de pointer depuis votre domicile ou sur le trajet, le pointage est automatiquement bloqué et une alerte de sécurité est envoyée à l'équipe RH avec votre position estimée.

---

## 👤 Guide Collaborateur au Quotidien

### 1. Pointer mon arrivée le matin
1. Rendez-vous sur la page **Pointage**.
2. **Si vous arrivez à l'heure (avant 07h45)** : Cliquez sur **"Valider mon Arrivée"**. Un message vert confirme la prise en compte.
3. **Si vous arrivez après 07h45 (Retard)** :
   - Un encadré orange apparaît indiquant votre nombre de minutes de retard.
   - Un champ texte obligatoire s'affiche : *"Motif du retard"*.
   - Renseignez la raison (ex. : *Bouchons exceptionnels carrefour Duncan*, *Rendez-vous médical préalable*).
   - Cliquez sur **"Enregistrer mon arrivée avec motif"**.

### 2. Pointer mon départ en fin de journée
1. En quittant le bureau, retournez sur la page **Pointage**.
2. Le système reconnaît que vous avez déjà pointé votre arrivée ce matin et vous propose automatiquement le bouton **"Valider mon Départ"**.
3. **Cas normal (après 16h45)** : Cliquez sur le bouton. Un message chaleureux s'affiche (avec un mot personnalisé pour le week-end si nous sommes vendredi !).
4. **Départ anticipé (avant 16h45)** :
   - Si vous devez partir plus tôt (urgence, permission autorisée), le système vous demande obligatoirement un motif.
   - Indiquez la raison puis confirmez. Votre responsable RH en sera immédiatement informé.

### 3. Consulter mon historique personnel
- Cliquez sur **"Historique"** dans le menu latéral.
- Vous retrouvez un récapitulatif clair de toutes vos journées :
  - L'heure exacte de vos arrivées et départs.
  - L'heure contractuelle qui était prévue.
  - Vos éventuels retards et les motifs que vous aviez saisis.
  - Les corrections éventuelles apportées par les RH (avec le motif de modification en toute transparence).

---

## 🏢 Guide pour l'Équipe RH & les Managers

La console RH sous **Pointage RH** regroupe tous les outils pour piloter la présence sans paperasse.

```
Pointage RH
 ├── 🟢 Présence du Jour      → Qui est au bureau ? Qui est en retard ?
 ├── 📝 Pointage Exceptionnel  → Régulariser un collaborateur qui n'a pas pu pointer
 ├── ✏️ Corrections           → Modifier une heure erronée avec traçabilité
 ├── 📋 Absences              → Justifier ou confirmer les absences détectées
 ├── ⚙️ Horaires & GPS        → Configurer les horaires et calibrer la position
 ├── 📅 Jours Fériés          → Enregistrer les jours chômés
 └── 📊 Reporting & Export    → Télécharger le fichier Excel officiel pour la paie
```

### 1. Voir les présences en direct (`/pointage/rh/presence`)
- **Direct temps réel** : La liste se met à jour automatiquement dès qu'un employé pointe, sans avoir besoin de rafraîchir la page (grâce à la technologie Server-Sent Events).
- Des compteurs en haut d'écran affichent le nombre de **Présents**, de **Retards** et d'**Absents**.
- Vous pouvez basculer d'un onglet à l'autre pour filtrer rapidement les personnes concernées.

### 2. Traiter une absence (`/pointage/rh/absences`)
- Chaque matin ou en fin de journée, les personnes n'ayant pas pointé apparaissent avec le statut orange **"À contrôler"**.
- Ouvrez la fiche de l'absence :
  - **Justifiée** : Si l'employé vous a fourni un justificatif (arrêt maladie, autorisation de la direction, mission). Saisissez la note justificative et validez.
  - **Confirmée** : Si l'absence est injustifiée. La confirmation envoie immédiatement un email et une notification d'avertissement au collaborateur.

### 3. Saisir un pointage exceptionnel (`/pointage/rh/pointages/nouveau`)
Un collaborateur a oublié son téléphone ou a été envoyé directement en clientèle le matin ?
1. Sélectionnez le nom de l'employé dans la liste déroulante.
2. Choisissez le type (`Arrivée` ou `Départ`).
3. Indiquez la date et l'heure réelles de sa prise de poste.
4. Renseignez un motif explicatif.
5. **Effet magique** : Si une absence avait été générée pour cette journée, le système la régularise automatiquement au statut **Justifiée** !

### 4. Corriger un pointage erroné (`/pointage/rh/corrections`)
Une erreur de manipulation (ex. départ pointé par inadvertance à midi au lieu de 17h) ?
- Les RH peuvent modifier l'heure enregistrée.
- **Règle d'or** : Chaque modification exige un motif et reste inscrite dans le grand livre d'audit du portail (l'ancienne heure et la nouvelle heure restent consultables pour éviter tout litige).
- Si l'heure d'arrivée est modifiée, le calcul du retard est automatiquement recalculé.

### 5. Exporter le reporting mensuel Excel (`/pointage/rh/reporting`)
1. Sélectionnez la période (ex : du 1er au 31 du mois).
2. Filtrez éventuellement par Service (ex : Commercial, Finance, Technique) ou pour un collaborateur précis.
3. Cliquez sur **"Exporter en Excel"**.
4. Vous obtenez un fichier `.xlsx` prêt pour la paie avec deux onglets aux couleurs de SIM Assurances :
   - **Résumé** : Total des jours travaillés, présences, absences, nombre de retards et cumul des minutes de retard par personne.
   - **Détails des retards** : Chaque retard répertorié ligne par ligne avec l'heure exacte et le motif invoqué.

---

## 🤖 Règles Automatiques : Comment le Système vous Protège

Pour éviter toute injustice, plusieurs gardes-fous automatiques ont été conçus :

### 1. Pourquoi ai-je été marqué "Absent" automatiquement ?
Le système exécute une vérification automatique chaque soir après l'heure de départ (16h45). Si un collaborateur n'a enregistré aucun pointage de la journée, le système crée une fiche d'absence au statut temporaire **"À contrôler"**.  
👉 **Rien n'est définitif** : Le service RH vérifie toujours ces fiches avant de valider.

### 2. L'alerte d'oubli de pointage de départ
Vous avez bien pointé votre arrivée à 07h40, mais vous êtes parti à 17h sans penser à pointer votre départ ?
- 30 minutes après la fin de journée, le système détecte l'oubli.
- Vous recevez instantanément une **alerte prioritaire** sur votre téléphone et par email pour vous rappeler de régulariser la situation dès le lendemain auprès des RH.

### 3. Week-ends et jours fériés : Zéro fausse absence
Le système ignore scrupuleusement les samedis et dimanches ainsi que tous les jours fériés enregistrés dans le calendrier de l'entreprise. Aucune absence automatique ne peut être générée sur ces journées.

### 4. Nouveaux arrivants et réactivations (Règle Option B)
Si un collaborateur rejoint l'entreprise un mercredi ou si son compte est réactivé un jeudi :
- Le système interdit formellement de lui imputer des absences pour les jours précédant son arrivée ou pour le jour même de sa création.
- Vos compteurs de présence démarrent proprement le lendemain de la mise en service de votre compte.

---

## ✨ Les Autres Nouveautés Pratiques du Portail

En plus du pointage, plusieurs améliorations majeures simplifient votre quotidien sur le portail :

### 🔔 Les Notifications Push sur votre écran
- Vous pouvez désormais autoriser les notifications du portail sur votre téléphone ou sur votre navigateur d'ordinateur.
- **Même si le portail est fermé**, vous recevrez une alerte directe sur votre écran pour les informations capitales (oubli de départ, validation de demande de trésorerie, régularisation RH).
- Un nouveau **tiroir latéral de notifications** s'ouvre d'un clic sur la cloche en haut à droite, avec un son discret lors des nouveaux messages.

### 🔑 Mot de passe oublié ? Réinitialisez-le en 1 clic
- Si vous avez égaré votre mot de passe, cliquez sur **"Mot de passe oublié ?"** sur la page de connexion.
- Saisissez votre adresse email professionnelle.
- Vous recevrez immédiatement un email sécurisé contenant un lien valable 1 heure pour choisir un nouveau mot de passe en toute autonomie, sans déranger l'administrateur !

### 👤 Votre Espace Profil Personnalisé
- Accédez à votre page **Profil** pour consulter le récapitulatif de votre compte, mettre à jour votre photo d'avatar et consulter votre journal d'activité récent.

---

## ❓ Foire Aux Questions (FAQ)

#### Q1 : Que faire si je n'ai pas de smartphone pour scanner le QR Code ?
> **Réponse** : Vous n'êtes absolument pas obligé d'utiliser un smartphone ! Vous pouvez pointer directement depuis n'importe quel ordinateur branché au réseau du bureau en vous rendant sur la page Pointage du portail.

#### Q2 : J'étais en mission extérieure toute la journée, comment justifier ma présence ?
> **Réponse** : Prévenez votre responsable RH à votre retour ou par email. L'équipe RH utilisera la fonction **Pointage Exceptionnel** pour inscrire votre journée comme effectuée et justifiée.

#### Q3 : Le système me dit "Signal GPS trop faible" quand j'essaie de pointer en géolocalisation. Que faire ?
> **Réponse** : Si vous êtes au sous-sol ou au milieu d'un bâtiment très épais, le GPS du téléphone peut être imprécis (> 150 mètres). Rapprochez-vous d'une fenêtre ou de l'entrée du bâtiment pendant quelques secondes, ou connectez-vous au réseau Wi-Fi de l'entreprise.

#### Q4 : J'ai oublié de pointer ce matin en arrivant à 08h00. Que dois-je faire ?
> **Réponse** : Pointez dès que vous vous en apercevez en indiquant en motif *"Oubli de badge à l'arrivée (arrivé à 08h00)"*. Le service RH pourra ajuster l'heure réelle lors de sa revue quotidienne.

#### Q5 : Mes collègues peuvent-ils voir mes heures de pointage et mes retards ?
> **Réponse** : **Non**. Chaque collaborateur ne peut consulter que son propre historique personnel. Seuls l'équipe RH et la Direction Générale ont accès au tableau de bord global de l'entreprise.

#### Q6 : Pourquoi le système me demande-t-il un motif si je pars à 16h30 ?
> **Réponse** : L'horaire de fin de journée de référence est fixé à 16h45. Tout départ avant cette heure est considéré comme un départ anticipé et nécessite d'indiquer une raison (ex: rendez-vous convenu avec le manager).

#### Q7 : Que se passe-t-il si les RH modifient l'un de mes pointages ?
> **Réponse** : Vous recevez automatiquement une notification vous informant de la régularisation, et la mention de la correction ainsi que le motif saisi par les RH apparaissent clairement dans votre historique.

---

*Guide officiel maintenu pour le personnel de SIM Assurances.*
