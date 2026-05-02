CREATE TABLE `images` (
	`id` text PRIMARY KEY NOT NULL,
	`filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`delete_token` text NOT NULL,
	`created_at` integer NOT NULL
);
