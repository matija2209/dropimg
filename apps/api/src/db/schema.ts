import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const images = sqliteTable('images', {
  id: text('id').primaryKey(), // Random ID for the public URL
  filename: text('filename').notNull(),
  altName: text('alt_name'),
  mimeType: text('mime_type').notNull(),
  size: integer('size').notNull(),
  deleteToken: text('delete_token').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export type Image = typeof images.$inferSelect;
export type NewImage = typeof images.$inferInsert;
