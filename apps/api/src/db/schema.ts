import { relations } from 'drizzle-orm';
import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull(),
  image: text('image'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  role: text('role').default('user'),
  banned: integer('banned', { mode: 'boolean' }),
  banReason: text('ban_reason'),
  banExpires: integer('ban_expires', { mode: 'timestamp' }),
});

export const session = sqliteTable('session', {
  id: text('id').primaryKey(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  token: text('token').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
});

export const account = sqliteTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp' }),
  refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp' }),
  scope: text('scope'),
  password: text('password'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const verification = sqliteTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
});

export const images = sqliteTable('images', {
  id: text('id').primaryKey(), // Random ID for the public URL
  filename: text('filename').notNull(),
  altName: text('alt_name'),
  mimeType: text('mime_type').notNull(),
  mediaType: text('media_type').notNull().default('image'),
  size: integer('size').notNull(),
  width: integer('width'),
  height: integer('height'),
  durationMs: integer('duration_ms'),
  transcoded: integer('transcoded', { mode: 'boolean' }).notNull().default(false),
  originalSize: integer('original_size'),
  isAnimated: integer('is_animated', { mode: 'boolean' }).notNull().default(false),
  deleteToken: text('delete_token').notNull(),
  source: text('source').notNull().default('upload'),
  userId: text('user_id')
    .references(() => user.id, { onDelete: 'set null' }),
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

export const apiKeys = sqliteTable('api_keys', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  keyHash: text('key_hash').notNull().unique(),
  keyPrefix: text('key_prefix').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp' }),
  expiresAt: integer('expires_at', { mode: 'timestamp' }),
});

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  user: one(user, {
    fields: [apiKeys.userId],
    references: [user.id],
  }),
}));

export const oauthApplication = sqliteTable('oauth_application', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  icon: text('icon'),
  metadata: text('metadata'),
  clientId: text('client_id').notNull().unique(),
  clientSecret: text('client_secret'),
  redirectUrls: text('redirect_urls').notNull(),
  type: text('type').notNull(),
  disabled: integer('disabled', { mode: 'boolean' }).default(false),
  userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const oauthAccessToken = sqliteTable('oauth_access_token', {
  id: text('id').primaryKey(),
  accessToken: text('access_token').notNull().unique(),
  refreshToken: text('refresh_token').unique(),
  accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp' }).notNull(),
  refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp' }),
  clientId: text('client_id').references(() => oauthApplication.clientId, { onDelete: 'cascade' }),
  userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
  scopes: text('scopes').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const oauthConsent = sqliteTable('oauth_consent', {
  id: text('id').primaryKey(),
  clientId: text('client_id').references(() => oauthApplication.clientId, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  scopes: text('scopes').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  consentGiven: integer('consent_given', { mode: 'boolean' }),
});

export const oauthApplicationRelations = relations(oauthApplication, ({ one, many }) => ({
  user: one(user, {
    fields: [oauthApplication.userId],
    references: [user.id],
  }),
  accessTokens: many(oauthAccessToken),
  consents: many(oauthConsent),
}));

export const oauthAccessTokenRelations = relations(oauthAccessToken, ({ one }) => ({
  application: one(oauthApplication, {
    fields: [oauthAccessToken.clientId],
    references: [oauthApplication.clientId],
  }),
  user: one(user, {
    fields: [oauthAccessToken.userId],
    references: [user.id],
  }),
}));

export const oauthConsentRelations = relations(oauthConsent, ({ one }) => ({
  application: one(oauthApplication, {
    fields: [oauthConsent.clientId],
    references: [oauthApplication.clientId],
  }),
  user: one(user, {
    fields: [oauthConsent.userId],
    references: [user.id],
  }),
}));

export type Image = typeof images.$inferSelect;
export type NewImage = typeof images.$inferSelect;
export type ImageVariant = typeof imageVariants.$inferSelect;
export type NewImageVariant = typeof imageVariants.$inferInsert;
export type User = typeof user.$inferSelect;
export type Session = typeof session.$inferSelect;
export type Account = typeof account.$inferSelect;
export type Verification = typeof verification.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
export type OauthApplication = typeof oauthApplication.$inferSelect;
export type NewOauthApplication = typeof oauthApplication.$inferInsert;
export type OauthAccessToken = typeof oauthAccessToken.$inferSelect;
export type NewOauthAccessToken = typeof oauthAccessToken.$inferInsert;
export type OauthConsent = typeof oauthConsent.$inferSelect;
export type NewOauthConsent = typeof oauthConsent.$inferInsert;

