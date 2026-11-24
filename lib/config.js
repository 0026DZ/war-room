// User configuration. Defaults live here; the user's copy is Documents/WarRoom/config.json and overrides them key by key.
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  // Task categories. keywords are matched against the CSV "category" value (any language).
  categories: [
    { id: 'work', label: 'WORK', color: '#8ea2ff', keywords: ['work', 'job', 'office', '工作'] },
    { id: 'study', label: 'STUDY', color: '#c79bff', keywords: ['study', 'school', 'class', 'homework', '学习', '学校'] },
    { id: 'health', label: 'HEALTH', color: '#ff8c1a', keywords: ['health', 'fitness', 'gym', 'workout', '健身', '运动'] },
    { id: 'life', label: 'LIFE', color: '#4fd1c5', keywords: ['life', 'personal', 'home', 'family', '生活'] },
    { id: 'errands', label: 'ERRANDS', color: '#9aa3af', keywords: ['errand', 'task', 'misc', 'other', '杂事'] }
  ],
  // Levels. One path stage per rank; a new stage every levelsPerStage levels.
  ranks: ['OBSERVER', 'OPERATOR', 'ANALYST', 'STRATEGIST', 'DIRECTOR', 'ARCHITECT'],
  levelsPerStage: 3,
  xp: { high: 30, normal: 20, low: 10 },
  // Markets. Symbols are Yahoo Finance symbols.
  charts: [
    { id: 'c1', label: 'NASDAQ', sub: 'COMPOSITE', symbol: '^IXIC' },
    { id: 'c2', label: 'GOLD', sub: 'FUTURES USD/OZ', symbol: 'GC=F' },
    { id: 'c3', label: 'BITCOIN', sub: 'BTC/USD', symbol: 'BTC-USD' }
  ],
  tape: [
    ['S&P 500', '^GSPC'], ['NASDAQ', '^IXIC'], ['DOW', '^DJI'], ['RUSSELL 2K', '^RUT'], ['FTSE 100', '^FTSE'], ['DAX', '^GDAXI'], ['NIKKEI', '^N225'],
    ['VIX', '^VIX'], ['US10Y', '^TNX'], ['DXY', 'DX-Y.NYB'], ['EUR/USD', 'EURUSD=X'], ['USD/JPY', 'JPY=X'],
    ['WTI', 'CL=F'], ['GOLD', 'GC=F'], ['SILVER', 'SI=F'], ['COPPER', 'HG=F'], ['BTC', 'BTC-USD'], ['ETH', 'ETH-USD'],
    ['AAPL', 'AAPL'], ['MSFT', 'MSFT'], ['NVDA', 'NVDA'], ['GOOGL', 'GOOGL'], ['AMZN', 'AMZN'], ['META', 'META'], ['TSLA', 'TSLA']
  ],
  sectors: [
    ['TECH', 'XLK'], ['SEMIS', 'SMH'], ['SOFTWARE', 'IGV'], ['FINANCIALS', 'XLF'], ['REGIONAL BANKS', 'KRE'], ['ENERGY', 'XLE'], ['URANIUM', 'URA'],
    ['HEALTH CARE', 'XLV'], ['BIOTECH', 'XBI'], ['GENOMICS', 'ARKG'], ['INDUSTRIALS', 'XLI'], ['DEFENSE', 'ITA'], ['ROBOTICS', 'BOTZ'],
    ['CONSUMER DISC', 'XLY'], ['STAPLES', 'XLP'], ['UTILITIES', 'XLU'], ['MATERIALS', 'XLB'], ['REAL ESTATE', 'XLRE'], ['COMM SERVICES', 'XLC']
  ],
  bias: true, // the NASDAQ BIAS strip (Polymarket odds + VIX)
  // Default news tabs per language. q is any Google News search.
  topics: {
    en: [
      { id: 'world', label: 'WORLD', q: 'geopolitics OR sanctions OR ceasefire OR summit' },
      { id: 'markets', label: 'MARKETS', q: 'stock market OR Federal Reserve OR earnings' },
      { id: 'tech', label: 'TECH', q: 'artificial intelligence OR semiconductors' }
    ],
    zh: [
      { id: 'world', label: '国际', q: '地缘政治 OR 制裁 OR 停火 OR 峰会' },
      { id: 'markets', label: '财经', q: '美股 OR 美联储 OR 财报' },
      { id: 'tech', label: '科技', q: '人工智能 OR 半导体' }
    ]
  },
  refreshMinutes: 60,
  notify: true, // desktop notification when a task's time arrives
  agentPort: 47600,
  hotkey: 'Control+Alt+W'
};

function clean(c) {
  const d = JSON.parse(JSON.stringify(DEFAULTS));
  const o = Object.assign(d, c && typeof c === 'object' ? c : {});
  const arr = (k, min) => { if (!Array.isArray(o[k]) || o[k].length < min) o[k] = JSON.parse(JSON.stringify(DEFAULTS[k])); };
  arr('categories', 1); arr('ranks', 1); arr('charts', 1); arr('tape', 0); arr('sectors', 0);
  o.categories = o.categories.filter(x => x && x.id).map(x => ({ id: String(x.id), label: String(x.label || x.id).toUpperCase(), color: /^#[0-9a-f]{3,8}$/i.test(x.color || '') ? x.color : '#9aa3af', keywords: Array.isArray(x.keywords) ? x.keywords.map(String) : [] }));
  if (!o.categories.length) o.categories = JSON.parse(JSON.stringify(DEFAULTS.categories));
  o.charts = o.charts.slice(0, 3);
  o.levelsPerStage = Math.max(1, Math.min(20, parseInt(o.levelsPerStage, 10) || 3));
  o.refreshMinutes = Math.max(5, Math.min(1440, Number(o.refreshMinutes) || 60));
  o.xp = Object.assign({}, DEFAULTS.xp, o.xp);
  o.topics = Object.assign({}, DEFAULTS.topics, o.topics);
  o.agentPort = parseInt(o.agentPort, 10) || DEFAULTS.agentPort;
  return o;
}

// Reads the user's config, creating it from the defaults on first run. A broken file falls back to defaults and reports why.
function load(file) {
  try {
    if (!fs.existsSync(file)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(DEFAULTS, null, 2));
    }
    return { cfg: clean(JSON.parse(fs.readFileSync(file, 'utf8'))), error: '' };
  } catch (e) {
    return { cfg: clean(null), error: 'config.json could not be read (' + e.message + '). Using defaults.' };
  }
}

module.exports = { DEFAULTS, load, clean };
