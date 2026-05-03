CREATE TABLE `image_variants` (
	`image_id` text NOT NULL,
	`variant` text NOT NULL,
	`storage_key` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	PRIMARY KEY(`image_id`, `variant`),
	FOREIGN KEY (`image_id`) REFERENCES `images`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `images` ADD `width` integer;--> statement-breakpoint
ALTER TABLE `images` ADD `height` integer;--> statement-breakpoint
ALTER TABLE `images` ADD `is_animated` integer DEFAULT false NOT NULL;