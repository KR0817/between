CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`consent_version` text NOT NULL,
	`consented` integer NOT NULL,
	`requested` integer,
	`verification` text DEFAULT 'none' NOT NULL,
	`verified_until` integer,
	`reviewed` integer,
	`method` text,
	`reference` text
);
--> statement-breakpoint
CREATE TABLE `complaints` (
	`id` text PRIMARY KEY NOT NULL,
	`receipt_hash` text NOT NULL,
	`category` text NOT NULL,
	`details` text NOT NULL,
	`contact` text NOT NULL,
	`room` text,
	`status` text DEFAULT 'received' NOT NULL,
	`reply` text DEFAULT '' NOT NULL,
	`created` integer NOT NULL,
	`updated` integer NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `complaints_receipt_hash_unique` ON `complaints` (`receipt_hash`);--> statement-breakpoint
CREATE INDEX `complaint_expiry` ON `complaints` (`expires`);--> statement-breakpoint
CREATE TABLE `maintenance` (
	`id` text PRIMARY KEY NOT NULL,
	`last_run` integer DEFAULT 0 NOT NULL,
	`last_success` integer,
	`failures` integer DEFAULT 0 NOT NULL,
	`cursor` text
);
--> statement-breakpoint
CREATE TABLE `request_rates` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `security_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`target` text NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `security_created` ON `security_events` (`created`);--> statement-breakpoint
CREATE TABLE `upload_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`room` text NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `upload_room` ON `upload_jobs` (`room`);--> statement-breakpoint
ALTER TABLE `rooms` ADD `lifecycle` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `rooms` ADD `deleted` integer;