// Génère docs/roles-et-permissions.md à partir de src/rolesCibles.ts (aucun accès base).
//   cd backend && npx tsx prisma/generer-doc-roles.ts
import "./chargerEnv";
import fs from "node:fs";
import path from "node:path";
import { genererDocRoles } from "../src/rolesDocumentation";

const cible = path.resolve(__dirname, "../../docs/roles-et-permissions.md");
fs.writeFileSync(cible, genererDocRoles(), "utf-8");
console.log(`Écrit : ${cible}`);
