import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import Database from 'better-sqlite3';
import * as schema from './schema.js';
import { join } from 'node:path';

const sqlite = new Database(process.env.DATABASE_URL?.replace('file:', '') || 'app.sqlite');
export const db = drizzle(sqlite, { schema });

// Automatically run migrations
migrate(db, { migrationsFolder: join(process.cwd(), 'drizzle') });
