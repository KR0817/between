export const POLICY_VERSION = "2026-10-30";
export const DAY = 86400000;
export const AUDIT_DAYS = 186;
export const MAX_MAINTENANCE_AGE = 3 * 3600000;
export const ROOM_TOKEN = /^[a-f0-9]{64}$/;
export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

export interface Account {
  id: string; consent_version: string; consented: number; requested: number | null;
  verification: string; verified_until: number | null; reviewed: number | null;
}
export interface Room {
  token: string; expires: number; member_a: string; member_b: string | null;
  seen_a: number; seen_b: number; count: number; bytes: number; lifecycle: number; deleted: number | null;
}
export interface Maintenance {
  last_run: number; last_success: number | null; failures: number; cursor: string | null;
}
export function fail(status: number, message: string): never {
  throw Object.assign(new Error(message), { status });
}
export function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
export function randomToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), x => x.toString(16).padStart(2, "0")).join("");
}
export async function hash(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, "0")).join("");
}
export async function secretEqual(supplied: string, expected: string | undefined) {
  if (!expected || expected.length < 32 || supplied.length > 512) return false;
  const a = await hash(supplied); const b = await hash(expected);
  let different = 0;
  for (let i = 0; i < a.length; i++) different |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return different === 0;
}
/** Sites dispatch, not a client-provided UUID, is the authentication boundary. */
export function identity(request: Request) {
  const id = request.headers.get("oai-authenticated-user-id") || "";
  const email = request.headers.get("oai-authenticated-user-email") || "";
  return id && id.length <= 200 && email && email.length <= 254 ? { id, email } : null;
}
export function isOperator(request: Request, operatorEmail: string | undefined) {
  const user = identity(request);
  return !!(user && operatorEmail && user.email.toLowerCase() === operatorEmail.toLowerCase());
}
export async function boundedBody(request: Request, limit: number) {
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = []; let length = 0;
  if (reader) while (true) {
    const part = await reader.read(); if (part.done) break;
    length += part.value.byteLength;
    // Drain rejected bodies so the local HTTP relay can reuse its connection.
    if (length > limit) chunks.length = 0; else chunks.push(part.value);
  }
  if (length > limit) fail(413, "内容超过大小限制");
  const bytes = new Uint8Array(length); let offset = 0;
  for (const part of chunks) { bytes.set(part, offset); offset += part.length; }
  return bytes;
}
export async function body(request: Request): Promise<Record<string, unknown>> {
  try {
    const result: unknown = JSON.parse(new TextDecoder().decode(await boundedBody(request, 20000)));
    if (!result || typeof result !== "object" || Array.isArray(result)) fail(400, "请求格式错误");
    return result as Record<string, unknown>;
  } catch (error) {
    if (error instanceof SyntaxError) fail(400, "请求格式错误"); throw error;
  }
}
export function stringField(value: unknown, max: number, optional = false) {
  if (optional && (value === undefined || value === "")) return "";
  if (typeof value !== "string" || !value.trim() || value.length > max) fail(400, "填写内容为空或超过长度限制");
  return value.trim();
}
export async function audit(db: D1Database, actor: string, action: string, target = "", now = Date.now()) {
  await db.prepare("INSERT INTO security_events(id,actor,action,target,created) VALUES(?,?,?,?,?)")
    .bind(crypto.randomUUID(), await hash(actor), action, target ? await hash(target) : "", now).run();
}
export async function rateLimit(db: D1Database, key: string, limit: number, now: number) {
  const result = await db.prepare("INSERT INTO request_rates(key,count,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires<=? THEN 1 ELSE count+1 END,expires=CASE WHEN expires<=? THEN ? ELSE expires END WHERE expires<=? OR count<?")
    .bind(key, now + 3600000, now, now, now + 3600000, now, limit).run();
  if (!result.meta.changes) fail(429, "提交过于频繁，请稍后重试");
}
export function activeRoom(room: Room | null, now: number): room is Room {
  return !!room && room.lifecycle === 1 && room.deleted === null && room.expires > now;
}

/** A recent successful batch is insufficient when overdue deletion work remains. */
export async function getMaintenanceHealth(db: D1Database, now = Date.now()) {
  const [maintenance, queue] = await Promise.all([
    db.prepare("SELECT * FROM maintenance WHERE id='cleanup'").first<Maintenance>(),
    db.prepare("SELECT MIN(CASE WHEN lifecycle=1 THEN MIN(expires,COALESCE(deleted,expires)) ELSE deleted END) AS oldest FROM rooms WHERE deleted IS NOT NULL OR (lifecycle=1 AND expires<=?)")
      .bind(now).first<{oldest:number|null}>(),
  ]);
  const oldestQueued = queue?.oldest ?? null;
  return {
    maintenanceHealthy: !!maintenance?.last_success && maintenance.last_success > now - MAX_MAINTENANCE_AGE
      && maintenance.failures === 0 && (oldestQueued === null || oldestQueued > now - MAX_MAINTENANCE_AGE),
    lastMaintenance: maintenance?.last_success || null,
    oldestQueued,
  };
}

/** Bounded, idempotent application-storage cleanup; failures remain retryable. */
export async function runMaintenance(db: D1Database, bucket: R2Bucket, now = Date.now()) {
  const previous = await db.prepare("SELECT * FROM maintenance WHERE id='cleanup'").first<Maintenance>();
  let deletedRooms = 0; let failedRooms = 0; let pendingUploads = 0;
  let cursor: string | null = previous?.cursor || null;
  // Explicit legacy deletions are eligible; untouched legacy data is not.
  const rooms = await db.prepare("SELECT token FROM rooms WHERE deleted IS NOT NULL OR (lifecycle=1 AND expires<=?) ORDER BY COALESCE(deleted,expires),token LIMIT 10").bind(now).all<{token:string}>();
  for (const { token } of rooms.results) {
    try {
      await db.prepare("UPDATE rooms SET deleted=COALESCE(deleted,CASE WHEN lifecycle=1 THEN MIN(expires,?) ELSE ? END) WHERE token=?").bind(now, now, token).run();
      const listing = await bucket.list({ prefix: `${token}/`, limit: 1000 });
      if (listing.objects.length) await bucket.delete(listing.objects.map(object => object.key));
      const pending = await db.prepare("SELECT COUNT(*) AS total FROM upload_jobs WHERE room=? AND created>?").bind(token, now - 10 * 60000).first<{total:number}>();
      if (listing.truncated || pending?.total) { pendingUploads += pending?.total || 0; continue; }
      await db.batch([
        db.prepare("DELETE FROM messages WHERE room=?").bind(token),
        db.prepare("DELETE FROM upload_jobs WHERE room=?").bind(token),
        db.prepare("DELETE FROM rooms WHERE token=? AND deleted IS NOT NULL").bind(token),
      ]);
      deletedRooms++;
    } catch { failedRooms++; }
  }
  try {
    // A persisted cursor sweeps late uploads after interrupted requests, including
    // writes that arrived after room metadata was removed. Never touch live keys.
    const objects = await bucket.list({ limit: 100, ...(cursor ? { cursor } : {}) });
    for (const object of objects.objects) {
      const [token] = object.key.split("/");
      if (!ROOM_TOKEN.test(token)) continue;
      const room = await db.prepare("SELECT * FROM rooms WHERE token=?").bind(token).first<Room>();
      if (!room || room.deleted !== null || (room.lifecycle === 1 && room.expires <= now)) await bucket.delete(object.key);
    }
    cursor = objects.truncated ? objects.cursor : null;
    await db.batch([
      db.prepare("DELETE FROM complaints WHERE expires<=?").bind(now),
      db.prepare("DELETE FROM security_events WHERE created<?").bind(now - AUDIT_DAYS * DAY),
      db.prepare("DELETE FROM request_rates WHERE expires<=?").bind(now),
      db.prepare("DELETE FROM upload_jobs WHERE created<? AND NOT EXISTS(SELECT 1 FROM rooms WHERE token=upload_jobs.room)").bind(now - 10 * 60000),
    ]);
  } catch { failedRooms++; }
  await db.prepare("INSERT INTO maintenance(id,last_run,last_success,failures,cursor) VALUES('cleanup',?,?,?,?) ON CONFLICT(id) DO UPDATE SET last_run=excluded.last_run,last_success=CASE WHEN excluded.failures=0 THEN excluded.last_success ELSE maintenance.last_success END,failures=excluded.failures,cursor=excluded.cursor")
    .bind(now, failedRooms ? null : now, failedRooms, cursor).run();
  const remaining = await db.prepare("SELECT COUNT(*) AS total FROM rooms WHERE deleted IS NOT NULL OR (lifecycle=1 AND expires<=?)").bind(now).first<{total:number}>();
  return { status: failedRooms ? "partial" : "ok", deletedRooms, failedRooms, pendingUploads, more: !!remaining?.total || !!cursor };
}
