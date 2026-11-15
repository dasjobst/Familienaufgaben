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

test('Verantwortung: Einzelmodus vergibt je Person eine eigene Aufgabe', async () => {
  const { call, owner } = await setupFamily();
  const nik = await addMember(call, owner, 'Nikolas', 'child', '');
  const jak = await addMember(call, owner, 'Jakob', 'child', '');
  const st = (await call('GET', '/state', { token: owner })).json.state;
  const bett = st.catalog.find(c => c.name === 'Bett machen');
  const mine = st.inst.filter(i => i.catId === bett.id && i.status !== 'done');
  assert.equal(mine.length, 3, 'Jobst, Nikolas, Jakob je eine');
  assert.deepEqual(new Set(mine.map(i => i.assignee)), new Set(st.members.map(m => m.id)));
  assert.ok(mine.every(i => i.mode === 'assigned' && i.status === 'taken'));
  // Keine Doppelten bei erneutem Laden
  const again = (await call('GET', '/state', { token: owner })).json.state;
  assert.equal(again.inst.filter(i => i.catId === bett.id && i.status !== 'done').length, 3);
  // Jedes Kind erledigt nur seins und bekommt 1 Punkt (zugewiesen, ohne Bonus)
  const kid = (await login(call, owner, nik)).token;
  const nikInst = mine.find(i => i.assignee === nik), jakInst = mine.find(i => i.assignee === jak);
  assert.equal((await call('POST', '/action', { token: kid, body: { type: 'complete', id: jakInst.id } })).json.ok, false);
  const done = await call('POST', '/action', { token: kid, body: { type: 'complete', id: nikInst.id } });
  assert.equal(done.json.pts, bett.pts);
  // Einzelmodus-Tätigkeiten lassen sich nicht in den Pool stellen
  assert.equal((await call('POST', '/action', { token: owner, body: { type: 'enqueue', id: bett.id } })).json.ok, false);
  // Eigene Tätigkeit nur für Auswahl
  const bad = await call('POST', '/action', { token: owner, body: { type: 'saveCat', data: { name: 'Hund füttern', interval: 1, min: 5, resp: 'custom', ids: [] } } });
  assert.equal(bad.json.ok, false);
  const good = await call('POST', '/action', { token: owner, body: { type: 'saveCat', data: { name: 'Hund füttern', interval: 1, min: 5, resp: 'custom', ids: [jak] } } });
  assert.equal(good.json.ok, true);
  const after = (await call('GET', '/state', { token: owner })).json.state;
  const hund = after.catalog.find(c => c.name === 'Hund füttern');
  assert.deepEqual(after.inst.filter(i => i.catId === hund.id).map(i => i.assignee), [jak]);
});

test('Freitagabend-Check: Kind meldet, Eltern bestätigen oder lehnen ab', async () => {
  L.setNow('2026-11-18'); // Mittwoch, Freitag ist 2026-11-20
  const store = memoryStore(); const call = client(store);
  const owner = (await call('POST', '/setup', { body: { code: CODE, name: 'Jobst' } })).json.token;
  const nik = await addMember(call, owner, 'Nikolas', 'child', '');
  const kid = (await login(call, owner, nik)).token;
  const st = (await call('GET', '/state', { token: kid })).json.state;
  const chk = st.catalog.find(c => c.name.startsWith('Freitagabend-Check'));
  assert.equal(chk.weekday, 5); assert.equal(chk.check, true); assert.equal(chk.items.length, 2);
  const inst = st.inst.find(i => i.catId === chk.id && i.assignee === nik);
  assert.ok(inst, 'Kind hat die Aufgabe'); assert.equal(inst.due, '2026-11-20');
  assert.ok(!st.inst.some(i => i.catId === chk.id && i.assignee !== nik && i.status !== 'done'), 'Eltern bekommen sie nicht');
  // Kind meldet fertig: keine Punkte, Status review
  const rep = await call('POST', '/action', { token: kid, body: { type: 'complete', id: inst.id } });
  assert.equal(rep.json.ok, true); assert.equal(rep.json.review, true);
  assert.equal(rep.json.state.inst.find(i => i.id === inst.id).status, 'review');
  assert.equal(rep.json.state.ledger.length, 0);
  // Kind kann sich nicht selbst bestätigen
  assert.equal((await call('POST', '/action', { token: kid, body: { type: 'approve', id: inst.id } })).json.ok, false);
  // Überfällig zählt nicht, solange das Kind gemeldet hat
  L.setNow('2026-11-22');
  const late = (await call('GET', '/state', { token: owner })).json.state;
  L.setNow('2026-11-18');
  assert.ok(late.inst.some(i => i.id === inst.id && i.status === 'review'));
  // Eltern lehnen ab, Kind meldet erneut, Eltern bestätigen
  const rej = await call('POST', '/action', { token: owner, body: { type: 'reject', id: inst.id, note: 'Boden fehlt' } });
  assert.equal(rej.json.ok, true); assert.equal(rej.json.state.inst.find(i => i.id === inst.id).status, 'taken');
  await call('POST', '/action', { token: kid, body: { type: 'complete', id: inst.id } });
  const ok = await call('POST', '/action', { token: owner, body: { type: 'approve', id: inst.id } });
  assert.equal(ok.json.ok, true); assert.equal(ok.json.pts, chk.pts);
  const next = ok.json.state.inst.find(i => i.catId === chk.id && i.assignee === nik && i.status !== 'done');
  assert.equal(next, undefined, 'nächster Freitag liegt außerhalb des Vorlaufs');
  L.setNow('2026-11-25');
  const wk = (await call('GET', '/state', { token: owner })).json.state;
  assert.equal(wk.inst.find(i => i.catId === chk.id && i.assignee === nik && i.status !== 'done').due, '2026-11-27');
  L.setNow('2026-11-14');
});

const ledgerOf = (st, id) => st.ledger.filter(l => l.member === id);
const sum = list => list.reduce((a, l) => a + l.delta, 0);

test('Strafpunkte: überfällige zugewiesene Aufgabe kostet einmal, Unverteiltes kostet nichts', async () => {
  const { call, owner } = await setupFamily();
  const nik = await addMember(call, owner, 'Nikolas', 'child', '');
  const cat = await call('POST', '/action', { token: owner, body: { type: 'saveCat', data: { name: 'Garage fegen', interval: 14, min: 20 } } });
  const c = cat.json.state.catalog.find(x => x.name === 'Garage fegen'); // 4 Punkte, Strafe 2
  const as = await call('POST', '/action', { token: owner, body: { type: 'assignNew', cat: c.id, to: nik, due: '2026-11-15' } });
  assert.equal(as.json.ok, true);
  L.setNow('2026-11-17');
  const s1 = (await call('GET', '/state', { token: owner })).json.state;
  const pen = ledgerOf(s1, nik).filter(l => l.kind === 'missed' && l.text.includes('Garage'));
  assert.equal(pen.length, 1); assert.equal(pen[0].delta, -2);
  const s2 = (await call('GET', '/state', { token: owner })).json.state;
  assert.equal(ledgerOf(s2, nik).filter(l => l.text.includes('Garage')).length, 1, 'nicht doppelt');
  assert.ok(s2.inst.some(i => i.catId === c.id && i.status === 'taken'), 'bleibt auf dem Board');
  // unverteilte Pool-Aufgaben: keine Strafe
  assert.equal(s2.ledger.filter(l => l.kind === 'missed' && !s2.members.some(m => m.id === l.member)).length, 0);
  L.setNow('2026-11-14');
});

test('Verpasste Tagesaufgaben rollen weiter und zählen jeden Termin', async () => {
  const { call, owner } = await setupFamily();
  const nik = await addMember(call, owner, 'Nikolas', 'child', '');
  const bett = (await call('GET', '/state', { token: owner })).json.state.catalog.find(c => c.name === 'Bett machen');
  L.setNow('2026-11-17'); // 3 Tage später
  const st = (await call('GET', '/state', { token: owner })).json.state;
  L.setNow('2026-11-14');
  const mine = ledgerOf(st, nik).filter(l => l.kind === 'missed');
  assert.equal(mine.length, 1); assert.equal(mine[0].n, 3); assert.equal(mine[0].delta, -3);
  const act = st.inst.filter(i => i.catId === bett.id && i.assignee === nik && i.status !== 'done');
  assert.equal(act.length, 1, 'genau eine neue Aufgabe'); assert.equal(act[0].due, '2026-11-17');
});

test('Eltern löschen überfällige Aufgabe: Strafpunkte entfallen', async () => {
  const { call, owner } = await setupFamily();
  const nik = await addMember(call, owner, 'Nikolas', 'child', '');
  const c = (await call('POST', '/action', { token: owner, body: { type: 'saveCat', data: { name: 'Garage fegen', interval: 14, min: 20 } } })).json.state.catalog.find(x => x.name === 'Garage fegen');
  await call('POST', '/action', { token: owner, body: { type: 'assignNew', cat: c.id, to: nik, due: '2026-11-15' } });
  L.setNow('2026-11-17');
  const st = (await call('GET', '/state', { token: owner })).json.state;
  assert.equal(sum(ledgerOf(st, nik).filter(l => l.text.includes('Garage'))), -2);
  const inst = st.inst.find(i => i.catId === c.id);
  const del = await call('POST', '/action', { token: owner, body: { type: 'deleteInst', id: inst.id } });
  L.setNow('2026-11-14');
  assert.equal(del.json.ok, true); assert.match(del.json.msg, /Strafpunkte entfallen/);
  assert.equal(ledgerOf(del.json.state, nik).filter(l => l.text.includes('Garage')).length, 0);
});

test('Strafpunkte einstellbar, nur Eltern, Bereich 0 bis 2', async () => {
  const { call, owner } = await setupFamily();
  const nik = await addMember(call, owner, 'Nikolas', 'child', '');
  const kid = (await login(call, owner, nik)).token;
  assert.equal((await call('POST', '/action', { token: kid, body: { type: 'setPenalty', value: 0 } })).json.ok, false);
  assert.equal((await call('POST', '/action', { token: owner, body: { type: 'setPenalty', value: 3 } })).json.ok, false);
  assert.equal((await call('POST', '/action', { token: owner, body: { type: 'setPenalty', value: 0 } })).json.ok, true);
  L.setNow('2026-11-17');
  const st = (await call('GET', '/state', { token: owner })).json.state;
  L.setNow('2026-11-14');
  assert.equal(st.ledger.filter(l => l.kind === 'missed').length, 0, 'bei Faktor 0 keine Strafe');
});

test('Rückgängig: nur kurz nach dem Erledigen, nur Zuständige oder Eltern', async () => {
  const { call, owner } = await setupFamily();
  const nik = await addMember(call, owner, 'Nikolas', 'child', '');
  const jak = await addMember(call, owner, 'Jakob', 'child', '');
  const a = (await login(call, owner, nik)).token, b = (await login(call, owner, jak)).token;
  const open = (await call('GET', '/state', { token: a })).json.state.inst.find(i => i.status === 'open');
  await call('POST', '/action', { token: a, body: { type: 'book', id: open.id } });
  const done = await call('POST', '/action', { token: a, body: { type: 'complete', id: open.id } });
  assert.equal(done.json.undo, open.id);
  assert.ok(sum(ledgerOf(done.json.state, nik)) > 0);
  assert.equal((await call('POST', '/action', { token: b, body: { type: 'undo', id: open.id } })).json.ok, false, 'fremdes Kind');
  const u = await call('POST', '/action', { token: a, body: { type: 'undo', id: open.id } });
  assert.equal(u.json.ok, true);
  assert.equal(sum(ledgerOf(u.json.state, nik)), 0);
  assert.equal(u.json.state.inst.find(i => i.id === open.id).status, 'taken');
  // nach Ablauf der Frist nicht mehr
  await call('POST', '/action', { token: a, body: { type: 'complete', id: open.id } });
  const real = Date.now; Date.now = () => real() + 3 * 60e3;
  try { assert.equal((await call('POST', '/action', { token: a, body: { type: 'undo', id: open.id } })).json.ok, false); } finally { Date.now = real; }
});

test('Sammelzuweisung unverteilter überfälliger Aufgaben', async () => {
  const { call, owner } = await setupFamily();
  const nik = await addMember(call, owner, 'Nikolas', 'child', '');
  const kid = (await login(call, owner, nik)).token;
  assert.equal((await call('POST', '/action', { token: owner, body: { type: 'assignOverdue', to: nik } })).json.ok, false, 'nichts überfällig');
  L.setNow('2026-11-16');
  const st = (await call('GET', '/state', { token: owner })).json.state;
  const unclaimed = st.inst.filter(i => i.status === 'open' && i.due < '2026-11-16');
  assert.ok(unclaimed.length > 0, 'es gibt unverteilte überfällige');
  assert.equal((await call('POST', '/action', { token: kid, body: { type: 'assignOverdue', to: nik } })).json.ok, false, 'Kinder dürfen nicht');
  const r = await call('POST', '/action', { token: owner, body: { type: 'assignOverdue', to: nik } });
  L.setNow('2026-11-14');
  assert.equal(r.json.ok, true);
  assert.ok(unclaimed.every(u => r.json.state.inst.find(i => i.id === u.id)?.assignee === nik));
});

test('Mitglied löschen: Aufgaben zurück in den Pool, Konto, Sitzungen und Foto weg', async () => {
  const store = memoryStore(), env = { SETUP_CODE: 'delete-setup-code-1234' };
  const api = async (method, path, token, body) => {
    const h = { 'content-type': 'application/json' }; if (token) h.authorization = 'Bearer ' + token;
    return (await handle(new Request('https://x/api' + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined }), { store, env })).json();
  };
  const owner = (await api('POST', '/setup', null, { code: env.SETUP_CODE, name: 'Eltern' })).token;
  const add = await api('POST', '/action', owner, { type: 'saveMember', data: { name: 'Kind', role: 'child' } });
  const kid = add.state.members.find(m => m.name === 'Kind').id;
  const kt = (await api('POST', '/redeem', null, { token: (await api('POST', '/invite', owner, { memberId: kid })).url.split('#invite=')[1] })).token;
  const st = await api('GET', '/state', kt);
  const pool = st.state.inst.find(i => i.status === 'open');
  await api('POST', '/action', kt, { type: 'book', id: pool.id });
  assert.equal((await api('POST', '/action', kt, { type: 'removeMember', id: kid })).ok, false, 'Kind darf nicht löschen');
  assert.equal((await api('POST', '/action', owner, { type: 'removeMember', id: (await api('GET', '/state', owner)).me })).ok, false, 'nicht selbst');
  const r = await api('POST', '/action', owner, { type: 'removeMember', id: kid });
  assert.equal(r.ok, true);
  assert.ok(!r.state.members.some(m => m.id === kid));
  assert.ok(!r.state.inst.some(i => i.assignee === kid));
  assert.equal(r.state.inst.find(i => i.id === pool.id).status, 'open');
  assert.equal((await api('GET', '/state', kt)).ok, false, 'Sitzung des gelöschten Kindes ungültig');
});

test('Ad-hoc-Aufgaben: nur Eltern legen an und weisen zu, Punkte aus Minuten, Board zeigt die letzten 25', async () => {
  const store = memoryStore(), env = { SETUP_CODE: 'adhoc-setup-code-12345' };
  const api = async (method, path, token, body) => {
    const h = { 'content-type': 'application/json' }; if (token) h.authorization = 'Bearer ' + token;
    return (await handle(new Request('https://x/api' + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined }), { store, env })).json();
  };
  const owner = (await api('POST', '/setup', null, { code: env.SETUP_CODE, name: 'Eltern' })).token;
  const kid = (await api('POST', '/action', owner, { type: 'saveMember', data: { name: 'Kind', role: 'child' } })).state.members.find(m => m.name === 'Kind').id;
  const kt = (await api('POST', '/redeem', null, { token: (await api('POST', '/invite', owner, { memberId: kid })).url.split('#invite=')[1] })).token;
  assert.equal((await api('POST', '/action', kt, { type: 'assignOneoff', name: 'Keller', min: 30, to: kid })).ok, false, 'Kind darf nicht anlegen');
  assert.equal((await api('POST', '/action', owner, { type: 'assignOneoff', name: 'Keller', min: 0, to: kid })).ok, false);
  assert.equal((await api('POST', '/action', owner, { type: 'assignOneoff', name: 'Keller', min: 9999, to: kid })).ok, false);
  const r = await api('POST', '/action', owner, { type: 'assignOneoff', name: 'Keller aufräumen', min: 23, to: kid });
  assert.equal(r.ok, true);
  const inst = r.state.inst.find(i => i.assignee === kid && r.state.catalog.find(c => c.id === i.catId).oneoff);
  assert.equal(inst.mode, 'assigned');
  const c = r.state.catalog.find(x => x.id === inst.catId);
  assert.equal(c.pts, 5); assert.equal(c.archived, true);
  // erscheint nicht als Pool-Aufgabe und nicht als bestehende Tätigkeit zum Buchen
  assert.equal((await api('POST', '/action', owner, { type: 'book', id: inst.id })).ok, false);
  const done = await api('POST', '/action', kt, { type: 'complete', id: inst.id });
  assert.equal(done.ok, true);
  const last = done.state.ledger.at(-1);
  assert.equal(last.delta, 5); assert.equal(last.text.startsWith('Keller aufräumen'), true); assert.ok(last.ts); assert.equal(last.min, 23);
  // Löschen einer offenen Ad-hoc-Aufgabe räumt auch den versteckten Katalogeintrag auf
  const r2 = await api('POST', '/action', owner, { type: 'assignOneoff', name: 'Fenster', min: 10, to: kid });
  const i2 = r2.state.inst.find(i => r2.state.catalog.find(c => c.id === i.catId && c.name === 'Fenster'));
  const del = await api('POST', '/action', owner, { type: 'deleteInst', id: i2.id });
  assert.ok(!del.state.catalog.some(c => c.name === 'Fenster'));
  // Board: letzte 25
  for (let i = 0; i < 30; i++) {
    const x = await api('POST', '/action', owner, { type: 'assignOneoff', name: 'Job ' + i, min: 5, to: kid });
    const id = x.state.inst.find(n => x.state.catalog.find(c => c.id === n.catId && c.name === 'Job ' + i)).id;
    await api('POST', '/action', kt, { type: 'complete', id });
  }
  const st = (await api('GET', '/state', owner)).state; L.setState(st);
  const b = L.board(25); assert.equal(b.length, 25); assert.equal(b[0].text.startsWith('Job 29'), true);
  assert.equal(L.ptsFromMin(2), 1); assert.equal(L.ptsFromMin(60), 12);
  const sv = await api('POST', '/action', owner, { type: 'saveCat', data: { name: 'Test', min: 40, pts: 99, interval: 7 } });
  assert.equal(sv.state.catalog.find(c => c.name === 'Test').pts, 8);
});

test('Anmeldung mit E-Mail und Passwort: setzen, einloggen, Sperre, Änderung, Reset', async () => {
  const store = memoryStore(), env = { SETUP_CODE: 'login-setup-code-12345' };
  const api = async (method, path, token, body) => {
    const h = { 'content-type': 'application/json' }; if (token) h.authorization = 'Bearer ' + token;
    const res = await handle(new Request('https://x/api' + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined }), { store, env });
    const d = await res.json(); d._status = res.status; return d;
  };
  const owner = (await api('POST', '/setup', null, { code: env.SETUP_CODE, name: 'Eltern', email: 'Eltern@Example.de' })).token;
  assert.equal((await api('POST', '/login', null, { email: 'eltern@example.de', password: 'irgendwas-langes' }))._status, 401, 'ohne Passwort kein Login');
  assert.equal((await api('POST', '/password', owner, { password: 'kurz' }))._status, 400);
  const set = await api('POST', '/password', owner, { password: 'Sonnenblume-im-Herbst' });
  assert.equal(set.ok, true); assert.equal(set.state.members[0].pw, true);
  assert.equal(JSON.stringify([...store._raw.values()]).includes('Sonnenblume'), false, 'Passwort nie im Klartext');
  const li = await api('POST', '/login', null, { email: 'ELTERN@example.de', password: 'Sonnenblume-im-Herbst' });
  assert.equal(li.ok, true); assert.ok((await api('GET', '/state', li.token)).ok);
  assert.equal((await api('POST', '/login', null, { email: 'nobody@example.de', password: 'Sonnenblume-im-Herbst' }))._status, 401);
  // Ändern braucht das aktuelle Passwort und meldet andere Geräte ab
  assert.equal((await api('POST', '/password', li.token, { password: 'Neues-Passwort-2026', current: 'falsch' }))._status, 403);
  assert.equal((await api('POST', '/password', li.token, { password: 'Neues-Passwort-2026', current: 'Sonnenblume-im-Herbst' })).ok, true);
  assert.equal((await api('GET', '/state', owner)).ok, false, 'altes Gerät abgemeldet');
  assert.equal((await api('POST', '/login', null, { email: 'eltern@example.de', password: 'Sonnenblume-im-Herbst' }))._status, 401);
  // Sperre nach 5 Fehlversuchen, auch mit richtigem Passwort
  for (let i = 0; i < 4; i++) await api('POST', '/login', null, { email: 'eltern@example.de', password: 'falsch-falsch-' + i });
  const locked = await api('POST', '/login', null, { email: 'eltern@example.de', password: 'Neues-Passwort-2026' });
  assert.equal(locked._status, 429);
  // Reset durch Eltern
  store._raw.delete('rl/' + (await import('node:crypto')).createHash('sha256').update('eltern@example.de').digest('hex'));
  const t2 = (await api('POST', '/login', null, { email: 'eltern@example.de', password: 'Neues-Passwort-2026' })).token;
  const kid = (await api('POST', '/action', t2, { type: 'saveMember', data: { name: 'Kind', role: 'child', email: 'kind@example.de' } })).state.members.find(m => m.name === 'Kind').id;
  const kt = (await api('POST', '/redeem', null, { token: (await api('POST', '/invite', t2, { memberId: kid })).url.split('#invite=')[1] })).token;
  assert.equal((await api('POST', '/password', kt, { password: 'Gummibaerchen-am-Morgen' })).ok, true);
  assert.equal((await api('POST', '/resetpw', kt, { memberId: kid }))._status, 403, 'Kind darf nicht zurücksetzen');
  assert.equal((await api('POST', '/resetpw', t2, { memberId: kid })).ok, true);
  assert.equal((await api('POST', '/login', null, { email: 'kind@example.de', password: 'Gummibaerchen-am-Morgen' }))._status, 401);
  assert.equal((await api('GET', '/state', kt)).ok, false);
});

test('Adminrolle: Nutzerverwaltung nur zentral beim Admin, Eltern behalten Aufgabenrechte', async () => {
  const store = memoryStore(), env = { SETUP_CODE: 'admin-setup-code-12345' };
  const api = async (method, path, token, body) => {
    const h = { 'content-type': 'application/json' }; if (token) h.authorization = 'Bearer ' + token;
    const res = await handle(new Request('https://x/api' + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined }), { store, env });
    const d = await res.json(); d._status = res.status; return d;
  };
  const adm = (await api('POST', '/setup', null, { code: env.SETUP_CODE, name: 'Admin', email: 'a@example.de' })).token;
  assert.equal((await api('GET', '/state', adm)).state.members[0].role, 'admin');
  const add = async (name, role, email) => (await api('POST', '/action', adm, { type: 'saveMember', data: { name, role, email } })).state.members.find(m => m.name === name).id;
  const pid = await add('Eltern2', 'parent', 'p@example.de'), kid = await add('Kind', 'child', 'k@example.de');
  const login = async id => (await api('POST', '/redeem', null, { token: (await api('POST', '/invite', adm, { memberId: id })).url.split('#invite=')[1] })).token;
  const par = await login(pid), kt = await login(kid);
  // Eltern: keine Nutzerverwaltung
  assert.equal((await api('POST', '/action', par, { type: 'saveMember', data: { name: 'Neu', role: 'child' } })).ok, false);
  assert.equal((await api('POST', '/action', par, { type: 'saveMember', data: { id: kid, name: 'Kind', role: 'parent' } })).ok, false);
  assert.equal((await api('POST', '/action', par, { type: 'removeMember', id: kid })).ok, false);
  assert.equal((await api('POST', '/invite', par, { memberId: kid }))._status, 403);
  assert.equal((await api('POST', '/revoke', par, { memberId: kid }))._status, 403);
  assert.equal((await api('POST', '/resetpw', par, { memberId: kid }))._status, 403);
  assert.equal((await api('PUT', '/photo/' + kid, par, null))._status, 403);
  // Eltern sehen fremde E-Mails nicht, behalten aber Aufgabenrechte
  const pv = (await api('GET', '/state', par)).state.members;
  assert.ok(pv.filter(m => m.id !== pid).every(m => !m.email));
  assert.equal((await api('POST', '/action', par, { type: 'saveCat', data: { name: 'Eltern-Aufgabe', min: 10, interval: 7 } })).ok, true);
  // Admin darf alles, aber der letzte Admin bleibt
  assert.equal((await api('POST', '/action', adm, { type: 'saveMember', data: { id: kid, name: 'Kind', role: 'child', email: 'k@example.de' } })).ok, true);
  const self = (await api('GET', '/state', adm)).me;
  assert.equal((await api('POST', '/action', adm, { type: 'saveMember', data: { id: self, name: 'Admin', role: 'parent', email: 'a@example.de' } })).ok, false, 'letzter Admin');
  assert.equal((await api('POST', '/action', adm, { type: 'saveMember', data: { id: pid, name: 'Eltern2', role: 'admin', email: 'p@example.de' } })).ok, true);
  assert.equal((await api('POST', '/action', adm, { type: 'saveMember', data: { id: self, name: 'Admin', role: 'parent', email: 'a@example.de' } })).ok, true, 'jetzt ist Eltern2 Admin');
  // Bestand ohne Admin wird migriert
  const legacy = JSON.parse(JSON.stringify((await api('GET', '/state', par)).state)); legacy.members.forEach(m => { if (m.role === 'admin') m.role = 'parent'; });
  L.setState(legacy); assert.equal(legacy.members.filter(m => m.role === 'admin').length, 1);
  assert.equal(L.isParent(kid), false);
});
