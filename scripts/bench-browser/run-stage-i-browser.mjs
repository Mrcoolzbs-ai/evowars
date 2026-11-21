// ============================================
// STAGE I — BROWSER BENCHMARK DRIVER (Chromium/Chrome)
// Persistent Rust/WASM Kinetics Session
// ============================================
//
// Запуск: npm run benchmark:browser
//
// Единый файл БЕЗ npm-зависимостей (package-lock не меняется):
// 1. node:http статический сервер КОРНЯ репозитория на 127.0.0.1
//    (MIME .wasm = application/wasm обязателен для WebAssembly);
// 2. запуск Chromium/Chrome headless (--headless=new) с remote
//    debugging (бинарник: $CHROME_PATH или типичные пути Linux CI);
// 3. мини-клиент CDP поверх глобального WebSocket (Node >= 22):
//    Runtime.enable (логи/исключения страницы в stderr) + поллинг
//    window.__stageIResult / window.__stageIError через
//    Runtime.evaluate (страница сама выполняет весь benchmark:
//    Worker + heartbeat + main-thread контраст);
// 4. артефакты: benchmark-artifacts/stage-i-browser-report.json и
//    benchmark-artifacts/stage-i-browser-summary.md.
//
// Это НЕ puppeteer: протокол CDP используется напрямую. Если
// Chromium не найден — выход с ошибкой (браузерный speedup НЕ
// объявляется по Node-бенчмарку).
//
// Exit code: 0 — прогон завершён (вердикт может быть любым,
// включая NO-GO); 1 — прогон не состоялся.

'use strict';

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const PAGE_PATH = '/rust/bench-web/stage-i.html';
const ARTIFACTS_DIR = join(REPO_ROOT, 'benchmark-artifacts');
const POLL_INTERVAL_MS = 10_000;
const TOTAL_TIMEOUT_MS = 12 * 60 * 1000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json'
};

function log(msg) {
  process.stderr.write(`[stage-i-browser] ${msg}\n`);
}

// --- 1. Статический сервер корня репозитория ---
const server = createServer((req, res) => {
  try {
    const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
    let filePath = normalize(join(REPO_ROOT, urlPath));
    if (!filePath.startsWith(REPO_ROOT + sep) && filePath !== REPO_ROOT) {
      res.writeHead(403);
      res.end('forbidden');
      return;
    }
    if (filePath.endsWith(sep)) {
      filePath = join(filePath, 'index.html');
    }
    if (!existsSync(filePath)) {
      res.writeHead(404);
      res.end('not found: ' + urlPath);
      return;
    }
    if (!statSync(filePath).isFile()) {
      res.writeHead(404);
      res.end('not a file: ' + urlPath);
      return;
    }
    const ext = filePath.slice(filePath.lastIndexOf('.'));
    res.writeHead(200, {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'cache-control': 'no-store'
    });
    // Синхронное чтение в память: файлы репо/wasm помещаются, сервер
    // обслуживает один benchmark-прогон.
    res.end(readFileSync(filePath));
  } catch (e) {
    res.writeHead(500);
    res.end(String(e));
  }
});

// --- 2. Поиск Chromium/Chrome ---
function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ].filter(Boolean);
  for (const c of candidates) {
    if (existsSync(c)) {
      return c;
    }
  }
  throw new Error('Chromium/Chrome не найден: задайте CHROME_PATH (браузерный benchmark обязателен для Stage I).');
}

// --- 3. Мини-клиент CDP ---
class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) {
          reject(new Error('CDP: ' + JSON.stringify(msg.error)));
        } else {
          resolve(msg.result);
        }
        return;
      }
      if (msg.method === 'Runtime.consoleAPICalled') {
        const text = (msg.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ');
        log(`[console.${msg.params.type}] ${text}`);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        log('[exception] ' + JSON.stringify(msg.params.exceptionDetails));
      }
    });
    this.opened = new Promise((resolveOpen, rejectOpen) => {
      this.ws.addEventListener('open', resolveOpen);
      this.ws.addEventListener('error', (ev) => rejectOpen(new Error('CDP WebSocket error: ' + JSON.stringify(ev))));
    });
  }

  async send(method, params = {}) {
    await this.opened;
    const id = this.nextId++;
    const promise = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.ws.send(JSON.stringify({ id, method, params }));
    return promise;
  }

  close() {
    try {
      this.ws.close();
    } catch {
      // уже закрыт
    }
  }
}

async function waitForJson(httpPort, path, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${httpPort}${path}`);
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // Chrome ещё поднимается — повторяем.
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Chrome не ответил на ${path} за ${timeoutMs} мс`);
}

function fmtMs(x) {
  return x === null || x === undefined ? 'н/д' : Number(x).toFixed(4);
}

async function main() {
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const httpPort = server.address().port;
  log(`статический сервер: http://127.0.0.1:${httpPort}/ (корень репо)`);

  const chromePath = findChrome();
  const cdpPort = 10000 + Math.floor(Math.random() * 40000);
  const userDataDir = join(tmpdir(), `stage-i-chrome-${Date.now()}`);
  const pageUrl = `http://127.0.0.1:${httpPort}${PAGE_PATH}`;
  log(`chrome: ${chromePath}; CDP порт: ${cdpPort}; страница: ${pageUrl}`);

  const chrome = spawn(chromePath, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${userDataDir}`,
    '--disable-features=Translate,MediaRouter',
    pageUrl
  ], { stdio: ['ignore', 'ignore', 'inherit'] });
  let chromeClosed = false;
  chrome.on('close', () => {
    chromeClosed = true;
  });

  try {
    const version = await waitForJson(cdpPort, '/json/version', 30_000);
    log('chrome version: ' + (version.Browser ?? 'unknown'));

    let pageTarget = null;
    for (let attempt = 0; attempt < 40; attempt++) {
      const targets = await waitForJson(cdpPort, '/json/list', 5_000);
      pageTarget = targets.find(
        (t) => t.type === 'page' && String(t.url).includes('stage-i.html')
      );
      if (pageTarget !== null && pageTarget.webSocketDebuggerUrl) {
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    if (pageTarget === null || !pageTarget.webSocketDebuggerUrl) {
      throw new Error('CDP: не найдена страница stage-i.html среди targets');
    }

    const cdp = new CdpClient(pageTarget.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');

    const deadline = Date.now() + TOTAL_TIMEOUT_MS;
    let payload = null;
    while (Date.now() < deadline) {
      const res = await cdp.send('Runtime.evaluate', {
        expression: 'JSON.stringify({r: window.__stageIResult ?? null, e: window.__stageIError ?? null})',
        returnByValue: true
      });
      if (res.exceptionDetails) {
        throw new Error('Runtime.evaluate exception: ' + JSON.stringify(res.exceptionDetails));
      }
      const parsed = JSON.parse(res.result.value);
      if (parsed !== null && (parsed.r !== null || parsed.e !== null)) {
        payload = parsed;
        break;
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    cdp.close();

    if (payload === null) {
      throw new Error(`benchmark не завершился за ${TOTAL_TIMEOUT_MS / 60000} мин (результат на странице не появился)`);
    }
    if (payload.e !== null) {
      throw new Error('ошибка на странице: ' + String(payload.e));
    }

    const pageResult = payload.r;
    const report = {
      meta: {
        date: new Date().toISOString(),
        driver: 'scripts/bench-browser/run-stage-i-browser.mjs (CDP, без puppeteer)',
        chrome: version.Browser ?? 'unknown',
        page: PAGE_PATH,
        pollIntervalMs: POLL_INTERVAL_MS,
        repoRootServed: true
      },
      result: pageResult
    };

    mkdirSync(ARTIFACTS_DIR, { recursive: true });
    const reportPath = join(ARTIFACTS_DIR, 'stage-i-browser-report.json');
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');

    // --- Сводка ---
    const w = pageResult.worker ?? {};
    const lines = [];
    lines.push('# Stage I — браузерный benchmark (Chromium headless): сводка');
    lines.push('');
    lines.push(`- Дата: ${report.meta.date}`);
    lines.push(`- Chrome: ${report.meta.chrome}`);
    lines.push(`- Инициализация WASM в воркере: ${w.meta?.wasmInitMs ?? 'н/д'} мс`);
    lines.push('');
    lines.push('## preparedTS vs Rust/WASM-сессия (Worker, одна среда)');
    lines.push('');
    lines.push('| ops | prepTS, ms | prepSession, ms | холодный тик, ms | tick preparedTS, ms | tick session, ms | speedup | break-even, тиков |');
    lines.push('|---:|---:|---:|---:|---:|---:|---:|---:|');
    for (const n of ['1000', '10000', '100000', '1000000']) {
      const row = w.loads?.[n];
      if (row === undefined) {
        lines.push(`| ${n} | н/д | | | | | | |`);
        continue;
      }
      lines.push(
        `| ${n} | ${fmtMs(row.prepTs?.medianMs)} | ${fmtMs(row.prepSession?.medianMs)} | ${fmtMs(row.coldFirstTickSessionMs)} | ${fmtMs(row.tickPreparedTs?.medianMs)} | ${fmtMs(row.tickSession?.medianMs)} | ${row.speedupSessionVsPreparedTs ?? 'н/д'}× | ${row.breakEvenTicks ?? 'н/д'} |`
      );
    }
    lines.push('');
    lines.push('## Перенос данных (2×8n байт, postMessage)');
    lines.push('');
    lines.push('| ops | bytes | clone, ms/сообщение | zero-copy (transfer), ms/сообщение |');
    lines.push('|---:|---:|---:|---:|');
    for (const n of ['1000', '10000', '100000', '1000000']) {
      const row = w.loads?.[n];
      if (row === undefined || row.transfer === undefined) {
        continue;
      }
      lines.push(`| ${n} | ${row.transfer.bytes} | ${fmtMs(row.transfer.clonePerMessageMs)} | ${fmtMs(row.transfer.zeroCopyPerMessageMs)} |`);
    }
    lines.push('');
    lines.push('## Память и heartbeat');
    lines.push('');
    for (const n of ['1000', '10000', '100000', '1000000']) {
      const row = w.loads?.[n];
      if (row === undefined || row.memory === undefined) {
        continue;
      }
      lines.push(`- ${n}: параметры сессии ${(row.memory.sessionParamBytes / 1048576).toFixed(2)} MB`);
    }
    const hb = pageResult.heartbeat;
    if (hb !== undefined) {
      const workerPhases = Object.entries(hb.maxGapByPhase ?? {}).filter(
        ([phase]) => phase !== 'mainThreadContrast' && phase !== 'startup'
      );
      const maxWorkerGap = workerPhases.reduce((acc, [, v]) => Math.max(acc, v), 0);
      lines.push(`- Heartbeat (интервал ${hb.intervalMs} мс): максимальный зазор в фазах Worker: ${maxWorkerGap.toFixed(1)} мс; в фазе блокирующих тиков на главном потоке: ${(hb.maxGapByPhase?.mainThreadContrast ?? 0).toFixed(1)} мс (контраст «Worker не блокирует UI»).`);
    }
    lines.push('');
    const v = w.verdict ?? {};
    lines.push(`## Вердикт (браузер)`);
    lines.push('');
    lines.push(`- speedup session vs preparedTS: 1e5 = ${v.speedupSessionVsPreparedTs100k ?? 'н/д'}×, 1e6 = ${v.speedupSessionVsPreparedTs1m ?? 'н/д'}×`);
    lines.push(`- Порог GO (>= 1.5× на 1e5 и 1e6): ${v.browserMeetsThreshold1_5x === true ? 'ДОСТИГНУТ' : v.browserMeetsThreshold1_5x === false ? 'НЕ достигнут' : 'н/д'}`);
    lines.push('');
    lines.push('Полные данные: stage-i-browser-report.json. Node-прогон: prepared-kinetics-report.json.');
    writeFileSync(join(ARTIFACTS_DIR, 'stage-i-browser-summary.md'), lines.join('\n') + '\n', 'utf8');

    log('артефакты записаны: ' + reportPath);
    process.exitCode = 0;
  } finally {
    if (!chromeClosed) {
      chrome.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 500));
      chrome.kill('SIGKILL');
    }
    server.close();
  }
}

main().catch((e) => {
  log('FAIL: ' + String((e && e.stack) || e));
  process.exitCode = 1;
});
