import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import Database from 'better-sqlite3';
import * as schema from './schema.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const sqlite = new Database(process.env.DATABASE_URL?.replace('file:', '') || 'app.sqlite');
sqlite.pragma('foreign_keys = ON');
export const db = drizzle(sqlite, { schema });

// Automatically run migrations - point to the 'drizzle' folder at the app/api level
migrate(db, { migrationsFolder: join(__dirname, '../../drizzle') });
