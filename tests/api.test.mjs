import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../netlify/lib/handler.mjs';
import * as L from '../public/shared/logic.mjs';
import { memoryStore } from './memory-store.mjs';

const CODE = 'test-setup-code-123456';
const ORIGIN = 'https://familie.example';

function client(store) {
  const env = { SETUP_CODE: CODE };
  return async function call(method, path, { token, body, raw, headers } = {}) {
    const h = { ...(headers || {}) };
    if (token) h.authorization = 'Bearer ' + token;
    let b;
    if (raw !== undefined) b = raw; else if (body !== undefined) { b = JSON.stringify(body); h['content-type'] = 'application/json'; }
    const res = await handle(new Request(ORIGIN + '/api' + path, { method, headers: h, body: b }), { store, env });
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, json: ct.includes('json') ? await res.json() : null, res };
  };
}

async function setupFamily() {
  L.setNow('2026-11-14');
  const store = memoryStore();
  const call = client(store);
  const s = await call('POST', '/setup', { body: { code: CODE, name: 'Jobst', email: 'jobst@example.de' } });
  assert.equal(s.status, 200);
  return { store, call, owner: s.json.token };
}
async function addMember(call, owner, name, role, email) {
  const r = await call('POST', '/action', { token: owner, body: { type: 'saveMember', data: { name, role, email } } });
  assert.equal(r.json.ok, true, r.json.msg);
  return r.json.state.members.find(m => m.name === name).id;
}
async function login(call, owner, memberId) {
  const inv = await call('POST', '/invite', { token: owner, body: { memberId } });
  assert.equal(inv.status, 200);
  const tok = inv.json.url.split('#invite=')[1];
  const red = await call('POST', '/redeem', { body: { token: tok } });
  assert.equal(red.status, 200);
  return { token: red.json.token, invite: tok };
}

test('Einrichtung: falscher Code, richtiger Code, nur einmal', async () => {
  L.setNow('2026-11-14');
  const store = memoryStore(); const call = client(store);
  assert.equal((await call('GET', '/state')).json.initialized, false);
  assert.equal((await call('POST', '/setup', { body: { code: 'falsch-falsch-falsch', name: 'X' } })).status, 403);
  assert.equal((await call('POST', '/setup', { body: { code: CODE, name: 'Jobst', email: 'kaputt' } })).status, 400);
  const ok = await call('POST', '/setup', { body: { code: CODE, name: 'Jobst' } });
  assert.equal(ok.status, 200);
  assert.equal((await call('POST', '/setup', { body: { code: CODE, name: 'Zweiter' } })).status, 409);
  const st = await call('GET', '/state', { token: ok.json.token });
  assert.equal(st.json.state.members.length, 1);
  assert.ok(st.json.state.inst.some(i => i.status === 'open'), 'Pool wird beim Start gefüllt');
});

test('Einrichtung ohne SETUP_CODE ist gesperrt', async () => {
  const call = async (b) => handle(new Request(ORIGIN + '/api/setup', { method: 'POST', body: JSON.stringify(b) }), { store: memoryStore(), env: {} });
  assert.equal((await call({ code: 'x', name: 'A' })).status, 503);
});

test('ohne Anmeldung kein Zugriff', async () => {
  const { call } = await setupFamily();
  assert.equal((await call('GET', '/state')).status, 401);
  assert.equal((await call('GET', '/state', { token: 'x'.repeat(43) })).status, 401);
  assert.equal((await call('POST', '/action', { body: { type: 'book', id: 'i1' } })).status, 401);
  assert.equal((await call('GET', '/photo/m1')).status, 401);
});

test('Einladungslink: einmalig, danach ungültig', async () => {
  const { call, owner } = await setupFamily();
  const nik = await addMember(call, owner, 'Nikolas', 'child', 'niko@example.de');
  const { token, invite } = await login(call, owner, nik);
  const st = await call('GET', '/state', { token });
  assert.equal(st.json.me, nik);
  const again = await call('POST', '/redeem', { body: { token: invite } });
  assert.equal(again.status, 410);
  assert.equal((await call('POST', '/redeem', { body: { token: 'a'.repeat(43) } })).status, 404);
});

test('abgelaufener Einladungslink', async () => {
  const { call, owner, store } = await setupFamily();
  const nik = await addMember(call, owner, 'Nikolas', 'child', '');
  const inv = await call('POST', '/invite', { token: owner, body: { memberId: nik } });
  const tok = inv.json.url.split('#invite=')[1];
  const real = Date.now; Date.now = () => real() + 15 * 864e5;
  try { assert.equal((await call('POST', '/redeem', { body: { token: tok } })).status, 410); } finally { Date.now = real; }
});

test('Kinder dürfen weder einladen noch Katalog ändern noch zuweisen', async () => {
  const { call, owner } = await setupFamily();
  const nik = await addMember(call, owner, 'Nikolas', 'child', 'niko@example.de');
  const { token: kid } = await login(call, owner, nik);
  assert.equal((await call('POST', '/invite', { token: kid, body: { memberId: nik } })).status, 403);
  assert.equal((await call('POST', '/revoke', { token: kid, body: { memberId: nik } })).status, 403);
  const c = await call('POST', '/action', { token: kid, body: { type: 'saveCat', data: { name: 'Neu', interval: 7, min: 10 } } });
  assert.equal(c.json.ok, false);
  const st = (await call('GET', '/state', { token: kid })).json.state;
  const open = st.inst.find(i => i.status === 'open');
  const a = await call('POST', '/action', { token: kid, body: { type: 'assign', id: open.id, to: nik } });
  assert.equal(a.json.ok, false);
});

test('E-Mail-Adressen sehen nur Eltern und die Person selbst', async () => {
  const { call, owner } = await setupFamily();
  const nik = await addMember(call, owner, 'Nikolas', 'child', 'niko@example.de');
  const jak = await addMember(call, owner, 'Jakob', 'child', 'jakob@example.de');
  const { token: kid } = await login(call, owner, nik);
  const view = (await call('GET', '/state', { token: kid })).json.state.members;
  assert.equal(view.find(m => m.id === nik).email, 'niko@example.de');
  assert.equal(view.find(m => m.id === jak).email, undefined);
  const pview = (await call('GET', '/state', { token: owner })).json.state.members;
  assert.equal(pview.find(m => m.id === jak).email, 'jakob@example.de');
});

test('gleichzeitiges Buchen: genau eine Person gewinnt', async () => {
  const { call, owner } = await setupFamily();
  const nik = await addMember(call, owner, 'Nikolas', 'child', '');
  const jak = await addMember(call, owner, 'Jakob', 'child', '');
  const a = (await login(call, owner, nik)).token, b = (await login(call, owner, jak)).token;
  const open = (await call('GET', '/state', { token: a })).json.state.inst.find(i => i.status === 'open');
  const [r1, r2] = await Promise.all([
    call('POST', '/action', { token: a, body: { type: 'book', id: open.id } }),
    call('POST', '/action', { token: b, body: { type: 'book', id: open.id } })
  ]);
  const wins = [r1, r2].filter(r => r.json.ok).length;
  assert.equal(wins, 1);
  const inst = (await call('GET', '/state', { token: owner })).json.state.inst.find(i => i.id === open.id);
  assert.equal(inst.status, 'taken');
  assert.equal(inst.mode, 'booked');
});

test('Buchen, Übertragen, Erledigen: Punkte stimmen', async () => {
  const { call, owner } = await setupFamily();
  const nik = await addMember(call, owner, 'Nikolas', 'child', '');
  const jak = await addMember(call, owner, 'Jakob', 'child', '');
  const a = (await login(call, owner, nik)).token, b = (await login(call, owner, jak)).token;
  const st = (await call('GET', '/state', { token: a })).json.state;
  const open = st.inst.filter(i => i.status === 'open');
  const cat = id => st.catalog.find(c => c.id === id);
  const t1 = open[0], t2 = open[1];
  await call('POST', '/action', { token: a, body: { type: 'book', id: t1.id } });
  const tr = await call('POST', '/action', { token: a, body: { type: 'transfer', id: t1.id, to: jak } });
  assert.equal(tr.json.ok, true);
  assert.equal((await call('POST', '/action', { token: a, body: { type: 'complete', id: t1.id } })).json.ok, false, 'Nikolas ist nicht mehr zuständig');
  const done = await call('POST', '/action', { token: b, body: { type: 'complete', id: t1.id } });
  assert.equal(done.json.pts, cat(t1.catId).pts, 'übertragen = ohne Bonus');
  await call('POST', '/action', { token: b, body: { type: 'book', id: t2.id } });
  const done2 = await call('POST', '/action', { token: b, body: { type: 'complete', id: t2.id } });
  assert.equal(done2.json.pts, Math.round(cat(t2.catId).pts * 1.5));
  const led = done2.json.state.ledger.filter(l => l.member === jak).reduce((x, l) => x + l.delta, 0);
  assert.equal(led, done.json.pts + done2.json.pts);
});

test('Foto: Upload, Abruf, Rechte, ungültige Dateien', async () => {
  const { call, owner } = await setupFamily();
  const nik = await addMember(call, owner, 'Nikolas', 'child', '');
  const jak = await addMember(call, owner, 'Jakob', 'child', '');
  const a = (await login(call, owner, nik)).token;
  const jpeg = new Uint8Array(2000); jpeg.set([0xff, 0xd8, 0xff, 0xe0], 0);
  const up = await call('PUT', '/photo/' + nik, { token: a, raw: jpeg, headers: { 'content-type': 'image/jpeg' } });
  assert.equal(up.status, 200);
  assert.ok(up.json.state.members.find(m => m.id === nik).photoV);
  const get = await call('GET', '/photo/' + nik, { token: owner });
  assert.equal(get.status, 200); assert.equal(get.res.headers.get('content-type'), 'image/jpeg');
  assert.equal((await get.res.arrayBuffer()).byteLength, 2000);
  assert.equal((await call('PUT', '/photo/' + jak, { token: a, raw: jpeg })).status, 403, 'fremdes Foto');
  const ok = await call('PUT', '/photo/' + jak, { token: owner, raw: jpeg });
  assert.equal(ok.status, 200, 'Eltern dürfen');
  assert.equal((await call('PUT', '/photo/' + nik, { token: a, raw: new TextEncoder().encode('<script>alert(1)</script>............') })).status, 415);
  assert.equal((await call('PUT', '/photo/' + nik, { token: a, raw: new Uint8Array(400 * 1024).fill(0xff) })).status, 413);
  const del = await call('DELETE', '/photo/' + nik, { token: a });
  assert.equal(del.status, 200);
  assert.equal(del.json.state.members.find(m => m.id === nik).photoV, undefined);
  assert.equal((await call('GET', '/photo/' + nik, { token: owner })).status, 404);
});

test('Geräte abmelden und Abmelden', async () => {
  const { call, owner } = await setupFamily();
  const nik = await addMember(call, owner, 'Nikolas', 'child', '');
  const { token } = await login(call, owner, nik);
  assert.equal((await call('GET', '/state', { token })).status, 200);
  assert.equal((await call('POST', '/revoke', { token: owner, body: { memberId: nik } })).json.ok, true);
  assert.equal((await call('GET', '/state', { token })).status, 401);
  const again = (await login(call, owner, nik)).token;
  assert.equal((await call('POST', '/logout', { token: again })).json.ok, true);
  assert.equal((await call('GET', '/state', { token: again })).status, 401);
});

test('Datum: Berliner Zeit, nicht UTC', () => {
  L.setNow(null);
  assert.match(L.today(), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(L.addDays('2026-12-30', 3), '2027-01-02');
  assert.equal(L.diffDays('2026-11-14', '2026-11-10'), 4);
});

test('Eltern löschen nicht erledigte Aufgaben, Kinder nicht, Erledigtes bleibt', async () => {
  const { call, owner } = await setupFamily();
  const nik = await addMember(call, owner, 'Nikolas', 'child', '');
  const kid = (await login(call, owner, nik)).token;
  const st = (await call('GET', '/state', { token: kid })).json.state;
  const open = st.inst.filter(i => i.status === 'open');
  const t1 = open[0], t2 = open[1];
  await call('POST', '/action', { token: kid, body: { type: 'book', id: t1.id } });
  // Kind darf nicht löschen
  assert.equal((await call('POST', '/action', { token: kid, body: { type: 'deleteInst', id: t1.id } })).json.ok, false);
  // Eltern dürfen eine gebuchte Aufgabe löschen
  const del = await call('POST', '/action', { token: owner, body: { type: 'deleteInst', id: t1.id } });
  assert.equal(del.json.ok, true);
  assert.ok(!del.json.state.inst.some(i => i.id === t1.id));
  // Kein sofortiges Wiederauftauchen derselben Tätigkeit im Pool
  assert.ok(!del.json.state.inst.some(i => i.catId === t1.catId && i.status !== 'done'), 'Intervall startet neu');
  // Erledigtes lässt sich nicht löschen
  await call('POST', '/action', { token: kid, body: { type: 'book', id: t2.id } });
  await call('POST', '/action', { token: kid, body: { type: 'complete', id: t2.id } });
  assert.equal((await call('POST', '/action', { token: owner, body: { type: 'deleteInst', id: t2.id } })).json.ok, false);
  // Pool-Aufgabe ohne Bearbeiter lässt sich ebenfalls löschen
  const pool = (await call('GET', '/state', { token: owner })).json.state.inst.find(i => i.status === 'open');
  assert.equal((await call('POST', '/action', { token: owner, body: { type: 'deleteInst', id: pool.id } })).json.ok, true);
  // Nach Ablauf des Intervalls kommt die Aufgabe wieder
  const c = st.catalog.find(x => x.id === t1.catId);
  L.setNow(L.addDays('2026-11-14', c.interval));
  const later = (await call('GET', '/state', { token: owner })).json.state;
  L.setNow('2026-11-14');
  assert.ok(later.inst.some(i => i.catId === t1.catId && i.status === 'open'), 'nach dem Intervall wieder im Pool');
});
