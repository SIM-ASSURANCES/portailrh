// Charge le ".env" de la racine du monorepo (voir CLAUDE.md "Monorepo backend/frontend") AVANT tout autre module.
//
// À importer EN PREMIER (`import "./chargerEnv";`) dans tout script qui touche, même indirectement, `src/prisma.ts` : ce
// module lit `DATABASE_URL` dès son import. Un simple `dotenv.config(...)` écrit après les `import` arrive trop tard — les
// imports sont évalués avant le corps du fichier — et le client se connecterait alors à la base du nom de l'utilisateur
// système (« Database `Arist` does not exist »). Les imports s'évaluant dans l'ordre, un module à effet de bord importé en
// premier est exécuté avant les autres. Une variable déjà définie dans le shell reste prioritaire (dotenv ne l'écrase pas).
import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });
