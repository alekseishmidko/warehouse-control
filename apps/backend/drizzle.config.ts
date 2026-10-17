/** @file Drizzle Kit: source schema и output migrations; подключение из общей validated config. */
import { defineConfig } from 'drizzle-kit';
import { loadEnvironment } from './src/infrastructure/config/environment';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/infrastructure/database/schema.ts',
  out: './drizzle',
  dbCredentials: { url: loadEnvironment().databaseUrl },
});
