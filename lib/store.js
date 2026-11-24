// Task state, CSV import/export, recurrence and XP rules. No Electron dependency, so it can be tested with plain Node.
const fs = require('fs');
const path = require('path');
const { clean } = require('./config');

const REPEATS = ['daily', 'weekdays', 'weekly', 'monthly'];
const pad = n => (n < 10 ? '0' : '') + n;
const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const today = () => iso(new Date());
const addDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function priOf(v) {
  v = String(v || '').trim().toLowerCase();
  if (/^(high|h|高|1|urgent|紧急)/.test(v)) return 'high';
  if (/^(low|l|低|3)/.test(v)) return 'low';
  return '';
}
function repeatOf(v) {
  v = String(v || '').trim().toLowerCase();
  if (/^(daily|every ?day|每天|每日)/.test(v)) return 'daily';
  if (/^(weekdays?|工作日)/.test(v)) return 'weekdays';
  if (/^(weekly|every ?week|每周)/.test(v)) return 'weekly';
  if (/^(monthly|every ?month|每月)/.test(v)) return 'monthly';
  return '';
}
function dateOf(v) {
  v = String(v || '').trim();
  if (!v) return '';
  const l = v.toLowerCase();
  if (l === 'today' || v === '今天') return today();
  if (l === 'tomorrow' || v === '明天') return addDays(1);
  if (v === '后天') return addDays(2);
  let m = v.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
  if (m) return m[1] + '-' + pad(+m[2]) + '-' + pad(+m[3]);
  m = v.match(/^(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?$/);
  if (m) {
    const y = m[3] ? (m[3].length === 2 ? '20' + m[3] : m[3]) : String(new Date().getFullYear());
    return y + '-' + pad(+m[1]) + '-' + pad(+m[2]);
  }
  const d = new Date(v);
  return isNaN(d) ? '' : iso(d);
}
function timeOf(v) {
  const m = String(v || '').trim().match(/^(\d{1,2})[:：](\d{2})\s*(am|pm)?/i);
  if (!m) return '';
  let h = +m[1];
  if (m[3]) { const p = m[3].toLowerCase(); if (p === 'pm' && h < 12) h += 12; if (p === 'am' && h === 12) h = 0; }
  return h > 23 ? '' : pad(h) + ':' + m[2];
}
// Next due date for a repeating task, never earlier than tomorrow.
function nextDue(due, repeat) {
  const d = new Date((due || today()) + 'T00:00:00');
  const step = () => {
    if (repeat === 'weekly') d.setDate(d.getDate() + 7);
    else if (repeat === 'monthly') d.setMonth(d.getMonth() + 1);
    else { d.setDate(d.getDate() + 1); if (repeat === 'weekdays') while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1); }
  };
  step();
  const t = today();
  while (iso(d) <= t) step();
  return iso(d);
}

function parseCSV(text) {
  text = text.replace(/^﻿/, '').replace(/^```[a-z]*\r?\n?|```\s*$/gim, '');
  const first = text.split(/\r?\n/)[0] || '';
  const delim = first.includes('\t') ? '\t' : (first.split(';').length > first.split(',').length ? ';' : ',');
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; rows.push(row); row = []; }
    else cur += ch;
  }
  row.push(cur); rows.push(row);
  return rows.filter(r => r.some(c => c.trim()));
}

const ALIAS = {
  title: /^(title|task|name|todo|to-do|任务|标题|事项|内容)$/,
  cat: /^(category|cat|type|area|分类|类别|类型)$/,
  due: /^(due|date|due date|due_date|day|日期|截止|截止日期)$/,
  time: /^(time|start|时间)$/,
  pri: /^(priority|pri|优先级)$/,
  repeat: /^(repeat|recurring|recurrence|重复|循环)$/,
  notes: /^(notes?|details?|description|备注|说明)$/
};

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX'];
function levelInfo(xp, cfg) {
  // Level n needs 100*n more XP than the level before: 0, 100, 300, 600, 1000 ...
  const per = cfg.levelsPerStage, ranks = cfg.ranks;
  const level = Math.floor((Math.sqrt(1 + 8 * xp / 100) - 1) / 2) + 1;
  const base = 100 * (level - 1) * level / 2;
  const tier = Math.min(ranks.length - 1, Math.floor((level - 1) / per));
  return { level, into: xp - base, need: 100 * level, tier, rank: String(ranks[tier]).toUpperCase(), grade: ROMAN[(level - 1) % per] || '' };
}
function streak(days) {
  let n = 0;
  const d = new Date();
  if (!days[iso(d)]) d.setDate(d.getDate() - 1); // today not started yet does not break the streak
  while (days[iso(d)] > 0) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

class Store {
  constructor(file, cfg) {
    this.file = file;
    this.cfg = cfg || clean(null);
    this.s = { tasks: [], xp: 0, days: {}, lang: 'en', log: [], topics: [], desktop: true };
    try { Object.assign(this.s, JSON.parse(fs.readFileSync(file, 'utf8'))); } catch (e) { /* first run */ }
  }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.s, null, 1));
    fs.renameSync(tmp, this.file);
  }
  view() {
    const c = this.cfg;
    return Object.assign({}, this.s, {
      today: today(), lv: levelInfo(this.s.xp, c), streak: streak(this.s.days),
      cfg: { categories: c.categories, ranks: c.ranks, levelsPerStage: c.levelsPerStage, refreshMinutes: c.refreshMinutes, bias: !!c.bias }
    });
  }
  find(id) { return this.s.tasks.find(t => t.id === id); }
  note(msg) { this.s.log.unshift({ at: Date.now(), msg }); this.s.log.length = Math.min(this.s.log.length, 30); }

  // Maps free text ("Gym", "学校", "work stuff") to a configured category id. Unknown text lands in the last category.
  catOf(v) {
    v = String(v || '').trim().toLowerCase();
    const cats = this.cfg.categories;
    const exact = cats.find(c => c.id.toLowerCase() === v || c.label.toLowerCase() === v);
    if (exact) return exact.id;
    const hit = v && cats.find(c => c.keywords.some(k => k && v.includes(String(k).toLowerCase())));
    return hit ? hit.id : cats[cats.length - 1].id;
  }
  dupe(title, due) { return this.s.tasks.some(t => t.title.toLowerCase() === title.toLowerCase() && t.due === due); }
  make(title, cat, due, time, pri, notes, repeat) {
    return { id: uid(), title, cat, due, time, pri, notes: String(notes || '').slice(0, 300), repeat: repeat || '', done: false, doneOn: '' };
  }

  act(type, p) {
    p = p || {};
    const s = this.s; let t;
    if (type === 'add') {
      const title = String(p.title || '').trim();
      if (!title) return this.view();
      s.tasks.push(this.make(title, this.catOf(p.cat), dateOf(p.due), timeOf(p.time), priOf(p.pri), '', repeatOf(p.repeat)));
    } else if (type === 'toggle' && (t = this.find(p.id))) {
      const day = today();
      if (!t.done) {
        t.done = true; t.doneOn = day; t.xp = this.cfg.xp[t.pri || 'normal'] || 20;
        s.xp += t.xp; s.days[day] = (s.days[day] || 0) + 1;
        if (REPEATS.includes(t.repeat)) { // schedule the next occurrence once
          const due = nextDue(t.due, t.repeat);
          if (!this.dupe(t.title, due)) s.tasks.push(this.make(t.title, t.cat, due, t.time, t.pri, t.notes, t.repeat));
        }
      } else {
        s.xp = Math.max(0, s.xp - (t.xp || 0));
        if (t.doneOn && s.days[t.doneOn]) s.days[t.doneOn]--;
        t.done = false; t.doneOn = ''; t.xp = 0;
      }
    } else if (type === 'rename' && (t = this.find(p.id))) {
      const title = String(p.title || '').trim();
      if (title) t.title = title.slice(0, 200);
    } else if (type === 'del') {
      s.tasks = s.tasks.filter(x => x.id !== p.id);
    } else if (type === 'bump' && (t = this.find(p.id))) {
      t.due = addDays(1);
    } else if (type === 'archive') {
      s.tasks = s.tasks.filter(x => !x.done); // XP and streak are kept
    } else if (type === 'mode') {
      s.desktop = !s.desktop;
    } else if (type === 'topicAdd') {
      const q = String(p.q || '').trim().slice(0, 80);
      if (q && s.topics.length < 8 && !s.topics.some(x => x.q.toLowerCase() === q.toLowerCase())) s.topics.push({ id: 'u' + uid(), label: q.toUpperCase().slice(0, 18), q });
    } else if (type === 'topicDel') {
      s.topics = s.topics.filter(x => x.id !== p.id);
    } else if (type === 'lang') {
      s.lang = p.lang === 'zh' ? 'zh' : 'en';
    } else if (type === 'import') {
      const r = this.importText(String(p.text || ''));
      this.note((p.name || 'CSV') + ': +' + r.added + (r.skipped ? ', ' + r.skipped + ' skipped' : ''));
      this.save();
      return Object.assign(this.view(), { result: r });
    }
    this.save();
    return this.view();
  }

  // One task from a plain object (used by the agent API). Returns the task, or null if it is a duplicate or has no title.
  addTask(o) {
    o = o || {};
    const title = String(o.title || '').trim();
    const due = dateOf(o.due);
    if (!title || this.dupe(title, due)) return null;
    const t = this.make(title, this.catOf(o.category || o.cat), due, timeOf(o.time), priOf(o.priority || o.pri), o.notes, repeatOf(o.repeat));
    this.s.tasks.push(t);
    return t;
  }

  importText(text) {
    const rows = parseCSV(text);
    if (!rows.length) return { added: 0, skipped: 0 };
    let map = {};
    rows[0].map(h => h.trim().toLowerCase()).forEach((h, i) => {
      for (const k in ALIAS) if (ALIAS[k].test(h) && map[k] == null) map[k] = i;
    });
    if (map.title == null) map = { title: 0, cat: 1, due: 2, time: 3, pri: 4, notes: 5 }; else rows.shift();
    let added = 0, skipped = 0;
    for (const r of rows) {
      const g = k => (map[k] != null && r[map[k]] != null ? r[map[k]].trim() : '');
      const title = g('title');
      const due = dateOf(g('due'));
      if (!title || this.dupe(title, due)) { skipped++; continue; }
      added++;
      this.s.tasks.push(this.make(title, this.catOf(g('cat')), due, timeOf(g('time')), priOf(g('pri')), g('notes'), repeatOf(g('repeat'))));
    }
    return { added, skipped };
  }

  exportCSV() {
    const q = v => { v = String(v == null ? '' : v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const rows = [['title', 'category', 'due', 'time', 'priority', 'repeat', 'notes', 'done']];
    for (const t of this.s.tasks) rows.push([t.title, t.cat, t.due, t.time, t.pri || 'medium', t.repeat || '', t.notes || '', t.done ? 'yes' : '']);
    return rows.map(r => r.map(q).join(',')).join('\r\n') + '\r\n';
  }

  // Open tasks whose date and time match "now" (minute precision). Used for desktop notifications.
  dueNow(now) {
    const d = now || new Date(), day = iso(d), hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
    return this.s.tasks.filter(t => !t.done && t.due === day && t.time === hm);
  }

  // Import every CSV in the inbox folder, then move each file into inbox/imported.
  sweepInbox(dir) {
    let total = 0, touched = false;
    let names = [];
    try { names = fs.readdirSync(dir); } catch (e) { return 0; }
    for (const name of names) {
      if (!/\.(csv|tsv|txt)$/i.test(name)) continue;
      const full = path.join(dir, name);
      try {
        if (!fs.statSync(full).isFile()) continue;
        const r = this.importText(fs.readFileSync(full, 'utf8'));
        const doneDir = path.join(dir, 'imported');
        fs.mkdirSync(doneDir, { recursive: true });
        fs.renameSync(full, path.join(doneDir, Date.now() + '-' + name));
        this.note(name + ': +' + r.added + (r.skipped ? ', ' + r.skipped + ' skipped' : ''));
        total += r.added;
      } catch (e) { this.note(name + ': could not read (' + e.message + ')'); }
      touched = true;
    }
    if (touched) this.save();
    return total;
  }
}

module.exports = { Store, parseCSV, levelInfo, streak, dateOf, timeOf, repeatOf, nextDue, REPEATS };
