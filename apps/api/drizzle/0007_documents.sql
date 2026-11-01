CREATE TABLE IF NOT EXISTS `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`original_filename` text NOT NULL,
	`alt_name` text,
	`storage_key` text NOT NULL,
	`mime_type` text DEFAULT 'application/pdf' NOT NULL,
	`size` integer NOT NULL,
	`page_count` integer,
	`visibility` text DEFAULT 'private' NOT NULL,
	`source` text DEFAULT 'mcp-direct' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `documents_storage_key_unique` ON `documents` (`storage_key`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `documents_user_id_idx` ON `documents` (`user_id`);
