CREATE TABLE `document` (
	`id` text PRIMARY KEY NOT NULL,
	`createdAt` text NOT NULL,
	`title` text NOT NULL,
	`content` text,
	`kind` text NOT NULL,
	`chatId` text,
	`extension` text DEFAULT 'txt' NOT NULL,
	FOREIGN KEY (`chatId`) REFERENCES `chat`(`id`) ON UPDATE no action ON DELETE no action
); 