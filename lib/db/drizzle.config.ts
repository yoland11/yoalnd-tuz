import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";
import path from "path";

config({ path: path.resolve(__dirname, "../../.env") });
config({ path: path.resolve(__dirname, "../../.env.local"), override: true });

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/**/*.ts",
  out: "./migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: true,
});