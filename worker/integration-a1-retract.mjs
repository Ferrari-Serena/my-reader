#!/usr/bin/env node
/**
 * A1 retract · pre-merge integration test（Miniflare/local D1）
 *
 * 本地起 Worker + 本地 D1 seed + 405/401/403/404/200 + 审计类型检查；不碰 remote。
 * 用法：node worker/integration-a1-retract.mjs [--keep]
 * Env：METRICS_TOKEN_TEST（必需，缺失 exit 2）；WRANGLER_PORT（默认 8789）；
 *      WRANGLER_CMD（默认 npx wrangler）；WRANGLER_CONFIG（可选，默认 worker/wrangler.toml）
 * 退出：0 全过；1 用例失败；2 环境/启动失败。
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SQL_FILE = path.join(HERE, 'test-fixtures/a1-retract-local.sql');
const CASES_FILE = path.join(HERE, 'test-fixtures/a1-retract-cases.json');
const PORT = Number(process.env.WRANGLER_PORT || 8789);
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = process.env.METRICS_TOKEN_TEST || '';
const WIN = process.platform === 'win32';
const NPX = process.env.WRANGLER_CMD || (WIN ? 'npx.cmd' : 'npx');
const KEEP = process.argv.includes('--keep');

if (!TOKEN) { console.error('FAIL：缺 METRICS_TOKEN_TEST（不跳过）'); process.exit(2); }
if (!fs.existsSync(SQL_FILE) || !fs.existsSync(CASES_FILE)) { console.error('FAIL：缺 fixtures'); process.exit(2); }

const configArg = () => {
  const c = process.env.WRANGLER_CONFIG || (fs.existsSync(path.join(HERE, 'wrangler.toml')) ? path.join(HERE, 'wrangler.toml') : '');
  return c ? ['--config', c] : [];
};
const run = (args, opts = {}) => spawnSync(NPX, ['wrangler', ...args], {
  cwd: HERE, encoding: 'utf8', timeout: 180000, shell: WIN, ...opts,
});
const d1 = (args) => run(['d1', 'execute', 'my-reader-dict', '--local', ...configArg(), ...args]);
const d1File = (sql, extra = []) => {
  const tmp = path.join(HERE, `.tmp-a1-${process.pid}-${Date.now()}.sql`);
  fs.writeFileSync(tmp, sql + '\n');
  const r = d1(['--file=' + tmp, ...extra]);
  fs.rmSync(tmp, { force: true });
  return r;
};
const d1Json = (sql) => {
  const r = d1File(sql, ['--json']);
  if (r.status !== 0) throw new Error(`d1 failed: ${(r.stderr || r.stdout || '').slice(0, 500)}`);
  const text = String(r.stdout || '');
  let data;
  try { data = JSON.parse(text); } catch {
    const a = text.indexOf('[');
    const b = text.lastIndexOf(']');
    if (a < 0 || b < a) throw new Error('d1 --json 输出解析失败');
    data = JSON.parse(text.slice(a, b + 1));
  }
  const first = Array.isArray(data) ? data[0] : data;
  return (first && (first.results || first.result || first)) || [];
};

const hash = crypto.randomBytes(32).toString('hex');
const ms = Date.now();
const cacheKey = `public:${hash}`;
const cacheKeyHash = crypto.createHash('sha256').update(cacheKey).digest('hex');
const sub = (s) => String(s)
  .replace(/<64hex>/g, hash)
  .replace(/<ms>/g, String(ms))
  .replace(/\$\{TOKEN\}/g, TOKEN);
const subDeep = (v) => typeof v === 'string' ? sub(v)
  : Array.isArray(v) ? v.map(subDeep)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, subDeep(x)]))
  : v;

console.log('== A1 retract integration (local) ==');
const schema = d1(['--file=' + SQL_FILE]);
if (schema.status !== 0) {
  console.error('FAIL：local D1 schema 失败\n' + String(schema.stderr || schema.stdout).slice(-1500));
  process.exit(2);
}

const devArgs = ['dev', '--local', '--port', String(PORT), ...configArg(), '--var', `METRICS_TOKEN:${TOKEN}`, '--var', 'PHRASE_CLOUD_DISABLED:1'];
const dev = spawn(NPX, ['wrangler', ...devArgs], { cwd: HERE, shell: WIN, stdio: ['ignore', 'pipe', 'pipe'] });
let devLog = '';
dev.stdout.on('data', (d) => { devLog += d; });
dev.stderr.on('data', (d) => { devLog += d; });

const sleep = (n) => new Promise((r) => setTimeout(r, n));
async function waitReady() {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(BASE + '/api/phrase/config');
      if (r.status === 200) return true;
    } catch {}
    await sleep(500);
  }
  return false;
}
function stopDev() {
  if (!dev.pid) return;
  if (WIN) spawnSync('taskkill', ['/PID', String(dev.pid), '/T', '/F'], { shell: true });
  else dev.kill('SIGTERM');
}

let failed = 0;
const results = [];
try {
  if (!(await waitReady())) {
    console.error('FAIL：wrangler dev 30s 内未就绪\n' + devLog.slice(-2000));
    process.exit(2);
  }
  const spec = JSON.parse(fs.readFileSync(CASES_FILE, 'utf8'));
  for (const c of spec.cases || []) {
    const problems = [];
    if (c.pre_sql) {
      const r = d1File(sub(c.pre_sql));
      if (r.status !== 0) problems.push('pre_sql failed: ' + String(r.stderr || r.stdout).slice(0, 300));
    }
    const headers = Object.fromEntries(Object.entries(subDeep(c.headers || {})).map(([k, v]) => [k, String(v)]));
    const init = { method: c.method || 'GET', headers };
    if (c.body !== undefined) {
      init.body = JSON.stringify(subDeep(c.body));
      if (!Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) headers['content-type'] = 'application/json';
    }
    let res, text = '', json = null;
    try {
      res = await fetch(BASE + c.path, init);
      text = await res.text();
      try { json = JSON.parse(text); } catch {}
    } catch (e) {
      problems.push('fetch failed: ' + String(e.message || e));
    }
    if (res) {
      if (res.status !== c.expect_status) problems.push(`status ${res.status} != ${c.expect_status}`);
      for (const [k, v] of Object.entries(c.expect_json || {})) {
        if (JSON.stringify(json && json[k]) !== JSON.stringify(v)) problems.push(`json.${k} != ${JSON.stringify(v)}`);
      }
      for (const [k, v] of Object.entries(c.expect_headers || {})) {
        if (String(res.headers.get(k) || '').toLowerCase() !== String(v).toLowerCase()) problems.push(`header ${k} != ${v}`);
      }
    }
    if (!problems.length && Array.isArray(c.post_checks)) {
      try {
        const cacheRow = d1Json(`SELECT COUNT(*) AS n FROM phrase_cloud_cache WHERE cache_key='${cacheKey}';`);
        const auditRow = d1Json(`SELECT retracted_at,scope_kind,book_id,answer_rank,schema_ver,model_ver,prompt_ver,lexicon_ver,operator FROM phrase_retract_log WHERE cache_key_hash='${cacheKeyHash}' ORDER BY id DESC LIMIT 1;`);
        const cacheCount = Number(cacheRow[0] && cacheRow[0].n);
        const audit = auditRow[0] || null;
        for (const chk of c.post_checks) {
          if (chk === 'cache_count=0' && cacheCount !== 0) problems.push(`cache_count=${cacheCount}`);
          if (chk === 'audit_count=1' && !audit) problems.push('audit row missing');
          if (chk === 'retracted_at integer' && !(audit && typeof audit.retracted_at === 'number' && Number.isInteger(audit.retracted_at))) problems.push('retracted_at not integer');
          if (chk === 'schema_ver/model_ver/prompt_ver/lexicon_ver null' && audit && ['schema_ver', 'model_ver', 'prompt_ver', 'lexicon_ver'].some((k) => audit[k] !== null)) problems.push('version metadata not null');
          if (chk === 'scope_kind=public' && !(audit && audit.scope_kind === 'public')) problems.push('scope_kind');
          if (chk === 'book_id=probe-null' && !(audit && audit.book_id === 'probe-null')) problems.push('book_id');
          if (chk === 'answer_rank=3' && !(audit && Number(audit.answer_rank) === 3)) problems.push('answer_rank');
          if (chk === 'operator=metrics-token' && !(audit && String(audit.operator).includes('metrics-token'))) problems.push('operator');
        }
      } catch (e) {
        problems.push('post_checks failed: ' + String(e.message || e));
      }
    }
    if (c.post_sql) {
      const r = d1File(sub(c.post_sql));
      if (r.status !== 0) problems.push('post_sql failed');
    }
    results.push({ name: c.name, ok: problems.length === 0, problems, status: res && res.status });
    if (problems.length) failed++;
    console.log(`${problems.length ? 'FAIL' : 'ok  '} ${c.name}${problems.length ? ' — ' + problems.join('; ') : ''}`);
  }
  // cleanup test rows even if checks fail
  try {
    d1File(`DELETE FROM phrase_retract_log WHERE cache_key_hash='${cacheKeyHash}'; DELETE FROM phrase_cloud_cache WHERE cache_key='${cacheKey}';`);
  } catch {}
} finally {
  if (!KEEP) stopDev();
  else console.log(`--keep：dev pid=${dev.pid}（${BASE}）`);
}

const ok = failed === 0;
console.log(`${ok ? 'PASS' : 'FAIL'} A1 retract integration · ${results.length - failed}/${results.length}`);
console.log(JSON.stringify({ ok, hash, cacheKeyHash, results }, null, 2));
process.exit(ok ? 0 : 1);
