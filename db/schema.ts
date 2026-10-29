import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const rooms = sqliteTable("rooms", {
  token: text("token").primaryKey(),
  creator: text("creator").notNull(),
  created: integer("created").notNull(),
  expires: integer("expires").notNull(),
  memberA: text("member_a").notNull(),
  memberB: text("member_b"),
  seenA: integer("seen_a").notNull(),
  seenB: integer("seen_b").notNull().default(0),
  bytes: integer("bytes").notNull().default(0),
  count: integer("count").notNull().default(0),
  sentA: integer("sent_a").notNull().default(0),
  sentB: integer("sent_b").notNull().default(0),
  lifecycle: integer("lifecycle").notNull().default(0),
  deleted: integer("deleted"),
}, (t) => [index("creator_created").on(t.creator, t.created)]);

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  room: text("room").notNull(),
  sender: text("sender").notNull(),
  text: text("text").notNull(),
  filename: text("filename"),
  size: integer("size"),
  created: integer("created").notNull(),
}, (t) => [index("room_created").on(t.room, t.created)]);

export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  consentVersion: text("consent_version").notNull(),
  consented: integer("consented").notNull(),
  requested: integer("requested"),
  verification: text("verification").notNull().default("none"),
  verifiedUntil: integer("verified_until"),
  reviewed: integer("reviewed"),
  method: text("method"),
  reference: text("reference"),
});

export const uploadJobs = sqliteTable("upload_jobs", {
  id: text("id").primaryKey(),
  room: text("room").notNull(),
  created: integer("created").notNull(),
}, t => [index("upload_room").on(t.room)]);

export const complaints = sqliteTable("complaints", {
  id: text("id").primaryKey(),
  receiptHash: text("receipt_hash").notNull().unique(),
  category: text("category").notNull(),
  details: text("details").notNull(),
  contact: text("contact").notNull(),
  room: text("room"),
  status: text("status").notNull().default("received"),
  reply: text("reply").notNull().default(""),
  created: integer("created").notNull(),
  updated: integer("updated").notNull(),
  expires: integer("expires").notNull(),
}, t => [index("complaint_expiry").on(t.expires)]);

export const securityEvents = sqliteTable("security_events", {
  id: text("id").primaryKey(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  target: text("target").notNull(),
  created: integer("created").notNull(),
}, t => [index("security_created").on(t.created)]);

export const requestRates = sqliteTable("request_rates", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  expires: integer("expires").notNull(),
});

export const maintenance = sqliteTable("maintenance", {
  id: text("id").primaryKey(),
  lastRun: integer("last_run").notNull().default(0),
  lastSuccess: integer("last_success"),
  failures: integer("failures").notNull().default(0),
  cursor: text("cursor"),
});
