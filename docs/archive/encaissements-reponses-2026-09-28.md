> **Remplacé par la V2.6** — [cahier-des-charges-encaissements-v2.md](../cahier-des-charges-encaissements-v2.md), reçue le 2026-09-28. Document conservé pour l’historique uniquement.

> Texte extrait du document Word « Reponses_questions_module_encaissements.docx » (2026-09-28), sans modification du contenu.

# Module Encaissements, taxes et commissions — Réponses aux questions
# A. Documents demandés
Question : un exemplaire du classeur Excel actuel.
Réponse : le fichier Classeur7.xlsx est joint. Il contient les en-têtes exacts des colonnes A à AH.
Question : la maquette des lots 1 et 2.
Réponse : la maquette est jointe (Maquette_registre_paiements.html) ; il suffit de l’ouvrir dans un navigateur.
# B. Questions qui bloquent le démarrage
1. Versements contenus dans le fichier de production. Le classeur a une ligne par versement, et il est importé par l’équipe technique ou la finance, alors que l’équipe technique ne peut pas saisir d’encaissements. Proposition : les versements du classeur sont acceptés lors de la reprise initiale ; ensuite, l’import de production ne crée que des contrats et les versements sont saisis par la gestion.
Réponse : d’accord. En complément, après la reprise initiale, la gestion doit pouvoir importer un fichier d’encaissements, en plus de la saisie à l’écran.
2. Validation des versements. Un versement passe de « Brouillon » à « Validé », mais aucun profil n’a ce droit. Proposition : l’enregistrement par le gestionnaire vaut validation ; seul le Responsable peut ensuite corriger un versement validé.
Réponse : d’accord.
3. Avenants et renouvellements. Le N° de police est unique, mais le type d’opération peut valoir « Renouvellement » ou « Avenant ». Proposition : un renouvellement reçoit un nouveau N° de police ; un avenant garde le N° d’origine et la prime est modifiée par l’équipe technique avec motif.
Réponse : la clé unique est le N° de police complet, tel que fourni par le système de production (le suffixe, par exemple « I00000 », peut identifier l’avenant). La règle de numérotation des renouvellements et des avenants vous sera confirmée par l’équipe technique.
4. Versement saisi après coup avec une date antérieure. Proposition : les montants d’un versement validé ne changent jamais ; le N° suit l’ordre de saisie.
Réponse : d’accord. Précision : le mois d’exigibilité de la taxe suit la date réelle de paiement. Si ce mois est déjà déclaré ou clôturé, la taxe est portée sur la déclaration suivante (échéance du 20), comme pour un paiement non identifié.
# C. Questions à trancher
5. Bordereaux et clôture. F5.1 génère les bordereaux à la clôture, F11 exige qu’ils soient déjà générés. Proposition : génération en fin de mois, comme point de la liste de contrôle, avant de clôturer.
Réponse : d’accord.
6. Types d’annulation. F4 et la section 5.7 ne citent pas les mêmes types. Proposition : on retient les trois types de la section 5.7 ; la ristourne est le remboursement qui découle d’une résiliation.
Réponse : d’accord.
7. Date d’une annulation « sans effet ». Proposition : la date saisie est celle de l’enregistrement de l’annulation ; l’effet remonte toujours à la date d’effet du contrat.
Réponse : d’accord.
8. Calcul inverse depuis la prime TTC. Proposition : si la base de la taxe ou des accessoires est modifiée, ou si les accessoires sont un montant fixe, le calcul inverse est désactivé et la prime nette doit être saisie.
Réponse : d’accord.
9. Contrat où prime nette + accessoires + taxes ≠ prime TTC. Proposition : la taxe totale reste celle du fichier ; la ventilation d’un versement peut s’écarter de quelques francs.
Réponse : d’accord.
10. Bordereau avec des lignes « En attente » (recette 9.6). Proposition : le bordereau fait 988 000 FCFA, les lignes en attente étant exclues ; le restant dû après un paiement de 500 000 est de 488 000.
Réponse : d’accord, vous avez raison. Le cas de recette 9.6 est corrigé dans ce sens.
11. Bénéficiaires des honoraires et des accessoires.
Réponse :
- Honoraires : versés à NOVELIA pour le moment. Le bénéficiaire peut changer ; il doit donc être modifiable dans le paramétrage, avec une date de début.
- Accessoires : partagés entre SIM et le partenaire. La répartition (en % pour SIM et en % pour le partenaire) doit être paramétrable par produit et par partenaire.
12. Paiement non identifié, identifié le 20 du mois. Proposition : il passe sur la déclaration du mois suivant, celle du jour étant considérée comme déjà préparée.
Réponse : d’accord.
13. Acompte non affecté. Proposition : l’acompte est enregistré à part, puis affecté plus tard, sans exception à la règle.
Réponse : d’accord.
14. Report d’un trop-perçu sur un autre contrat. Proposition : écriture inverse sur le contrat d’origine, puis nouveau versement sur l’autre contrat, daté du jour du report.
Réponse : d’accord.
15. Versement annulé après que la commission a été payée. Proposition : si la commission n’était pas payée, les deux lignes s’annulent ; si elle l’était, le montant devient « à récupérer » sur le partenaire.
Réponse : d’accord.
16. Écart de taxe après une déclôture. Proposition : calculé automatiquement à la re-clôture, puis reporté sur la déclaration suivante.
Réponse : d’accord.
17. Année des numéros de versement (PAI-AAAA-…). Proposition : l’année de saisie.
Réponse : d’accord.
# D. Points techniques
18. Double authentification du Responsable. Elle n’existe pas encore dans le portail et ne figure dans aucun lot. Faut-il l’intégrer à ce module ou la traiter plus tard pour tout le portail ?
Réponse : elle sera traitée plus tard, pour l’ensemble du portail. Elle devra être en place avant la mise en production de ce module.
19. Sécurité de la base de données. L’application se connecte à PostgreSQL avec le compte administrateur. Il faudrait un compte applicatif aux droits limités, notamment pour garantir le journal d’audit. Qui doit prendre cette décision ?
Réponse : la question est transmise au responsable informatique pour décision. Nous sommes favorables au compte applicatif à droits limités.
