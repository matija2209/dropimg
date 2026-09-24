CREATE TABLE IF NOT EXISTS `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`key_hash` text NOT NULL,
	`key_prefix` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`expires_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `api_keys_key_hash_unique` ON `api_keys` (`key_hash`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `oauth_application` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`icon` text,
	`metadata` text,
	`client_id` text NOT NULL,
	`client_secret` text,
	`redirect_urls` text NOT NULL,
	`type` text NOT NULL,
	`disabled` integer DEFAULT false,
	`user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `oauth_application_client_id_unique` ON `oauth_application` (`client_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `oauth_access_token` (
	`id` text PRIMARY KEY NOT NULL,
	`access_token` text NOT NULL,
	`refresh_token` text,
	`access_token_expires_at` integer NOT NULL,
	`refresh_token_expires_at` integer,
	`client_id` text,
	`user_id` text,
	`scopes` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_application`(`client_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `oauth_access_token_access_token_unique` ON `oauth_access_token` (`access_token`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `oauth_access_token_refresh_token_unique` ON `oauth_access_token` (`refresh_token`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `oauth_consent` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text,
	`user_id` text NOT NULL,
	`scopes` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`consent_given` integer,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_application`(`client_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);