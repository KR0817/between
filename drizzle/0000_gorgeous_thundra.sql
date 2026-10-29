CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`room` text NOT NULL,
	`sender` text NOT NULL,
	`text` text NOT NULL,
	`filename` text,
	`size` integer,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `room_created` ON `messages` (`room`,`created`);--> statement-breakpoint
CREATE TABLE `rooms` (
	`token` text PRIMARY KEY NOT NULL,
	`creator` text NOT NULL,
	`created` integer NOT NULL,
	`expires` integer NOT NULL,
	`member_a` text NOT NULL,
	`member_b` text,
	`seen_a` integer NOT NULL,
	`seen_b` integer DEFAULT 0 NOT NULL,
	`bytes` integer DEFAULT 0 NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`sent_a` integer DEFAULT 0 NOT NULL,
	`sent_b` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `creator_created` ON `rooms` (`creator`,`created`);