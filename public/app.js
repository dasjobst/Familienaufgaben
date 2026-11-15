import * as L from './shared/logic.mjs';

const KEY = 'haushalt-session';
let token = null;
try { token = localStorage.getItem(KEY); } catch (e) { /* ohne Speicher: Anmeldung gilt nur bis zum Schließen */ }
let S = null, me = null, lastJson = '';
let tab = 'tasks';
const filt = { q: '', cat: '', archive: false };
const ui = { poolAll: false, othersOpen: false, unclaimedOpen: false, bands: new Set() };
const photos = new Map();
const inflight = new Set();
let photoTarget = null;

const $ = id => document.getElementById(id);
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function setToken(t) { token = t; try { if (t) localStorage.setItem(KEY, t); else localStorage.removeItem(KEY); } catch (e) { /* egal */ } }
function toast(msg, bad, action) {
  const t = document.createElement('div'); t.className = 'toast' + (bad ? ' err' : ''); t.setAttribute('role', 'status');
  const span = document.createElement('span'); span.textContent = msg; t.appendChild(span);
  if (action) {
    const b = document.createElement('button'); b.className = 'toast-btn'; b.textContent = action.label;
    b.onclick = () => { t.remove(); action.fn(); }; t.appendChild(b);
  }
  document.body.appendChild(t); setTimeout(() => t.remove(), action ? 9000 : 3200);
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

function apply(d, silent) {
  const j = JSON.stringify(d.state);
  if (silent && j === lastJson && d.me === me) return;
  lastJson = j; S = d.state; me = d.me;
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
async function silentRefresh() {
  const r = await api('/state');
  if (r.data && r.data.ok) apply(r.data, true);
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
    '<form id="pwForm" class="card"><h2>Anmelden</h2><div class="field"><label for="l_mail">E-Mail</label><input id="l_mail" name="email" type="email" inputmode="email" autocomplete="username" required></div>' +
    '<div class="field"><label for="l_pw">Passwort</label><input id="l_pw" name="password" type="password" autocomplete="current-password" required></div>' +
    '<button class="btn primary" type="submit">Anmelden</button></form>' +
    '<details class="adv"><summary>Mit Einladungslink anmelden</summary><p class="note">Noch kein Passwort? Öffne den Link, den dir ein Elternteil geschickt hat, oder füge ihn hier ein. Danach kannst du unter „Familie“ ein Passwort festlegen.</p>' +
    '<form id="loginForm"><div class="field"><label for="l_link">Einladungslink</label><input id="l_link" name="link" required autocomplete="off" placeholder="https://…/#invite=…"></div><button class="btn" type="submit">Mit Link anmelden</button></form></details></div>';
  $('pwForm').onsubmit = async e => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    const r = await api('/login', { method: 'POST', json: fd });
    if (r.data && r.data.ok && r.data.token) { setToken(r.data.token); await refresh(); } else toast((r.data && r.data.msg) || 'Fehler.', true);
  };
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
  setToken(null); S = null; me = null; lastJson = ''; showLogin('Du bist abgemeldet.');
}

/* ---------- Aktionen ---------- */
async function act(type, payload = {}) {
  const r = await api('/action', { method: 'POST', json: { type, ...payload } });
  if (r.status === 401) { setToken(null); showLogin('Deine Anmeldung ist abgelaufen.'); return { ok: false }; }
  const d = r.data || { ok: false, msg: 'Fehler.' };
  if (d.state) apply(d);
  toast(d.msg || (d.ok ? 'Fertig.' : 'Fehler.'), !d.ok, d.ok && d.undo ? { label: 'Rückgängig', fn: () => act('undo', { id: d.undo }) } : null);
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

/* ---------- Dialoge ---------- */
function closeLayer() { $('layer').innerHTML = ''; }
function modal(title, bodyHtml, submitLabel, onSubmit, danger) {
  const layer = $('layer');
  layer.innerHTML = '<div class="overlay" id="ov"><form class="modal" id="mf" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><h2>' + esc(title) + '</h2>' + bodyHtml +
    '<div class="actions"><button type="submit" class="btn ' + (danger ? 'danger' : 'primary') + '">' + esc(submitLabel) + '</button><button type="button" class="btn" id="mc">Abbrechen</button></div></form></div>';
  $('mc').onclick = closeLayer;
  $('ov').addEventListener('click', e => { if (e.target.id === 'ov') closeLayer(); });
  $('mf').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = {};
    for (const [k, v] of new FormData(e.target).entries()) { if (k in fd) fd[k] = [].concat(fd[k], v); else fd[k] = v; }
    const res = await onSubmit(fd);
    if (res && res.ok === false) return;
    closeLayer();
  });
  const f = document.querySelector('#mf input,#mf select'); if (f) f.focus();
}
function infoModal(title, bodyHtml, buttons) {
  const layer = $('layer');
  layer.innerHTML = '<div class="overlay" id="ov"><div class="modal" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><h2>' + esc(title) + '</h2>' + bodyHtml + '<div class="actions">' + buttons + '<button class="btn" id="mc">Schließen</button></div></div></div>';
  $('mc').onclick = closeLayer;
  $('ov').addEventListener('click', e => { if (e.target.id === 'ov') closeLayer(); });
}
function memberOptions(sel, excl) { return S.members.filter(m => m.id !== excl).map(m => '<option value="' + esc(m.id) + '"' + (m.id === sel ? ' selected' : '') + '>' + esc(m.name) + '</option>').join(''); }
const isParent = () => L.isParent(me);

/* ---------- Aufgaben: gemeinsame Bausteine ---------- */
const overdue = i => Math.max(0, -L.diffDays(i.due, L.today()));
const sevClass = n => n >= 3 ? 'late' : 'warn';
function dueSpan(i) {
  const n = i.status === 'open' ? 0 : overdue(i);
  return '<span class="' + (n > 0 ? sevClass(n) : '') + '">' + L.dueText(i.due) + '</span>';
}
function primaryOf(i) {
  const c = L.catById(i.catId); if (!c) return '';
  const mine = me === i.assignee, p = isParent(), id = esc(i.id);
  if (i.status === 'open') return '<button class="btn primary small" data-act="book" data-id="' + id + '">Buchen</button>';
  if (i.status === 'taken' && (mine || p)) return '<button class="btn primary small" data-act="complete" data-id="' + id + '">' + (c.check && !p ? 'Fertig melden' : 'Erledigt') + '</button>';
  if (i.status === 'review' && p) return '<button class="btn primary small" data-act="approve" data-id="' + id + '">Check bestanden</button><button class="btn small" data-act="rejectPick" data-id="' + id + '">Nicht bestanden</button>';
  return '';
}
function moreItems(i) {
  const mine = me === i.assignee, p = isParent(), items = [];
  if (i.status === 'open' && p) items.push(['assignPick', 'Zuweisen an …']);
  if (i.status === 'taken') {
    if (mine || p) items.push(['transferPick', 'Übertragen']);
    if (i.mode === 'booked' && mine && overdue(i) === 0) items.push(['release', 'Zurück in den Pool']);
    else if (i.mode === 'booked' && !mine && p) items.push(['releasePick', 'Buchung aufheben']);
  }
  if (p && i.status !== 'done') items.push(['instDelete', 'Löschen', true]);
  return items;
}
function moreBtn(i) { return moreItems(i).length ? '<button class="btn icon" data-act="more" data-id="' + esc(i.id) + '" aria-label="Weitere Aktionen">⋯</button>' : ''; }
function openSheet(id) {
  const i = L.instById(id); if (!i) return;
  const c = L.catById(i.catId), items = moreItems(i);
  $('layer').innerHTML = '<div class="overlay" id="ov"><div class="modal sheet" role="dialog" aria-modal="true" aria-label="Weitere Aktionen"><h2>' + esc(c.name) + '</h2><div class="actions">' +
    items.map(it => '<button class="btn' + (it[2] ? ' danger' : '') + '" data-sheet data-act="' + it[0] + '" data-id="' + esc(id) + '">' + esc(it[1]) + '</button>').join('') +
    '</div><button class="btn" id="mc">Schließen</button></div></div>';
  $('mc').onclick = closeLayer;
  $('ov').addEventListener('click', e => { if (e.target.id === 'ov') closeLayer(); });
}

function taskCard(i) {
  const c = L.catById(i.catId); if (!c) return '';
  const n = overdue(i), w = i.assignee ? L.memberById(i.assignee) : null;
  let pts;
  if (i.status === 'open') pts = '<div><span class="pts">' + Math.round(c.pts * S.bonus) + ' Pkt</span><div class="sub">' + c.pts + ' bei Zuweisung</div></div>';
  else pts = '<span class="pts">' + L.pointsFor(i) + ' Pkt</span>';
  let state;
  if (i.status === 'open') state = 'Im Pool · ' + dueSpan(i);
  else if (i.status === 'review') state = '<span class="who">' + avatar(w, 'sm') + '<b>' + esc(w ? w.name : '?') + '</b></span> · gemeldet, wartet auf den Check durch Eltern';
  else state = '<span class="who">' + avatar(w, 'sm') + '<b>' + esc(w ? w.name : '?') + '</b></span> · ' + (i.mode === 'booked' ? 'selbst gebucht' : 'zugewiesen') + ' · ' + dueSpan(i);
  const a = primaryOf(i) + moreBtn(i);
  const cls = n > 0 && i.status === 'taken' ? ' ' + sevClass(n) : '';
  return '<article class="card' + cls + '"><div class="top"><h3>' + esc(c.name) + '</h3>' + pts + '</div>' +
    '<div class="meta"><span class="chip">' + esc(c.cat) + '</span>' + (c.room ? '<span>' + esc(c.room) + '</span>' : '') + '<span>' + c.min + ' Min.</span><span>' + L.schedLabel(c) + '</span></div>' +
    '<div class="state">' + state + '</div>' + (c.items && c.items.length ? '<div class="hint">Check: ' + c.items.map(esc).join(' · ') + '</div>' : '') + (a ? '<div class="actions">' + a + '</div>' : '') + '</article>';
}

/* ---------- Ansichten ---------- */
function viewTasks() {
  const p = isParent();
  const byDue = (a, b) => a.due < b.due ? -1 : a.due > b.due ? 1 : 0;
  const open = S.inst.filter(i => i.status === 'open').sort(byDue);
  const mine = S.inst.filter(i => (i.status === 'taken' || i.status === 'review') && i.assignee === me).sort(byDue);
  const others = S.inst.filter(i => (i.status === 'taken' || i.status === 'review') && i.assignee !== me && !(p && i.status === 'review')).sort(byDue);
  const reviews = p ? S.inst.filter(i => i.status === 'review' && i.assignee !== me).sort(byDue) : [];
  const done = S.inst.filter(i => i.status === 'done' && !i.seed).sort((a, b) => a.doneAt < b.doneAt ? 1 : -1).slice(0, 8);
  let h = '';
  if (L.isAdmin(me) && S.members.length === 1) {
    h += '<section><article class="card guide"><h3>So startest du</h3><ol><li>Unter „Familie“ Mitglieder anlegen, Rolle und E-Mail eintragen.</li><li>Pro Mitglied einen Einladungslink erzeugen und verschicken.</li><li>Im Katalog Tätigkeiten prüfen und eigene ergänzen.</li></ol><div class="actions"><button class="btn primary small" data-tab="family">Mitglieder anlegen</button></div></article></section>';
  }
  if (reviews.length) h += '<section><div class="sec-h"><h2>Wartet auf Check</h2><span class="count">' + reviews.length + '</span></div>' + reviews.map(taskCard).join('') + '</section>';
  h += '<section><div class="sec-h"><h2>Meine Aufgaben</h2><span class="count">' + mine.length + '</span></div>' + (mine.length ? mine.map(taskCard).join('') : '<div class="empty">Nichts offen. Buche eine Aufgabe aus dem Pool und sammle mehr Punkte als bei einer Zuweisung.</div>') + '</section>';
  const shown = ui.poolAll ? open : open.slice(0, 5);
  h += '<section><div class="sec-h"><h2>Pool</h2><span class="count">' + open.length + '</span></div>';
  if (p) h += '<div class="actions"><button class="btn small" data-act="assignNew">+ Aufgabe zuweisen</button><button class="btn small" data-act="oneoffNew">+ Ad-hoc-Aufgabe</button></div>';
  h += (shown.length ? shown.map(taskCard).join('') : '<div class="empty">Der Pool ist leer. Neue Aufgaben entstehen, sobald Intervalle ablaufen.</div>');
  if (open.length > 5) h += '<button class="btn more-btn" data-act="togglePool">' + (ui.poolAll ? 'Weniger anzeigen' : 'Alle ' + open.length + ' anzeigen') + '</button>';
  h += '</section>';
  if (others.length) h += '<section><button class="band-btn" data-act="toggleOthers" aria-expanded="' + ui.othersOpen + '"><span>Bei anderen (' + others.length + ')</span><span>' + (ui.othersOpen ? '▴' : '▾') + '</span></button>' + (ui.othersOpen ? others.map(taskCard).join('') : '') + '</section>';
  h += '<section><div class="sec-h"><h2>Zuletzt erledigt</h2></div>' + (done.length ? '<div class="log">' + done.map(i => '<div><span>' + esc(L.catById(i.catId) ? L.catById(i.catId).name : '?') + ' · ' + esc(L.memberById(i.assignee) ? L.memberById(i.assignee).name : '?') + '</span><span class="d">+' + i.points + '</span></div>').join('') + '</div>' : '<div class="empty">Noch nichts erledigt.</div>') + '</section>';
  return h;
}

function viewCatalog() {
  const parent = isParent();
  const cats = [...new Set(S.catalog.filter(c => !c.oneoff).map(c => c.cat))].sort();
  const list = S.catalog.filter(c => !c.oneoff && (filt.archive || !c.archived) && (!filt.cat || c.cat === filt.cat) && (!filt.q || c.name.toLowerCase().includes(filt.q.toLowerCase())));
  list.sort((a, b) => { const ba = L.catBand(a)[0], bb = L.catBand(b)[0]; return ba - bb || a.name.localeCompare(b.name, 'de'); });
  const searching = !!(filt.q || filt.cat);
  let h = '<section><div class="sec-h"><h2>Katalog</h2><span class="count">' + list.length + ' Tätigkeiten</span></div>';
  h += '<div class="filters"><input type="search" id="fq" placeholder="Suchen" value="' + esc(filt.q) + '" aria-label="Katalog durchsuchen"><select id="fc" aria-label="Kategorie"><option value="">Alle Kategorien</option>' + cats.map(c => '<option' + (c === filt.cat ? ' selected' : '') + '>' + esc(c) + '</option>').join('') + '</select><label class="chk check"><input type="checkbox" id="fa"' + (filt.archive ? ' checked' : '') + '> Archivierte anzeigen</label></div>';
  if (parent) h += '<div class="actions"><button class="btn primary small" data-act="catNew">+ Eigene Tätigkeit</button></div>';
  else h += '<p class="note">Den Katalog bearbeiten nur Eltern. Du kannst Aufgaben aus dem Pool buchen.</p>';
  const groups = [];
  list.forEach(c => { const b = L.catBand(c)[1]; let g = groups[groups.length - 1]; if (!g || g.b !== b) { g = { b, items: [] }; groups.push(g); } g.items.push(c); });
  groups.forEach(g => {
    const open = searching || ui.bands.has(g.b);
    h += '<button class="band-btn" data-act="band" data-id="' + esc(g.b) + '" aria-expanded="' + open + '"><span>' + esc(g.b) + ' (' + g.items.length + ')</span><span>' + (open ? '▴' : '▾') + '</span></button>';
    if (!open) return;
    g.items.forEach(c => {
      const act = L.activeInst(c.id);
      h += '<article class="card"><div class="top"><h3>' + esc(c.name) + (c.archived ? ' (archiviert)' : '') + '</h3><span class="pts">' + c.pts + ' Pkt</span></div>' +
        '<div class="meta"><span class="chip">' + esc(c.cat) + '</span>' + (c.origin === 'familie' ? '<span class="chip fam">Familie</span>' : '') + '<span class="chip fam">' + esc(L.respLabel(c)) + '</span>' + (c.check ? '<span class="chip fam">Check</span>' : '') + (c.room ? '<span>' + esc(c.room) + '</span>' : '') + '<span>' + c.min + ' Min.</span><span>' + L.schedLabel(c) + '</span></div>' +
        (c.items && c.items.length ? '<div class="hint">Check: ' + c.items.map(esc).join(' · ') + '</div>' : '') +
        (L.hasDates(c) ? (() => { const nx = c.dates.find(d => d >= L.today()), last = c.dates[c.dates.length - 1]; return '<div class="hint">' + (nx ? 'Nächster Termin: ' + L.fmtDateFull(nx) + ' · ' : '') + 'Termine bis ' + L.fmtDateFull(last) + (last < L.addDays(L.today(), 14) ? ' · <b class="late">bald keine Termine mehr, bitte ergänzen</b>' : '') + '</div>'; })() : '');
      if (parent) {
        h += '<div class="actions">';
        if (c.archived) h += '<button class="btn small" data-act="catRestore" data-id="' + esc(c.id) + '">Wiederherstellen</button>';
        else {
          h += '<button class="btn small" data-act="catEdit" data-id="' + esc(c.id) + '">Bearbeiten</button>';
          if (!act && !L.hasDates(c) && !(c.resp && c.resp.mode === 'each')) h += '<button class="btn small" data-act="catEnqueue" data-id="' + esc(c.id) + '">In den Pool</button>';
          h += '<button class="btn small danger" data-act="catDelete" data-id="' + esc(c.id) + '">Löschen</button>';
        }
        h += '</div>';
      }
      h += '</article>';
    });
  });
  if (!list.length) h += '<div class="empty">Keine Treffer.</div>';
  return h + '</section>';
}

function viewPoints() {
  const rows = S.members.map(m => ({ m, p: L.pointsOf(m.id), miss: L.missedStats(m.id, 30) })).sort((a, b) => b.p - a.p);
  const max = Math.max(1, ...rows.map(r => r.p));
  let h = '<section><div class="sec-h"><h2>Board</h2></div>';
  const feed = L.board(25);
  h += '<div class="sec-h"><h2>Zuletzt erledigt</h2><span class="count">letzte ' + feed.length + '</span></div>';
  h += feed.length ? '<div class="card feed">' + feed.map(l => {
    const m = L.memberById(l.member);
    return '<div class="frow">' + avatar(m, 'sm') + '<div class="t"><b>' + esc(l.text) + '</b><div class="hint">' + esc(m ? m.name : 'Gelöscht') + ' · ' + esc(L.stampText(l)) + (l.min ? ' · ' + l.min + ' Min.' : '') + + '</div></div><div class="fr"><span class="pts">+' + l.delta + '</span>' + '' + '</div></div>';
  }).join('') + '</div>' : '<div class="empty">Noch nichts erledigt.</div>';
  h += '<div class="sec-h"><h2>Punktestand</h2></div><div class="card rank">' + rows.map(r => '<div class="r"><span class="who">' + avatar(r.m) + '<span class="nm">' + esc(r.m.name) + '</span></span><span class="sc' + (r.p < 0 ? ' neg' : '') + '">' + r.p + '</span><div class="bar"><i style="width:' + Math.max(2, Math.round(Math.max(0, r.p) / max * 100)) + '%"></i></div>' + (r.miss.n ? '<span class="hint" style="grid-column:1/-1">Verpasst in 30 Tagen: ' + r.miss.n + '× (−' + r.miss.pts + ' Punkte)</span>' : '') + '</div>').join('') + '</div>';
  h += '<p class="note">Punkte entstehen aus der Zeit: 5 Minuten = 1 Punkt. Selbst gebuchte Aufgaben zählen ×' + S.bonus + ', zugewiesene und Ad-hoc-Aufgaben ×1. Verpasste Aufgaben kosten ×' + (S.penalty === undefined ? 0.5 : S.penalty) + ' ihres Werts.</p></section>';
  const lg = S.ledger.filter(l => l.kind === 'missed').slice(-10).reverse();
  if (lg.length) h += '<section><div class="sec-h"><h2>Abzüge</h2></div><div class="log">' + lg.map(l => '<div><span>' + esc(L.memberById(l.member) ? L.memberById(l.member).name : '?') + ' · ' + esc(l.text) + '</span><span class="d neg">' + l.delta + '</span></div>').join('') + '</div></section>';
  return h;
}

function escRow(i) {
  const c = L.catById(i.catId), n = overdue(i);
  return '<div class="erow"><div class="t"><b>' + esc(c.name) + '</b><div class="hint"><span class="' + sevClass(n) + '" style="font-weight:600">' + n + (n === 1 ? ' Tag' : ' Tage') + ' überfällig</span> · fällig war ' + L.fmtDate(i.due) + (i.mode === 'booked' ? ' · selbst gebucht' : '') + '</div></div><div class="actions">' + primaryOf(i) + moreBtn(i) + '</div></div>';
}
function viewEscalation() {
  const list = L.escalations();
  const named = list.filter(i => i.assignee), un = list.filter(i => !i.assignee);
  const groups = {};
  named.forEach(i => { (groups[i.assignee] ||= []).push(i); });
  const order = Object.keys(groups).sort((a, b) => groups[b].length - groups[a].length || Math.max(...groups[b].map(overdue)) - Math.max(...groups[a].map(overdue)));
  let h = '<section><div class="sec-h"><h2>Eskalationsboard</h2><span class="count">' + list.length + ' überfällig</span></div>';
  h += '<p class="note">Wer eine Aufgabe nicht rechtzeitig erledigt, steht hier mit Namen. Ab 3 Tagen Verzug wird es rot. Verpasste Aufgaben kosten Punkte.</p>';
  if (order.length) h += '<div class="meta">' + order.map(id => { const m = L.memberById(id), mx = Math.max(...groups[id].map(overdue)); return '<span class="chip ' + sevClass(mx) + '">' + esc(m.name) + ': ' + groups[id].length + '</span>'; }).join('') + '</div>';
  h += order.map(id => {
    const m = L.memberById(id), items = groups[id], mx = Math.max(...items.map(overdue)), miss = L.missedStats(id, 30);
    return '<article class="card ' + sevClass(mx) + '"><div class="top"><div class="who">' + avatar(m) + '<span class="esc-who">' + esc(m.name) + '</span></div><span class="chip ' + sevClass(mx) + '">' + items.length + ' überfällig</span></div>' +
      (miss.n ? '<div class="hint">Verpasst in 30 Tagen: ' + miss.n + '× (−' + miss.pts + ' Punkte)</div>' : '') + items.map(escRow).join('') + '</article>';
  }).join('');
  if (!named.length) h += '<div class="empty">Niemand ist im Verzug.</div>';
  if (un.length) {
    h += '<section><button class="band-btn" data-act="toggleUnclaimed" aria-expanded="' + ui.unclaimedOpen + '"><span>Unverteilt (' + un.length + ')</span><span>' + (ui.unclaimedOpen ? '▴' : '▾') + '</span></button>';
    if (ui.unclaimedOpen) {
      h += '<p class="note">Diese Aufgaben hat noch niemand gebucht. Es gibt dafür keine Strafpunkte, bis sie jemandem gehören.</p>';
      if (isParent()) h += '<div class="actions"><button class="btn small" data-act="assignOverduePick">Alle zuweisen an …</button></div>';
      h += '<article class="card">' + un.map(escRow).join('') + '</article>';
    }
    h += '</section>';
  }
  return h + '</section>';
}

function viewFamily() {
  const parent = isParent(), admin = L.isAdmin(me);
  let h = '<section><div class="sec-h"><h2>Mitglieder</h2></div>';
  h += S.members.map(m => {
    const mine = m.id === me, canPhoto = mine || admin;
    let a = '';
    if (canPhoto) a += '<button class="btn small" data-act="photo" data-id="' + esc(m.id) + '">' + (m.photoV ? 'Foto ändern' : 'Foto hinzufügen') + '</button>';
    if (canPhoto && m.photoV) a += '<button class="btn small" data-act="photoDel" data-id="' + esc(m.id) + '">Foto entfernen</button>';
    if (admin) a += '<button class="btn small" data-act="memEdit" data-id="' + esc(m.id) + '">Bearbeiten</button><button class="btn small" data-act="invite" data-id="' + esc(m.id) + '">Einladungslink</button><button class="btn small" data-act="revoke" data-id="' + esc(m.id) + '">Geräte abmelden</button>' + (m.pw ? '<button class="btn small" data-act="pwReset" data-id="' + esc(m.id) + '">Passwort zurücksetzen</button>' : '') + (mine ? '' : '<button class="btn small danger" data-act="memDelete" data-id="' + esc(m.id) + '">Löschen</button>');
    return '<article class="card"><div class="top"><div class="who">' + avatar(m, 'lg') + '<div><h3>' + esc(m.name) + (mine ? ' (du)' : '') + '</h3><div class="meta">' + (m.email ? '<span>' + esc(m.email) + '</span>' : (admin || mine ? '<span>Keine E-Mail hinterlegt</span>' : '')) + '</div></div></div><span class="chip">' + L.roleLabel(m.role) + '</span></div>' + (a ? '<div class="actions">' + a + '</div>' : '') + '</article>';
  }).join('');
  if (admin) h += '<div class="actions"><button class="btn primary small" data-act="memNew">+ Mitglied</button></div>';
  else h += '<p class="note">Mitglieder, Rollen, E-Mail-Adressen, Einladungen und Passwort-Resets verwaltet nur der Admin.</p>';
  h += '</section>';
  const pen = S.penalty === undefined ? 0.5 : S.penalty;
  h += '<section><div class="sec-h"><h2>Regeln</h2></div><div class="card">' +
    '<div class="field"><label for="bonus">Buchungsbonus (Faktor auf Katalogpunkte)</label><input id="bonus" type="number" min="1" max="3" step="0.1" value="' + S.bonus + '"' + (parent ? '' : ' disabled') + '></div>' + (parent ? '<div class="actions"><button class="btn small" data-act="bonusSave">Bonus speichern</button></div>' : '') +
    '<div class="field"><label for="penalty">Strafpunkte für Verpasstes (Faktor, 0 = aus)</label><input id="penalty" type="number" min="0" max="2" step="0.1" value="' + pen + '"' + (parent ? '' : ' disabled') + '></div>' + (parent ? '<div class="actions"><button class="btn small" data-act="penaltySave">Strafpunkte speichern</button></div>' : '') +
    '<p class="note">Eltern weisen zu und pflegen den Katalog. Kinder buchen, erledigen und übertragen eigene Aufgaben. Nach „Erledigt“ bleiben 2 Minuten zum Rückgängigmachen.</p></div></section>';
  const mm = L.memberById(me);
  h += '<section><div class="sec-h"><h2>Passwort</h2></div><div class="card">' + (mm && mm.email
    ? '<p class="note">Anmeldung per E-Mail (' + esc(mm.email) + ') und Passwort. ' + (mm.pw ? 'Ein Passwort ist gesetzt.' : 'Noch kein Passwort gesetzt.') + '</p><div class="actions"><button class="btn small" data-act="pwSet">' + (mm.pw ? 'Passwort ändern' : 'Passwort festlegen') + '</button></div>'
    : '<p class="note">Für die Anmeldung per Passwort braucht dein Konto eine E-Mail-Adresse. Ein Elternteil trägt sie bei dir ein.</p>') + '</div></section>';
  h += '<section><div class="sec-h"><h2>Dieses Gerät</h2></div><div class="card"><div class="actions"><button class="btn small danger" data-act="logout">Abmelden</button></div></div></section>';
  return h;
}

function render() {
  if (!S) return;
  const all = L.escalations().length;
  const mineLate = S.inst.filter(i => i.status === 'taken' && i.assignee === me && overdue(i) > 0).length;
  const mm = L.memberById(me);
  const tabs = [['tasks', 'Aufgaben'], ['catalog', 'Katalog'], ['points', 'Board'], ['esc', 'Eskalation'], ['family', 'Familie']];
  const keep = document.activeElement && document.activeElement.id;
  const v = { tasks: viewTasks, catalog: viewCatalog, points: viewPoints, esc: viewEscalation, family: viewFamily }[tab];
  const pts = L.pointsOf(me);
  $('app').innerHTML = '<header><div class="wrap"><div class="head"><h1>Haushaltsplaner</h1><button class="me-btn" data-tab="family" aria-label="Mein Profil">' + avatar(mm) + '<span>' + esc(mm ? mm.name : '') + '</span></button></div>' +
    '<div class="sum"><span class="pill"><b' + (pts < 0 ? ' class="neg"' : '') + '>' + pts + '</b> Punkte</span><span class="pill"><b>' + S.inst.filter(i => (i.status === 'taken' || i.status === 'review') && i.assignee === me).length + '</b> offen für mich</span>' + (mineLate ? '<span class="pill crit"><b>' + mineLate + '</b> bei mir überfällig</span>' : '') + '</div></div></header>' +
    '<main class="wrap">' + v() + '</main>' +
    '<nav><div class="tabs">' + tabs.map(t => '<button data-tab="' + t[0] + '"' + (tab === t[0] ? ' aria-current="page"' : '') + '>' + t[1] + (t[0] === 'esc' && all ? '<span class="badge">' + all + '</span>' : '') + '</button>').join('') + '</div></nav>';
  if (keep === 'fq') { const f = $('fq'); if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); } }
  hydratePhotos();
}

function catForm(c) {
  c = c || { name: '', cat: '', room: '', interval: 7, min: 15, pts: '' };
  const r = c.resp && c.resp.mode === 'each' ? c.resp.who : 'pool', sel = (c.resp && c.resp.ids) || [];
  const cats = [...new Set(S.catalog.filter(x => !x.oneoff).map(x => x.cat))].sort();
  const advOpen = (c.dates && c.dates.length) || r !== 'pool' || (c.weekday !== null && c.weekday !== undefined) || c.check || (c.items && c.items.length);
  return '<div class="field"><label for="f_name">Name der Tätigkeit</label><input id="f_name" name="name" required maxlength="80" value="' + esc(c.name) + '"></div>' +
    '<div class="grid2"><div class="field"><label for="f_cat">Kategorie</label><input id="f_cat" name="cat" list="catlist" maxlength="40" value="' + esc(c.cat) + '"><datalist id="catlist">' + cats.map(x => '<option value="' + esc(x) + '">').join('') + '</datalist></div>' +
    '<div class="field"><label for="f_room">Raum</label><input id="f_room" name="room" maxlength="40" value="' + esc(c.room) + '"></div></div>' +
    '<div class="grid2"><div class="field"><label for="f_int">Intervall in Tagen</label><input id="f_int" name="interval" type="number" min="0" value="' + c.interval + '"><span class="hint">0 = nur manuell. 1 täglich, 7 wöchentlich, 30 monatlich.</span></div>' +
    '<div class="field"><label for="f_min">Aufwand in Minuten</label><input id="f_min" name="min" type="number" min="1" value="' + c.min + '"></div></div>' +
    '<p class="hint">Punkte entstehen immer aus dem Aufwand: 5 Minuten = 1 Punkt (mindestens 1). Selbst gebucht gibt Bonus.</p>' +
    '<details class="adv"' + (advOpen ? ' open' : '') + '><summary>Erweitert: Verantwortung, feste Termine, Check</summary>' +
    '<div class="field"><label for="f_resp">Verantwortung</label><select id="f_resp" name="resp">' + [['pool', 'Pool: wer will, bucht'], ['all', 'Jede Person einzeln: alle'], ['children', 'Jede Person einzeln: nur Kinder'], ['parents', 'Jede Person einzeln: nur Eltern'], ['custom', 'Jede Person einzeln: Auswahl']].map(o => '<option value="' + o[0] + '"' + (o[0] === r ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select>' +
    '<div class="choices">' + S.members.map(m => '<label class="check"><input type="checkbox" name="ids" value="' + esc(m.id) + '"' + (sel.includes(m.id) ? ' checked' : '') + '> ' + esc(m.name) + '</label>').join('') + '</div><span class="hint">Die Namen gelten nur bei „Auswahl“. Beim Einzelmodus bekommt jede zuständige Person ihre eigene Aufgabe, zum Beispiel Bett machen.</span></div>' +
    '<div class="field"><label for="f_wd">Fester Wochentag</label><select id="f_wd" name="weekday"><option value="">Kein fester Tag</option>' + [[1, 'Montag'], [2, 'Dienstag'], [3, 'Mittwoch'], [4, 'Donnerstag'], [5, 'Freitag'], [6, 'Samstag'], [0, 'Sonntag']].map(o => '<option value="' + o[0] + '"' + (c.weekday === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select><span class="hint">Setzt das Intervall auf wöchentlich.</span></div>' +
    '<div class="field"><label for="f_dates">Feste Termine (ein Datum pro Zeile)</label><textarea id="f_dates" name="dates" rows="4" placeholder="17.11.2026" style="background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:10px;width:100%;font:inherit;color:inherit">' + esc((c.dates || []).map(L.fmtDateFull).join('\n')) + '</textarea><span class="hint">Gilt statt Intervall und Wochentag. Die Aufgabe erscheint 3 Tage vor dem Termin im Pool und ist am Termin fällig.</span></div>' +
    '<label class="check"><input type="checkbox" name="check"' + (c.check ? ' checked' : '') + '> Punkte erst nach Bestätigung durch Eltern</label>' +
    '<div class="field"><label for="f_items">Checkliste (eine Zeile pro Punkt)</label><textarea id="f_items" name="items" rows="3" style="background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:10px;width:100%;font:inherit;color:inherit">' + esc((c.items || []).join('\n')) + '</textarea></div></details>';
}
function memForm(m) {
  m = m || { name: '', role: 'child', email: '' };
  return '<div class="field"><label for="m_n">Name</label><input id="m_n" name="name" required maxlength="40" value="' + esc(m.name) + '"></div>' +
    '<div class="field"><label for="m_e">E-Mail (optional)</label><input id="m_e" name="email" type="email" inputmode="email" autocomplete="off" value="' + esc(m.email || '') + '" placeholder="name@beispiel.de"></div>' +
    '<div class="field"><label for="m_r">Rolle</label><select id="m_r" name="role"><option value="child"' + (m.role === 'child' ? ' selected' : '') + '>Kind</option><option value="parent"' + (m.role === 'parent' ? ' selected' : '') + '>Eltern</option><option value="admin"' + (m.role === 'admin' ? ' selected' : '') + '>Admin (Eltern + Nutzerverwaltung)</option></select></div>';
}

async function copyText(text, ta) {
  try { await navigator.clipboard.writeText(text); toast('Kopiert.'); } catch (e) { if (ta) { ta.focus(); ta.select(); } toast('Bitte den markierten Text selbst kopieren.'); }
}

document.addEventListener('click', async e => {
  const tb = e.target.closest('[data-tab]'); if (tb) { tab = tb.dataset.tab; render(); window.scrollTo(0, 0); return; }
  const b = e.target.closest('[data-act]'); if (!b || !S) return;
  const a = b.dataset.act, id = b.dataset.id;
  if (b.hasAttribute('data-sheet')) closeLayer();
  if (a === 'book') act('book', { id });
  else if (a === 'complete') act('complete', { id });
  else if (a === 'release') act('release', { id });
  else if (a === 'releasePick') {
    const i = L.instById(id), c = L.catById(i.catId), w = L.memberById(i.assignee);
    modal('Buchung aufheben', '<p>„' + esc(c.name) + '“ von ' + esc(w ? w.name : '?') + ' zurück in den Pool legen?' + (overdue(i) > 0 ? ' Strafpunkte für diese Aufgabe entfallen.' : '') + '</p>', 'Buchung aufheben', () => act('release', { id }), true);
  }
  else if (a === 'approve') act('approve', { id });
  else if (a === 'more') openSheet(id);
  else if (a === 'togglePool') { ui.poolAll = !ui.poolAll; render(); }
  else if (a === 'toggleOthers') { ui.othersOpen = !ui.othersOpen; render(); }
  else if (a === 'toggleUnclaimed') { ui.unclaimedOpen = !ui.unclaimedOpen; render(); }
  else if (a === 'band') { if (ui.bands.has(id)) ui.bands.delete(id); else ui.bands.add(id); render(); }
  else if (a === 'rejectPick') {
    const i = L.instById(id), c = L.catById(i.catId);
    modal('Check nicht bestanden', '<p>„' + esc(c.name) + '“ geht an ' + esc(L.memberById(i.assignee).name) + ' zurück.</p><div class="field"><label for="r_n">Hinweis (optional)</label><input id="r_n" name="note" maxlength="120" placeholder="z. B. Boden noch nicht gesaugt"></div>', 'Zurückgeben', fd => act('reject', { id, note: fd.note }));
  } else if (a === 'instDelete') {
    const i = L.instById(id), c = L.catById(i.catId), w = i.assignee ? L.memberById(i.assignee) : null;
    modal('Aufgabe löschen', '<p>„' + esc(c.name) + '“' + (w ? ' bei ' + esc(w.name) : ' im Pool') + ' endgültig entfernen? Es werden keine Punkte vergeben, Strafpunkte dieser Aufgabe entfallen. Das Intervall der Tätigkeit startet heute neu.</p>', 'Löschen', () => act('deleteInst', { id }), true);
  } else if (a === 'assignPick') modal('Zuweisen an', '<div class="field"><label for="p_m">Person</label><select id="p_m" name="to">' + memberOptions(null) + '</select></div><p class="hint">Zugewiesene Aufgaben lassen sich nicht löschen, nur übertragen. Löschen können nur Eltern.</p>', 'Zuweisen', fd => act('assign', { id, to: fd.to }));
  else if (a === 'assignOverduePick') modal('Alle unverteilten zuweisen', '<div class="field"><label for="p_m">Person</label><select id="p_m" name="to">' + memberOptions(null) + '</select></div><p class="hint">Alle überfälligen Aufgaben ohne Namen gehen an diese Person. Danach gelten die üblichen Strafpunkte.</p>', 'Zuweisen', fd => act('assignOverdue', { to: fd.to }));
  else if (a === 'transferPick') {
    const i = L.instById(id);
    modal('Übertragen an', '<div class="field"><label for="p_m">Person</label><select id="p_m" name="to">' + memberOptions(null, i.assignee) + '</select></div><p class="hint">Die Aufgabe gilt danach als zugewiesen, ohne Buchungsbonus.</p>', 'Übertragen', fd => act('transfer', { id, to: fd.to }));
  } else if (a === 'assignNew') {
    const free = S.catalog.filter(c => !c.archived && !L.activeInst(c.id) && !(c.resp && c.resp.mode === 'each'));
    const d = L.addDays(L.today(), 2);
    modal('Aufgabe zuweisen', '<div class="field"><label for="a_c">Tätigkeit</label><select id="a_c" name="cat">' + free.map(c => '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>').join('') + '</select></div><div class="grid2"><div class="field"><label for="a_m">Person</label><select id="a_m" name="to">' + memberOptions(null) + '</select></div><div class="field"><label for="a_d">Fällig am</label><input id="a_d" name="due" type="date" value="' + d + '" min="' + L.today() + '"></div></div>', 'Zuweisen', fd => act('assignNew', { cat: fd.cat, to: fd.to, due: fd.due }));
  } else if (a === 'catNew') modal('Eigene Tätigkeit', catForm(), 'Hinzufügen', fd => act('saveCat', { data: fd }));
  else if (a === 'catEdit') { const c = L.catById(id); modal('Tätigkeit bearbeiten', catForm(c) + '<input type="hidden" name="id" value="' + esc(c.id) + '">', 'Speichern', fd => act('saveCat', { data: fd })); }
  else if (a === 'catEnqueue') act('enqueue', { id });
  else if (a === 'catRestore') act('restoreCat', { id });
  else if (a === 'catDelete') { const c = L.catById(id); modal('Tätigkeit löschen', '<p>„' + esc(c.name) + '“ aus dem Katalog entfernen? Hat die Tätigkeit schon erledigte Aufgaben, wird sie archiviert und die Punktehistorie bleibt.</p>', 'Löschen', () => act('removeCat', { id }), true); }
  else if (a === 'memNew') modal('Neues Mitglied', memForm(), 'Hinzufügen', fd => act('saveMember', { data: fd }));
  else if (a === 'memEdit') { const m = L.memberById(id); modal('Mitglied bearbeiten', memForm(m) + '<input type="hidden" name="id" value="' + esc(m.id) + '">', 'Speichern', fd => act('saveMember', { data: fd })); }
  else if (a === 'pwSet') {
    const has = !!L.memberById(me).pw;
    modal(has ? 'Passwort ändern' : 'Passwort festlegen', (has ? '<div class="field"><label for="pw0">Aktuelles Passwort</label><input id="pw0" name="current" type="password" autocomplete="current-password" required></div>' : '') +
      '<div class="field"><label for="pw1">Neues Passwort (mindestens 10 Zeichen)</label><input id="pw1" name="password" type="password" autocomplete="new-password" minlength="10" required></div>' +
      '<div class="field"><label for="pw2">Wiederholen</label><input id="pw2" name="again" type="password" autocomplete="new-password" minlength="10" required></div><p class="hint">Eine Wortfolge ist besser als ein kurzes Passwort mit Sonderzeichen. Andere Geräte werden abgemeldet.</p>', 'Speichern', async fd => {
      if (fd.password !== fd.again) { toast('Die beiden Passwörter sind nicht gleich.', true); return { ok: false }; }
      const r = await api('/password', { method: 'POST', json: { password: fd.password, current: fd.current || '' } });
      if (r.data && r.data.state) apply(r.data);
      toast((r.data && r.data.msg) || 'Fehler.', !(r.data && r.data.ok)); return r.data || { ok: false };
    });
  } else if (a === 'pwReset') {
    const m = L.memberById(id);
    modal('Passwort zurücksetzen', '<p>Das Passwort von ' + esc(m.name) + ' wird gelöscht und alle Geräte werden abgemeldet. Danach erzeugst du einen neuen Einladungslink, mit dem die Person ein neues Passwort festlegt.</p>', 'Zurücksetzen', async () => {
      const r = await api('/resetpw', { method: 'POST', json: { memberId: id } });
      if (r.data && r.data.state) apply(r.data);
      toast((r.data && r.data.msg) || 'Fehler.', !(r.data && r.data.ok)); return r.data || { ok: false };
    }, true);
  } else if (a === 'oneoffNew') {
    modal('Ad-hoc-Aufgabe zuweisen', '<div class="field"><label for="h_n">Was ist zu tun?</label><input id="h_n" name="name" required maxlength="80" placeholder="z. B. Keller aufräumen"></div><div class="grid2"><div class="field"><label for="h_m">Zeitaufwand (Min.)</label><input id="h_m" name="min" type="number" inputmode="numeric" min="1" max="480" required value="30"></div><div class="field"><label for="h_d">Fällig am</label><input id="h_d" name="due" type="date" value="' + L.addDays(L.today(), 2) + '" min="' + L.today() + '"></div></div><div class="field"><label for="h_w">Zuweisen an</label><select id="h_w" name="to">' + memberOptions(null) + '</select></div><p class="hint">Einmalige Aufgabe, nicht im Katalog. Punkte: 5 Minuten = 1 Punkt. Zugewiesene Aufgaben lassen sich nur übertragen, nicht ablehnen.</p>', 'Zuweisen', fd => act('assignOneoff', fd));
  }
  else if (a === 'memDelete') { const m = L.memberById(id); modal('Mitglied löschen', '<p>' + esc(m.name) + ' endgültig entfernen? Konto, Punkte, Verlauf, Foto und alle angemeldeten Geräte werden gelöscht. Offene gebuchte oder zugewiesene Aufgaben gehen ohne Strafpunkte zurück in den Pool. Das lässt sich nicht rückgängig machen.</p>', 'Endgültig löschen', () => act('removeMember', { id }), true); }
  else if (a === 'bonusSave') act('setBonus', { value: $('bonus').value });
  else if (a === 'penaltySave') act('setPenalty', { value: $('penalty').value });
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
document.addEventListener('visibilitychange', () => { if (!document.hidden && S && token) silentRefresh(); });
// Stand regelmäßig nachladen, solange die Seite offen ist und niemand tippt oder einen Dialog offen hat.
setInterval(() => {
  if (document.hidden || !S || !token || $('layer').innerHTML) return;
  const ae = document.activeElement;
  if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return;
  silentRefresh();
}, 45000);

boot();
