import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./src/_common/database/drizzle-gen",
  schema: "./src/_common/database/schema.ts",
  dialect: "sqlite",
  dbCredentials: {
    url: "sqlite:main.db",
  },
  strict: true,
  verbose: false,
});
