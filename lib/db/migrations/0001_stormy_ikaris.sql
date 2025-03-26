CREATE TABLE `folder` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_chat` (
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
--> statement-breakpoint
INSERT INTO `__new_chat`("id", "title", "folder_id", "chat", "created_at", "updated_at", "meta", "archived") SELECT "id", "title", "folder_id", "chat", "created_at", "updated_at", "meta", "archived" FROM `chat`;--> statement-breakpoint
DROP TABLE `chat`;--> statement-breakpoint
ALTER TABLE `__new_chat` RENAME TO `chat`;--> statement-breakpoint
PRAGMA foreign_keys=ON;