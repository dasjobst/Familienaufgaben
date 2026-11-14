// Gemeinsame Fachlogik. Läuft auf dem Server (maßgeblich) und im Browser (nur lesende Helfer).
// Alle Zustandsänderungen sind synchron und arbeiten auf dem Modulzustand S, den der Aufrufer per setState setzt.

const DAY = 864e5;
let NOW = null;
let S = null;

const berlin = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' });
export function setNow(d) { NOW = d || null; }
export function today() { return NOW || berlin.format(new Date()); }
export function setState(s) { S = s; }
export function getState() { return S; }

export function addDays(s, n) { const p = s.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10); }
export function diffDays(a, b) { const pa = a.split('-').map(Number), pb = b.split('-').map(Number); return Math.round((Date.UTC(pa[0], pa[1] - 1, pa[2]) - Date.UTC(pb[0], pb[1] - 1, pb[2])) / DAY); }
export function fmtDate(s) { const p = s.split('-'); return p[2] + '.' + p[1] + '.'; }
export function isDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s)); }
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
  ['Zählerstände ablesen', 'Verwaltung', 'Keller', 365, 10]
];

function uid(p) { S.seq++; return p + S.seq; }
export function catById(id) { return S.catalog.find(c => c.id === id); }
export function memberById(id) { return S.members.find(m => m.id === id); }
export function instById(id) { return S.inst.find(i => i.id === id); }
export function isParent(id) { const m = memberById(id); return !!m && m.role === 'parent'; }
export function activeInst(catId) { return S.inst.find(i => i.catId === catId && i.status !== 'done'); }
export function lastDone(catId) { let l = null; S.inst.forEach(i => { if (i.catId === catId && i.status === 'done' && (!l || i.doneAt > l)) l = i.doneAt; }); return l; }
export function pointsOf(memberId) { return S.ledger.filter(l => l.member === memberId).reduce((a, l) => a + l.delta, 0); }
export function pointsFor(inst) { const c = catById(inst.catId); const base = c ? c.pts : 0; return inst.mode === 'booked' ? Math.round(base * S.bonus) : base; }
function err(msg) { return { ok: false, msg }; }
function ok(msg, extra) { return Object.assign({ ok: true, msg: msg || '' }, extra || {}); }
function str(v, max) { return String(v == null ? '' : v).trim().slice(0, max); }

// Neue Familie: ein Elternteil, Standardkatalog mit gestaffelter Vorgeschichte.
export function createState(ownerName, ownerEmail) {
  S = { v: 2, seq: 0, bonus: 1.5, members: [], catalog: [], inst: [], ledger: [] };
  const owner = { id: uid('m'), name: str(ownerName, 40), role: 'parent', email: str(ownerEmail, 120).toLowerCase() };
  S.members.push(owner);
  SEED_CATALOG.forEach((r, i) => {
    const c = { id: uid('c'), name: r[0], cat: r[1], room: r[2], interval: r[3], min: r[4], pts: Math.max(1, Math.round(r[4] / 5)), origin: 'standard', archived: false };
    S.catalog.push(c);
    const off = (i * 5) % (c.interval + 3);
    S.inst.push({ id: uid('i'), catId: c.id, status: 'done', assignee: owner.id, mode: 'booked', due: addDays(today(), -off), doneAt: addDays(today(), -off), points: 0, seed: true, log: [] });
  });
  refreshPool();
  return S;
}

function laterOf(a, b) { return !a ? (b || null) : !b ? a : (a > b ? a : b); }
const HORIZON = 3;
export function refreshPool() {
  let n = 0;
  S.catalog.forEach(c => {
    if (c.archived || !c.interval || activeInst(c.id)) return;
    const last = laterOf(lastDone(c.id), c.snooze) || today();
    const due = addDays(last, c.interval);
    if (diffDays(due, today()) <= HORIZON) {
      S.inst.push({ id: uid('i'), catId: c.id, status: 'open', assignee: null, mode: null, due: (diffDays(due, today()) < 0 ? today() : due), log: [] });
      n++;
    }
  });
  // Altlast begrenzen: je Tätigkeit bleibt die letzte erledigte Aufgabe, ältere erledigte nach 120 Tagen weg.
  const keep = new Set();
  S.catalog.forEach(c => { let best = null; S.inst.forEach(i => { if (i.catId === c.id && i.status === 'done' && (!best || i.doneAt > best.doneAt)) best = i; }); if (best) keep.add(best.id); });
  const before = S.inst.length;
  S.inst = S.inst.filter(i => i.status !== 'done' || keep.has(i.id) || diffDays(today(), i.doneAt) <= 120);
  if (S.ledger.length > 500) S.ledger = S.ledger.slice(-500);
  return n + (before - S.inst.length);
}

export function book(instId, by) {
  const i = instById(instId); if (!i) return err('Aufgabe nicht gefunden.');
  if (!memberById(by)) return err('Person nicht gefunden.');
  if (i.status !== 'open') return err('Diese Aufgabe ist schon vergeben.');
  i.status = 'taken'; i.assignee = by; i.mode = 'booked'; i.log.push('Selbst gebucht von ' + memberById(by).name);
  return ok('Gebucht: ' + pointsFor(i) + ' Punkte bei Erledigung.');
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
  if (activeInst(catId)) return err('Diese Tätigkeit läuft bereits. Übertrage die bestehende Aufgabe.');
  S.inst.push({ id: uid('i'), catId, status: 'taken', assignee: toId, mode: 'assigned', due: due || addDays(today(), 2), log: ['Zugewiesen von ' + memberById(by).name + ' an ' + memberById(toId).name] });
  return ok('Zugewiesen an ' + memberById(toId).name + '.');
}
export function enqueue(catId, by) {
  if (!isParent(by)) return err('Nur Eltern dürfen Aufgaben in den Pool stellen.');
  const c = catById(catId); if (!c) return err('Tätigkeit nicht gefunden.');
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
  if (i.status !== 'taken' || i.mode !== 'booked') return err('Nur selbst gebuchte Aufgaben gehen zurück in den Pool.');
  if (by !== i.assignee) return err('Nur wer gebucht hat, kann zurückgeben.');
  if (diffDays(i.due, today()) < 0) return err('Überfällige Aufgaben lassen sich nicht mehr zurückgeben. Übertrage sie stattdessen.');
  i.status = 'open'; i.assignee = null; i.mode = null; i.log.push('Zurück in den Pool');
  return ok('Zurück im Pool.');
}
export function complete(instId, by) {
  const i = instById(instId); if (!i) return err('Aufgabe nicht gefunden.');
  if (i.status !== 'taken') return err('Diese Aufgabe ist nicht vergeben.');
  if (!(by === i.assignee || isParent(by))) return err('Nur die zuständige Person oder Eltern dürfen abschließen.');
  const pts = pointsFor(i);
  i.status = 'done'; i.doneAt = today(); i.points = pts; i.log.push('Erledigt');
  S.ledger.push({ id: uid('l'), member: i.assignee, delta: pts, text: catById(i.catId).name + (i.mode === 'booked' ? ' (gebucht)' : ' (zugewiesen)'), date: today() });
  refreshPool();
  return ok('+' + pts + ' Punkte für ' + memberById(i.assignee).name + '.', { pts });
}
// Nur Eltern: nicht erledigte Aufgabe verwerfen. Das Intervall der Tätigkeit startet ab heute neu,
// damit der Pool die Aufgabe nicht sofort wieder anlegt.
export function deleteInst(instId, by) {
  if (!isParent(by)) return err('Nur Eltern dürfen Aufgaben löschen.');
  const i = instById(instId); if (!i) return err('Aufgabe nicht gefunden.');
  if (i.status === 'done') return err('Erledigte Aufgaben bleiben erhalten, sie stehen in der Punktehistorie.');
  const c = catById(i.catId);
  S.inst = S.inst.filter(x => x.id !== instId);
  if (c) c.snooze = today();
  return ok('Aufgabe gelöscht' + (c && c.interval ? '. Das Intervall startet heute neu.' : '.'));
}
export function escalations() {
  return S.inst.filter(i => i.status !== 'done' && diffDays(i.due, today()) < 0)
    .sort((a, b) => a.due < b.due ? -1 : a.due > b.due ? 1 : 0);
}
export function saveCat(data, by) {
  if (!isParent(by)) return err('Nur Eltern dürfen den Katalog ändern.');
  data = data || {};
  const name = str(data.name, 80); if (!name) return err('Bitte einen Namen eingeben.');
  const interval = Math.min(3650, Math.max(0, Math.round(Number(data.interval) || 0)));
  const min = Math.min(1440, Math.max(1, Math.round(Number(data.min) || 0) || 1));
  let pts = Math.round(Number(data.pts)); if (!pts || pts < 1) pts = Math.max(1, Math.round(min / 5)); pts = Math.min(1000, pts);
  const cat = str(data.cat, 40) || 'Sonstiges', room = str(data.room, 40);
  const clash = S.catalog.find(c => c.name.toLowerCase() === name.toLowerCase() && c.id !== data.id && !c.archived);
  if (clash) return err('Es gibt schon eine Tätigkeit mit diesem Namen.');
  if (data.id) {
    const c = catById(data.id); if (!c) return err('Tätigkeit nicht gefunden.');
    Object.assign(c, { name, cat, room, interval, min, pts });
    return ok('Gespeichert.');
  }
  S.catalog.push({ id: uid('c'), name, cat, room, interval, min, pts, origin: 'familie', archived: false });
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
  if (!isParent(by)) return err('Nur Eltern dürfen Mitglieder ändern.');
  data = data || {};
  const name = str(data.name, 40); if (!name) return err('Bitte einen Namen eingeben.');
  if (S.members.some(m => m.name.toLowerCase() === name.toLowerCase() && m.id !== data.id)) return err('Der Name ist schon vergeben.');
  const email = str(data.email, 120).toLowerCase();
  if (email && !isEmail(email)) return err('Diese E-Mail-Adresse ist ungültig.');
  if (email && S.members.some(m => (m.email || '') === email && m.id !== data.id)) return err('Diese E-Mail-Adresse gehört schon zu einem anderen Mitglied.');
  const role = data.role === 'parent' ? 'parent' : 'child';
  if (data.id) {
    const m = memberById(data.id); if (!m) return err('Mitglied nicht gefunden.');
    if (m.role === 'parent' && role === 'child' && S.members.filter(x => x.role === 'parent').length < 2) return err('Es muss mindestens ein Elternteil bleiben.');
    m.name = name; m.role = role; m.email = email; return ok('Gespeichert.');
  }
  if (S.members.length >= 20) return err('Mehr als 20 Mitglieder sind nicht vorgesehen.');
  S.members.push({ id: uid('m'), name, role, email }); return ok('Mitglied hinzugefügt.');
}
export function setPhotoMeta(memberId, by, on, stamp) {
  const m = memberById(memberId); if (!m) return err('Mitglied nicht gefunden.');
  if (!(by === memberId || isParent(by))) return err('Nur die Person selbst oder Eltern dürfen das Foto ändern.');
  if (on) m.photoV = stamp || Date.now(); else delete m.photoV;
  return ok(on ? 'Foto gespeichert.' : 'Foto entfernt.');
}
export function setBonus(v, by) {
  if (!isParent(by)) return err('Nur Eltern dürfen den Bonus ändern.');
  const n = Number(v); if (!(n >= 1 && n <= 3)) return err('Der Faktor muss zwischen 1 und 3 liegen.');
  S.bonus = Math.round(n * 10) / 10; return ok('Buchungsbonus: ×' + S.bonus);
}
