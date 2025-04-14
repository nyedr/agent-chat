CREATE TABLE `chat` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`folder_id` text,
	`chat` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`meta` text NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`folder_id`) REFERENCES `folder`(`id`) ON UPDATE no action ON DELETE no action
); 