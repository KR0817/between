import { env } from "cloudflare:workers";
import {
  POLICY_VERSION, DAY, ROOM_TOKEN, UUID,
  fail, json, randomToken, hash, secretEqual, identity, isOperator,
  boundedBody, body, stringField, audit, rateLimit, activeRoom, runMaintenance, getMaintenanceHealth,
  type Account, type Room,
} from "@/lib/governance";

export const dynamic = "force-dynamic";
const MAX_FILE = 20 * 1024 * 1024;
interface Message { id: string; room: string; sender: string; text: string; filename: string | null; size: number | null; created: number }
interface Complaint { id: string; category: string; details: string; contact: string; room: string | null; status: string; reply: string; created: number; updated: number }

async function handle(request: Request) {
  try {
    const db = env.DB; const bucket = env.BUCKET;
    if (!db || !bucket) fail(503, "服务尚未配置完成");
    const url = new URL(request.url);
    const origin = request.headers.get("origin");
    if ((origin && origin !== url.origin) || request.headers.get("sec-fetch-site") === "cross-site") fail(403, "不允许跨站请求");
    const route = url.pathname.replace(/\/$/, "");
    const post = request.method === "POST";
    const now = Date.now();
    const user = identity(request);
    const admin = isOperator(request, env.OPERATOR_EMAIL);
    if (route === "/api/maintenance" && post) {
      const authorization = request.headers.get("authorization") || "";
      if (!authorization.startsWith("Bearer ") || !await secretEqual(authorization.slice(7), env.MAINTENANCE_TOKEN)) fail(401, "维护授权无效");
      const result = await runMaintenance(db, bucket, now);
      return json(result, result.failedRooms ? 503 : 200);
    }
    if (route === "/api/account" && request.method === "GET") {
      const account = user ? await db.prepare("SELECT * FROM accounts WHERE id=?").bind(user.id).first<Account>() : null;
      const health = await getMaintenanceHealth(db, now);
      return json({ signedIn: !!user, member: user?.id || "", email: user?.email || "", admin,
        accepted: account?.consent_version === POLICY_VERSION,
        verification: account?.verification || "none", verifiedUntil: account?.verified_until || null,
        ...health });
    }
    if (route === "/api/complaints/status" && post) {
      const value = await body(request); const receipt = stringField(value.receipt, 64);
      if (!ROOM_TOKEN.test(receipt)) fail(404, "回执不存在或已到保存期限");
      const item = await db.prepare("SELECT status,reply,created,updated FROM complaints WHERE receipt_hash=? AND expires>?").bind(await hash(receipt), now).first();
      if (!item) fail(404, "回执不存在或已到保存期限");
      return json(item);
    }
    if (route === "/api/complaints" && post) {
      const value = await body(request);
      const category = stringField(value.category, 20);
      if (!["privacy", "content", "account", "other"].includes(category)) fail(400, "请选择有效的投诉类型");
      const details = stringField(value.details, 2000); const contact = stringField(value.contact, 254, true);
      if (!env.MAINTENANCE_TOKEN || env.MAINTENANCE_TOKEN.length < 32) fail(503, "投诉服务配置尚未完成，请使用公示邮箱联系运营者");
      const ip = request.headers.get("cf-connecting-ip") || "local";
      await rateLimit(db, await hash(`${env.MAINTENANCE_TOKEN}:complaint:${ip}`), 3, now);
      let room: string | null = null;
      const requestedRoom = request.headers.get("x-room");
      if (requestedRoom) {
        if (!ROOM_TOKEN.test(requestedRoom)) fail(400, "房间标识无效");
        const record = await db.prepare("SELECT * FROM rooms WHERE token=?").bind(requestedRoom).first<Room>();
        const owner = record?.lifecycle === 0 ? request.headers.get("x-member") : user?.id;
        if (!record || !owner || (record.member_a !== owner && record.member_b !== owner)) fail(403, "只能关联你参与的房间");
        room = requestedRoom;
      }
      const receipt = randomToken(); const id = crypto.randomUUID();
      await db.prepare("INSERT INTO complaints(id,receipt_hash,category,details,contact,room,created,updated,expires) VALUES(?,?,?,?,?,?,?,?,?)")
        .bind(id, await hash(receipt), category, details, contact, room, now, now, now + 180 * DAY).run();
      await audit(db, user?.id || "anonymous", "complaint_received", id, now);
      return json({ receipt, status: "received", created: now }, 201);
    }
    if (route.startsWith("/api/admin/")) {
      if (!admin || !user) fail(403, "仅限运营者处理");
      if (route === "/api/admin/overview" && request.method === "GET") {
        const accountId = url.searchParams.has("accountId") ? stringField(url.searchParams.get("accountId"), 200) : null;
        const complaintId = url.searchParams.has("complaintId") ? stringField(url.searchParams.get("complaintId"), 36) : null;
        if (complaintId && !UUID.test(complaintId)) fail(400, "工单编号无效");
        const accountQuery = db.prepare(`SELECT id,requested,verification,reviewed,verified_until FROM accounts WHERE ${accountId ? "id=?" : "requested IS NOT NULL"} ORDER BY CASE WHEN verification='pending' THEN 0 ELSE 1 END,requested ASC LIMIT 100`);
        const accounts = await (accountId ? accountQuery.bind(accountId) : accountQuery).all();
        const complaintQuery = db.prepare(`SELECT id,category,details,contact,room,status,reply,created,updated FROM complaints WHERE expires>? ${complaintId ? "AND id=?" : ""} ORDER BY CASE WHEN status IN ('received','in_progress') THEN 0 ELSE 1 END,CASE WHEN status IN ('received','in_progress') THEN created END ASC,created DESC LIMIT 100`);
        const complaints = await (complaintId ? complaintQuery.bind(now, complaintId) : complaintQuery.bind(now)).all<Complaint>();
        const counts = await db.prepare("SELECT COALESCE(SUM(CASE WHEN lifecycle=1 AND deleted IS NULL AND expires>? THEN 1 ELSE 0 END),0) AS active,COALESCE(SUM(CASE WHEN deleted IS NOT NULL OR (lifecycle=1 AND expires<=?) THEN 1 ELSE 0 END),0) AS queued,COALESCE(SUM(CASE WHEN lifecycle=0 AND deleted IS NULL THEN 1 ELSE 0 END),0) AS legacy FROM rooms").bind(now, now).first();
        const lastMaintenance = await db.prepare("SELECT last_run,last_success,failures FROM maintenance WHERE id='cleanup'").first();
        return json({ accounts: accounts.results, complaints: complaints.results.map(({ room, ...item }) => ({ ...item, hasRoom: !!room })), counts, lastMaintenance });
      }
      if (route === "/api/admin/verification" && post) {
        const value = await body(request); const accountId = stringField(value.accountId, 200);
        const decision = stringField(value.decision, 20);
        if (!["verified", "rejected", "revoked"].includes(decision)) fail(400, "审核结果无效");
        let method = ""; let reference = "";
        if (decision === "verified") {
          method = stringField(value.method, 30); reference = stringField(value.reference, 120);
          if (!["document", "verified_phone", "trusted_provider"].includes(method) || value.attested !== true) fail(400, "请确认已实际核验，并填写不含证件信息的凭据编号");
          if (/\b\d{15,18}[xX]?\b/.test(reference)) fail(400, "凭据编号中不得包含身份证号码");
        }
        const account = await db.prepare("SELECT * FROM accounts WHERE id=?").bind(accountId).first<Account>();
        if (!account || !account.requested || account.consent_version !== POLICY_VERSION) fail(409, "该账号尚未提交有效核验申请");
        await db.batch([
          db.prepare("UPDATE accounts SET verification=?,verified_until=?,reviewed=?,method=?,reference=? WHERE id=?")
            .bind(decision, decision === "verified" ? now + 180 * DAY : null, now, method || null, reference || null, accountId),
          db.prepare("UPDATE rooms SET deleted=COALESCE(deleted,?) WHERE lifecycle=1 AND (member_a=? OR member_b=?) AND ?<>'verified'").bind(now, accountId, accountId, decision),
        ]);
        await audit(db, user.id, `verification_${decision}`, accountId, now);
        return json({ status: decision });
      }
      if (route === "/api/admin/complaints" && post) {
        const value = await body(request); const id = stringField(value.id, 36);
        const status = stringField(value.status, 20); const reply = stringField(value.reply, 2000);
        if (!["in_progress", "resolved", "rejected"].includes(status) || !UUID.test(id)) fail(400, "工单状态无效");
        const item = await db.prepare("SELECT * FROM complaints WHERE id=? AND expires>?").bind(id, now).first<Complaint>();
        if (!item) fail(404, "工单不存在或已过期");
        const expires = Math.min(item.created + 180 * DAY, status === "in_progress" ? item.created + 180 * DAY : now + 30 * DAY);
        const statements = [db.prepare("UPDATE complaints SET status=?,reply=?,updated=?,expires=? WHERE id=?").bind(status, reply, now, expires, id)];
        if (value.closeRoom === true && item.room) statements.push(db.prepare("UPDATE rooms SET deleted=COALESCE(deleted,?) WHERE token=?").bind(now, item.room));
        await db.batch(statements);
        await audit(db, user.id, "complaint_updated", id, now);
        return json({ status });
      }
      if (route === "/api/admin/legacy-cleanup" && post) {
        if ((await body(request)).confirm !== true) fail(400, "请明确确认清理历史过期数据");
        const result = await db.prepare("UPDATE rooms SET deleted=? WHERE lifecycle=0 AND deleted IS NULL AND expires<=?").bind(now, now).run();
        await audit(db, user.id, "legacy_cleanup_requested", "", now);
        return json({ status: "queued", count: result.meta.changes });
      }
      if (route === "/api/admin/cleanup" && post) {
        await audit(db, user.id, "cleanup_requested", "", now);
        const result = await runMaintenance(db, bucket, now);
        return json(result, result.failedRooms ? 503 : 200);
      }
      fail(404, "接口不存在");
    }
    if (route === "/api/rooms/delete" && post) {
      const token = request.headers.get("x-room") || "";
      if (!ROOM_TOKEN.test(token)) fail(401, "邀请链接不完整");
      const room = await db.prepare("SELECT * FROM rooms WHERE token=?").bind(token).first<Room>();
      if (!room) fail(410, "房间不存在或已清理");
      const member = room.lifecycle === 0 ? request.headers.get("x-member") : user?.id;
      if (!member || (room.member_a !== member && room.member_b !== member)) fail(403, "仅房间成员可请求删除");
      await db.prepare("UPDATE rooms SET deleted=COALESCE(deleted,?) WHERE token=?").bind(now, token).run();
      await audit(db, member, "room_deletion_requested", token, now);
      return json({ status: "queued" }, 202);
    }
    if (!user) fail(401, "请先登录，再完成身份核验");
    const member = user.id;
    if (route === "/api/account/consent" && post) {
      const value = await body(request);
      if (value.version !== POLICY_VERSION || value.accept !== true || value.adult !== true) fail(400, "请阅读当前隐私政策，并确认已满18周岁");
      await rateLimit(db, `consent:${await hash(member)}`, 10, now);
      await db.prepare("INSERT INTO accounts(id,consent_version,consented) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET consent_version=excluded.consent_version,consented=excluded.consented").bind(member, POLICY_VERSION, now).run();
      await audit(db, member, "privacy_accepted", POLICY_VERSION, now);
      return json({ accepted: true });
    }
    if (route === "/api/account/delete" && post) {
      await db.batch([
        db.prepare("UPDATE rooms SET deleted=COALESCE(deleted,?) WHERE lifecycle=1 AND (member_a=? OR member_b=?)").bind(now, member, member),
        db.prepare("DELETE FROM accounts WHERE id=?").bind(member),
      ]);
      await audit(db, member, "account_deleted", "", now);
      return json({ status: "queued" }, 202);
    }
    const account = await db.prepare("SELECT * FROM accounts WHERE id=?").bind(member).first<Account>();
    if (!account || account.consent_version !== POLICY_VERSION) fail(403, "请先阅读并确认当前隐私政策");
    if (route === "/api/account/verification" && post) {
      if (account.verification === "verified" && (account.verified_until || 0) > now) return json({ status: "verified" });
      await rateLimit(db, `verify:${await hash(member)}`, 3, now);
      await db.prepare("UPDATE accounts SET verification='pending',requested=?,verified_until=NULL WHERE id=?").bind(now, member).run();
      await audit(db, member, "verification_requested", "", now);
      return json({ status: "pending" }, 202);
    }
    if (account.verification !== "verified" || !account.verified_until || account.verified_until <= now) fail(403, "身份尚未核验或核验已到期，请联系运营者");
    if (route === "/api/rooms" && post) {
      if (!(await getMaintenanceHealth(db, now)).maintenanceHealthy) fail(503, "数据清理维护暂不可用，已暂停新建房间");
      const creator = await hash(member); const token = randomToken(); const expires = now + DAY;
      const inserted = await db.prepare("INSERT INTO rooms(token,creator,created,expires,member_a,seen_a,lifecycle) SELECT ?,?,?,?,?,?,1 WHERE (SELECT COUNT(*) FROM rooms WHERE creator=? AND created>?)<10 AND (SELECT COUNT(*) FROM rooms WHERE lifecycle=1 AND deleted IS NULL AND expires>?)<1000 AND EXISTS(SELECT 1 FROM accounts WHERE id=? AND consent_version=? AND verification='verified' AND verified_until>?)").bind(token,creator,now,expires,member,now,creator,now-3600000,now,member,POLICY_VERSION,Date.now()).run();
      if (!inserted.meta.changes) fail(429, "创建过于频繁或服务已满，请稍后重试");
      await audit(db, member, "room_created", token, now);
      return json({ token, expires });
    }
    const token = request.headers.get("x-room") || "";
    if (!ROOM_TOKEN.test(token)) fail(401, "邀请链接不完整");
    let room = await db.prepare("SELECT * FROM rooms WHERE token=?").bind(token).first<Room>();
    if (!activeRoom(room, now)) fail(410, "房间已关闭、过期或属于旧版，请创建新房间");
    if (route === "/api/rooms/join" && post) {
      await db.prepare("UPDATE rooms SET member_b=?,seen_b=? WHERE token=? AND member_b IS NULL AND member_a<>? AND expires>? AND deleted IS NULL AND lifecycle=1 AND EXISTS(SELECT 1 FROM accounts WHERE id=? AND consent_version=? AND verification='verified' AND verified_until>?)").bind(member,now,token,member,now,member,POLICY_VERSION,Date.now()).run();
      room = await db.prepare("SELECT * FROM rooms WHERE token=?").bind(token).first<Room>();
    }
    if (!activeRoom(room, Date.now())) fail(410, "房间已经关闭或过期");
    if (room.member_a !== member && room.member_b !== member) fail(403, "房间已满，仅限两个人加入");
    const seat = room.member_a === member ? "a" : "b";
    if ((route === "/api/rooms/sync" || route === "/api/rooms/join") && post) {
      await db.prepare(`UPDATE rooms SET seen_${seat}=? WHERE token=? AND deleted IS NULL AND expires>?`).bind(now,token,now).run();
      const rows = await db.prepare("SELECT id,sender,text,filename,size,created FROM messages WHERE room=? AND EXISTS(SELECT 1 FROM rooms WHERE token=? AND deleted IS NULL AND expires>?) ORDER BY created,id LIMIT 200").bind(token,token,Date.now()).all<Message>();
      return json({ expires: room.expires, joined: !!room.member_b, online: (seat === "a" ? room.seen_b : room.seen_a) > now - 15000,
        messages: rows.results.map(({ sender, ...item }) => ({ ...item, mine: sender === member })) });
    }
    if (route.startsWith("/api/files/") && request.method === "GET") {
      const id = route.slice("/api/files/".length);
      if (!UUID.test(id)) fail(404, "文件不存在");
      const item = await db.prepare("SELECT * FROM messages WHERE id=? AND room=? AND filename IS NOT NULL").bind(id,token).first<Message>();
      if (!item) fail(404, "文件不存在");
      const object = await bucket.get(`${token}/${id}`);
      if (!object) fail(404, "文件不可用");
      if (!activeRoom(await db.prepare("SELECT * FROM rooms WHERE token=?").bind(token).first<Room>(), Date.now())) fail(410, "房间已经关闭或过期");
      const filename = encodeURIComponent(item.filename!).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
      return new Response(object.body, { headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename*=UTF-8''${filename}`, "Content-Length": String(object.size), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
    }
    if ((route === "/api/messages" || route === "/api/files") && post) {
      let text = ""; let filename: string | null = null; let bytes: Uint8Array | null = null;
      if (route === "/api/messages") {
        text = stringField((await body(request)).text, 4000);
      } else {
        try { filename = decodeURIComponent(request.headers.get("x-filename") || ""); } catch { fail(400, "文件名无效"); }
        if (!filename || filename.length > 180 || /[\x00-\x1f\x7f/\\]/.test(filename)) fail(400, "文件名无效或过长");
        bytes = await boundedBody(request, MAX_FILE);
      }
      const size = bytes?.byteLength || 0; const sent = Date.now();
      const reservation = await db.prepare(`UPDATE rooms SET count=count+1,bytes=bytes+?,sent_${seat}=? WHERE token=? AND count<200 AND bytes+?<=104857600 AND sent_${seat}<? AND expires>? AND deleted IS NULL`).bind(size,sent,token,size,sent-500,sent).run();
      if (!reservation.meta.changes) fail(429, "房间已关闭、发送过快或达到容量（200条 / 100 MB）");
      const id = crypto.randomUUID(); const key = `${token}/${id}`;
      if (bytes) {
        const job = await db.prepare("INSERT INTO upload_jobs(id,room,created) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM rooms WHERE token=? AND deleted IS NULL AND expires>?)").bind(id,token,sent,token,Date.now()).run();
        if (!job.meta.changes) fail(410, "房间已经关闭或过期");
        try { await bucket.put(key, bytes); } catch { fail(503, "文件保存失败，清理任务会回收未完成的上传"); }
      }
      try {
        const inserted = await db.prepare("INSERT INTO messages(id,room,sender,text,filename,size,created) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM rooms WHERE token=? AND deleted IS NULL AND expires>?) AND EXISTS(SELECT 1 FROM accounts WHERE id=? AND consent_version=? AND verification='verified' AND verified_until>?)")
          .bind(id,token,member,text,filename,filename === null ? null : size,sent,token,Date.now(),member,POLICY_VERSION,Date.now()).run();
        if (!inserted.meta.changes) {
          if (bytes) await bucket.delete(key);
          await db.prepare("DELETE FROM upload_jobs WHERE id=?").bind(id).run();
          fail(410, "房间已经关闭，发送内容已丢弃");
        }
        await db.prepare("DELETE FROM upload_jobs WHERE id=?").bind(id).run();
      } catch (error) {
        // Keep durable jobs on ambiguous errors; cleanup reclaims uncommitted keys.
        if (error instanceof Error && "status" in error) throw error;
        fail(503, "保存结果尚未确认，请刷新会话确认后重试");
      }
      return json({ id });
    }
    fail(404, "接口不存在");
  } catch (error) {
    if (request.body && !request.bodyUsed) {
      try { await boundedBody(request, 0); } catch { /* Preserve the original rejection. */ }
    }
    const status = error instanceof Error && "status" in error && typeof error.status === "number" ? error.status : 500;
    return json({ error: status === 500 ? "服务暂时不可用，请稍后重试" : (error as Error).message }, status);
  }
}
export const POST = handle;
export const GET = handle;
