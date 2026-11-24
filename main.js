const { app, BrowserWindow, ipcMain, shell, dialog, Tray, Menu, screen, globalShortcut, nativeImage, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { Store } = require('./lib/store');
const config = require('./lib/config');
const feeds = require('./lib/feeds');
const api = require('./lib/api');

let win, tray, store, cfg, cfgError = '', home, inbox, pathDir, cfgFile;
let cache = null, cacheKey = '', inflight = null, images = null;
let quitting = false, switching = false;
const agent = { port: 0, token: '', ok: false };
const notified = new Set();

const hotkeyLabel = () => String(cfg.hotkey || '').replace('Control', 'Ctrl').replace('CommandOrControl', 'Ctrl');
function withMeta(v) { v.inbox = inbox; v.pathDir = pathDir; v.hotkey = hotkeyLabel(); v.cfgError = cfgError; return v; }
function push() { if (win && !win.isDestroyed()) win.webContents.send('state', withMeta(store.view())); }
function sweep() {
  const before = (store.s.log[0] || {}).at;
  store.sweepInbox(inbox);
  if ((store.s.log[0] || {}).at !== before) push();
}
function show() { if (!win || win.isDestroyed()) return createWindow(); win.show(); win.focus(); }
function toggleShow() { if (win && !win.isDestroyed() && win.isVisible() && win.isFocused()) win.hide(); else show(); }

function createWindow() {
  const desk = !!store.s.desktop;
  const wa = screen.getPrimaryDisplay().workArea;
  const base = {
    backgroundColor: '#050607', title: 'War Room', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  };
  // Desktop mode: no frame, no taskbar button, fills the screen up to the taskbar, cannot be moved or resized.
  const mode = desk
    ? { x: wa.x, y: wa.y, width: wa.width, height: wa.height, frame: false, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, hasShadow: false }
    : { width: 1380, height: 880, minWidth: 980, minHeight: 640, autoHideMenuBar: true };
  win = new BrowserWindow(Object.assign(base, mode));
  win.loadFile(path.join(__dirname, 'app', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.on('focus', sweep);
  win.on('close', e => { if (desk && !quitting && !switching) { e.preventDefault(); win.hide(); } }); // Alt+F4 hides instead of quitting
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', e => e.preventDefault());
}

function switchMode() {
  store.act('mode');
  switching = true;
  const old = win;
  createWindow();
  if (old && !old.isDestroyed()) old.destroy();
  switching = false;
  buildTray();
}

function buildTray() {
  if (!tray) {
    try { tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'app', 'tray.png'))); } catch (e) { return; }
    tray.setToolTip('War Room');
    tray.on('click', show);
  }
  const login = app.getLoginItemSettings().openAtLogin;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show War Room' + (hotkeyLabel() ? ' (' + hotkeyLabel() + ')' : ''), click: show },
    { type: 'separator' },
    { label: 'Desktop mode (frameless)', type: 'checkbox', checked: !!store.s.desktop, click: switchMode },
    { label: 'Start with the computer', type: 'checkbox', checked: login, enabled: app.isPackaged, click: () => { app.setLoginItemSettings({ openAtLogin: !login }); buildTray(); } },
    { label: 'Open settings file', click: () => shell.openPath(cfgFile) },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } }
  ]));
}

function loadConfig() {
  const r = config.load(cfgFile);
  cfg = r.cfg; cfgError = r.error;
  if (store) store.cfg = cfg;
  cache = null;
}

// Path images are the user's own files: Documents/WarRoom/path/stage-1.jpg, stage-2.png ... One per rank.
function pathImages() {
  if (images) return images;
  const mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
  images = cfg.ranks.map((_r, i) => {
    for (const ext of Object.keys(mime)) {
      const f = path.join(pathDir, 'stage-' + (i + 1) + '.' + ext);
      try { if (fs.statSync(f).size < 12e6) return 'data:' + mime[ext] + ';base64,' + fs.readFileSync(f).toString('base64'); } catch (e) { /* try the next extension */ }
    }
    return null;
  });
  return images;
}

// Local API for AI agents. Bound to 127.0.0.1 only, and every request needs the token.
function startApi() {
  agent.port = cfg.agentPort;
  const tokFile = path.join(app.getPath('userData'), 'agent-token.txt');
  try { agent.token = fs.readFileSync(tokFile, 'utf8').trim(); } catch (e) { /* first run */ }
  if (!agent.token) { agent.token = crypto.randomBytes(24).toString('hex'); fs.writeFileSync(tokFile, agent.token); }
  const srv = http.createServer((req, res) => {
    const send = (status, json) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(json)); };
    if (req.headers.origin) return send(403, { error: 'Browser requests are not accepted.' });
    if (req.headers.authorization !== 'Bearer ' + agent.token) return send(401, { error: 'Missing or wrong token. Send header: Authorization: Bearer <token>' });
    let body = '', size = 0;
    req.on('data', c => { size += c.length; if (size > 1e6) req.destroy(); else body += c; });
    req.on('end', () => {
      try {
        const r = api.handle(store, req.method, req.url, body, req.headers['content-type'] || '');
        if (r.changed) push();
        send(r.status, r.json);
      } catch (e) { send(500, { error: e.message }); }
    });
  });
  srv.on('error', () => { agent.ok = false; });
  srv.listen(agent.port, '127.0.0.1', () => { agent.ok = true; });
}

function remind() {
  if (!cfg.notify || !Notification.isSupported()) return;
  for (const t of store.dueNow()) {
    const key = t.id + t.due + t.time;
    if (notified.has(key)) continue;
    notified.add(key);
    const n = new Notification({ title: t.title, body: 'Due now · ' + t.time });
    n.on('click', show);
    n.show();
  }
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', show);
  app.whenReady().then(() => {
    home = path.join(app.getPath('documents'), 'WarRoom');
    inbox = path.join(home, 'inbox'); pathDir = path.join(home, 'path'); cfgFile = path.join(home, 'config.json');
    fs.mkdirSync(inbox, { recursive: true }); fs.mkdirSync(pathDir, { recursive: true });
    loadConfig();
    store = new Store(path.join(app.getPath('userData'), 'war-room.json'), cfg);
    store.sweepInbox(inbox);

    let t1 = null, t2 = null, t3 = null;
    try { fs.watch(inbox, () => { clearTimeout(t1); t1 = setTimeout(sweep, 900); }); } catch (e) { /* the focus sweep still works */ }
    try { fs.watch(pathDir, () => { clearTimeout(t2); t2 = setTimeout(() => { images = null; push(); }, 900); }); } catch (e) { /* restart picks up new images */ }
    try { fs.watch(home, (_ev, name) => { if (name === 'config.json') { clearTimeout(t3); t3 = setTimeout(() => { loadConfig(); images = null; push(); }, 900); } }); } catch (e) { /* restart picks up config */ }

    ipcMain.handle('state', () => withMeta(store.view()));
    ipcMain.handle('act', (_e, type, payload) => {
      type = String(type);
      if (type === 'mode') return withMeta(store.view()); // mode changes go through switchMode
      return withMeta(store.act(type, payload));
    });
    ipcMain.handle('intel', async (_e, force) => {
      const key = store.s.lang + '|' + store.s.topics.map(t => t.q).join('|');
      if (!force && cache && cacheKey === key && Date.now() - cache.at < 90 * 1000) return cache;
      if (cacheKey !== key) inflight = null;
      if (!inflight) {
        const p = feeds.intel(store.s.lang, store.s.topics, cfg).then(r => { cache = r; cacheKey = key; return r; }).finally(() => { if (inflight === p) inflight = null; });
        inflight = p;
      }
      return inflight;
    });
    ipcMain.handle('open', (_e, url) => { if (/^https:\/\//.test(String(url))) shell.openExternal(url); });
    ipcMain.handle('openDir', (_e, which) => shell.openPath(which === 'path' ? pathDir : which === 'config' ? cfgFile : inbox));
    ipcMain.handle('pathImages', () => pathImages());
    ipcMain.handle('agent', () => agent);
    ipcMain.handle('mode', () => { switchMode(); });
    ipcMain.handle('hide', () => { if (win) win.hide(); });
    ipcMain.handle('quit', () => { quitting = true; app.quit(); });
    ipcMain.handle('export', async () => {
      const r = await dialog.showSaveDialog(win, { defaultPath: 'war-room-tasks.csv', filters: [{ name: 'CSV', extensions: ['csv'] }] });
      if (r.canceled || !r.filePath) return false;
      fs.writeFileSync(r.filePath, '﻿' + store.exportCSV());
      return true;
    });
    ipcMain.handle('pick', async () => {
      const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'CSV', extensions: ['csv', 'tsv', 'txt'] }] });
      if (r.canceled) return withMeta(store.view());
      let added = 0, skipped = 0;
      for (const f of r.filePaths) {
        try { const x = store.importText(fs.readFileSync(f, 'utf8')); added += x.added; skipped += x.skipped; store.note(path.basename(f) + ': +' + x.added + (x.skipped ? ', ' + x.skipped + ' skipped' : '')); }
        catch (e) { store.note(path.basename(f) + ': could not read'); }
      }
      store.save();
      return Object.assign(withMeta(store.view()), { result: { added, skipped } });
    });

    startApi();
    createWindow();
    buildTray();
    try { if (cfg.hotkey) globalShortcut.register(cfg.hotkey, toggleShow); } catch (e) { /* shortcut invalid or taken by another app */ }
    setInterval(remind, 20 * 1000);
    app.on('activate', show);
  });
  app.on('before-quit', () => { quitting = true; });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', () => { if (!switching && process.platform !== 'darwin') app.quit(); });
}
