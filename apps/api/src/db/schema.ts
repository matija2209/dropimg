import { relations } from 'drizzle-orm';
import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const images = sqliteTable('images', {
  id: text('id').primaryKey(), // Random ID for the public URL
  filename: text('filename').notNull(),
  altName: text('alt_name'),
  mimeType: text('mime_type').notNull(),
  size: integer('size').notNull(),
  width: integer('width'),
  height: integer('height'),
  isAnimated: integer('is_animated', { mode: 'boolean' }).notNull().default(false),
  deleteToken: text('delete_token').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const imageVariants = sqliteTable(
  'image_variants',
  {
    imageId: text('image_id')
      .notNull()
      .references(() => images.id, { onDelete: 'cascade' }),
    variant: text('variant').notNull(),
    storageKey: text('storage_key').notNull(),
    mimeType: text('mime_type').notNull(),
    size: integer('size').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
  },
  (table) => [primaryKey({ columns: [table.imageId, table.variant] })]
);

export const imagesRelations = relations(images, ({ many }) => ({
  variants: many(imageVariants),
}));

export const imageVariantsRelations = relations(imageVariants, ({ one }) => ({
  image: one(images, {
    fields: [imageVariants.imageId],
    references: [images.id],
  }),
}));

export type Image = typeof images.$inferSelect;
export type NewImage = typeof images.$inferInsert;
export type ImageVariant = typeof imageVariants.$inferSelect;
export type NewImageVariant = typeof imageVariants.$inferInsert;
