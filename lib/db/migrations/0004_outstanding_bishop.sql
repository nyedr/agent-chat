PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_document` (
	`id` text NOT NULL,
	`chatId` text NOT NULL,
	`title` text NOT NULL,
	`content` text,
	`kind` text NOT NULL,
	`extension` text DEFAULT 'txt' NOT NULL,
	`createdAt` text NOT NULL,
	PRIMARY KEY(`id`, `createdAt`),
	FOREIGN KEY (`chatId`) REFERENCES `chat`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_document`("id", "chatId", "title", "content", "kind", "extension", "createdAt") SELECT "id", "chatId", "title", "content", "kind", "extension", "createdAt" FROM `document`;--> statement-breakpoint
DROP TABLE `document`;--> statement-breakpoint
ALTER TABLE `__new_document` RENAME TO `document`;--> statement-breakpoint
PRAGMA foreign_keys=ON;