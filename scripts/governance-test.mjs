import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomBytes, createHash } from 'node:crypto';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

// Synthetic trusted identity headers exist only in this isolated local harness.
// No HTTP destination, production storage, or secret file is accepted as input.
const secret = randomBytes(32).toString('hex');
const compiled = await build({
  stdin: { contents: `
    import { env } from 'cloudflare:workers';
    import { GET, POST } from './app/api/[...action]/route.ts';
    import { runMaintenance } from './lib/governance.ts';
    export default { async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === '/__test/cleanup') {
        const input = await request.json();
        const bucket = input.failDelete ? new Proxy(env.BUCKET, { get(target, key) {
          if (key === 'delete') return async () => { throw new Error('Synthetic storage failure'); };
          const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
        } }) : env.BUCKET;
        return Response.json(await runMaintenance(env.DB, bucket, input.now || Date.now()));
      }
      return request.method === 'GET' ? GET(request) : POST(request);
    } };`, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, write: false, platform: 'neutral', format: 'esm', target: 'es2022', external: ['cloudflare:workers'],
});
const mf = new Miniflare({ modules: true, script: compiled.outputFiles[0].text, compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat'], bindings: { OPERATOR_EMAIL: 'operator@example.invalid', MAINTENANCE_TOKEN: secret }, d1Databases: ['DB'], r2Buckets: ['BUCKET'] });
const checks = [];
const pass = name => { checks.push(name); console.log(`PASS ${name}`); };
const users = {
  a: { id: 'synthetic-user-a', email: 'a@example.invalid' },
  b: { id: 'synthetic-user-b', email: 'b@example.invalid' },
  c: { id: 'synthetic-user-c', email: 'c@example.invalid' },
  operator: { id: 'synthetic-operator', email: 'operator@example.invalid' },
};
async function call(path, { user, room, data, bytes, headers = {}, method = 'POST' } = {}) {
  const person = users[user];
  const response = await mf.dispatchFetch(`https://between.test${path}`, { method, headers: {
    origin: 'https://between.test',
    ...(person ? { 'oai-authenticated-user-id': person.id, 'oai-authenticated-user-email': person.email } : {}),
    ...(room ? { 'x-room': room } : {}),
    ...(data === undefined ? {} : { 'content-type': 'application/json' }),
    'cf-connecting-ip': person?.id || 'synthetic-anonymous', ...headers,
  }, body: bytes ?? (data === undefined ? undefined : JSON.stringify(data)) });
  return new Response(await response.arrayBuffer(), { status: response.status, headers: response.headers });
}
async function ok(path, options, status = 200) {
  const response = await call(path, options);
  assert.equal(response.status, status, `${path} returned unexpected status`);
  return response.json();
}
async function approve(user) {
  await ok('/api/account/consent', { user, data: { version: '2026-10-30', accept: true, adult: true } });
  await ok('/api/account/verification', { user }, 202);
  await ok('/api/admin/verification', { user: 'operator', data: { accountId: users[user].id, decision: 'verified', method: 'trusted_provider', reference: 'synthetic-local-evidence', attested: true } });
}
try {
  const db = await mf.getD1Database('DB'); const bucket = await mf.getR2Bucket('BUCKET');
  for (const file of (await readdir('drizzle')).filter(x => x.endsWith('.sql')).sort()) {
    for (const sql of (await readFile(`drizzle/${file}`, 'utf8')).split('--> statement-breakpoint').filter(x => x.trim())) await db.prepare(sql).run();
  }
  const anonymous = await ok('/api/account', { method: 'GET' });
  assert.equal(anonymous.signedIn, false);
  assert.equal((await call('/api/rooms')).status, 401);
  assert.equal((await call('/api/rooms', { headers: { 'x-member': crypto.randomUUID() } })).status, 401);
  assert.equal((await call('/api/admin/overview', { user: 'a', method: 'GET' })).status, 403);
  assert.equal((await call('/api/maintenance', { headers: { Authorization: 'Bearer wrong' } })).status, 401);
  pass('anonymous, client identity forgery, non-operator and invalid maintenance credentials denied');
  const maintenance = await ok('/api/maintenance', { headers: { Authorization: `Bearer ${secret}` } });
  assert.equal(maintenance.status, 'ok');
  assert.equal((await call('/api/rooms', { user: 'a' })).status, 403);
  assert.equal((await call('/api/account/consent', { user: 'a', data: { version: 'old', accept: true, adult: true } })).status, 400);
  await ok('/api/account/consent', { user: 'a', data: { version: '2026-10-30', accept: true, adult: true } });
  await ok('/api/account/verification', { user: 'a' }, 202);
  assert.equal((await call('/api/rooms', { user: 'a' })).status, 403);
  assert.equal((await call('/api/admin/verification', { user: 'operator', data: { accountId: users.a.id, decision: 'verified', method: 'document', reference: 'synthetic', attested: false } })).status, 400);
  for (const user of ['a', 'b', 'c']) await approve(user);
  pass('versioned adult consent and actual operator attestation required before communication');
  const { token } = await ok('/api/rooms', { user: 'a' });
  const joins = await Promise.all(['b', 'c'].map(user => call('/api/rooms/join', { user, room: token })));
  assert.deepEqual(joins.map(x => x.status).sort(), [200, 403]);
  const peer = joins[0].status === 200 ? 'b' : 'c'; const outsider = peer === 'b' ? 'c' : 'b';
  await ok('/api/messages', { user: 'a', room: token, data: { text: 'Synthetic A <script>literal</script>' } });
  await ok('/api/messages', { user: peer, room: token, data: { text: 'Synthetic reply' } });
  const snapshot = await ok('/api/rooms/sync', { user: peer, room: token, headers: { 'x-member': users.a.id } });
  assert.equal(snapshot.messages.length, 2); assert.equal(snapshot.messages.find(x => x.mine).text, 'Synthetic reply');
  pass('two-seat race, bidirectional text, and server-derived message ownership');
  const bytes = randomBytes(1024 * 1024 + 17);
  await new Promise(resolve => setTimeout(resolve, 550));
  const { id } = await ok('/api/files', { user: 'a', room: token, bytes, headers: { 'x-filename': encodeURIComponent("test'()*中文.bin") } });
  const download = await call(`/api/files/${id}`, { user: peer, room: token, method: 'GET' });
  const hash = value => createHash('sha256').update(value).digest('hex');
  assert.equal(hash(Buffer.from(await download.arrayBuffer())), hash(bytes));
  assert.match(download.headers.get('Content-Disposition'), /%27%28%29%2A/);
  assert.equal((await call(`/api/files/${id}`, { user: outsider, room: token, method: 'GET' })).status, 403);
  assert.equal((await call('/api/files', { user: 'a', room: token, bytes: Buffer.alloc(20 * 1024 * 1024 + 1), headers: { 'x-filename': 'oversize.bin' } })).status, 413);
  assert.equal((await call('/api/messages', { user: 'a', room: token, data: { text: 'x'.repeat(4001) } })).status, 400);
  assert.equal((await call('/api/messages', { user: 'a', room: token, data: { text: 'cross-origin' }, headers: { origin: 'https://evil.invalid' } })).status, 403);
  pass('file SHA-256, RFC8187 filename, unauthorized download, size and origin boundaries');
  const complaint = await ok('/api/complaints', { user: 'a', room: token, data: { category: 'privacy', details: 'Synthetic private complaint', contact: 'contact@example.invalid' } }, 201);
  assert.match(complaint.receipt, /^[a-f0-9]{64}$/);
  const lookup = await ok('/api/complaints/status', { data: { receipt: complaint.receipt } });
  assert.ok(!('details' in lookup)); assert.ok(!('contact' in lookup));
  assert.equal((await call('/api/complaints/status', { data: { receipt: 'f'.repeat(64) } })).status, 404);
  const overview = await ok('/api/admin/overview', { user: 'operator', method: 'GET' });
  const ticket = overview.complaints.find(x => x.details === 'Synthetic private complaint'); assert.ok(ticket);
  await ok('/api/admin/complaints', { user: 'operator', data: { id: ticket.id, status: 'resolved', reply: 'Synthetic resolution', closeRoom: false } });
  assert.equal((await ok('/api/complaints/status', { data: { receipt: complaint.receipt } })).reply, 'Synthetic resolution');
  pass('private receipt, unauthorized lookup denial and operator complaint response');
  assert.equal((await call('/api/complaints', { user: outsider, room: token, data: { category: 'content', details: 'Synthetic unauthorized association' } })).status, 403);
  await db.prepare("UPDATE accounts SET verified_until=? WHERE id=?").bind(Date.now() - 1, users[peer].id).run();
  assert.equal((await call('/api/rooms/sync', { user: peer, room: token })).status, 403);
  await db.prepare("UPDATE accounts SET verified_until=?,consent_version='old' WHERE id=?").bind(Date.now()+86400000, users[peer].id).run();
  assert.equal((await call('/api/rooms/sync', { user: peer, room: token })).status, 403);
  await db.prepare("UPDATE accounts SET consent_version='2026-10-30' WHERE id=?").bind(users[peer].id).run();
  await db.prepare("UPDATE maintenance SET last_success=? WHERE id='cleanup'").bind(Date.now()-4*3600000).run();
  assert.equal((await call('/api/rooms', { user: peer })).status, 503);
  await ok('/api/maintenance', { headers: { Authorization: `Bearer ${secret}` } });
  pass('expired verification, outdated consent, foreign-room complaint and stale maintenance rejected');
  await ok('/api/rooms/delete', { user: 'a', room: token }, 202);
  assert.equal((await call('/api/rooms/sync', { user: peer, room: token })).status, 410);
  const later = Date.now() + 15 * 60 * 1000;
  const failed = await ok('/__test/cleanup', { data: { failDelete: true, now: later } });
  assert.notEqual(failed.status, 'ok');
  assert.ok(await bucket.get(`${token}/${id}`));
  await ok('/__test/cleanup', { data: { now: later } });
  assert.equal(await bucket.get(`${token}/${id}`), null);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM messages WHERE room=?').bind(token).first()).n, 0);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM rooms WHERE token=?').bind(token).first()).n, 0);
  await bucket.put(`${token}/late-crashed-upload`, 'synthetic late put');
  for (let i = 0; i < 3; i++) await ok('/__test/cleanup', { data: { now: later } });
  assert.equal(await bucket.get(`${token}/late-crashed-upload`), null);
  pass('immediate close, storage-failure retry, D1/R2 erasure and late orphan cleanup');
  await ok('/api/account/delete', { user: 'a' }, 202);
  assert.equal((await call('/api/rooms', { user: 'a' })).status, 403);
  const account = await ok('/api/account', { user: 'a', method: 'GET' }); assert.equal(account.accepted, false);
  pass('account erasure revokes communication and consent');
  const legacyToken = randomBytes(32).toString('hex');
  const legacyMember = crypto.randomUUID(); const old = Date.now()-2*86400000;
  await db.prepare('INSERT INTO rooms(token,creator,created,expires,member_a,seen_a) VALUES(?,?,?,?,?,?)').bind(legacyToken,'synthetic',old,old+86400000,legacyMember,old).run();
  await bucket.put(`${legacyToken}/legacy.bin`,'synthetic legacy bytes');
  await ok('/api/maintenance', { headers: { Authorization: `Bearer ${secret}` } });
  assert.ok(await bucket.get(`${legacyToken}/legacy.bin`));
  assert.equal((await call('/api/admin/legacy-cleanup', { user:'operator',data:{confirm:false} })).status,400);
  await ok('/api/admin/legacy-cleanup', { user:'operator',data:{confirm:true} });
  await ok('/api/maintenance', { headers: { Authorization: `Bearer ${secret}` } });
  assert.equal(await bucket.get(`${legacyToken}/legacy.bin`),null);
  const expired = await ok('/api/rooms',{user:peer});
  await db.prepare('UPDATE rooms SET expires=? WHERE token=?').bind(Date.now()-1,expired.token).run();
  assert.equal((await call('/api/rooms/sync',{user:peer,room:expired.token})).status,410);
  await ok('/api/maintenance', { headers: { Authorization: `Bearer ${secret}` } });
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM rooms WHERE token=?').bind(expired.token).first()).n,0);
  await db.prepare('UPDATE complaints SET expires=? WHERE id=?').bind(Date.now()-1,ticket.id).run();
  assert.equal((await call('/api/complaints/status',{data:{receipt:complaint.receipt}})).status,404);
  await ok('/api/maintenance', { headers: { Authorization: `Bearer ${secret}` } });
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM complaints WHERE id=?').bind(ticket.id).first()).n,0);
  pass('legacy data preserved until explicit approval, managed expiry and complaint expiry erase storage');
  const backlog = await ok('/api/rooms',{user:peer});
  await db.prepare('UPDATE rooms SET expires=? WHERE token=?').bind(Date.now()-4*3600000,backlog.token).run();
  assert.equal((await ok('/api/account',{user:peer,method:'GET'})).maintenanceHealthy,false);
  assert.equal((await call('/api/rooms',{user:peer})).status,503);
  await ok('/api/maintenance', { headers: { Authorization: `Bearer ${secret}` } });
  assert.equal((await ok('/api/account',{user:peer,method:'GET'})).maintenanceHealthy,true);
  await db.batch(Array.from({length:105},(_,i)=>db.prepare("INSERT INTO accounts(id,consent_version,consented,requested,verification) VALUES(?,'2026-10-30',?,?,'pending')").bind(`synthetic-queue-${i}`,Date.now(),Date.now()-100000+i)));
  const located = await ok(`/api/admin/overview?accountId=${encodeURIComponent(users[peer].id)}`,{user:'operator',method:'GET'});
  assert.equal(located.accounts.length,1); assert.equal(located.accounts[0].id,users[peer].id);
  const complaintIds=Array.from({length:105},()=>crypto.randomUUID());
  await db.batch(complaintIds.map((id,i)=>db.prepare("INSERT INTO complaints(id,receipt_hash,category,details,contact,created,updated,expires) VALUES(?,?,'other','synthetic queue','',?,?,?)").bind(id,hash(id),Date.now()+i,Date.now()+i,Date.now()+86400000)));
  const locatedComplaint=await ok(`/api/admin/overview?complaintId=${complaintIds[104]}`,{user:'operator',method:'GET'});
  assert.equal(locatedComplaint.complaints.length,1); assert.equal(locatedComplaint.complaints[0].id,complaintIds[104]);
  pass('aged deletion backlog blocks new rooms and operator exact lookup reaches records beyond first 100');
  console.log(JSON.stringify({ status: 'passed', checks: checks.length, scope: 'isolated Miniflare with synthetic identities and ephemeral D1/R2' }));
} finally { await mf.dispose(); }
