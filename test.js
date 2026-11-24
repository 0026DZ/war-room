// Run with: npm test   (plain Node, no Electron needed)
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const { Store, levelInfo, nextDue } = require('./lib/store');
const config = require('./lib/config');
const F = require('./lib/feeds');
const api = require('./lib/api');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wr-'));
const loaded = config.load(path.join(dir, 'WarRoom', 'config.json'));
assert.equal(loaded.error, ''); assert.ok(fs.existsSync(path.join(dir, 'WarRoom', 'config.json')));
const cfg = loaded.cfg;
fs.writeFileSync(path.join(dir, 'bad.json'), '{oops');
assert.ok(config.load(path.join(dir, 'bad.json')).error); assert.equal(config.clean({ categories: [] }).categories.length, 5);
assert.equal(config.clean({ categories: [{ id: 'x', color: 'red' }] }).categories[0].color, '#9aa3af');

const st = new Store(path.join(dir, 's.json'), cfg);
const sample = fs.readFileSync(path.join(__dirname, 'sample-tasks.csv'), 'utf8');
let v = st.act('import', { text: sample, name: 'sample' });
assert.equal(v.result.added, 5); assert.equal(v.tasks[0].due, v.today); assert.equal(v.tasks[0].cat, 'study');
assert.equal(v.tasks[1].cat, 'health'); assert.equal(v.tasks[1].repeat, 'daily'); assert.equal(v.tasks[4].notes, 'portal, then email');
v = st.act('import', { text: sample }); assert.equal(v.result.added, 0); assert.equal(v.result.skipped, 5);

// XP, streak, undo
v = st.act('toggle', { id: v.tasks[0].id }); assert.equal(v.xp, 30); assert.equal(v.streak, 1);
v = st.act('toggle', { id: v.tasks[0].id }); assert.equal(v.xp, 0); assert.equal(v.streak, 0);
// completing a repeating task schedules the next one, once
v = st.act('toggle', { id: v.tasks[1].id }); assert.equal(v.tasks.length, 6); assert.ok(v.tasks[5].due > v.today); assert.equal(v.tasks[5].repeat, 'daily');
v = st.act('toggle', { id: v.tasks[1].id }); v = st.act('toggle', { id: v.tasks[1].id }); assert.equal(v.tasks.length, 6);
assert.equal(new Date(nextDue('2020-01-03', 'weekdays') + 'T00:00:00').getDay() % 6 !== 0, true);
v = st.act('rename', { id: v.tasks[2].id, title: 'Renamed' }); assert.equal(v.tasks[2].title, 'Renamed');
v = st.act('add', { title: 'x', cat: 'life', due: '2030-12-01', time: '09:00', repeat: 'weekly' }); assert.equal(v.tasks[6].cat, 'life');
assert.equal(st.dueNow(new Date('2030-12-01T09:00:30')).length, 1); assert.equal(st.dueNow(new Date('2030-12-01T09:01:00')).length, 0);
assert.ok(st.exportCSV().startsWith('title,category,due,time,priority,repeat,notes,done')); assert.ok(st.exportCSV().includes('"portal, then email"'));

// levels follow the config
assert.deepEqual([0, 99, 100, 300].map(x => levelInfo(x, cfg).level), [1, 1, 2, 3]);
assert.deepEqual([0, 599, 600, 12000, 99999].map(x => levelInfo(x, cfg).tier), [0, 0, 1, 5, 5]);
assert.equal(levelInfo(100, config.clean({ ranks: ['A', 'B'], levelsPerStage: 1 })).rank, 'B');

// inbox folder, non-English headers
const inbox = path.join(dir, 'inbox'); fs.mkdirSync(inbox);
fs.writeFileSync(path.join(inbox, 'a.csv'), '任务,分类,日期,重复\n背单词,学校,明天,每天\n');
assert.equal(st.sweepInbox(inbox), 1); assert.equal(fs.readdirSync(path.join(inbox, 'imported')).length, 1);
assert.equal(st.s.tasks[7].cat, 'study'); assert.equal(st.s.tasks[7].repeat, 'daily');
assert.equal(new Store(path.join(dir, 's.json'), cfg).s.tasks.length, 8);

// feeds parsing
const rss = '<rss><channel><item><title>Talks resume in Oman &amp; more - Reuters</title><link>https://news.google.com/x</link><pubDate>Fri, 20 Nov 2026 12:00:00 GMT</pubDate><source url="https://reuters.com">Reuters</source></item></channel></rss>';
const n = F.parseRSS(rss); assert.equal(n[0].title, 'Talks resume in Oman & more'); assert.equal(n[0].source, 'Reuters');
const D = 86400, ts = [10 * D + 3600, 10 * D + 7200, 11 * D + 3600, 11 * D + 7200];
const y = F.parseYahoo(JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: 110, gmtoffset: 0 }, timestamp: ts, indicators: { quote: [{ open: [90, 95, null, 104], high: [96, 101, null, 111], low: [89, 94, null, 103], close: [95, 100, null, 109] }] } }] } }));
assert.equal(y.price, 110); assert.equal(Math.round(y.chg), 10); assert.equal(y.candles.length, 3); assert.equal(y.hi, 111); assert.equal(y.lo, 89);
assert.equal(Math.round(F.parseLite(JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: 51, chartPreviousClose: 50 } }] } })).chg), 2);
assert.equal(Math.round(F.parseFiveDay(JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: 105 }, indicators: { quote: [{ close: [100, 101, null, 104] }] } }] } })).chg5), 5);
assert.equal(F.ndxSlugs(Date.parse('2026-11-20T15:00:00-05:00'))[0].slug, 'ndx-up-or-down-on-november-20-2026');
assert.equal(F.ndxSlugs(Date.parse('2026-11-21T10:00:00-05:00'))[0].slug, 'ndx-up-or-down-on-november-23-2026');
assert.equal(Math.round(F.parsePoly(JSON.stringify([{ closed: false, markets: [{ closed: false, outcomes: '["Up", "Down"]', outcomePrices: '["0.58", "0.42"]' }] }])).up), 58);
assert.equal(F.parsePoly('[]'), null);
assert.equal(F.sentiment({ up: 58 }, { price: 15, chg: -1 }).bias, 'BULLISH'); assert.equal(F.sentiment(null, { price: 31, chg: 4 }).bias, 'BEARISH');
assert.equal(new Set(cfg.tape.map(r => r[1])).size, cfg.tape.length);

// agent API
let r = api.handle(st, 'POST', '/tasks', JSON.stringify([{ title: 'Agent task', category: 'gym', due: '2030-12-02', priority: 'high' }, { title: 'Agent task', due: '2030-12-02' }]));
assert.equal(r.json.added.length, 1); assert.equal(r.json.skipped, 1); assert.equal(r.json.added[0].cat, 'health');
const xp0 = st.s.xp; r = api.handle(st, 'POST', '/tasks/' + r.json.added[0].id + '/done', ''); assert.equal(r.json.task.done, true); assert.equal(st.s.xp, xp0 + 30);
assert.equal(api.handle(st, 'POST', '/tasks', 'nope').status, 400); assert.equal(api.handle(st, 'POST', '/import', 'title\nFrom csv\n').json.added, 1);
assert.equal(api.handle(st, 'GET', '/nope', '').status, 404);
v = st.act('topicAdd', { q: 'Taiwan Strait' }); v = st.act('topicAdd', { q: 'taiwan strait' }); assert.equal(v.topics.length, 1);
console.log('all checks passed');
