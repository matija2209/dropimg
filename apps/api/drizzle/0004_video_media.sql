ALTER TABLE `images` ADD `media_type` text DEFAULT 'image' NOT NULL;
--> statement-breakpoint
ALTER TABLE `images` ADD `duration_ms` integer;
--> statement-breakpoint
ALTER TABLE `images` ADD `transcoded` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `images` ADD `original_size` integer;
