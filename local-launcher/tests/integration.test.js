import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parseApps } from '../extension/lib/apps-core.js';

const source = readFileSync(new URL('../extension/launcher.js', import.meta.url), 'utf8').replace(/^import .*;\s*/, '');
function element() { return { hidden: true, children: [], textContent: '', listeners: {}, append(...items) { this.children.push(...items); }, replaceChildren(...items) { this.children = items; }, addEventListener(name, fn) { this.listeners[name] = fn; } }; }
for (const failure of ['offline', 'http', 'json', 'schema']) {
  test(`launcher handles ${failure} and recovers on Retry`, async () => {
    const nodes = Object.fromEntries(['list','error','error-msg','retry'].map(id => [id, element()]));
    let fail = true;
    const context = vm.createContext({ parseApps, document: { getElementById: id => nodes[id], createElement: element }, chrome: {}, fetch: async () => {
      if (fail && failure === 'offline') throw new Error('offline');
      return { ok: !(fail && failure === 'http'), status: 500, json: async () => {
        if (fail && failure === 'json') throw new SyntaxError();
        return fail && failure === 'schema' ? {} : { apps: [{ id: 'sip', name: 'Sip', file: 'sip.html' }] };
      } };
    } });
    vm.runInContext(source, context);
    await vm.runInContext('load()', context);
    assert.equal(nodes.error.hidden, false);
    assert.match(nodes['error-msg'].textContent, /Server not running/);
    fail = false;
    await nodes.retry.listeners.click();
    assert.equal(nodes.error.hidden, true);
    assert.equal(nodes.list.children.length, 1);
  });
}

test('worker serializes duplicate clicks, keeps other apps, and replaces stale IDs', async () => {
  let listener; let state = {}; let next = 1;
  const windows = new Map();
  globalThis.chrome = {
    storage: { session: { get: async () => ({ openWindows: structuredClone(state) }), set: async value => { state = value.openWindows; } } },
    windows: { get: async id => { if (!windows.has(id)) throw new Error('closed'); return { id }; }, update: async id => ({ id }), create: async () => { const id = next++; windows.set(id, true); return { id }; } },
    runtime: { onMessage: { addListener: fn => { listener = fn; } } }
  };
  try {
    await import('../extension/background.js');
    const send = appId => new Promise(resolve => listener({ type: 'open-app', appId, url: 'http://127.0.0.1:8765/sip.html', width: 380, height: 560 }, {}, resolve));
    const results = await Promise.all([send('sip'), send('sip'), send('other')]);
    assert.deepEqual(results.map(r => r.action), ['create','focus','create']);
    assert.equal(windows.size, 2);
    windows.delete(state.sip);
    assert.equal((await send('sip')).action, 'create');
    assert.deepEqual(state, { sip: 3, other: 2 });
  } finally { delete globalThis.chrome; }
});
