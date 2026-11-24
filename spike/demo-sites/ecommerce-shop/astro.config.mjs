import { defineConfig } from "astro/config";
import { emdash } from "emdash/astro";
import { local } from "emdash/storage";
import { postgres } from "emdash/database";

// Read database URL from environment
const databaseUrl = process.env.DATABASE_URL || "postgresql://emdash:emdash@localhost:5432/emdash";

export default defineConfig({
	integrations: [
		emdash({
			database: postgres({ connectionString: databaseUrl }),
			storage: local({ directory: process.env.UPLOADS_DIR || "./uploads", baseUrl: "/_emdash/api/media/file" }),
		}),
	],
	output: "server",
});
