// Local agent API. Pure routing so it can be tested without Electron; main.js does the HTTP and the token check.
function handle(store, method, url, body, ctype) {
  const p = url.split('?')[0].replace(/\/+$/, '') || '/';
  if (method === 'GET' && p === '/') return { status: 200, json: { app: 'war-room', endpoints: ['GET /tasks', 'POST /tasks', 'POST /import', 'POST /tasks/{id}/done', 'DELETE /tasks/{id}'] } };
  if (method === 'GET' && p === '/tasks') {
    const v = store.view();
    return { status: 200, json: { today: v.today, level: v.lv.level, xp: v.xp, streak: v.streak, tasks: v.tasks } };
  }
  if (method === 'POST' && p === '/tasks') {
    let data;
    try { data = JSON.parse(body); } catch (e) { return { status: 400, json: { error: 'Body must be JSON: one task object or an array of them. Fields: title, category, due, time, priority, repeat, notes.' } }; }
    const list = Array.isArray(data) ? data : [data];
    const added = [];
    let skipped = 0;
    for (const o of list) { const t = store.addTask(o); if (t) added.push(t); else skipped++; }
    store.note('agent: +' + added.length + (skipped ? ', ' + skipped + ' skipped' : ''));
    store.save();
    return { status: 200, json: { added, skipped }, changed: true };
  }
  if (method === 'POST' && p === '/import') {
    const r = store.importText(String(body || ''));
    store.note('agent CSV: +' + r.added + (r.skipped ? ', ' + r.skipped + ' skipped' : ''));
    store.save();
    return { status: 200, json: r, changed: true };
  }
  let m = p.match(/^\/tasks\/([\w-]+)\/done$/);
  if (method === 'POST' && m) {
    const t = store.find(m[1]);
    if (!t) return { status: 404, json: { error: 'No task with that id. GET /tasks lists ids.' } };
    if (!t.done) store.act('toggle', { id: t.id });
    return { status: 200, json: { task: store.find(m[1]) }, changed: true };
  }
  m = p.match(/^\/tasks\/([\w-]+)$/);
  if (method === 'DELETE' && m) {
    if (!store.find(m[1])) return { status: 404, json: { error: 'No task with that id.' } };
    store.act('del', { id: m[1] });
    return { status: 200, json: { deleted: m[1] }, changed: true };
  }
  return { status: 404, json: { error: 'Unknown route. GET / lists the endpoints.' } };
}
module.exports = { handle };
