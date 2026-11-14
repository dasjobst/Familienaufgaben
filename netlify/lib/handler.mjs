// HTTP-Logik der API, unabhängig vom Speicher (Netlify Blobs oder Speicher-Store im Test).
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import * as L from '../../public/shared/logic.mjs';

const SESSION_DAYS = 180;
const INVITE_DAYS = 14;
const MAX_PHOTO = 350 * 1024;
const MAX_JSON = 20 * 1024;

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; this.msg = msg; } }

const sha = s => createHash('sha256').update(s).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');
const nowMs = () => Date.now();

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}
async function readJson(req) {
  const t = await req.text();
  if (t.length > MAX_JSON) throw new HttpError(413, 'Die Anfrage ist zu groß.');
  try { const o = JSON.parse(t || '{}'); return (o && typeof o === 'object') ? o : {}; } catch (e) { throw new HttpError(400, 'Ungültige Anfrage.'); }
}
function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

// Aktuellen Stand lesen, Änderung anwenden, nur schreiben wenn niemand dazwischen geschrieben hat.
async function mutate(store, fn) {
  for (let t = 0; t < 6; t++) {
    const cur = await store.getWithMetadata('state', { type: 'json', consistency: 'strong' });
    if (!cur) return { missing: true };
    const S = cur.data;
    L.setState(S);
    const out = fn(S);
    if (!out.write) return { S, out };
    const r = await store.setJSON('state', S, { onlyIfMatch: cur.etag });
    if (r.modified) return { S, out };
  }
  throw new HttpError(503, 'Gerade zu viel los. Bitte noch einmal versuchen.');
}

async function createSession(store, memberId) {
  const token = newToken();
  await store.setJSON('ses/' + sha(token), { m: memberId, at: nowMs() });
  return token;
}
async function sessionMember(store, req) {
  const h = req.headers.get('authorization') || '';
  const m = /^Bearer ([A-Za-z0-9_-]{20,80})$/.exec(h);
  if (!m) return null;
  const s = await store.get('ses/' + sha(m[1]), { type: 'json' });
  if (!s || nowMs() - s.at > SESSION_DAYS * 864e5) return null;
  return { memberId: s.m, hash: sha(m[1]) };
}

function viewOf(S, me) {
  const v = structuredClone(S);
  const meIsParent = L.isParent(me);
  v.members.forEach(m => { if (!meIsParent && m.id !== me) delete m.email; });
  return { ok: true, initialized: true, me, date: L.today(), state: v };
}

function sniffImage(buf) {
  const b = new Uint8Array(buf);
  if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 12 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}

const ACTIONS = {
  book: (p, by) => L.book(p.id, by),
  assign: (p, by) => L.assignInst(p.id, p.to, by),
  assignNew: (p, by) => L.assignNew(p.cat, p.to, p.due, by),
  enqueue: (p, by) => L.enqueue(p.id, by),
  transfer: (p, by) => L.transfer(p.id, p.to, by),
  release: (p, by) => L.release(p.id, by),
  complete: (p, by) => L.complete(p.id, by),
  deleteInst: (p, by) => L.deleteInst(p.id, by),
  approve: (p, by) => L.approve(p.id, by),
  undo: (p, by) => L.undo(p.id, by),
  assignOverdue: (p, by) => L.assignOverdueOpen(p.to, by),
  setPenalty: (p, by) => L.setPenalty(p.value, by),
  reject: (p, by) => L.reject(p.id, p.note, by),
  saveCat: (p, by) => L.saveCat(p.data, by),
  removeCat: (p, by) => L.removeCat(p.id, by),
  restoreCat: (p, by) => L.restoreCat(p.id, by),
  saveMember: (p, by) => L.saveMember(p.data, by),
  removeMember: (p, by) => L.removeMember(p.id, by),
  setBonus: (p, by) => L.setBonus(p.value, by)
};

export async function handle(req, { store, env }) {
  try {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/api/, '') || '/';
    const method = req.method;

    // ---- Einrichtung der Familie (einmalig, mit Einrichtungscode) ----
    if (method === 'POST' && path === '/setup') {
      const code = String(env.SETUP_CODE || '').trim();
      if (!code) return json({ ok: false, msg: 'Die Einrichtung ist nicht aktiviert: Die Funktion sieht keine Variable SETUP_CODE. In Netlify prüfen, dass sie den Bereich "Functions" (und "Runtime") hat, und danach neu deployen.' }, 503);
      if (code.length < 12) return json({ ok: false, msg: 'Die Einrichtung ist nicht aktiviert: SETUP_CODE ist kürzer als 12 Zeichen.' }, 503);
      const b = await readJson(req);
      if (!safeEqual(String(b.code || ''), code)) return json({ ok: false, msg: 'Der Einrichtungscode stimmt nicht.' }, 403);
      const name = String(b.name || '').trim();
      const email = String(b.email || '').trim().toLowerCase();
      if (!name || name.length > 40) return json({ ok: false, msg: 'Bitte deinen Namen eingeben (bis 40 Zeichen).' }, 400);
      if (email && !L.isEmail(email)) return json({ ok: false, msg: 'Diese E-Mail-Adresse ist ungültig.' }, 400);
      const S = L.createState(name, email);
      const r = await store.setJSON('state', S, { onlyIfNew: true });
      if (!r.modified) return json({ ok: false, msg: 'Die Familie ist schon eingerichtet.' }, 409);
      const token = await createSession(store, S.members[0].id);
      return json({ ok: true, token });
    }

    // ---- Einladungslink einlösen ----
    if (method === 'POST' && path === '/redeem') {
      const b = await readJson(req);
      const t = String(b.token || '');
      if (!/^[A-Za-z0-9_-]{20,80}$/.test(t)) return json({ ok: false, msg: 'Der Einladungslink ist ungültig.' }, 400);
      const key = 'inv/' + sha(t);
      const inv = await store.getWithMetadata(key, { type: 'json', consistency: 'strong' });
      if (!inv) return json({ ok: false, msg: 'Der Einladungslink ist ungültig.' }, 404);
      if (inv.data.used || nowMs() > inv.data.exp) return json({ ok: false, msg: 'Der Einladungslink ist abgelaufen oder schon benutzt. Bitte einen neuen anfordern.' }, 410);
      const r = await store.setJSON(key, { ...inv.data, used: true }, { onlyIfMatch: inv.etag });
      if (!r.modified) return json({ ok: false, msg: 'Der Einladungslink ist schon benutzt.' }, 410);
      const st = await store.get('state', { type: 'json' });
      if (!st || !st.members.some(m => m.id === inv.data.m)) return json({ ok: false, msg: 'Das Mitglied existiert nicht mehr.' }, 404);
      const token = await createSession(store, inv.data.m);
      return json({ ok: true, token });
    }

    // ---- ab hier nur mit Anmeldung ----
    const cur = await store.getWithMetadata('state', { type: 'json', consistency: 'strong' });
    if (!cur) return json({ ok: true, initialized: false });
    const sess = await sessionMember(store, req);
    if (!sess) return json({ ok: false, initialized: true, msg: 'Nicht angemeldet.' }, 401);
    const me = sess.memberId;
    if (!cur.data.members.some(m => m.id === me)) return json({ ok: false, initialized: true, msg: 'Nicht angemeldet.' }, 401);

    if (method === 'GET' && path === '/state') {
      const res = await mutate(store, S => ({ write: L.refreshPool() > 0 }));
      return json(viewOf(res.S, me));
    }

    if (method === 'POST' && path === '/logout') {
      await store.delete('ses/' + sess.hash);
      return json({ ok: true });
    }

    if (method === 'POST' && path === '/action') {
      const b = await readJson(req);
      const fn = ACTIONS[b.type];
      if (!fn) return json({ ok: false, msg: 'Unbekannte Aktion.' }, 400);
      const res = await mutate(store, S => {
        const pool = L.refreshPool();
        const out = fn(b, me);
        return { write: out.ok || pool > 0, out };
      });
      if (b.type === 'removeMember' && res.out.out.ok) {
        const gone = String(b.id || '');
        await store.delete('photo/' + gone).catch(() => {});
        for (const prefix of ['ses/', 'inv/']) {
          const list = await store.list({ prefix });
          for (const e of list.blobs) {
            const v = await store.get(e.key, { type: 'json' });
            if (v && v.m === gone) await store.delete(e.key);
          }
        }
      }
      return json({ ...res.out.out, ...viewOf(res.S, me), msg: res.out.out.msg, ok: res.out.out.ok });
    }

    if (method === 'POST' && path === '/invite') {
      const b = await readJson(req);
      L.setState(cur.data);
      if (!L.isParent(me)) return json({ ok: false, msg: 'Nur Eltern dürfen einladen.' }, 403);
      const mem = L.memberById(String(b.memberId || ''));
      if (!mem) return json({ ok: false, msg: 'Mitglied nicht gefunden.' }, 404);
      const token = newToken();
      const exp = nowMs() + INVITE_DAYS * 864e5;
      await store.setJSON('inv/' + sha(token), { m: mem.id, exp, used: false });
      return json({ ok: true, url: new URL(req.url).origin + '/#invite=' + token, expires: new Date(exp).toISOString(), name: mem.name, email: mem.email || '' });
    }

    if (method === 'POST' && path === '/revoke') {
      const b = await readJson(req);
      L.setState(cur.data);
      if (!L.isParent(me)) return json({ ok: false, msg: 'Nur Eltern dürfen Geräte abmelden.' }, 403);
      const target = String(b.memberId || '');
      if (!L.memberById(target)) return json({ ok: false, msg: 'Mitglied nicht gefunden.' }, 404);
      let n = 0;
      for (const prefix of ['ses/', 'inv/']) {
        const list = await store.list({ prefix });
        for (const e of list.blobs) {
          const v = await store.get(e.key, { type: 'json' });
          if (v && v.m === target && !(e.key === 'ses/' + sess.hash)) { await store.delete(e.key); n++; }
        }
      }
      return json({ ok: true, msg: n ? 'Alle Geräte und offenen Einladungen dieser Person sind abgemeldet.' : 'Es gab nichts abzumelden.' });
    }

    const pm = /^\/photo\/([A-Za-z0-9_-]{1,20})$/.exec(path);
    if (pm) {
      const id = pm[1];
      L.setState(cur.data);
      if (!L.memberById(id)) return json({ ok: false, msg: 'Mitglied nicht gefunden.' }, 404);
      if (method === 'GET') {
        const e = await store.getWithMetadata('photo/' + id, { type: 'arrayBuffer' });
        if (!e) return new Response(null, { status: 404 });
        return new Response(e.data, { status: 200, headers: { 'content-type': (e.metadata && e.metadata.type) || 'image/jpeg', 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff' } });
      }
      if (!(id === me || L.isParent(me))) return json({ ok: false, msg: 'Nur die Person selbst oder Eltern dürfen das Foto ändern.' }, 403);
      if (method === 'PUT') {
        const buf = await req.arrayBuffer();
        if (buf.byteLength > MAX_PHOTO) return json({ ok: false, msg: 'Das Foto ist zu groß (höchstens 350 KB).' }, 413);
        const type = sniffImage(buf);
        if (!type) return json({ ok: false, msg: 'Das ist kein gültiges Bild (JPEG, PNG oder WebP).' }, 415);
        await store.set('photo/' + id, buf, { metadata: { type } });
        const res = await mutate(store, S => ({ write: true, out: L.setPhotoMeta(id, me, true, nowMs()) }));
        return json({ ...viewOf(res.S, me), msg: res.out.out.msg, ok: true });
      }
      if (method === 'DELETE') {
        await store.delete('photo/' + id);
        const res = await mutate(store, S => ({ write: true, out: L.setPhotoMeta(id, me, false) }));
        return json({ ...viewOf(res.S, me), msg: res.out.out.msg, ok: true });
      }
    }

    return json({ ok: false, msg: 'Nicht gefunden.' }, 404);
  } catch (e) {
    if (e instanceof HttpError) return json({ ok: false, msg: e.msg }, e.status);
    console.error(e);
    return json({ ok: false, msg: 'Serverfehler. Bitte später noch einmal versuchen.' }, 500);
  }
}
