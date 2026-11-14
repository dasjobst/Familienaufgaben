// Rauchtest der Oberfläche mit einem minimalen DOM-Ersatz gegen den echten Handler.
import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../netlify/lib/handler.mjs';
import * as L from '../public/shared/logic.mjs';
import { memoryStore } from './memory-store.mjs';

test('Oberfläche rendert alle Ansichten für Eltern und Kind ohne Fehler', async () => {
  L.setNow('2026-11-18');
  const store = memoryStore(), env = { SETUP_CODE: 'smoke-setup-code-12345' };
  const api = async (method, path, token, body) => {
    const h = { 'content-type': 'application/json' }; if (token) h.authorization = 'Bearer ' + token;
    return (await handle(new Request('https://x/api' + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined }), { store, env })).json();
  };
  const owner = (await api('POST', '/setup', null, { code: env.SETUP_CODE, name: 'Jobst' })).token;
  const added = await api('POST', '/action', owner, { type: 'saveMember', data: { name: 'Nikolas', role: 'child', email: 'n@example.de' } });
  const nik = added.state.members.find(m => m.name === 'Nikolas').id;
  const inv = await api('POST', '/invite', owner, { memberId: nik });
  const kidTok = (await api('POST', '/redeem', null, { token: inv.url.split('#invite=')[1] })).token;

  const els = {}, handlers = {};
  const el = id => (els[id] ||= { id, innerHTML: '', dataset: {}, style: {}, addEventListener() {}, click() {}, focus() {}, value: '' });
  globalThis.document = {
    getElementById: el, querySelectorAll: () => [], querySelector: () => null, activeElement: null, hidden: false,
    addEventListener: (t, f) => { (handlers[t] ||= []).push(f); },
    createElement: () => ({ setAttribute() {}, remove() {}, style: {} }), body: { appendChild() {} }
  };
  const mem = { t: owner };
  globalThis.localStorage = { getItem: () => mem.t, setItem: (k, v) => { mem.t = v; }, removeItem: () => { mem.t = null; } };
  globalThis.location = { hash: '', pathname: '/' }; globalThis.history = { replaceState() {} };
  globalThis.window = { scrollTo() {} };
  globalThis.fetch = async (url, o = {}) => handle(new Request('https://x' + url, o), { store, env });
  globalThis.setTimeout = (f) => 0;
  const click = target => handlers.click.forEach(f => f({ target: { closest: s => (s === '[data-tab]' ? target.tab : target.act) ? { dataset: s === '[data-tab]' ? { tab: target.tab } : { act: target.act, id: target.id } } : null } }));
  const settle = () => new Promise(r => setImmediate(r));

  await import('../public/app.js?parent');
  await settle(); await settle();
  assert.match(els.app.innerHTML, /Meine Aufgaben/);
  for (const [tab, needle] of [['catalog', 'Eigene Tätigkeit'], ['points', 'Punktestand'], ['esc', 'Eskalationsboard'], ['family', 'Einladungslink'], ['tasks', 'Pool']]) {
    click({ tab }); assert.ok(els.app.innerHTML.includes(needle), tab + ' zeigt ' + needle);
  }
  click({ tab: 'catalog' });
  click({ act: 'catNew' });
  assert.match(els.layer.innerHTML, /Verantwortung/); assert.match(els.layer.innerHTML, /Fester Wochentag/); assert.match(els.layer.innerHTML, /Checkliste/);
  assert.match(els.app.innerHTML, /Jedes Kind/);

  // Kind: kein Eltern-Zubehör
  mem.t = kidTok;
  await import('../public/app.js?kid');
  await settle(); await settle();
  click({ tab: 'family' });
  assert.ok(!els.app.innerHTML.includes('Einladungslink</button>'), 'Kind sieht keine Einladungsbuttons');
  assert.match(els.app.innerHTML, /Foto hinzufügen/);
  click({ tab: 'tasks' });
  assert.ok(!els.app.innerHTML.includes('instDelete'), 'Kind sieht kein Löschen');
  L.setNow('2026-11-14');
});
