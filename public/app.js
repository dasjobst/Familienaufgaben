import * as L from './shared/logic.mjs';

const KEY = 'haushalt-session';
let token = null;
try { token = localStorage.getItem(KEY); } catch (e) { /* ohne Speicher: Anmeldung gilt nur bis zum Schließen */ }
let S = null, me = null;
let tab = 'tasks';
const filt = { q: '', cat: '', archive: false };
const photos = new Map();
const inflight = new Set();
let photoTarget = null;

const $ = id => document.getElementById(id);
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function setToken(t) { token = t; try { if (t) localStorage.setItem(KEY, t); else localStorage.removeItem(KEY); } catch (e) { /* egal */ } }
function toast(msg, bad) {
  const t = document.createElement('div'); t.className = 'toast' + (bad ? ' err' : ''); t.textContent = msg; t.setAttribute('role', 'status');
  document.body.appendChild(t); setTimeout(() => t.remove(), 3000);
}

async function api(path, { method = 'GET', json, raw, headers } = {}) {
  const h = { ...(headers || {}) };
  if (token) h.Authorization = 'Bearer ' + token;
  let body;
  if (json !== undefined) { body = JSON.stringify(json); h['Content-Type'] = 'application/json'; } else if (raw !== undefined) { body = raw; }
  try {
    const res = await fetch('/api' + path, { method, headers: h, body });
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : null;
    return { status: res.status, data, res };
  } catch (e) {
    return { status: 0, data: { ok: false, msg: 'Keine Verbindung zum Server.' } };
  }
}

function apply(d) {
  S = d.state; me = d.me;
  L.setState(S); L.setNow(d.date);
  render();
}

/* ---------- Start, Einrichtung, Anmeldung ---------- */
async function boot() {
  const m = /^#invite=([\w-]+)$/.exec(location.hash);
  if (m) {
    history.replaceState(null, '', location.pathname);
    const r = await api('/redeem', { method: 'POST', json: { token: m[1] } });
    if (r.data && r.data.ok) setToken(r.data.token);
    else { showLogin((r.data && r.data.msg) || 'Der Einladungslink funktioniert nicht.'); return; }
  }
  await refresh();
}
async function refresh() {
  const r = await api('/state');
  if (r.status === 0) { $('app').innerHTML = '<div class="gate"><h1>Keine Verbindung</h1><p class="note">Der Server ist gerade nicht erreichbar.</p><button class="btn primary" id="retry">Noch einmal versuchen</button></div>'; $('retry').onclick = refresh; return; }
  if (r.status === 401) { setToken(null); showLogin(); return; }
  if (r.data && r.data.initialized === false) { showSetup(); return; }
  if (r.data && r.data.ok) apply(r.data); else showLogin((r.data && r.data.msg) || 'Fehler beim Laden.');
}
function showSetup() {
  $('app').innerHTML = '<div class="gate"><h1>Familie einrichten</h1><p class="note">Du richtest die App einmalig ein und wirst das erste Elternteil. Den Einrichtungscode hat Netlify als Umgebungsvariable SETUP_CODE gespeichert.</p>' +
    '<form id="setupForm" class="card">' +
    '<div class="field"><label for="s_code">Einrichtungscode</label><input id="s_code" name="code" required autocomplete="off"></div>' +
    '<div class="field"><label for="s_name">Dein Name</label><input id="s_name" name="name" required maxlength="40"></div>' +
    '<div class="field"><label for="s_mail">Deine E-Mail (optional)</label><input id="s_mail" name="email" type="email" inputmode="email" autocomplete="email"></div>' +
    '<button class="btn primary" type="submit">Einrichten</button></form></div>';
  $('setupForm').onsubmit = async e => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    const r = await api('/setup', { method: 'POST', json: fd });
    if (r.data && r.data.ok) { setToken(r.data.token); await refresh(); } else toast((r.data && r.data.msg) || 'Fehler.', true);
  };
}
function showLogin(msg) {
  $('app').innerHTML = '<div class="gate"><h1>Haushaltsplaner</h1>' + (msg ? '<p class="card" role="alert">' + esc(msg) + '</p>' : '') +
    '<p class="note">Der Zugang läuft über einen persönlichen Einladungslink. Frag ein Elternteil nach deinem Link und öffne ihn auf diesem Gerät, oder füge ihn hier ein.</p>' +
    '<form id="loginForm" class="card"><div class="field"><label for="l_link">Einladungslink</label><input id="l_link" name="link" required autocomplete="off" placeholder="https://…/#invite=…"></div><button class="btn primary" type="submit">Anmelden</button></form></div>';
  $('loginForm').onsubmit = async e => {
    e.preventDefault();
    const v = String(new FormData(e.target).get('link') || '').trim();
    const m = /invite=([\w-]+)/.exec(v) || /^([\w-]{20,80})$/.exec(v);
    if (!m) { toast('Das sieht nicht nach einem Einladungslink aus.', true); return; }
    const r = await api('/redeem', { method: 'POST', json: { token: m[1] } });
    if (r.data && r.data.ok) { setToken(r.data.token); await refresh(); } else toast((r.data && r.data.msg) || 'Fehler.', true);
  };
}
async function logout() {
  await api('/logout', { method: 'POST' });
  setToken(null); S = null; me = null; showLogin('Du bist abgemeldet.');
}

/* ---------- Aktionen ---------- */
async function act(type, payload = {}) {
  const r = await api('/action', { method: 'POST', json: { type, ...payload } });
  if (r.status === 401) { setToken(null); showLogin('Deine Anmeldung ist abgelaufen.'); return { ok: false }; }
  const d = r.data || { ok: false, msg: 'Fehler.' };
  if (d.state) apply(d);
  toast(d.msg || (d.ok ? 'Fertig.' : 'Fehler.'), !d.ok);
  return d;
}

/* ---------- Avatare ---------- */
function avatar(m, cls = '') {
  if (!m) return '<span class="av ' + cls + '">?</span>';
  const init = esc((m.name || '?').trim().charAt(0).toUpperCase());
  if (m.photoV) {
    const k = m.id + ':' + m.photoV, u = photos.get(k);
    if (u) return '<img class="av ' + cls + '" alt="" src="' + u + '">';
    return '<span class="av ' + cls + '" data-ph="' + esc(m.id) + '" data-v="' + esc(m.photoV) + '">' + init + '</span>';
  }
  return '<span class="av ' + cls + '">' + init + '</span>';
}
function hydratePhotos() {
  document.querySelectorAll('[data-ph]').forEach(el => {
    const k = el.dataset.ph + ':' + el.dataset.v;
    if (photos.has(k) || inflight.has(k)) return;
    inflight.add(k);
    api('/photo/' + el.dataset.ph).then(async r => {
      inflight.delete(k);
      if (r.status === 200) { const b = await r.res.blob(); photos.set(k, URL.createObjectURL(b)); render(); }
    });
  });
}
async function prepPhoto(file) {
  const bmp = await createImageBitmap(file);
  const size = 320, c = document.createElement('canvas'); c.width = c.height = size;
  const s = Math.min(bmp.width, bmp.height);
  c.getContext('2d').drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, size, size);
  for (const q of [0.85, 0.7, 0.5]) {
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', q));
    if (blob && blob.size <= 340 * 1024) return blob;
  }
  throw new Error('Das Foto ist auch verkleinert zu groß.');
}
$('photoInput').addEventListener('change', async e => {
  const f = e.target.files && e.target.files[0]; e.target.value = '';
  if (!f || !photoTarget) return;
  try {
    const blob = await prepPhoto(f);
    const r = await api('/photo/' + photoTarget, { method: 'PUT', raw: blob, headers: { 'Content-Type': 'image/jpeg' } });
    if (r.data && r.data.state) apply(r.data);
    toast((r.data && r.data.msg) || 'Fehler.', !(r.data && r.data.ok));
  } catch (err) { toast('Das Bild konnte nicht gelesen werden.', true); }
});

/* ---------- Modale ---------- */
function modal(title, bodyHtml, submitLabel, onSubmit, danger) {
  const layer = $('layer');
  layer.innerHTML = '<div class="overlay" id="ov"><form class="modal" id="mf" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><h2>' + esc(title) + '</h2>' + bodyHtml +
    '<div class="actions"><button type="submit" class="btn ' + (danger ? 'danger' : 'primary') + '">' + esc(submitLabel) + '</button><button type="button" class="btn" id="mc">Abbrechen</button></div></form></div>';
  const close = () => { layer.innerHTML = ''; };
  $('mc').onclick = close;
  $('ov').addEventListener('click', e => { if (e.target.id === 'ov') close(); });
  $('mf').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    const res = await onSubmit(fd);
    if (res && res.ok === false) return;
    close();
  });
  const f = document.querySelector('#mf input,#mf select'); if (f) f.focus();
}
function infoModal(title, bodyHtml, buttons) {
  const layer = $('layer');
  layer.innerHTML = '<div class="overlay" id="ov"><div class="modal" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><h2>' + esc(title) + '</h2>' + bodyHtml + '<div class="actions">' + buttons + '<button class="btn" id="mc">Schließen</button></div></div></div>';
  const close = () => { layer.innerHTML = ''; };
  $('mc').onclick = close;
  $('ov').addEventListener('click', e => { if (e.target.id === 'ov') close(); });
}
function memberOptions(sel, excl) { return S.members.filter(m => m.id !== excl).map(m => '<option value="' + esc(m.id) + '"' + (m.id === sel ? ' selected' : '') + '>' + esc(m.name) + '</option>').join(''); }
const isParent = () => L.isParent(me);

/* ---------- Ansichten ---------- */
function taskCard(i) {
  const c = L.catById(i.catId); if (!c) return '';
  const late = i.status !== 'done' && L.diffDays(i.due, L.today()) < 0, w = i.assignee ? L.memberById(i.assignee) : null;
  let pts;
  if (i.status === 'open') pts = '<div><span class="pts">' + Math.round(c.pts * S.bonus) + ' Pkt</span><div class="sub">' + c.pts + ' bei Zuweisung</div></div>';
  else pts = '<span class="pts">' + L.pointsFor(i) + ' Pkt</span>';
  let state;
  if (i.status === 'open') state = 'Im Pool · <span class="' + (late ? 'late' : '') + '">' + L.dueText(i.due) + '</span>';
  else state = '<span class="who">' + avatar(w, 'sm') + '<b>' + esc(w ? w.name : '?') + '</b></span> · ' + (i.mode === 'booked' ? 'selbst gebucht' : 'zugewiesen') + ' · <span class="' + (late ? 'late' : '') + '">' + L.dueText(i.due) + '</span>';
  let a = '';
  if (i.status === 'open') {
    a += '<button class="btn primary small" data-act="book" data-id="' + esc(i.id) + '">Buchen</button>';
    if (isParent()) a += '<button class="btn small" data-act="assignPick" data-id="' + esc(i.id) + '">Zuweisen an …</button>';
  } else if (i.status === 'taken') {
    if (me === i.assignee || isParent()) {
      a += '<button class="btn primary small" data-act="complete" data-id="' + esc(i.id) + '">Erledigt</button>';
      a += '<button class="btn small" data-act="transferPick" data-id="' + esc(i.id) + '">Übertragen</button>';
    }
    if (i.mode === 'booked' && me === i.assignee && !late) a += '<button class="btn small" data-act="release" data-id="' + esc(i.id) + '">Zurück in Pool</button>';
  }
  if (isParent() && i.status !== 'done') a += '<button class="btn small danger" data-act="instDelete" data-id="' + esc(i.id) + '">Löschen</button>';
  return '<article class="card' + (late ? ' late' : '') + '"><div class="top"><h3>' + esc(c.name) + '</h3>' + pts + '</div>' +
    '<div class="meta"><span class="chip">' + esc(c.cat) + '</span>' + (c.room ? '<span>' + esc(c.room) + '</span>' : '') + '<span>' + c.min + ' Min.</span><span>' + L.freqLabel(c.interval) + '</span></div>' +
    '<div class="state">' + state + '</div>' + (a ? '<div class="actions">' + a + '</div>' : '') + '</article>';
}

function viewTasks() {
  const open = S.inst.filter(i => i.status === 'open').sort((a, b) => a.due < b.due ? -1 : 1);
  const mine = S.inst.filter(i => i.status === 'taken' && i.assignee === me).sort((a, b) => a.due < b.due ? -1 : 1);
  const others = S.inst.filter(i => i.status === 'taken' && i.assignee !== me).sort((a, b) => a.due < b.due ? -1 : 1);
  const done = S.inst.filter(i => i.status === 'done' && !i.seed).sort((a, b) => a.doneAt < b.doneAt ? 1 : -1).slice(0, 8);
  let h = '<section><div class="sec-h"><h2>Meine Aufgaben</h2><span class="count">' + mine.length + '</span></div>' + (mine.length ? mine.map(taskCard).join('') : '<div class="empty">Nichts offen. Buche eine Aufgabe aus dem Pool und sammle mehr Punkte als bei einer Zuweisung.</div>') + '</section>';
  h += '<section><div class="sec-h"><h2>Pool</h2><span class="count">' + open.length + '</span></div>';
  if (isParent()) h += '<div class="actions"><button class="btn small" data-act="assignNew">+ Aufgabe zuweisen</button></div>';
  h += (open.length ? open.map(taskCard).join('') : '<div class="empty">Der Pool ist leer. Neue Aufgaben entstehen, sobald Intervalle ablaufen.</div>') + '</section>';
  if (others.length) h += '<section><div class="sec-h"><h2>Bei anderen</h2><span class="count">' + others.length + '</span></div>' + others.map(taskCard).join('') + '</section>';
  h += '<section><div class="sec-h"><h2>Zuletzt erledigt</h2></div>' + (done.length ? '<div class="log">' + done.map(i => '<div><span>' + esc(L.catById(i.catId) ? L.catById(i.catId).name : '?') + ' · ' + esc(L.memberById(i.assignee) ? L.memberById(i.assignee).name : '?') + '</span><span class="d">+' + i.points + '</span></div>').join('') + '</div>' : '<div class="empty">Noch nichts erledigt.</div>') + '</section>';
  return h;
}

function viewCatalog() {
  const parent = isParent();
  const cats = [...new Set(S.catalog.map(c => c.cat))].sort();
  const list = S.catalog.filter(c => (filt.archive || !c.archived) && (!filt.cat || c.cat === filt.cat) && (!filt.q || c.name.toLowerCase().includes(filt.q.toLowerCase())));
  list.sort((a, b) => { const ba = L.band(a.interval)[0], bb = L.band(b.interval)[0]; return ba - bb || a.name.localeCompare(b.name, 'de'); });
  let h = '<section><div class="sec-h"><h2>Katalog</h2><span class="count">' + list.length + ' Tätigkeiten</span></div>';
  h += '<div class="filters"><input type="search" id="fq" placeholder="Suchen" value="' + esc(filt.q) + '" aria-label="Katalog durchsuchen"><select id="fc" aria-label="Kategorie"><option value="">Alle Kategorien</option>' + cats.map(c => '<option' + (c === filt.cat ? ' selected' : '') + '>' + esc(c) + '</option>').join('') + '</select><label class="chk"><input type="checkbox" id="fa"' + (filt.archive ? ' checked' : '') + '> Archivierte anzeigen</label></div>';
  if (parent) h += '<div class="actions"><button class="btn primary small" data-act="catNew">+ Eigene Tätigkeit</button></div>';
  else h += '<p class="note">Den Katalog bearbeiten nur Eltern. Du kannst Aufgaben aus dem Pool buchen.</p>';
  let last = null;
  list.forEach(c => {
    const b = L.band(c.interval)[1];
    if (b !== last) { h += '<h3 class="band">' + b + '</h3>'; last = b; }
    const act = L.activeInst(c.id);
    h += '<article class="card"><div class="top"><h3>' + esc(c.name) + (c.archived ? ' (archiviert)' : '') + '</h3><span class="pts">' + c.pts + ' Pkt</span></div>' +
      '<div class="meta"><span class="chip">' + esc(c.cat) + '</span>' + (c.origin === 'familie' ? '<span class="chip fam">Familie</span>' : '') + (c.room ? '<span>' + esc(c.room) + '</span>' : '') + '<span>' + c.min + ' Min.</span><span>' + L.freqLabel(c.interval) + '</span></div>';
    if (parent) {
      h += '<div class="actions">';
      if (c.archived) h += '<button class="btn small" data-act="catRestore" data-id="' + esc(c.id) + '">Wiederherstellen</button>';
      else {
        h += '<button class="btn small" data-act="catEdit" data-id="' + esc(c.id) + '">Bearbeiten</button>';
        if (!act) h += '<button class="btn small" data-act="catEnqueue" data-id="' + esc(c.id) + '">In den Pool</button>';
        h += '<button class="btn small danger" data-act="catDelete" data-id="' + esc(c.id) + '">Löschen</button>';
      }
      h += '</div>';
    }
    h += '</article>';
  });
  if (!list.length) h += '<div class="empty">Keine Treffer.</div>';
  return h + '</section>';
}

function viewPoints() {
  const rows = S.members.map(m => ({ m, p: L.pointsOf(m.id) })).sort((a, b) => b.p - a.p);
  const max = Math.max(1, ...rows.map(r => r.p));
  let h = '<section><div class="sec-h"><h2>Punktestand</h2></div><div class="card rank">' + rows.map(r => '<div class="r"><span class="who">' + avatar(r.m) + '<span class="nm">' + esc(r.m.name) + '</span></span><span class="sc">' + r.p + '</span><div class="bar"><i style="width:' + Math.max(2, Math.round(r.p / max * 100)) + '%"></i></div></div>').join('') + '</div>';
  h += '<p class="note">Selbst gebuchte Aufgaben zählen ×' + S.bonus + ' des Katalogwerts, zugewiesene ×1. Übertragene Aufgaben zählen für die neue Person als zugewiesen.</p></section>';
  const lg = S.ledger.slice().reverse().slice(0, 15);
  h += '<section><div class="sec-h"><h2>Verlauf</h2></div>' + (lg.length ? '<div class="log">' + lg.map(l => '<div><span>' + esc(L.memberById(l.member) ? L.memberById(l.member).name : '?') + ' · ' + esc(l.text) + '</span><span class="d' + (l.delta < 0 ? ' neg' : '') + '">' + (l.delta > 0 ? '+' : '') + l.delta + '</span></div>').join('') + '</div>' : '<div class="empty">Noch keine Punkte vergeben.</div>') + '</section>';
  return h;
}

function viewEscalation() {
  const list = L.escalations();
  const by = {}; list.forEach(i => { const k = i.assignee ? L.memberById(i.assignee).name : 'Niemand zuständig'; by[k] = (by[k] || 0) + 1; });
  let h = '<section><div class="sec-h"><h2>Eskalationsboard</h2><span class="count">' + list.length + ' überfällig</span></div>';
  h += '<p class="note">Hier steht jede Aufgabe, deren Frist abgelaufen ist, mit dem Namen der zuständigen Person. Aufgaben im Pool, die keiner gebucht hat, erscheinen ohne Namen.</p>';
  if (list.length) h += '<div class="meta">' + Object.keys(by).map(k => '<span class="chip" style="background:var(--crit-soft);color:var(--crit)">' + esc(k) + ': ' + by[k] + '</span>').join('') + '</div>';
  h += list.length ? list.map(i => {
    const c = L.catById(i.catId), d = -L.diffDays(i.due, L.today()), w = i.assignee ? L.memberById(i.assignee) : null;
    let a = '';
    if (i.status === 'open') a += '<button class="btn primary small" data-act="book" data-id="' + esc(i.id) + '">Jetzt buchen</button>' + (isParent() ? '<button class="btn small" data-act="assignPick" data-id="' + esc(i.id) + '">Zuweisen an …</button>' : '');
    else if (me === i.assignee || isParent()) a += '<button class="btn primary small" data-act="complete" data-id="' + esc(i.id) + '">Erledigt</button><button class="btn small" data-act="transferPick" data-id="' + esc(i.id) + '">Übertragen</button>';
    if (isParent()) a += '<button class="btn small danger" data-act="instDelete" data-id="' + esc(i.id) + '">Löschen</button>';
    return '<article class="card late"><div class="who">' + (w ? avatar(w) : '') + '<span class="esc-who">' + esc(w ? w.name : 'Niemand zuständig') + '</span></div><h3>' + esc(c.name) + '</h3><div class="state"><span class="late">' + d + (d === 1 ? ' Tag' : ' Tage') + ' überfällig</span> · fällig war ' + L.fmtDate(i.due) + ' · ' + (i.status === 'open' ? 'nicht gebucht' : (i.mode === 'booked' ? 'selbst gebucht' : 'zugewiesen')) + '</div>' + (a ? '<div class="actions">' + a + '</div>' : '') + '</article>';
  }).join('') : '<div class="empty">Nichts überfällig.</div>';
  return h + '</section>';
}

function viewFamily() {
  const parent = isParent();
  let h = '<section><div class="sec-h"><h2>Mitglieder</h2></div>';
  h += S.members.map(m => {
    const mine = m.id === me, canPhoto = mine || parent;
    let a = '';
    if (canPhoto) a += '<button class="btn small" data-act="photo" data-id="' + esc(m.id) + '">' + (m.photoV ? 'Foto ändern' : 'Foto hinzufügen') + '</button>';
    if (canPhoto && m.photoV) a += '<button class="btn small" data-act="photoDel" data-id="' + esc(m.id) + '">Foto entfernen</button>';
    if (parent) a += '<button class="btn small" data-act="memEdit" data-id="' + esc(m.id) + '">Bearbeiten</button><button class="btn small" data-act="invite" data-id="' + esc(m.id) + '">Einladungslink</button><button class="btn small" data-act="revoke" data-id="' + esc(m.id) + '">Geräte abmelden</button>';
    return '<article class="card"><div class="top"><div class="who">' + avatar(m, 'lg') + '<div><h3>' + esc(m.name) + (mine ? ' (du)' : '') + '</h3><div class="meta">' + (m.email ? '<span>' + esc(m.email) + '</span>' : (parent || mine ? '<span>Keine E-Mail hinterlegt</span>' : '')) + '</div></div></div><span class="chip">' + (m.role === 'parent' ? 'Eltern' : 'Kind') + '</span></div>' + (a ? '<div class="actions">' + a + '</div>' : '') + '</article>';
  }).join('');
  if (parent) h += '<div class="actions"><button class="btn primary small" data-act="memNew">+ Mitglied</button></div>';
  h += '</section>';
  h += '<section><div class="sec-h"><h2>Regeln</h2></div><div class="card"><div class="field"><label for="bonus">Buchungsbonus (Faktor auf Katalogpunkte)</label><input id="bonus" type="number" min="1" max="3" step="0.1" value="' + S.bonus + '"' + (parent ? '' : ' disabled') + '></div>' + (parent ? '<div class="actions"><button class="btn small" data-act="bonusSave">Speichern</button></div>' : '') +
    '<p class="note">Eltern weisen zu und pflegen den Katalog. Kinder buchen, erledigen und übertragen eigene Aufgaben.</p></div></section>';
  h += '<section><div class="sec-h"><h2>Dieses Gerät</h2></div><div class="card"><div class="actions"><button class="btn small danger" data-act="logout">Abmelden</button></div></div></section>';
  return h;
}

function render() {
  if (!S) return;
  const esc_n = L.escalations().length;
  const mm = L.memberById(me);
  const tabs = [['tasks', 'Aufgaben'], ['catalog', 'Katalog'], ['points', 'Punkte'], ['esc', 'Eskalation'], ['family', 'Familie']];
  const keep = document.activeElement && document.activeElement.id;
  const v = { tasks: viewTasks, catalog: viewCatalog, points: viewPoints, esc: viewEscalation, family: viewFamily }[tab];
  $('app').innerHTML = '<header><div class="wrap"><div class="head"><h1>Haushaltsplaner</h1><button class="me-btn" data-tab="family" aria-label="Mein Profil">' + avatar(mm) + '<span>' + esc(mm ? mm.name : '') + '</span></button></div>' +
    '<div class="sum"><span class="pill"><b>' + L.pointsOf(me) + '</b> Punkte</span><span class="pill"><b>' + S.inst.filter(i => i.status === 'taken' && i.assignee === me).length + '</b> offen für mich</span>' + (esc_n ? '<span class="pill crit"><b>' + esc_n + '</b> überfällig</span>' : '') + '</div></div></header>' +
    '<main class="wrap">' + v() + '</main>' +
    '<nav><div class="tabs">' + tabs.map(t => '<button data-tab="' + t[0] + '"' + (tab === t[0] ? ' aria-current="page"' : '') + '>' + t[1] + (t[0] === 'esc' && esc_n ? '<span class="badge">' + esc_n + '</span>' : '') + '</button>').join('') + '</div></nav>';
  if (keep === 'fq') { const f = $('fq'); if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); } }
  hydratePhotos();
}

function catForm(c) {
  c = c || { name: '', cat: '', room: '', interval: 7, min: 15, pts: '' };
  const cats = [...new Set(S.catalog.map(x => x.cat))].sort();
  return '<div class="field"><label for="f_name">Name der Tätigkeit</label><input id="f_name" name="name" required maxlength="80" value="' + esc(c.name) + '"></div>' +
    '<div class="grid2"><div class="field"><label for="f_cat">Kategorie</label><input id="f_cat" name="cat" list="catlist" maxlength="40" value="' + esc(c.cat) + '"><datalist id="catlist">' + cats.map(x => '<option value="' + esc(x) + '">').join('') + '</datalist></div>' +
    '<div class="field"><label for="f_room">Raum</label><input id="f_room" name="room" maxlength="40" value="' + esc(c.room) + '"></div></div>' +
    '<div class="grid2"><div class="field"><label for="f_int">Intervall in Tagen</label><input id="f_int" name="interval" type="number" min="0" value="' + c.interval + '"><span class="hint">0 = nur manuell. 1 täglich, 7 wöchentlich, 30 monatlich.</span></div>' +
    '<div class="field"><label for="f_min">Aufwand in Minuten</label><input id="f_min" name="min" type="number" min="1" value="' + c.min + '"></div></div>' +
    '<div class="field"><label for="f_pts">Punkte</label><input id="f_pts" name="pts" type="number" min="1" value="' + (c.pts || '') + '" placeholder="leer = Aufwand ÷ 5"></div>';
}
function memForm(m) {
  m = m || { name: '', role: 'child', email: '' };
  return '<div class="field"><label for="m_n">Name</label><input id="m_n" name="name" required maxlength="40" value="' + esc(m.name) + '"></div>' +
    '<div class="field"><label for="m_e">E-Mail (optional)</label><input id="m_e" name="email" type="email" inputmode="email" autocomplete="off" value="' + esc(m.email || '') + '" placeholder="name@beispiel.de"></div>' +
    '<div class="field"><label for="m_r">Rolle</label><select id="m_r" name="role"><option value="child"' + (m.role === 'child' ? ' selected' : '') + '>Kind</option><option value="parent"' + (m.role === 'parent' ? ' selected' : '') + '>Eltern</option></select></div>';
}

async function copyText(text, ta) {
  try { await navigator.clipboard.writeText(text); toast('Kopiert.'); } catch (e) { if (ta) { ta.focus(); ta.select(); } toast('Bitte den markierten Text selbst kopieren.'); }
}

document.addEventListener('click', async e => {
  const tb = e.target.closest('[data-tab]'); if (tb) { tab = tb.dataset.tab; render(); window.scrollTo(0, 0); return; }
  const b = e.target.closest('[data-act]'); if (!b || !S) return;
  const a = b.dataset.act, id = b.dataset.id;
  if (a === 'book') act('book', { id });
  else if (a === 'complete') act('complete', { id });
  else if (a === 'release') act('release', { id });
  else if (a === 'instDelete') {
    const i = L.instById(id), c = L.catById(i.catId), w = i.assignee ? L.memberById(i.assignee) : null;
    modal('Aufgabe löschen', '<p>„' + esc(c.name) + '“' + (w ? ' bei ' + esc(w.name) : ' im Pool') + ' endgültig entfernen? Es werden keine Punkte vergeben. Das Intervall der Tätigkeit startet heute neu.</p>', 'Löschen', () => act('deleteInst', { id }), true);
  }
  else if (a === 'assignPick') modal('Zuweisen an', '<div class="field"><label for="p_m">Person</label><select id="p_m" name="to">' + memberOptions(null) + '</select></div><p class="hint">Zugewiesene Aufgaben lassen sich nicht löschen, nur übertragen.</p>', 'Zuweisen', fd => act('assign', { id, to: fd.to }));
  else if (a === 'transferPick') {
    const i = L.instById(id);
    modal('Übertragen an', '<div class="field"><label for="p_m">Person</label><select id="p_m" name="to">' + memberOptions(null, i.assignee) + '</select></div><p class="hint">Die Aufgabe gilt danach als zugewiesen, ohne Buchungsbonus.</p>', 'Übertragen', fd => act('transfer', { id, to: fd.to }));
  } else if (a === 'assignNew') {
    const free = S.catalog.filter(c => !c.archived && !L.activeInst(c.id));
    const d = L.addDays(L.today(), 2);
    modal('Aufgabe zuweisen', '<div class="field"><label for="a_c">Tätigkeit</label><select id="a_c" name="cat">' + free.map(c => '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>').join('') + '</select></div><div class="grid2"><div class="field"><label for="a_m">Person</label><select id="a_m" name="to">' + memberOptions(null) + '</select></div><div class="field"><label for="a_d">Fällig am</label><input id="a_d" name="due" type="date" value="' + d + '" min="' + L.today() + '"></div></div>', 'Zuweisen', fd => act('assignNew', { cat: fd.cat, to: fd.to, due: fd.due }));
  } else if (a === 'catNew') modal('Eigene Tätigkeit', catForm(), 'Hinzufügen', fd => act('saveCat', { data: fd }));
  else if (a === 'catEdit') { const c = L.catById(id); modal('Tätigkeit bearbeiten', catForm(c) + '<input type="hidden" name="id" value="' + esc(c.id) + '">', 'Speichern', fd => act('saveCat', { data: fd })); }
  else if (a === 'catEnqueue') act('enqueue', { id });
  else if (a === 'catRestore') act('restoreCat', { id });
  else if (a === 'catDelete') { const c = L.catById(id); modal('Tätigkeit löschen', '<p>„' + esc(c.name) + '“ aus dem Katalog entfernen? Hat die Tätigkeit schon erledigte Aufgaben, wird sie archiviert und die Punktehistorie bleibt.</p>', 'Löschen', () => act('removeCat', { id }), true); }
  else if (a === 'memNew') modal('Neues Mitglied', memForm(), 'Hinzufügen', fd => act('saveMember', { data: fd }));
  else if (a === 'memEdit') { const m = L.memberById(id); modal('Mitglied bearbeiten', memForm(m) + '<input type="hidden" name="id" value="' + esc(m.id) + '">', 'Speichern', fd => act('saveMember', { data: fd })); }
  else if (a === 'bonusSave') act('setBonus', { value: $('bonus').value });
  else if (a === 'photo') { photoTarget = id; $('photoInput').click(); }
  else if (a === 'photoDel') {
    const r = await api('/photo/' + id, { method: 'DELETE' });
    if (r.data && r.data.state) apply(r.data);
    toast((r.data && r.data.msg) || 'Fehler.', !(r.data && r.data.ok));
  } else if (a === 'logout') logout();
  else if (a === 'revoke') {
    const m = L.memberById(id);
    modal('Geräte abmelden', '<p>Alle angemeldeten Geräte und offenen Einladungen von ' + esc(m.name) + ' werden ungültig. Mit einem neuen Einladungslink kommt die Person wieder hinein.</p>', 'Abmelden', async () => {
      const r = await api('/revoke', { method: 'POST', json: { memberId: id } });
      toast((r.data && r.data.msg) || 'Fehler.', !(r.data && r.data.ok)); return r.data;
    }, true);
  } else if (a === 'invite') {
    const r = await api('/invite', { method: 'POST', json: { memberId: id } });
    if (!(r.data && r.data.ok)) { toast((r.data && r.data.msg) || 'Fehler.', true); return; }
    const d = r.data, subject = 'Einladung zum Haushaltsplaner der Familie';
    const me_ = L.memberById(me);
    const body = 'Hallo ' + d.name + ',\n\n' + (me_ ? me_.name : 'ich') + ' lädt dich zum Haushaltsplaner der Familie ein. Dort buchst du Aufgaben, sammelst Punkte und siehst, was ansteht.\n\nÖffne diesen Link auf dem Gerät, das du benutzen willst:\n' + d.url + '\n\nDer Link gilt 14 Tage und nur einmal. Er ist dein persönlicher Zugang, gib ihn nicht weiter.\n\nBis gleich!';
    const mailto = d.email ? 'mailto:' + encodeURIComponent(d.email) + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body) : '';
    infoModal('Einladung für ' + d.name,
      '<div class="field"><label for="inv_t">Text zum Verschicken</label><textarea id="inv_t" readonly rows="9" style="background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:10px;width:100%;font:inherit;color:inherit">' + esc(body) + '</textarea></div><p class="hint">Der Link gilt einmal und 14 Tage. Die App verschickt keine E-Mails selbst.</p>',
      '<button class="btn primary" id="inv_copy">Text kopieren</button>' + (mailto ? '<a class="btn" href="' + esc(mailto) + '" style="text-decoration:none;color:inherit;display:inline-flex;align-items:center">Im Mailprogramm öffnen</a>' : ''));
    $('inv_copy').onclick = () => copyText(subject + '\n\n' + body, $('inv_t'));
  }
});
document.addEventListener('input', e => { if (e.target.id === 'fq') { filt.q = e.target.value; render(); } });
document.addEventListener('change', e => {
  if (e.target.id === 'fc') { filt.cat = e.target.value; render(); } else if (e.target.id === 'fa') { filt.archive = e.target.checked; render(); }
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && S && token) refresh(); });

boot();
