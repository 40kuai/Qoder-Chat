import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export const POOL_HOME = process.env.QODER_POOL_HOME || path.join(os.homedir(), '.qoder-cn-pool');
export const ACCOUNTS_FILE = path.join(POOL_HOME, 'accounts.json');
export const LEGACY_ACCOUNT_ID = 'legacy-pat';
export const CLI_INSTALL_HINT = 'curl -fsSL https://static.qoder.com.cn/qoder-cli-cn/install.sh | bash';

function ensurePoolHome() {
  fs.mkdirSync(POOL_HOME, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(POOL_HOME, 0o700);
  } catch {
    // Best effort on non-POSIX filesystems.
  }
}

function emptyStore() {
  return { version: 1, defaultAccountId: null, loadBalance: true, accounts: [] };
}

const activeLogins = new Map();
let balanceCursor = 0;

export function loadStore() {
  ensurePoolHome();
  if (!fs.existsSync(ACCOUNTS_FILE)) return emptyStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
    if (!parsed || !Array.isArray(parsed.accounts)) return emptyStore();
    parsed.version ||= 1;
    parsed.loadBalance = parsed.loadBalance !== false;
    parsed.accounts = parsed.accounts.filter((account) => account && account.id && account.label && account.authType);
    return parsed;
  } catch {
    return emptyStore();
  }
}

export function saveStore(store) {
  ensurePoolHome();
  const temp = `${ACCOUNTS_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, ACCOUNTS_FILE);
  try {
    fs.chmodSync(ACCOUNTS_FILE, 0o600);
  } catch {
    // Best effort.
  }
}

export function publicAccount(account, store) {
  const session = activeLogins.get(account.id);
  return {
    id: account.id,
    label: account.label,
    auth_type: account.authType,
    status: account.status || 'unknown',
    last_error: account.lastError || null,
    last_check_at: account.lastCheckAt || null,
    last_used_at: account.lastUsedAt || null,
    is_default: store.defaultAccountId === account.id,
    identity: account.identity || null,
    label_auto: account.labelAuto === true,
    login_url: session?.url || null,
  };
}

export function setLoadBalance(store, enabled) {
  store.loadBalance = Boolean(enabled);
  saveStore(store);
  return store.loadBalance;
}

export function pickBalancedAccount(store) {
  const healthy = store.accounts.filter((account) => account.status === 'ready');
  if (!healthy.length) return null;
  const account = healthy[balanceCursor % healthy.length];
  balanceCursor = (balanceCursor + 1) % healthy.length;
  return account;
}

export function ensureLegacyAccount(store, pat) {
  if (!pat) return null;
  let account = store.accounts.find((item) => item.authType === 'env');
  if (!account) {
    account = {
      id: LEGACY_ACCOUNT_ID,
      label: '兼容账号（PAT）',
      authType: 'env',
      configDir: null,
      status: 'ready',
      lastError: null,
      createdAt: new Date().toISOString(),
      lastCheckAt: null,
      lastUsedAt: null,
    };
    store.accounts.unshift(account);
  }
  if (!store.defaultAccountId) {
    const oauth = store.accounts.find((item) => item.authType === 'oauth' && item.id !== account.id);
    store.defaultAccountId = oauth ? oauth.id : account.id;
  }
  saveStore(store);
  return account;
}

export function addOAuthAccount(store, label) {
  const clean = String(label || '').trim();
  const labelAuto = clean.length === 0;
  if (clean.length > 40) throw new Error('账号名称不能超过 40 个字符');
  if (clean && store.accounts.some((item) => item.label.toLowerCase() === clean.toLowerCase())) {
    throw new Error('账号名称已存在');
  }
  const id = `acc_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const accountRoot = path.join(POOL_HOME, 'accounts', id);
  const configDir = path.join(accountRoot, 'cli');
  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(accountRoot, 0o700);
    fs.chmodSync(configDir, 0o700);
  } catch {
    // Best effort.
  }
  const account = {
    id,
    label: clean || `待授权账号 ${id.slice(-4)}`,
    labelAuto,
    identity: null,
    authType: 'oauth',
    configDir,
    status: 'login_required',
    lastError: null,
    createdAt: new Date().toISOString(),
    lastCheckAt: null,
    lastUsedAt: null,
  };
  store.accounts.push(account);
  if (!store.defaultAccountId) store.defaultAccountId = id;
  saveStore(store);
  return account;
}

export function findAccount(store, selector) {
  const key = String(selector || '').trim();
  if (!key) {
    return store.accounts.find((item) => item.id === store.defaultAccountId) || store.accounts[0] || null;
  }
  return (
    store.accounts.find((item) => item.id === key) ||
    store.accounts.find((item) => item.label.toLowerCase() === key.toLowerCase()) ||
    null
  );
}

export function setDefaultAccount(store, selector) {
  const account = findAccount(store, selector);
  if (!account) throw new Error('账号不存在');
  store.defaultAccountId = account.id;
  saveStore(store);
  return account;
}

export function removeAccount(store, selector) {
  const account = findAccount(store, selector);
  if (!account) throw new Error('账号不存在');
  store.accounts = store.accounts.filter((item) => item.id !== account.id);
  if (store.defaultAccountId === account.id) {
    store.defaultAccountId = store.accounts[0]?.id || null;
  }
  saveStore(store);
  return account;
}

function currentAccount(store, account) {
  return store.accounts.find((item) => item.id === account.id) || account;
}

function commitAccount(store, account) {
  const target = currentAccount(store, account);
  target.status = account.status;
  target.lastError = account.lastError;
  target.lastCheckAt = account.lastCheckAt;
  target.label = account.label;
  target.identity = account.identity;
  target.labelAuto = account.labelAuto;
  saveStore(store);
  return target;
}

export function markAccountUsed(store, account) {
  const target = currentAccount(store, account);
  target.lastUsedAt = new Date().toISOString();
  saveStore(store);
  return target;
}

export function markAccountAuthError(store, account, message = '账号认证失效，请重新登录') {
  const target = currentAccount(store, account);
  target.status = 'login_required';
  target.lastError = message;
  target.lastCheckAt = new Date().toISOString();
  saveStore(store);
  return target;
}

export function markAccountError(store, account, message) {
  const target = currentAccount(store, account);
  target.status = 'error';
  target.lastError = sanitizeText(message);
  target.lastCheckAt = new Date().toISOString();
  saveStore(store);
  return target;
}

function which(command) {
  const result = spawnSync('which', [command], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

const CLI_NAMES = ['qoderclicn', 'qodercn', 'qoder'];

export function resolveCli() {
  const explicit = (process.env.QODER_CLI_BIN || '').trim();
  if (explicit) {
    if (explicit.includes('/')) {
      if (!fs.existsSync(explicit)) throw new Error(`QODER_CLI_BIN 不存在: ${explicit}`);
      return { command: explicit, args: [], source: explicit };
    }
    const found = which(explicit);
    if (found) return { command: found, args: [], source: explicit };
    throw new Error(`QODER_CLI_BIN 不可执行: ${explicit}`);
  }

  const common = [
    path.join(os.homedir(), '.local/bin/qoderclicn'),
    path.join(os.homedir(), '.qoder-cn/bin/qoderclicn/qoderclicn'),
  ];
  for (const candidate of common) {
    if (fs.existsSync(candidate)) return { command: candidate, args: [], source: candidate };
  }
  for (const name of CLI_NAMES) {
    const found = which(name);
    if (found) return { command: found, args: [], source: name };
  }
  const npx = which('npx');
  if (npx) {
    return {
      command: npx,
      args: ['--yes', '@qodercn-ai/qoderclicn'],
      source: 'npx（首次会下载官方 CLI）',
    };
  }
  throw new Error(`未找到 Qoder CN CLI。请先安装：${CLI_INSTALL_HINT}`);
}

export function cliEnv(account, extra = {}) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('QODER_') || key.startsWith('QODERCN_')) continue;
    env[key] = value;
  }
  if (account && account.configDir) {
    env.QODERCN_CONFIG_DIR = account.configDir;
    env.QODERCN_CLI_HOME = account.configDir;
  }
  return { ...env, ...extra };
}

function sanitizeText(value) {
  return String(value || '')
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/pt-[A-Za-z0-9_-]{20,}/g, '<token>')
    .replace(/sk-[A-Za-z0-9_-]{20,}/g, '<token>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

function runProcess(command, args, { cwd, env, timeoutMs = 45000 } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      resolve({ code: null, stdout: '', stderr: String(error?.message || error), timedOut: false });
      return;
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      try {
        child.kill('SIGTERM');
      } catch {
        // Ignore.
      }
      finish({ code: null, stdout, stderr, timedOut: true });
    }, timeoutMs);
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      finish({ code: null, stdout, stderr: `${stderr}\n${error?.message || error}`, timedOut: false });
    });
    child.on('close', (code) => {
      finish({ code, stdout, stderr, timedOut: false });
    });
  });
}

function readMachineId() {
  const candidates = [
    path.join(os.homedir(), 'Library/Application Support/com.qodercn.app.stable/auth.machine-id'),
    path.join(os.homedir(), '.qoder-cn/.auth/machine_id'),
  ];
  for (const file of candidates) {
    try {
      const value = fs.readFileSync(file, 'utf8').trim();
      if (value) return value;
    } catch {
      // Try the next path.
    }
  }
  return '';
}

async function checkPat(pat) {
  if (!pat) return { ok: false, message: 'PAT 未配置' };
  const machineId = readMachineId();
  if (!machineId) return { ok: false, message: '找不到 QoderCN machine id' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch('https://openapi.qoder.com.cn/api/v1/jobToken/exchange', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'qoder/1.1.69',
      },
      body: JSON.stringify({ personal_token: pat, machine_id: machineId }),
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, message: `PAT 校验失败（HTTP ${response.status}）` };
    const payload = await response.json().catch(() => null);
    return payload?.token ? { ok: true } : { ok: false, message: 'PAT 校验失败（未返回 token）' };
  } catch (error) {
    return { ok: false, message: sanitizeText(error?.message || 'PAT 校验失败') };
  } finally {
    clearTimeout(timer);
  }
}

export async function checkAccount(store, account, { pat } = {}) {
  if (activeLogins.has(account.id)) return account;
  account.lastCheckAt = new Date().toISOString();
  if (account.authType === 'env') {
    const result = await checkPat(pat);
    if (result.ok) {
      account.status = 'ready';
      account.lastError = null;
    } else {
      account.status = 'login_required';
      account.lastError = result.message;
    }
    return commitAccount(store, account);
  }

  let cli;
  try {
    cli = resolveCli();
  } catch (error) {
    account.status = 'error';
    account.lastError = sanitizeText(error?.message || error);
    return commitAccount(store, account);
  }

  const result = await runProcess(cli.command, [...cli.args, '--config-dir', account.configDir, '--list-models'], {
    cwd: account.configDir,
    env: cliEnv(account, { NO_BROWSER: '1', CI: '1' }),
    timeoutMs: 45000,
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim();

  if (result.timedOut) {
    account.status = 'error';
    account.lastError = '账号检查超时';
  } else if (result.code === 0) {
    account.status = 'ready';
    account.lastError = null;
  } else if (/not logged in|login required|please login|unauthorized|authentication|登录|认证/i.test(output)) {
    account.status = 'login_required';
    account.lastError = '账号需要重新登录';
  } else {
    account.status = 'error';
    account.lastError = sanitizeText(output) || `CLI 退出码 ${result.code}`;
  }
  return commitAccount(store, account);
}

export function loginCommandHint(account) {
  return `./accounts.sh login ${account.id}`;
}

export async function loginAccount(store, account, { noBrowser = false } = {}) {
  if (account.authType !== 'oauth') throw new Error('只有 OAuth 账号需要登录');
  const cli = resolveCli();
  console.log(`使用 CLI: ${cli.source}`);
  console.log(`账号: ${account.label} (${account.id})`);
  if (noBrowser) console.log('NO_BROWSER=1：如未自动打开浏览器，请复制终端输出的 URL。');

  let output = '';
  const code = await new Promise((resolve, reject) => {
    const child = spawn(cli.command, [...cli.args, '--config-dir', account.configDir, 'login'], {
      cwd: account.configDir,
      env: cliEnv(account, noBrowser ? { NO_BROWSER: '1' } : {}),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.on('data', (chunk) => {
      output += chunk.toString();
      process.stdout.write(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      output += chunk.toString();
      process.stderr.write(chunk);
    });
    child.on('error', reject);
    child.on('close', resolve);
  });

  if (code !== 0) throw new Error(`登录未完成（退出码 ${code}）`);
  applyIdentityFromOutput(store, account, output);
  return checkAccount(store, account);
}

function cleanCliOutput(value) {
  return String(value || '').replace(/\x1b\[[0-9;]*m/g, '');
}

function extractIdentity(output) {
  const text = cleanCliOutput(output);
  const welcome = [...text.matchAll(/Welcome[,\s:：]+([^\s,，。]+)/gi)];
  let identity = welcome.length ? welcome[welcome.length - 1][1] : '';
  identity = identity.replace(/[.,。;；]+$/, '').trim();
  if (!identity) {
    const emails = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g);
    if (emails?.length) identity = emails[emails.length - 1];
  }
  return identity;
}

function uniqueLabel(store, desired, accountId) {
  const base = String(desired || '').trim() || 'OAuth 账号';
  let label = base;
  let suffix = 2;
  while (
    store.accounts.some(
      (item) => item.id !== accountId && item.label.toLowerCase() === label.toLowerCase(),
    )
  ) {
    label = `${base} (${suffix++})`;
  }
  return label;
}

function applyIdentityFromOutput(store, account, output) {
  const identity = extractIdentity(output);
  if (!identity) return null;
  account.identity = identity;
  if (account.labelAuto === true) {
    account.label = uniqueLabel(store, identity, account.id);
  }
  saveStore(store);
  return identity;
}

export function cancelOAuthLogin(accountId) {
  const session = activeLogins.get(accountId);
  if (!session) return false;
  activeLogins.delete(accountId);
  if (session.maxTimer) clearTimeout(session.maxTimer);
  try {
    session.child.kill('SIGTERM');
  } catch {
    // Ignore.
  }
  return true;
}

export async function startOAuthLogin(store, account, { timeoutMs = 12000 } = {}) {
  if (account.authType !== 'oauth') throw new Error('只有 OAuth 账号需要登录');
  const existing = activeLogins.get(account.id);
  if (existing) return { session: existing, url: existing.url, done: existing.done };

  let cli;
  try {
    cli = resolveCli();
  } catch (error) {
    account.status = 'error';
    account.lastError = sanitizeText(error?.message || error);
    commitAccount(store, account);
    throw error;
  }

  let child;
  try {
    child = spawn(cli.command, [...cli.args, '--config-dir', account.configDir, 'login'], {
      cwd: account.configDir,
      env: cliEnv(account, { NO_BROWSER: '1' }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    account.status = 'error';
    account.lastError = sanitizeText(error?.message || error);
    commitAccount(store, account);
    throw error;
  }

  const session = {
    accountId: account.id,
    child,
    output: '',
    url: null,
    startedAt: Date.now(),
    done: null,
    maxTimer: null,
  };
  activeLogins.set(account.id, session);

  account.status = 'login_pending';
  account.lastError = null;
  commitAccount(store, account);

  const onData = (chunk) => {
    session.output = (session.output + chunk.toString()).slice(-20000);
    const text = cleanCliOutput(session.output);
    const matches = text.match(/https:\/\/[^\s"'<>]+/g) || [];
    const url = matches.find((item) => /device|login|oauth|authorize|signin/i.test(item)) || matches[0];
    if (url) session.url = url;
  };
  child.stdout?.on('data', onData);
  child.stderr?.on('data', onData);

  session.maxTimer = setTimeout(() => {
    if (activeLogins.get(account.id) === session) {
      try {
        child.kill('SIGTERM');
      } catch {
        // Ignore.
      }
    }
  }, 10 * 60 * 1000);
  session.maxTimer.unref?.();

  session.done = new Promise((resolve) => {
    let settled = false;
    const finish = async (code, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(session.maxTimer);
      activeLogins.delete(account.id);
      if (error || code !== 0) {
        account.status = 'login_required';
        account.lastError = '登录未完成或已取消';
        commitAccount(store, account);
        resolve({ code, error: error?.message || null });
        return;
      }
      try {
        applyIdentityFromOutput(store, account, session.output);
        await checkAccount(store, account);
        resolve({ code: 0 });
      } catch (err) {
        account.status = 'error';
        account.lastError = sanitizeText(err?.message || err);
        commitAccount(store, account);
        resolve({ code: 0, error: err?.message || String(err) });
      }
    };
    child.on('error', (error) => finish(null, error));
    child.on('close', (code) => finish(code, null));
  });

  const url = await new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (session.url) {
        clearInterval(timer);
        resolve(session.url);
      } else if (!activeLogins.has(account.id)) {
        clearInterval(timer);
        resolve(null);
      } else if (Date.now() - started >= timeoutMs) {
        clearInterval(timer);
        resolve(null);
      }
    }, 100);
    timer.unref?.();
  });

  return { session, url, done: session.done };
}
