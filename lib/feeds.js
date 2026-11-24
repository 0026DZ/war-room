// Market quotes (Yahoo Finance chart endpoint, CoinGecko fallback for bitcoin), headlines (Google News RSS)
// and Polymarket odds. None needs an API key. They are public endpoints that can change; every call fails soft.
// What to fetch comes from the user's config (see lib/config.js).
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

async function get(url, ms = 12000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' }, signal: c.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } finally { clearTimeout(t); }
}
const chartUrl = (sym, q) => 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(sym) + '?' + q;

// Run fn over rows, five requests at a time. Failed rows are dropped.
async function pool(rows, fn) {
  const out = new Array(rows.length);
  let next = 0;
  const worker = async () => {
    while (next < rows.length) {
      const i = next++;
      try { out[i] = await fn(rows[i]); } catch (e) { out[i] = null; }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker(), worker()]);
  return out.filter(Boolean);
}

// One week of hourly candles.
function parseYahoo(json) {
  const r = JSON.parse(json).chart.result[0];
  const q = r.indicators.quote[0], ts = r.timestamp || [], off = r.meta.gmtoffset || 0;
  const num = v => typeof v === 'number';
  const c = [];
  for (let i = 0; i < ts.length; i++) {
    if (num(q.open[i]) && num(q.high[i]) && num(q.low[i]) && num(q.close[i])) c.push({ t: ts[i], o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] });
  }
  if (!c.length) throw new Error('no candles');
  const price = num(r.meta.regularMarketPrice) ? r.meta.regularMarketPrice : c[c.length - 1].c;
  // Day change = last price against the final close of the previous trading day (exchange-local dates).
  const day = x => Math.floor((x.t + off) / 86400);
  const lastDay = day(c[c.length - 1]);
  let prev = null;
  for (let i = c.length - 1; i >= 0; i--) if (day(c[i]) < lastDay) { prev = c[i].c; break; }
  return {
    price,
    chg: prev ? (price / prev - 1) * 100 : 0,
    wk: (price / c[0].o - 1) * 100,
    hi: Math.max.apply(null, c.map(x => x.h)),
    lo: Math.min.apply(null, c.map(x => x.l)),
    candles: c.map(x => [x.o, x.h, x.l, x.c])
  };
}
async function chart(m) {
  const base = { id: m.id, label: String(m.label || m.symbol).toUpperCase(), sub: m.sub || '', symbol: m.symbol };
  try {
    const now = Math.floor(Date.now() / 1000);
    return Object.assign({ ok: true }, base, parseYahoo(await get(chartUrl(m.symbol, 'period1=' + (now - 7 * 86400) + '&period2=' + now + '&interval=1h'))));
  } catch (e) {
    if (m.symbol === 'BTC-USD') {
      try {
        const j = JSON.parse(await get('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true'));
        return Object.assign({ ok: true }, base, { price: j.bitcoin.usd, chg: j.bitcoin.usd_24h_change || 0, wk: null, candles: [] });
      } catch (e2) { /* fall through */ }
    }
    return Object.assign({ ok: false, error: e.message }, base);
  }
}

// Last price and day change, for the tape.
function parseLite(json) {
  const m = JSON.parse(json).chart.result[0].meta;
  const price = m.regularMarketPrice;
  const prev = typeof m.chartPreviousClose === 'number' ? m.chartPreviousClose : m.previousClose;
  if (typeof price !== 'number') throw new Error('no price');
  return { price, chg: prev ? (price / prev - 1) * 100 : 0 };
}
function tape(rows) {
  return pool(rows, async row => Object.assign({ label: String(row[0]), symbol: row[1] }, parseLite(await get(chartUrl(row[1], 'range=1d&interval=1d')))));
}

// Sector ETFs ranked by 5-day move.
function parseFiveDay(json) {
  const r = JSON.parse(json).chart.result[0];
  const closes = (r.indicators.quote[0].close || []).filter(v => typeof v === 'number');
  const price = typeof r.meta.regularMarketPrice === 'number' ? r.meta.regularMarketPrice : closes[closes.length - 1];
  if (closes.length < 2) throw new Error('too few closes');
  return { price, chg5: (price / closes[0] - 1) * 100 };
}
async function sectors(rows) {
  const out = await pool(rows, async row => Object.assign({ label: String(row[0]), etf: row[1] }, parseFiveDay(await get(chartUrl(row[1], 'range=5d&interval=1d')))));
  return out.sort((a, b) => b.chg5 - a.chg5);
}

// Polymarket runs a daily "Nasdaq 100 (NDX) Up or Down on <date>" market. Find the nearest open one.
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
function ndxSlugs(now) {
  const out = [];
  const ny = new Date(new Date(now).toLocaleString('en-US', { timeZone: 'America/New_York' }));
  for (let i = 0; i < 5 && out.length < 3; i++) {
    const d = new Date(ny.getFullYear(), ny.getMonth(), ny.getDate() + i);
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    out.push({ slug: 'ndx-up-or-down-on-' + MONTHS[d.getMonth()] + '-' + d.getDate() + '-' + d.getFullYear(), day: MONTHS[d.getMonth()].slice(0, 3).toUpperCase() + ' ' + d.getDate() });
  }
  return out;
}
function parsePoly(json) {
  const ev = JSON.parse(json);
  const e = Array.isArray(ev) ? ev[0] : ev;
  if (!e || e.closed) return null;
  const m = (e.markets || []).find(x => !x.closed);
  if (!m) return null;
  const arr = v => (typeof v === 'string' ? JSON.parse(v) : v) || [];
  const names = arr(m.outcomes), prices = arr(m.outcomePrices).map(Number);
  const i = names.findIndex(n => /^up$/i.test(String(n).trim()));
  if (i < 0 || !(prices[i] >= 0)) return null;
  return { up: prices[i] * 100 };
}
async function polymarket() {
  for (const s of ndxSlugs(Date.now())) {
    try {
      const r = parsePoly(await get('https://gamma-api.polymarket.com/events?slug=' + s.slug));
      if (r) return Object.assign(r, { day: s.day, url: 'https://polymarket.com/event/' + s.slug });
    } catch (e) { /* try the next trading day */ }
  }
  return null;
}

// A rule of thumb, not a forecast: Polymarket's implied odds decide the lean; the VIX describes the mood.
function sentiment(poly, vix) {
  const mood = !vix ? null : vix.price < 17 ? 'CALM' : vix.price < 22 ? 'NORMAL' : vix.price < 30 ? 'ELEVATED' : 'FEAR';
  let bias = 'NEUTRAL';
  if (poly) bias = poly.up >= 55 ? 'BULLISH' : poly.up <= 45 ? 'BEARISH' : 'NEUTRAL';
  else if (vix) bias = vix.price >= 25 && vix.chg > 0 ? 'BEARISH' : vix.price < 17 && vix.chg <= 0 ? 'BULLISH' : 'NEUTRAL';
  return { bias, mood, basis: poly ? 'POLYMARKET' : vix ? 'VIX ONLY' : 'NO DATA' };
}

function decode(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&amp;/g, '&')
    .trim();
}
function parseRSS(xml) {
  const out = [];
  const items = xml.match(/<item[\s>][\s\S]*?<\/item>/g) || [];
  for (const it of items) {
    const tag = n => { const m = it.match(new RegExp('<' + n + '[^>]*>([\\s\\S]*?)</' + n + '>')); return m ? decode(m[1]) : ''; };
    let title = tag('title');
    const source = tag('source');
    if (source && title.endsWith(' - ' + source)) title = title.slice(0, -(source.length + 3));
    const link = tag('link');
    const ts = Date.parse(tag('pubDate')) || 0;
    if (title && /^https?:\/\//.test(link)) out.push({ title, source, link, ts });
  }
  return out.sort((a, b) => b.ts - a.ts);
}
async function headlines(topic, lang) {
  const loc = lang === 'zh' ? 'hl=zh-CN&gl=US&ceid=US:zh-Hans' : 'hl=en-US&gl=US&ceid=US:en';
  const url = 'https://news.google.com/rss/search?q=' + encodeURIComponent(topic.q + ' when:2d') + '&' + loc;
  const base = { id: topic.id, label: String(topic.label || topic.q).toUpperCase(), custom: !!topic.custom };
  try { return Object.assign(base, { ok: true, items: parseRSS(await get(url)).slice(0, 14) }); }
  catch (e) { return Object.assign(base, { ok: false, error: e.message, items: [] }); }
}

async function intel(lang, custom, cfg) {
  const defaults = (cfg.topics[lang === 'zh' ? 'zh' : 'en'] || cfg.topics.en || []).filter(t => t && t.id && t.q);
  const topics = defaults.concat((custom || []).map(t => ({ id: t.id, label: t.label, q: t.q, custom: true })));
  const [markets, tapeRows, sectorRows, poly, news] = await Promise.all([
    Promise.all(cfg.charts.map(chart)),
    tape(cfg.tape),
    sectors(cfg.sectors),
    cfg.bias ? polymarket() : null,
    Promise.all(topics.map(t => headlines(t, lang)))
  ]);
  const vix = tapeRows.find(x => x.symbol === '^VIX') || null;
  return {
    at: Date.now(), markets, tape: tapeRows, news,
    hot: sectorRows.slice(0, 3), cold: sectorRows.length > 3 ? sectorRows[sectorRows.length - 1] : null,
    poly, vix, sentiment: cfg.bias ? sentiment(poly, vix) : null
  };
}

module.exports = { intel, parseRSS, parseYahoo, parseLite, parseFiveDay, parsePoly, ndxSlugs, sentiment };
