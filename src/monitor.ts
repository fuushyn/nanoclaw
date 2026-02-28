/**
 * Streaming Monitor UI for NanoClaw
 *
 * Deep module with a simple interface: start(), stop(), emit().
 * Serves a real-time SSE dashboard showing agent activity across all groups.
 */
import http from 'http';

import { MONITOR_PORT } from './config.js';
import { logger } from './logger.js';

// --- SSE fan-out ---

interface SSEClient {
  res: http.ServerResponse;
  id: number;
}

let clients: SSEClient[] = [];
let clientIdCounter = 0;
let server: http.Server | null = null;

// Ring buffer for recent events — new clients get history on connect
const BUFFER_SIZE = 500;
const eventBuffer: string[] = [];

function bufferEvent(data: string): void {
  eventBuffer.push(data);
  if (eventBuffer.length > BUFFER_SIZE) {
    eventBuffer.shift();
  }
}

function sendToAll(data: string): void {
  for (const client of clients) {
    client.res.write(`data: ${data}\n\n`);
  }
}

// --- Public API ---

export function emit(group: string, type: string, subtype: string, summary: string): void {
  const event = JSON.stringify({
    time: new Date().toLocaleTimeString('en-GB', { hour12: false }),
    group,
    type,
    subtype,
    summary,
  });
  bufferEvent(event);
  if (clients.length > 0) {
    sendToAll(event);
  }
}

export function start(): void {
  server = http.createServer((req, res) => {
    if (req.url === '/events') {
      // SSE endpoint
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });

      const id = clientIdCounter++;
      const client: SSEClient = { res, id };
      clients.push(client);

      // Send buffered history then connected confirmation
      for (const event of eventBuffer) {
        res.write(`data: ${event}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

      // Keepalive every 15s
      const keepalive = setInterval(() => {
        res.write(': keepalive\n\n');
      }, 15000);

      req.on('close', () => {
        clearInterval(keepalive);
        clients = clients.filter((c) => c.id !== id);
      });

      return;
    }

    // Dashboard HTML
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(DASHBOARD_HTML);
  });

  server.listen(MONITOR_PORT, () => {
    logger.info(`Monitor UI available at http://localhost:${MONITOR_PORT}`);
  });
}

export function stop(): void {
  if (server) {
    for (const client of clients) {
      client.res.end();
    }
    clients = [];
    server.close();
    server = null;
  }
}

// --- Inline Dashboard ---

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>NanoClaw Monitor</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #0d1117;
    color: #c9d1d9;
    font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', monospace;
    font-size: 13px;
    height: 100vh;
    display: flex;
    flex-direction: column;
  }
  header {
    padding: 8px 16px;
    background: #161b22;
    border-bottom: 1px solid #30363d;
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-shrink: 0;
  }
  header h1 { font-size: 14px; font-weight: 600; color: #58a6ff; }
  #status { font-size: 12px; color: #8b949e; }
  #status.connected { color: #3fb950; }
  .controls {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .controls label {
    font-size: 12px;
    color: #8b949e;
    cursor: pointer;
    user-select: none;
  }
  .controls input[type="checkbox"] { cursor: pointer; }
  .toggle-btn {
    font-size: 11px;
    padding: 3px 10px;
    border: 1px solid #30363d;
    border-radius: 4px;
    background: transparent;
    color: #8b949e;
    cursor: pointer;
    font-family: inherit;
  }
  .toggle-btn:hover { color: #c9d1d9; border-color: #484f58; }
  .toggle-btn.active { color: #f0883e; border-color: #f0883e; background: rgba(240,136,62,0.1); }

  /* Group filter tabs */
  #tabs {
    display: flex;
    gap: 0;
    padding: 0 16px;
    background: #161b22;
    border-bottom: 1px solid #30363d;
    flex-shrink: 0;
    overflow-x: auto;
  }
  .tab {
    padding: 6px 14px;
    font-size: 12px;
    color: #8b949e;
    cursor: pointer;
    border-bottom: 2px solid transparent;
    white-space: nowrap;
    user-select: none;
  }
  .tab:hover { color: #c9d1d9; }
  .tab.active { color: #58a6ff; border-bottom-color: #58a6ff; }
  .tab .count {
    display: inline-block;
    margin-left: 5px;
    padding: 0 5px;
    background: #30363d;
    border-radius: 8px;
    font-size: 10px;
    color: #8b949e;
    min-width: 16px;
    text-align: center;
  }

  #log {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
  }
  .row {
    padding: 2px 16px 2px 12px;
    border-left: 3px solid transparent;
    line-height: 1.5;
    cursor: default;
  }
  .row .meta {
    display: flex;
  }
  .row.hidden { display: none; }
  .row:hover { background: #161b22; }
  .row .time { color: #484f58; width: 70px; flex-shrink: 0; }
  .row .group { color: #8b949e; width: 100px; flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row .badge {
    display: inline-block;
    width: 90px;
    flex-shrink: 0;
    font-weight: 600;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  .row .summary-line { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row .detail {
    display: none;
    margin: 4px 0 6px 170px;
    padding: 8px 12px;
    background: #161b22;
    border-radius: 4px;
    border: 1px solid #21262d;
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 12px;
    color: #8b949e;
    max-height: 400px;
    overflow-y: auto;
  }
  .row.expanded .detail { display: block; }
  .row.expandable { cursor: pointer; }
  .row.expandable .summary-line::before {
    content: '\\25B6';
    font-size: 9px;
    margin-right: 6px;
    color: #484f58;
  }
  .row.expandable.expanded .summary-line::before {
    content: '\\25BC';
  }

  /* In compact mode (debug off), hide thinking/tool_result/init/server rows */
  body:not(.debug) .row.thinking { display: none; }
  body:not(.debug) .row.tool_result { display: none; }
  body:not(.debug) .row.init { display: none; }
  body:not(.debug) .row.spawn { display: none; }
  body:not(.debug) .row.done { display: none; }
  body:not(.debug) .row.processing { display: none; }

  /* subtype colors */
  .row.thinking  { border-left-color: #d29922; }
  .row.thinking .badge { color: #d29922; }
  .row.thinking .detail { color: #d29922; opacity: 0.8; }
  .row.text      { border-left-color: #c9d1d9; }
  .row.text .badge { color: #c9d1d9; }
  .row.tool_use  { border-left-color: #58a6ff; }
  .row.tool_use .badge { color: #58a6ff; }
  .row.tool_result { border-left-color: #3fb950; }
  .row.tool_result .badge { color: #3fb950; }
  .row.tool_result .detail { color: #3fb950; opacity: 0.8; }
  .row.init      { border-left-color: #484f58; }
  .row.init .badge { color: #484f58; }
  .row.result    { border-left-color: #bc8cff; }
  .row.result .badge { color: #bc8cff; }
  .row.user      { border-left-color: #f778ba; }
  .row.user .badge { color: #f778ba; }

  /* server events */
  .row.spawn     { border-left-color: #388bfd; }
  .row.spawn .badge { color: #388bfd; }
  .row.output    { border-left-color: #a371f7; }
  .row.output .badge { color: #a371f7; }
  .row.error     { border-left-color: #f85149; }
  .row.error .badge { color: #f85149; }
  .row.error .summary-line { color: #f85149; }
  .row.done      { border-left-color: #238636; }
  .row.done .badge { color: #238636; }
  .row.processing { border-left-color: #8b949e; }
  .row.processing .badge { color: #8b949e; }

  /* Empty state */
  #empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #484f58;
    font-size: 14px;
  }
  #empty.hidden { display: none; }
</style>
</head>
<body>
  <header>
    <h1>NanoClaw Monitor</h1>
    <div class="controls">
      <span id="status">Connecting...</span>
      <button class="toggle-btn" id="debugBtn">Debug</button>
      <label><input type="checkbox" id="autoscroll" checked> Auto-scroll</label>
    </div>
  </header>
  <div id="tabs"><div class="tab active" data-group="*">All</div></div>
  <div id="empty">Waiting for agent activity...</div>
  <div id="log"></div>
<script>
(function() {
  var log = document.getElementById('log');
  var status = document.getElementById('status');
  var autoscroll = document.getElementById('autoscroll');
  var tabs = document.getElementById('tabs');
  var empty = document.getElementById('empty');
  var debugBtn = document.getElementById('debugBtn');
  var MAX_EVENTS = 1000;
  var activeGroup = '*';
  var groupCounts = {};
  var debugMode = localStorage.getItem('nc_debug') === '1';

  function applyDebug() {
    document.body.classList.toggle('debug', debugMode);
    debugBtn.classList.toggle('active', debugMode);
    debugBtn.textContent = debugMode ? 'Debug ON' : 'Debug';
    localStorage.setItem('nc_debug', debugMode ? '1' : '0');
  }
  applyDebug();

  debugBtn.onclick = function() {
    debugMode = !debugMode;
    applyDebug();
    if (autoscroll.checked) log.scrollTop = log.scrollHeight;
  };

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function ensureTab(group) {
    if (!group || document.querySelector('.tab[data-group="' + CSS.escape(group) + '"]')) return;
    var tab = document.createElement('div');
    tab.className = 'tab';
    tab.dataset.group = group;
    groupCounts[group] = 0;
    tab.innerHTML = esc(group) + ' <span class="count">0</span>';
    tab.onclick = function() { setActiveGroup(group); };
    tabs.appendChild(tab);
  }

  function updateTabCount(group) {
    groupCounts[group] = (groupCounts[group] || 0) + 1;
    var tab = document.querySelector('.tab[data-group="' + CSS.escape(group) + '"]');
    if (tab) {
      var cnt = tab.querySelector('.count');
      if (cnt) cnt.textContent = groupCounts[group];
    }
  }

  function setActiveGroup(group) {
    activeGroup = group;
    document.querySelectorAll('.tab').forEach(function(t) {
      t.classList.toggle('active', t.dataset.group === group);
    });
    document.querySelectorAll('.row').forEach(function(row) {
      if (group === '*' || row.dataset.group === group) {
        row.classList.remove('hidden');
      } else {
        row.classList.add('hidden');
      }
    });
    if (autoscroll.checked) log.scrollTop = log.scrollHeight;
  }

  tabs.querySelector('.tab').onclick = function() { setActiveGroup('*'); };

  // Format tool_use summary: extract tool name and show params
  function formatSummary(e) {
    var s = e.summary || '';
    if (e.subtype === 'tool_use') {
      var m = s.match(/^([^(]+)\\((.*)\\)$/s);
      if (m) return '<span style="color:#79c0ff">' + esc(m[1]) + '</span>(' + esc(m[2]).slice(0, 120) + (m[2].length > 120 ? '...' : '') + ')';
    }
    if (e.subtype === 'error') return '<span style="color:#f85149">' + esc(s) + '</span>';
    // Truncate long summaries in the one-liner
    return esc(s.length > 200 ? s.slice(0, 200) + '...' : s);
  }

  function addRow(e) {
    empty.classList.add('hidden');
    ensureTab(e.group);
    updateTabCount(e.group);

    var sub = e.subtype || '';
    var fullText = e.summary || '';
    var isLong = fullText.length > 100;
    // tool_result is always expandable (even short results are easier to read expanded)
    var expandable = (sub === 'tool_result' && fullText.length > 20) || (isLong && (sub === 'thinking' || sub === 'text' || sub === 'tool_use' || sub === 'output' || sub === 'error'));

    var row = document.createElement('div');
    row.className = 'row ' + sub + (expandable ? ' expandable' : '');
    row.dataset.group = e.group || '';
    if (activeGroup !== '*' && e.group !== activeGroup) {
      row.classList.add('hidden');
    }

    var label = sub;
    if (e.type === 'server') label = sub;

    var html = '<div class="meta">' +
      '<span class="time">' + esc(e.time || '') + '</span>' +
      '<span class="group">' + esc(e.group || '') + '</span>' +
      '<span class="badge">' + esc(label) + '</span>' +
      '<span class="summary-line">' + formatSummary(e) + '</span>' +
      '</div>';

    if (expandable) {
      html += '<div class="detail">' + esc(fullText) + '</div>';
    }

    row.innerHTML = html;

    if (expandable) {
      row.onclick = function() { row.classList.toggle('expanded'); };
    }

    log.appendChild(row);

    while (log.children.length > MAX_EVENTS) {
      log.removeChild(log.firstChild);
    }

    if (autoscroll.checked) {
      log.scrollTop = log.scrollHeight;
    }
  }

  function connect() {
    var es = new EventSource('/events');

    es.onmessage = function(ev) {
      try {
        var data = JSON.parse(ev.data);
        if (data.type === 'connected') {
          status.textContent = 'Connected';
          status.className = 'connected';
          return;
        }
        addRow(data);
      } catch(e) {}
    };

    es.onerror = function() {
      status.textContent = 'Disconnected';
      status.className = '';
      es.close();
      setTimeout(connect, 2000);
    };
  }

  connect();
})();
</script>
</body>
</html>`;
