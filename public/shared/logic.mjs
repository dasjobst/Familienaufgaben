// Gemeinsame Fachlogik. Läuft auf dem Server (maßgeblich) und im Browser (nur lesende Helfer).
// Alle Zustandsänderungen sind synchron und arbeiten auf dem Modulzustand S, den der Aufrufer per setState setzt.

const DAY = 864e5;
let NOW = null;
let S = null;

const berlin = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' });
export function setNow(d) { NOW = d || null; }
export function today() { return NOW || berlin.format(new Date()); }
export function ptsFromMin(min) { return Math.max(1, Math.round((Number(min) || 0) / 5)); }
export function setState(s) {
  S = s;
  if (S && S.catalog) S.catalog.forEach(c => { c.pts = ptsFromMin(c.min); });
  // Bestand ohne Admin: der erste Eltern-Account (Einrichter) wird Admin.
  if (S && S.members && S.members.length && !S.members.some(m => m.role === 'admin')) { const f = S.members.find(m => m.role === 'parent'); if (f) f.role = 'admin'; }
}
export function getState() { return S; }

export function addDays(s, n) { const p = s.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10); }
export function diffDays(a, b) { const pa = a.split('-').map(Number), pb = b.split('-').map(Number); return Math.round((Date.UTC(pa[0], pa[1] - 1, pa[2]) - Date.UTC(pb[0], pb[1] - 1, pb[2])) / DAY); }
export function fmtDateFull(s) { const p = s.split('-'); return p[2] + '.' + p[1] + '.' + p[0]; }
export function parseDates(text) {
  const out = new Set();
  for (const raw of String(text || '').split(/[\n,;]+/)) {
    const t = raw.trim(); if (!t) continue;
    let iso = null, m;
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t))) iso = m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
    else if ((m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(t))) iso = m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
    if (!iso || !isDate(iso)) return null;
    out.add(iso);
  }
  return [...out].sort();
}
export function hasDates(c) { return !!(c && c.dates && c.dates.length); }
export function schedLabel(c) {
  if (hasDates(c)) return 'feste Termine';
  return (c.weekday !== null && c.weekday !== undefined) ? 'jeden ' + weekdayLabel(c.weekday) : freqLabel(c.interval);
}
export function catBand(c) { return hasDates(c) ? [0, 'Feste Termine'] : band(c.interval); }
export function fmtDate(s) { const p = s.split('-'); return p[2] + '.' + p[1] + '.'; }
export function isDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s; }
export function dueText(due) { const d = diffDays(due, today()); if (d < 0) return (-d) + (d === -1 ? ' Tag' : ' Tage') + ' überfällig'; if (d === 0) return 'heute fällig'; if (d === 1) return 'morgen fällig'; return 'fällig in ' + d + ' Tagen'; }
export function freqLabel(n) {
  if (!n) return 'nur manuell'; if (n === 1) return 'täglich'; if (n === 7) return 'wöchentlich'; if (n === 14) return 'alle 2 Wochen';
  if (n === 30) return 'monatlich'; if (n === 90) return 'vierteljährlich'; if (n === 180) return 'halbjährlich'; if (n === 365) return 'jährlich';
  if (n % 7 === 0 && n <= 56) return 'alle ' + (n / 7) + ' Wochen'; return 'alle ' + n + ' Tage';
}
export function band(n) {
  if (!n) return [99, 'Nur nach Bedarf']; if (n === 1) return [1, 'Täglich']; if (n < 7) return [2, 'Mehrmals pro Woche'];
  if (n < 14) return [3, 'Wöchentlich']; if (n < 30) return [4, 'Alle 2 Wochen']; if (n < 90) return [5, 'Monatlich'];
  if (n < 180) return [6, 'Vierteljährlich']; if (n < 365) return [7, 'Halbjährlich']; return [8, 'Jährlich'];
}

const SEED_CATALOG = [
  ['Spülmaschine ausräumen', 'Küche', 'Küche', 1, 10],
  ['Küche abwischen', 'Küche', 'Küche', 1, 10],
  ['Müll rausbringen', 'Müll & Entsorgung', 'Küche', 3, 5],
  ['Wäsche waschen', 'Wäsche', 'Hauswirtschaftsraum', 3, 15],
  ['Wäsche zusammenlegen und einräumen', 'Wäsche', 'Schlafzimmer', 3, 20],
  ['Boden in Küche und Flur saugen', 'Böden', 'Flur', 3, 15],
  ['Bad kurz abwischen', 'Bad & WC', 'Bad', 3, 10],
  ['Alle Böden saugen und wischen', 'Böden', 'Wohnbereich', 7, 40],
  ['Bad und WC gründlich reinigen', 'Bad & WC', 'Bad', 7, 35],
  ['Staub wischen', 'Wohnräume', 'Wohnzimmer', 7, 25],
  ['Altglas und Papier entsorgen', 'Müll & Entsorgung', 'Keller', 7, 10],
  ['Wocheneinkauf', 'Einkauf & Vorräte', 'Unterwegs', 7, 60],
  ['Kühlschrank durchsehen', 'Küche', 'Küche', 7, 10],
  ['Betten beziehen', 'Wäsche', 'Schlafzimmer', 14, 20],
  ['Spiegel und Glasflächen putzen', 'Wohnräume', 'Bad', 14, 15],
  ['Spülmaschinen-Filter reinigen', 'Küche', 'Küche', 14, 10],
  ['Kühlschrank auswischen', 'Küche', 'Küche', 30, 20],
  ['Backofen und Mikrowelle reinigen', 'Küche', 'Küche', 30, 30],
  ['Waschmaschine reinigen', 'Wäsche', 'Hauswirtschaftsraum', 30, 15],
  ['Rauchmelder testen', 'Technik & Sicherheit', 'Flur', 30, 5],
  ['Polstermöbel absaugen', 'Wohnräume', 'Wohnzimmer', 30, 15],
  ['Fenster putzen', 'Wohnräume', 'Wohnbereich', 90, 90],
  ['Dunstabzugshaube reinigen', 'Küche', 'Küche', 90, 25],
  ['Kaffeemaschine und Wasserkocher entkalken', 'Küche', 'Küche', 90, 15],
  ['Matratzen absaugen und wenden', 'Wohnräume', 'Schlafzimmer', 90, 20],
  ['Gardinen waschen', 'Wäsche', 'Wohnbereich', 180, 40],
  ['Heizkörper entlüften', 'Technik & Sicherheit', 'Wohnbereich', 180, 20],
  ['Kleiderschränke ausmisten', 'Wohnräume', 'Schlafzimmer', 180, 60],
  ['Dachrinnen reinigen', 'Garten & Außen', 'Außen', 365, 60],
  ['Keller und Garage ausmisten', 'Müll & Entsorgung', 'Keller', 365, 120],
  ['Gartengeräte warten', 'Garten & Außen', 'Garten', 365, 45],
  ['Versicherungen und Verträge prüfen', 'Verwaltung', 'Büro', 365, 60],
  ['Zählerstände ablesen', 'Verwaltung', 'Keller', 365, 10],
  ['Bett machen', 'Wohnräume', 'Schlafzimmer', 1, 5, { resp: { mode: 'each', who: 'all', ids: [] } }],
  ['Freitagabend-Check: Zimmer aufgeräumt und gesaugt', 'Wohnräume', 'Kinderzimmer', 7, 30, { resp: { mode: 'each', who: 'children', ids: [] }, weekday: 5, check: true, items: ['Zimmer aufgeräumt', 'Zimmer gesaugt'] }]
];

function uid(p) { S.seq++; return p + S.seq; }
export function catById(id) { return S.catalog.find(c => c.id === id); }
export function memberById(id) { return S.members.find(m => m.id === id); }
export function instById(id) { return S.inst.find(i => i.id === id); }
export function isParent(id) { const m = memberById(id); return !!m && (m.role === 'parent' || m.role === 'admin'); }
export function isAdmin(id) { const m = memberById(id); return !!m && m.role === 'admin'; }
export function roleLabel(r) { return r === 'admin' ? 'Admin' : r === 'parent' ? 'Eltern' : 'Kind'; }
export function activeInst(catId) { return S.inst.find(i => i.catId === catId && i.status !== 'done'); }
export function lastDone(catId) { let l = null; S.inst.forEach(i => { if (i.catId === catId && i.status === 'done' && (!l || i.doneAt > l)) l = i.doneAt; }); return l; }
export function pointsOf(memberId) { return ((S.carry && S.carry[memberId]) || 0) + S.ledger.filter(l => l.member === memberId).reduce((a, l) => a + l.delta, 0); }
export function periodStart(period) {
  const t = today();
  if (period === 'month') return t.slice(0, 8) + '01';
  if (period === 'week') { const wd = (new Date(t + 'T00:00:00Z').getUTCDay() + 6) % 7; return addDays(t, -wd); }
  return '0000-00-00';
}
function streakOf(memberId) {
  const days = new Set(S.ledger.filter(l => l.member === memberId && l.delta > 0 && l.kind !== 'missed').map(l => l.date));
  let d = days.has(today()) ? today() : addDays(today(), -1), n = 0;
  while (days.has(d)) { n++; d = addDays(d, -1); }
  return { n, today: days.has(today()) };
}
const wdIdx = d => (new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7;
function entryCat(l) {
  if (l.cat) return l.cat;
  const c = S.catalog.find(x => l.text.indexOf(x.name) === 0);
  return c ? c.cat : 'Sonstiges';
}
export function stats(period) {
  const from = periodStart(period), t = today();
  const done = S.ledger.filter(l => l.delta > 0 && l.kind !== 'missed' && l.date >= from && l.date <= t);
  const miss = S.ledger.filter(l => l.kind === 'missed' && l.date >= from && l.date <= t);
  // Zeitleiste: Woche = Mo bis So, Monat = Tage des Monats bis heute, Gesamt = letzte 12 Wochen
  const buckets = [];
  if (period === 'week') for (let k = 0; k < 7; k++) { const d = addDays(from, k); buckets.push({ from: d, to: d, label: ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'][k], future: d > t }); }
  else if (period === 'month') { for (let d = from; d <= t; d = addDays(d, 1)) buckets.push({ from: d, to: d, label: String(Number(d.slice(8))) }); }
  else { const w0 = periodStart('week'); for (let k = 11; k >= 0; k--) { const f = addDays(w0, -7 * k); buckets.push({ from: f, to: addDays(f, 6), label: fmtDate(f).slice(0, 5) }); } }
  const days = buckets.map(b => { const by = {}; let sum = 0; done.forEach(l => { if (l.date >= b.from && l.date <= b.to) { by[l.member] = (by[l.member] || 0) + l.delta; sum += l.delta; } }); return { ...b, by, sum }; });
  const cats = {}; done.forEach(l => { const c = entryCat(l); (cats[c] = cats[c] || { name: c, pts: 0, n: 0 }); cats[c].pts += l.delta; cats[c].n++; });
  const catList = Object.values(cats).sort((a, b) => b.pts - a.pts);
  const wd = [0, 0, 0, 0, 0, 0, 0]; done.forEach(l => { wd[wdIdx(l.date)] += l.delta; });
  const pts = done.reduce((a, l) => a + l.delta, 0), min = done.reduce((a, l) => a + (l.min || 0), 0), missed = miss.reduce((a, l) => a + (l.n || 1), 0);
  return { from, days, cats: catList, wd, kpi: { n: done.length, pts, min, missed, quote: done.length + missed ? Math.round(done.length / (done.length + missed) * 100) : null } };
}
export function leaderboard(period) {
  const from = periodStart(period);
  const rows = S.members.map(m => {
    let pts = 0, n = 0, lost = 0;
    S.ledger.forEach(l => {
      if (l.member !== m.id || l.date < from) return;
      if (l.kind === 'missed') lost += -l.delta; else if (l.delta > 0) { pts += l.delta; n++; }
    });
    return { m, pts, n, lost, total: pointsOf(m.id), streak: streakOf(m.id) };
  }).sort((a, b) => b.pts - a.pts || b.n - a.n || a.m.name.localeCompare(b.m.name, 'de'));
  let rank = 0, prev = null;
  rows.forEach((r, i) => { if (prev === null || r.pts !== prev) rank = i + 1; r.rank = r.pts > 0 ? rank : 0; prev = r.pts; });
  return rows;
}
export function pointsFor(inst) { const c = catById(inst.catId); const base = c ? c.pts : 0; return inst.mode === 'booked' ? Math.round(base * S.bonus) : base; }
function err(msg) { return { ok: false, msg }; }
function ok(msg, extra) { return Object.assign({ ok: true, msg: msg || '' }, extra || {}); }
function str(v, max) { return String(v == null ? '' : v).trim().slice(0, max); }

// Neue Familie: ein Elternteil, Standardkatalog mit gestaffelter Vorgeschichte.
export function createState(ownerName, ownerEmail) {
  S = { v: 2, seq: 0, bonus: 1.5, penalty: 0.5, members: [], catalog: [], inst: [], ledger: [] };
  const owner = { id: uid('m'), name: str(ownerName, 40), role: 'admin', email: str(ownerEmail, 120).toLowerCase() };
  S.members.push(owner);
  SEED_CATALOG.forEach((r, i) => {
    const c = { id: uid('c'), name: r[0], cat: r[1], room: r[2], interval: r[3], min: r[4], pts: Math.max(1, Math.round(r[4] / 5)), origin: 'standard', archived: false };
    Object.assign(c, r[5] || {});
    S.catalog.push(c);
    if (c.resp && c.resp.mode === 'each') return;
    const off = (i * 5) % (c.interval + 3);
    S.inst.push({ id: uid('i'), catId: c.id, status: 'done', assignee: owner.id, mode: 'booked', due: addDays(today(), -off), doneAt: addDays(today(), -off), points: 0, seed: true, log: [] });
  });
  refreshPool();
  return S;
}

function laterOf(a, b) { return !a ? (b || null) : !b ? a : (a > b ? a : b); }
const HORIZON = 3;
function weekdayOf(s) { const p = s.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay(); }
function nextWeekday(from, wd) { let d = from; for (let k = 0; k < 7; k++) { if (weekdayOf(d) === wd) return d; d = addDays(d, 1); } return from; }
function lastDoneInst(catId, memberId) {
  let l = null;
  S.inst.forEach(i => { if (i.catId === catId && i.status === 'done' && (!memberId || i.assignee === memberId) && (!l || i.doneAt > l.doneAt)) l = i; });
  return l;
}
// Wer ist für eine Tätigkeit je einzeln zuständig? Leer = Pool.
export function targetsOf(c) {
  const r = c.resp; if (!r || r.mode !== 'each') return [];
  return S.members.filter(m => r.who === 'all' || (r.who === 'children' && m.role === 'child') || (r.who === 'parents' && m.role !== 'child') || (r.who === 'custom' && (r.ids || []).includes(m.id)));
}
export function respLabel(c) {
  const r = c.resp; if (!r || r.mode !== 'each') return 'Pool';
  if (r.who === 'all') return 'Jede Person'; if (r.who === 'children') return 'Jedes Kind'; if (r.who === 'parents') return 'Jedes Elternteil';
  return (r.ids || []).map(id => (memberById(id) || { name: '?' }).name).join(', ') || 'Auswahl';
}
const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
export function weekdayLabel(n) { return (n === null || n === undefined) ? '' : WD[n]; }
function dueAfter(c, last, fresh) {
  if (c.weekday !== null && c.weekday !== undefined) {
    let base = last ? addDays(last.due, 1) : today();
    if (c.snooze) { const sk = addDays(nextWeekday(c.snooze, c.weekday), 1); if (sk > base) base = sk; }
    let d = nextWeekday(base, c.weekday);
    if (diffDays(d, today()) < 0) d = nextWeekday(today(), c.weekday);
    return d;
  }
  const ld = laterOf(last ? last.doneAt : null, c.snooze);
  return ld ? addDays(ld, c.interval) : fresh;
}
const UNDO_MS = 2 * 60 * 1000;
function penaltyFactor() { return (S.penalty === undefined || S.penalty === null) ? 0.5 : S.penalty; }
function penaltyAmount(i) {
  const base = pointsFor(i), f = penaltyFactor();
  return (f <= 0 || base <= 0) ? 0 : Math.max(1, Math.round(base * f));
}
function applyPenalty(i, times) {
  const amount = penaltyAmount(i) * times;
  if (times <= 0 || amount <= 0 || !i.assignee || !memberById(i.assignee)) return;
  S.ledger.push({ id: uid('l'), member: i.assignee, delta: -amount, text: 'Verpasst: ' + catById(i.catId).name + (times > 1 ? ' (' + times + '×)' : ''), date: today(), kind: 'missed', n: times, inst: i.id });
}
// Überfällige Aufgaben: einmal Strafpunkte. Kurze Intervalle (bis 3 Tage) rollen weiter und zählen jeden verpassten Termin.
function settleMissed() {
  let changed = 0;
  S.inst = S.inst.filter(i => {
    if (i.status === 'done' || i.status === 'review') return true;
    const od = diffDays(today(), i.due); if (od < 1) return true;
    const c = catById(i.catId); if (!c) return true;
    const roll = c.interval >= 1 && c.interval <= 3 && (c.weekday === null || c.weekday === undefined);
    if (roll && od >= c.interval) {
      applyPenalty(i, Math.min(14, Math.floor(od / c.interval)) - (i.penalized ? 1 : 0));
      changed++; return false;
    }
    if (!i.penalized && i.assignee) { applyPenalty(i, 1); i.penalized = true; changed++; }
    return true;
  });
  return changed;
}
export function missedStats(memberId, days) {
  let n = 0, pts = 0;
  S.ledger.forEach(l => { if (l.kind === 'missed' && l.member === memberId && diffDays(today(), l.date) <= (days || 30)) { n += l.n || 1; pts += -l.delta; } });
  return { n, pts };
}

const MUELL = [
  { name: 'Rest- und Biomüll rausbringen', min: 10, dates: ['2026-11-03', '2026-11-17', '2026-12-01', '2026-12-15', '2026-12-29'] },
  { name: 'Gelben Sack rausbringen', min: 5, dates: ['2026-11-05', '2026-12-03', '2026-12-31'] },
  { name: 'Papiertonne rausbringen', min: 5, dates: ['2026-11-24', '2026-12-21'] }
];
function migrate() {
  S.mig = S.mig || {};
  if (S.mig.muell1) return 0;
  S.mig.muell1 = true;
  S.catalog.filter(c => !c.oneoff && c.name.trim().toLowerCase() === 'müll rausbringen').forEach(c => {
    const gone = new Set(S.inst.filter(i => i.catId === c.id && i.status !== 'done').map(i => i.id));
    S.ledger = S.ledger.filter(l => !(l.kind === 'missed' && gone.has(l.inst)));
    S.inst = S.inst.filter(i => !gone.has(i.id));
    const hasHistory = S.inst.some(i => i.catId === c.id && i.status === 'done' && !i.seed) || S.ledger.some(l => l.text.indexOf(c.name) !== -1);
    if (hasHistory) c.archived = true; else { S.catalog = S.catalog.filter(x => x.id !== c.id); S.inst = S.inst.filter(i => i.catId !== c.id); }
  });
  MUELL.forEach(m => {
    if (S.catalog.some(c => c.name === m.name && !c.archived)) return;
    S.catalog.push({ id: uid('c'), name: m.name, cat: 'Müll & Entsorgung', room: 'Draußen', interval: 0, min: m.min, pts: ptsFromMin(m.min), origin: 'standard', archived: false, resp: { mode: 'pool' }, weekday: null, check: false, items: [], dates: m.dates.slice() });
  });
  return 1;
}
export function refreshPool() {
  let n = migrate() + settleMissed();
  S.catalog.forEach(c => {
    if (c.archived || !hasDates(c)) return;
    c.dates.forEach(d => {
      const k = diffDays(d, today());
      if (k < 0 || k > HORIZON) return;
      if ((c.skip || []).includes(d) || S.inst.some(i => i.catId === c.id && i.fixed === d)) return;
      S.inst.push({ id: uid('i'), catId: c.id, status: 'open', assignee: null, mode: null, due: d, fixed: d, log: [] });
      n++;
    });
  });
  S.catalog.forEach(c => {
    if (c.archived || !c.interval || hasDates(c)) return;
    const each = !!(c.resp && c.resp.mode === 'each');
    (each ? targetsOf(c) : [null]).forEach(m => {
      const mid = m ? m.id : null;
      if (S.inst.some(i => i.catId === c.id && i.status !== 'done' && (!each || i.assignee === mid))) return;
      const due = dueAfter(c, lastDoneInst(c.id, mid), each ? today() : addDays(today(), c.interval));
      if (diffDays(due, today()) > HORIZON) return;
      const d = diffDays(due, today()) < 0 ? today() : due;
      if (each) S.inst.push({ id: uid('i'), catId: c.id, status: 'taken', assignee: mid, mode: 'assigned', due: d, log: ['Automatisch zugewiesen'] });
      else S.inst.push({ id: uid('i'), catId: c.id, status: 'open', assignee: null, mode: null, due: d, log: [] });
      n++;
    });
  });
  // Altlast begrenzen: je Tätigkeit und Person bleibt die letzte erledigte Aufgabe, ältere erledigte nach 120 Tagen weg.
  const best = {};
  S.inst.forEach(i => { if (i.status !== 'done') return; const k = i.catId + '|' + i.assignee; if (!best[k] || i.doneAt > best[k].doneAt) best[k] = i; });
  const keep = new Set(Object.values(best).map(i => i.id));
  const before = S.inst.length;
  S.inst = S.inst.filter(i => i.status !== 'done' || keep.has(i.id) || diffDays(today(), i.doneAt) <= 120);
  S.catalog = S.catalog.filter(c => !c.oneoff || S.inst.some(i => i.catId === c.id));
  if (S.ledger.length > 500) {
    const drop = S.ledger.slice(0, S.ledger.length - 500); S.carry = S.carry || {};
    drop.forEach(l => { S.carry[l.member] = (S.carry[l.member] || 0) + l.delta; });
    S.ledger = S.ledger.slice(-500);
  }
  return n + (before - S.inst.length);
}

export function book(instId, by) {
  const i = instById(instId); if (!i) return err('Aufgabe nicht gefunden.');
  if (!memberById(by)) return err('Person nicht gefunden.');
  if (i.status !== 'open') return err('Diese Aufgabe ist schon vergeben.');
  i.status = 'taken'; i.assignee = by; i.mode = 'booked'; i.log.push('Selbst gebucht von ' + memberById(by).name);
  // Nach dem Buchen bleibt mindestens ein Tag Zeit, auch wenn die Aufgabe im Pool schon überfällig war.
  const minDue = addDays(today(), 1); if (i.due < minDue) i.due = minDue;
  return ok('Gebucht: ' + pointsFor(i) + ' Punkte bei Erledigung, ' + dueText(i.due) + '.');
}
export function assignInst(instId, toId, by) {
  if (!isParent(by)) return err('Nur Eltern dürfen zuweisen.');
  const i = instById(instId); if (!i) return err('Aufgabe nicht gefunden.');
  if (!memberById(toId)) return err('Person nicht gefunden.');
  if (i.status !== 'open') return err('Diese Aufgabe ist schon vergeben. Du kannst sie übertragen.');
  i.status = 'taken'; i.assignee = toId; i.mode = 'assigned'; i.log.push('Zugewiesen von ' + memberById(by).name + ' an ' + memberById(toId).name);
  return ok('Zugewiesen an ' + memberById(toId).name + '.');
}
export function assignNew(catId, toId, due, by) {
  if (!isParent(by)) return err('Nur Eltern dürfen zuweisen.');
  const c = catById(catId); if (!c) return err('Tätigkeit nicht gefunden.');
  if (!memberById(toId)) return err('Person nicht gefunden.');
  if (due && !isDate(due)) return err('Das Datum ist ungültig.');
  if (c.resp && c.resp.mode === 'each') return err('Diese Tätigkeit wird automatisch an jede zuständige Person vergeben.');
  if (activeInst(catId)) return err('Diese Tätigkeit läuft bereits. Übertrage die bestehende Aufgabe.');
  S.inst.push({ id: uid('i'), catId, status: 'taken', assignee: toId, mode: 'assigned', due: due || addDays(today(), 2), log: ['Zugewiesen von ' + memberById(by).name + ' an ' + memberById(toId).name] });
  return ok('Zugewiesen an ' + memberById(toId).name + '.');
}
export function enqueue(catId, by) {
  if (!isParent(by)) return err('Nur Eltern dürfen Aufgaben in den Pool stellen.');
  const c = catById(catId); if (!c) return err('Tätigkeit nicht gefunden.');
  if (c.resp && c.resp.mode === 'each') return err('Diese Tätigkeit wird automatisch an jede zuständige Person vergeben.');
  if (hasDates(c)) return err('Diese Tätigkeit hat feste Termine und wird automatisch rechtzeitig in den Pool gestellt.');
  if (activeInst(catId)) return err('Diese Tätigkeit läuft bereits.');
  S.inst.push({ id: uid('i'), catId, status: 'open', assignee: null, mode: null, due: addDays(today(), 2), log: [] });
  return ok('In den Pool gestellt.');
}
export function transfer(instId, toId, by) {
  const i = instById(instId); if (!i) return err('Aufgabe nicht gefunden.');
  if (i.status !== 'taken') return err('Nur vergebene Aufgaben lassen sich übertragen.');
  if (!(by === i.assignee || isParent(by))) return err('Nur die zuständige Person oder Eltern dürfen übertragen.');
  if (!memberById(toId)) return err('Person nicht gefunden.');
  if (toId === i.assignee) return err('Die Person ist schon zuständig.');
  const wasBooked = i.mode === 'booked';
  const from = memberById(i.assignee).name;
  i.assignee = toId; i.mode = 'assigned';
  i.log.push('Übertragen von ' + from + ' an ' + memberById(toId).name + ' durch ' + memberById(by).name);
  return ok('Übertragen an ' + memberById(toId).name + (wasBooked ? ' (gilt dort als zugewiesen, ohne Buchungsbonus).' : '.'));
}
export function release(instId, by) {
  const i = instById(instId); if (!i) return err('Aufgabe nicht gefunden.');
  if (i.status !== 'taken' || i.mode !== 'booked') return err('Nur selbst gebuchte Aufgaben lassen sich aufheben. Zugewiesene werden übertragen.');
  const self = by === i.assignee, was = memberById(i.assignee), who = memberById(by);
  if (!self && !isParent(by)) return err('Nur die Person selbst oder Eltern dürfen eine Buchung aufheben.');
  let refund = 0;
  if (!self) {
    // Entscheidung der Eltern: Strafpunkte dieser Buchung entfallen
    S.ledger = S.ledger.filter(l => { if (l.kind === 'missed' && l.inst === i.id) { refund += -l.delta; return false; } return true; });
    i.penalized = false;
  }
  i.status = 'open'; i.assignee = null; i.mode = null;
  i.log.push(self ? 'Zurück in den Pool' : 'Buchung von ' + (was ? was.name : '?') + ' aufgehoben von ' + (who ? who.name : '?'));
  return ok(self ? 'Zurück im Pool.' : 'Buchung von ' + (was ? was.name : '?') + ' aufgehoben, die Aufgabe liegt wieder im Pool' + (refund ? ' (Strafpunkte entfallen)' : '') + '.');
}
function finish(i) {
  const pts = pointsFor(i), prev = i.status, before = new Set(S.inst.map(x => x.id));
  i.status = 'done'; i.doneAt = today(); i.points = pts; i.log.push('Erledigt');
  const lid = uid('l');
  S.ledger.push({ id: lid, member: i.assignee, delta: pts, text: catById(i.catId).name + (i.mode === 'booked' ? ' (gebucht)' : ' (zugewiesen)'), date: today(), ts: Date.now(), min: catById(i.catId).min, cat: catById(i.catId).cat, inst: i.id });
  refreshPool();
  i.undo = { at: Date.now(), ledgerId: lid, prev, next: S.inst.filter(x => !before.has(x.id)).map(x => x.id) };
  return pts;
}
export function undo(instId, by) {
  const i = instById(instId);
  if (!i || i.status !== 'done' || !i.undo) return err('Das lässt sich nicht mehr rückgängig machen.');
  if (!(by === i.assignee || isParent(by))) return err('Nur die zuständige Person oder Eltern dürfen das rückgängig machen.');
  if (Date.now() - i.undo.at > UNDO_MS) return err('Die Frist zum Rückgängigmachen (2 Minuten) ist abgelaufen.');
  S.ledger = S.ledger.filter(l => l.id !== i.undo.ledgerId);
  const drop = new Set(i.undo.next || []);
  S.inst = S.inst.filter(x => !(drop.has(x.id) && x.status !== 'done' && x.log.length <= 1));
  i.status = i.undo.prev; delete i.doneAt; delete i.points; i.log.push('Rückgängig gemacht'); delete i.undo;
  return ok('Rückgängig gemacht.');
}
export function complete(instId, by) {
  const i = instById(instId); if (!i) return err('Aufgabe nicht gefunden.');
  if (i.status !== 'taken') return err('Diese Aufgabe ist nicht vergeben.');
  if (!(by === i.assignee || isParent(by))) return err('Nur die zuständige Person oder Eltern dürfen abschließen.');
  const c = catById(i.catId);
  if (c.check && !isParent(by)) {
    i.status = 'review'; i.reportedAt = today(); i.log.push('Fertig gemeldet');
    return ok('Gemeldet. Jetzt prüft ein Elternteil.', { review: true });
  }
  const pts = finish(i);
  return ok('+' + pts + ' Punkte für ' + memberById(i.assignee).name + '.', { pts, undo: i.id });
}
export function approve(instId, by) {
  if (!isParent(by)) return err('Nur Eltern dürfen den Check bestätigen.');
  const i = instById(instId); if (!i) return err('Aufgabe nicht gefunden.');
  if (i.status !== 'review') return err('Diese Aufgabe wartet nicht auf einen Check.');
  const pts = finish(i);
  return ok('Check bestanden: +' + pts + ' Punkte für ' + memberById(i.assignee).name + '.', { pts, undo: i.id });
}
export function reject(instId, note, by) {
  if (!isParent(by)) return err('Nur Eltern dürfen den Check ablehnen.');
  const i = instById(instId); if (!i) return err('Aufgabe nicht gefunden.');
  if (i.status !== 'review') return err('Diese Aufgabe wartet nicht auf einen Check.');
  i.status = 'taken'; delete i.reportedAt; i.log.push('Check nicht bestanden' + (str(note, 120) ? ': ' + str(note, 120) : ''));
  return ok('Zurück an ' + memberById(i.assignee).name + '.');
}
// Nur Eltern: nicht erledigte Aufgabe verwerfen. Das Intervall der Tätigkeit startet ab heute neu,
// damit der Pool die Aufgabe nicht sofort wieder anlegt.
export function deleteInst(instId, by) {
  if (!isParent(by)) return err('Nur Eltern dürfen Aufgaben löschen.');
  const i = instById(instId); if (!i) return err('Aufgabe nicht gefunden.');
  if (i.status === 'done') return err('Erledigte Aufgaben bleiben erhalten, sie stehen in der Punktehistorie.');
  const c = catById(i.catId);
  const refunded = S.ledger.some(l => l.kind === 'missed' && l.inst === instId);
  S.ledger = S.ledger.filter(l => !(l.kind === 'missed' && l.inst === instId));
  S.inst = S.inst.filter(x => x.id !== instId);
  if (c && c.oneoff) S.catalog = S.catalog.filter(x => x.id !== c.id);
  else if (c) { c.snooze = today(); if (i.fixed) (c.skip = c.skip || []).push(i.fixed); }
  return ok('Aufgabe gelöscht' + (refunded ? ', Strafpunkte entfallen' : '') + (c && c.interval ? '. Das Intervall startet heute neu.' : '.'));
}
export function escalations() {
  return S.inst.filter(i => i.status !== 'done' && i.status !== 'review' && diffDays(i.due, today()) < 0)
    .sort((a, b) => a.due < b.due ? -1 : a.due > b.due ? 1 : 0);
}
export function saveCat(data, by) {
  if (!isParent(by)) return err('Nur Eltern dürfen den Katalog ändern.');
  data = data || {};
  const name = str(data.name, 80); if (!name) return err('Bitte einen Namen eingeben.');
  const interval = Math.min(3650, Math.max(0, Math.round(Number(data.interval) || 0)));
  const min = Math.min(1440, Math.max(1, Math.round(Number(data.min) || 0) || 1));
  const pts = ptsFromMin(min);
  const cat = str(data.cat, 40) || 'Sonstiges', room = str(data.room, 40);
  const respMode = ['pool', 'all', 'children', 'parents', 'custom'].includes(data.resp) ? data.resp : 'pool';
  const ids = [].concat(data.ids || []).filter(id => memberById(id)).slice(0, 20);
  if (respMode === 'custom' && !ids.length) return err('Bitte mindestens eine Person auswählen.');
  const resp = respMode === 'pool' ? { mode: 'pool' } : { mode: 'each', who: respMode, ids: respMode === 'custom' ? ids : [] };
  let weekday = (data.weekday === '' || data.weekday == null) ? null : Number(data.weekday);
  if (weekday !== null && !(Number.isInteger(weekday) && weekday >= 0 && weekday <= 6)) weekday = null;
  const check = data.check === 'on' || data.check === true;
  const items = String(data.items || '').split('\n').map(x => x.trim().slice(0, 60)).filter(Boolean).slice(0, 10);
  const dates = parseDates(data.dates);
  if (dates === null) return err('Ein Termin ist ungültig. Bitte je Zeile ein Datum wie 17.11.2026 eintragen.');
  if (dates.length > 150) return err('Höchstens 150 Termine.');
  const clash = S.catalog.find(c => c.name.toLowerCase() === name.toLowerCase() && c.id !== data.id && !c.archived);
  if (clash) return err('Es gibt schon eine Tätigkeit mit diesem Namen.');
  if (data.id) {
    const c = catById(data.id); if (!c) return err('Tätigkeit nicht gefunden.');
    const fx = dates.length > 0;
    Object.assign(c, { name, cat, room, interval: fx ? 0 : (weekday !== null ? 7 : interval), min, pts, resp, weekday: fx ? null : weekday, check, items, dates });
    return ok('Gespeichert.');
  }
  { const fx = dates.length > 0; S.catalog.push({ id: uid('c'), name, cat, room, interval: fx ? 0 : (weekday !== null ? 7 : interval), min, pts, origin: 'familie', archived: false, resp, weekday: fx ? null : weekday, check, items, dates }); }
  return ok('Zum Katalog hinzugefügt.');
}
export function removeCat(id, by) {
  if (!isParent(by)) return err('Nur Eltern dürfen den Katalog ändern.');
  const c = catById(id); if (!c) return err('Tätigkeit nicht gefunden.');
  if (activeInst(id)) return err('Es läuft noch eine Aufgabe zu dieser Tätigkeit. Erst erledigen oder übertragen.');
  const hasHistory = S.inst.some(i => i.catId === id && i.status === 'done' && !i.seed) || S.ledger.some(l => l.text.indexOf(c.name) === 0);
  if (hasHistory) { c.archived = true; return ok('Archiviert. Die Historie bleibt erhalten.', { how: 'archived' }); }
  S.catalog = S.catalog.filter(x => x.id !== id); S.inst = S.inst.filter(i => i.catId !== id);
  return ok('Gelöscht.', { how: 'deleted' });
}
export function restoreCat(id, by) {
  if (!isParent(by)) return err('Nur Eltern dürfen den Katalog ändern.');
  const c = catById(id); if (!c) return err('Tätigkeit nicht gefunden.'); c.archived = false; return ok('Wiederhergestellt.');
}
export function isEmail(s) { return typeof s === 'string' && s.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s); }
export function saveMember(data, by) {
  if (!isAdmin(by)) return err('Mitglieder und ihre Einstellungen ändert nur der Admin.');
  data = data || {};
  const name = str(data.name, 40); if (!name) return err('Bitte einen Namen eingeben.');
  if (S.members.some(m => m.name.toLowerCase() === name.toLowerCase() && m.id !== data.id)) return err('Der Name ist schon vergeben.');
  const email = str(data.email, 120).toLowerCase();
  if (email && !isEmail(email)) return err('Diese E-Mail-Adresse ist ungültig.');
  if (email && S.members.some(m => (m.email || '') === email && m.id !== data.id)) return err('Diese E-Mail-Adresse gehört schon zu einem anderen Mitglied.');
  const role = data.role === 'admin' ? 'admin' : data.role === 'parent' ? 'parent' : 'child';
  if (data.id) {
    const m = memberById(data.id); if (!m) return err('Mitglied nicht gefunden.');
    if (m.role === 'admin' && role !== 'admin' && S.members.filter(x => x.role === 'admin').length < 2) return err('Es muss mindestens ein Admin bleiben. Ernenne zuerst jemand anderen zum Admin.');
    m.name = name; m.role = role; m.email = email; return ok('Gespeichert.');
  }
  if (S.members.length >= 20) return err('Mehr als 20 Mitglieder sind nicht vorgesehen.');
  S.members.push({ id: uid('m'), name, role, email }); return ok('Mitglied hinzugefügt.');
}
export function removeMember(id, by) {
  if (!isAdmin(by)) return err('Mitglieder löscht nur der Admin.');
  const m = memberById(id); if (!m) return err('Mitglied nicht gefunden.');
  if (id === by) return err('Du kannst dich nicht selbst löschen.');
  let back = 0;
  S.inst = S.inst.filter(i => {
    if (i.assignee !== id) return true;
    const c = catById(i.catId);
    if (i.status === 'done') return false;
    if (c && c.resp && c.resp.mode === 'each') return false;
    i.status = 'open'; i.assignee = null; i.mode = null; i.log.push('Zurück im Pool, ' + m.name + ' wurde gelöscht'); back++;
    return true;
  });
  S.ledger = S.ledger.filter(l => l.member !== id);
  if (S.carry) delete S.carry[id];
  S.catalog.forEach(c => {
    if (c.resp && c.resp.mode === 'each' && c.resp.who === 'custom') {
      c.resp.ids = (c.resp.ids || []).filter(x => x !== id);
      if (!c.resp.ids.length) c.resp = { mode: 'pool' };
    }
  });
  S.members = S.members.filter(x => x.id !== id);
  return ok(m.name + ' wurde gelöscht.' + (back ? ' ' + back + ' Aufgabe(n) liegen wieder im Pool.' : ''));
}
const berlinTime = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' });
export function stampText(l) {
  if (!l.ts) return fmtDate(l.date);
  const d = new Date(l.ts), day = berlin.format(d), t = berlinTime.format(d);
  if (day === today()) return 'heute ' + t;
  if (day === addDays(today(), -1)) return 'gestern ' + t;
  return fmtDate(day) + ' ' + t;
}
export function board(n) {
  return S.ledger.filter(l => l.delta > 0 && l.kind !== 'missed').slice(-(n || 25)).reverse();
}
export function assignOneoff(data, by) {
  if (!isParent(by)) return err('Ad-hoc-Aufgaben legen nur Eltern an.');
  data = data || {};
  const name = str(data.name, 80); if (!name) return err('Bitte beschreiben, was zu tun ist.');
  const min = Math.round(Number(data.min));
  if (!min || min < 1) return err('Bitte den Zeitaufwand in Minuten angeben.');
  if (min > 480) return err('Höchstens 480 Minuten pro Aufgabe.');
  const to = memberById(data.to); if (!to) return err('Person nicht gefunden.');
  if (data.due && !isDate(data.due)) return err('Das Datum ist ungültig.');
  if (S.catalog.filter(c => c.oneoff).length >= 200) return err('Zu viele Ad-hoc-Aufgaben auf einmal.');
  const c = { id: uid('c'), name, cat: 'Ad hoc', room: '', interval: 0, min, pts: ptsFromMin(min), origin: 'adhoc', oneoff: true, archived: true, resp: { mode: 'pool' }, weekday: null, check: false, items: [] };
  S.catalog.push(c);
  S.inst.push({ id: uid('i'), catId: c.id, status: 'taken', assignee: to.id, mode: 'assigned', due: data.due || addDays(today(), 2), log: ['Ad hoc zugewiesen von ' + memberById(by).name + ' an ' + to.name] });
  return ok('Zugewiesen an ' + to.name + ' (' + c.pts + ' Punkte).');
}
export function setPhotoMeta(memberId, by, on, stamp) {
  const m = memberById(memberId); if (!m) return err('Mitglied nicht gefunden.');
  if (!(by === memberId || isAdmin(by))) return err('Nur die Person selbst oder der Admin dürfen das Foto ändern.');
  if (on) m.photoV = stamp || Date.now(); else delete m.photoV;
  return ok(on ? 'Foto gespeichert.' : 'Foto entfernt.');
}
export function assignOverdueOpen(toId, by) {
  if (!isParent(by)) return err('Nur Eltern dürfen zuweisen.');
  if (!memberById(toId)) return err('Person nicht gefunden.');
  let n = 0;
  S.inst.forEach(i => {
    if (i.status === 'open' && diffDays(i.due, today()) < 0) { i.status = 'taken'; i.assignee = toId; i.mode = 'assigned'; i.log.push('Zugewiesen von ' + memberById(by).name + ' an ' + memberById(toId).name); n++; }
  });
  return n ? ok(n + (n === 1 ? ' Aufgabe' : ' Aufgaben') + ' an ' + memberById(toId).name + ' zugewiesen.') : err('Es gibt keine unverteilten überfälligen Aufgaben.');
}
export function setPenalty(v, by) {
  if (!isParent(by)) return err('Nur Eltern dürfen die Strafpunkte ändern.');
  const n = Number(v); if (!(n >= 0 && n <= 2)) return err('Der Faktor muss zwischen 0 und 2 liegen.');
  S.penalty = Math.round(n * 10) / 10; return ok(S.penalty === 0 ? 'Strafpunkte ausgeschaltet.' : 'Strafpunkte: ×' + S.penalty);
}
export function setBonus(v, by) {
  if (!isParent(by)) return err('Nur Eltern dürfen den Bonus ändern.');
  const n = Number(v); if (!(n >= 1 && n <= 3)) return err('Der Faktor muss zwischen 1 und 3 liegen.');
  S.bonus = Math.round(n * 10) / 10; return ok('Buchungsbonus: ×' + S.bonus);
}
