import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  ACCOUNTS_FILE,
  addOAuthAccount,
  cancelOAuthLogin,
  checkAccount,
  ensureLegacyAccount,
  findAccount,
  loadStore,
  loginCommandHint,
  markAccountAuthError,
  markAccountUsed,
  pickBalancedAccount,
  publicAccount,
  removeAccount,
  saveStore,
  setDefaultAccount,
  setLoadBalance,
  startOAuthLogin,
} from './accounts.mjs';

const APP_PATH = process.env.QODER_APP_PATH || '/Applications/Qoder CN.app';
const SDK_PATH = path.join(
  APP_PATH,
  'Contents/Resources/app.asar/node_modules/@qoder-ai/qoder-cn-agent-sdk/dist/index.js',
);
const RUNTIME_PATH = path.join(
  APP_PATH,
  'Contents/Resources/app.asar.unpacked/node_modules/@qoder-ai/qoder-cn-agent-sdk/dist/_worker/qoder-worker-runtime.obf.mjs',
);
const UI_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ui.html');

const PAT = (process.env.QODER_PAT || process.env.QODERCN_PERSONAL_ACCESS_TOKEN || process.env.QODER_PERSONAL_ACCESS_TOKEN || '').trim();
const HOST = (process.env.HOST || '127.0.0.1').trim();
const PORT = Number.parseInt(process.env.PORT || '8788', 10);
const PROXY_API_KEY = (process.env.PROXY_API_KEY || '').trim();
const UI_AUTO_AUTH = (process.env.UI_AUTO_AUTH || 'private').toLowerCase();
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.REQUEST_TIMEOUT_MS || '300000', 10);
const ACCOUNT_HEALTH_INTERVAL_MS = Number.parseInt(process.env.ACCOUNT_HEALTH_INTERVAL_MS || '600000', 10);
const MAX_CONCURRENT = Math.max(1, Number.parseInt(process.env.MAX_CONCURRENT || '4', 10));
const QUEUE_LIMIT = Math.max(1, Number.parseInt(process.env.QUEUE_LIMIT || '64', 10));
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const WORKDIR = process.env.WORKDIR || path.join(os.tmpdir(), 'qoder-deepseek-proxy');
const DEFAULT_MODEL_ID = 'dfmodel';
const CREATED = 1730000000;

const MODEL_CATALOG = [
  { id: 'dfmodel', alias: 'deepseek-flash', display: 'DeepSeek-Flash', vendor: 'DeepSeek', free: true, priceFactor: 0, context: 200000, reasoning: true },
  { id: 'dmodel', alias: 'deepseek-v4-pro', display: 'DeepSeek-V4-Pro', vendor: 'DeepSeek', free: false, priceFactor: 0.5, context: 200000, reasoning: true },
  { id: 'qmodel_38max', alias: 'qwen3.8-max', display: 'Qwen3.8-Max', vendor: 'Qwen', free: false, priceFactor: 0.5, context: 200000, reasoning: true },
  { id: 'qfmodel', alias: 'qwen3.8-flash', display: 'Qwen3.8-Flash', vendor: 'Qwen', free: true, priceFactor: 0, context: 200000, reasoning: true },
  { id: 'qmodel', alias: 'qwen3.7-plus', display: 'Qwen3.7-Plus', vendor: 'Qwen', free: false, priceFactor: 0.1, context: 200000, reasoning: true },
  { id: 'gmodel', alias: 'glm-5.3', display: 'GLM-5.3', vendor: 'Zhipu', free: false, priceFactor: 0.8, context: 200000, reasoning: true },
  { id: 'gfmodel', alias: 'glm-5.3-flash', display: 'GLM-5.3-Flash', vendor: 'Zhipu', free: false, priceFactor: 0.1, context: 200000, reasoning: true },
  { id: 'kmodel_latest', alias: 'kimi-k3', display: 'Kimi-K3', vendor: 'Moonshot', free: false, priceFactor: 1.4, context: 200000, reasoning: false },
  { id: 'kmodel', alias: 'kimi-k2.8-preview', display: 'Kimi-K2.8-Preview', vendor: 'Moonshot', free: false, priceFactor: 0.8, context: 200000, reasoning: true },
  { id: 'mmodel', alias: 'minimax-m3.1-flash', display: 'MiniMax-M3.1-Flash', vendor: 'MiniMax', free: false, priceFactor: 0.1, context: 200000, reasoning: false },
  { id: 'fast', alias: 'fast', display: 'Fast', vendor: 'Qoder', free: false, priceFactor: 0.8, context: 200000, reasoning: true },
  { id: 'auto', alias: 'auto', display: 'Auto', vendor: 'Qoder', free: false, priceFactor: 0.5, context: 200000, reasoning: true },
];

const SINGLE_CONTEXT_WINDOW_MODELS = new Set(['auto', 'mmodel']);
for (const model of MODEL_CATALOG) {
  model.contextWindows = SINGLE_CONTEXT_WINDOW_MODELS.has(model.id) ? [200000] : [200000, 400000, 1000000];
  model.defaultContextWindow = model.context;
}

const MODEL_LOOKUP = new Map();
for (const model of MODEL_CATALOG) {
  MODEL_LOOKUP.set(model.id, model);
  MODEL_LOOKUP.set(model.alias, model);
}
const DEFAULT_MODEL = MODEL_LOOKUP.get(DEFAULT_MODEL_ID);
MODEL_LOOKUP.set('deepseek-flash-latest', DEFAULT_MODEL);
MODEL_LOOKUP.set('deepseek/deepseek-flash', DEFAULT_MODEL);

function fail(message) {
  console.error(`[fatal] ${message}`);
  process.exit(1);
}

if (!existsSync(RUNTIME_PATH)) fail(`Qoder CN SDK runtime not found: ${RUNTIME_PATH}`);
if (!Number.isInteger(PORT) || PORT <= 0 || PORT > 65535) fail(`Invalid PORT: ${process.env.PORT}`);
if (!isLoopback(HOST) && !PROXY_API_KEY) {
  fail('Refusing to listen on a non-loopback address without PROXY_API_KEY. Set a key or use HOST=127.0.0.1.');
}
if (!['private', 'local', 'off'].includes(UI_AUTO_AUTH)) {
  fail('UI_AUTO_AUTH must be one of: private, local, off.');
}
mkdirSync(WORKDIR, { recursive: true });

const ACCOUNT_STORE = loadStore();
ensureLegacyAccount(ACCOUNT_STORE, PAT);
if (!ACCOUNT_STORE.accounts.some((account) => account.id === ACCOUNT_STORE.defaultAccountId)) {
  ACCOUNT_STORE.defaultAccountId = ACCOUNT_STORE.accounts[0]?.id || null;
  saveStore(ACCOUNT_STORE);
}
let resetPendingLogins = false;
for (const account of ACCOUNT_STORE.accounts) {
  if (account.status === 'login_pending') {
    account.status = 'login_required';
    account.lastError = '登录进程已中断，请重新登录';
    resetPendingLogins = true;
  }
}
if (resetPendingLogins) saveStore(ACCOUNT_STORE);
const HAS_OAUTH_ACCOUNT = ACCOUNT_STORE.accounts.some((account) => account.authType === 'oauth');
if (!PAT && !HAS_OAUTH_ACCOUNT) {
  fail('No account configured. Run ./accounts.sh add "name" and ./accounts.sh login <id>, or set QODER_PAT.');
}

let accountStoreMtime = 0;
try {
  accountStoreMtime = statSync(ACCOUNTS_FILE).mtimeMs;
} catch {
  // The store file may not exist yet.
}

function refreshAccountStore() {
  try {
    const mtime = statSync(ACCOUNTS_FILE).mtimeMs;
    if (mtime === accountStoreMtime) return;
    const latest = loadStore();
    ACCOUNT_STORE.version = latest.version;
    ACCOUNT_STORE.defaultAccountId = latest.defaultAccountId;
    ACCOUNT_STORE.accounts = latest.accounts;
    accountStoreMtime = mtime;
  } catch {
    // Keep the in-memory copy on transient read errors.
  }
}

function getLanAddresses() {
  const found = [];
  for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family === 'IPv4' && !address.internal) found.push({ name, address: address.address });
    }
  }
  const rank = (name) => (name === 'en0' ? 0 : name.startsWith('en') ? 1 : name.startsWith('utun') ? 9 : 2);
  found.sort((a, b) => rank(a.name) - rank(b.name));
  return found.map((item) => item.address);
}

const LAN_ADDRESSES = getLanAddresses();
const LAN_BASE_URL =
  HOST !== '0.0.0.0' && HOST !== '127.0.0.1' && HOST !== '::1'
    ? `http://${HOST}:${PORT}`
    : LAN_ADDRESSES.length
      ? `http://${LAN_ADDRESSES[0]}:${PORT}`
      : `http://127.0.0.1:${PORT}`;

let sdk;
try {
  sdk = await import(pathToFileURL(SDK_PATH).href);
} catch (err) {
  fail(`Failed to load Qoder CN Agent SDK from ${SDK_PATH}: ${err?.message || err}`);
}

let UI_HTML = null;
try {
  UI_HTML = readFileSync(UI_PATH, 'utf8');
} catch (err) {
  console.warn(`[warn] UI not loaded from ${UI_PATH}: ${err?.message || err}`);
}

class ApiError extends Error {
  constructor(status, message, code = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.type = status >= 500 ? 'server_error' : 'invalid_request_error';
  }
}

function isLoopback(host) {
  return host === '127.0.0.1' || host === '::1' || host === 'localhost';
}

function normalizeClientIp(value) {
  const ip = String(value || '');
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

function isLoopbackAddress(ip) {
  return ip === '127.0.0.1' || ip === '::1' || ip === 'localhost';
}

function isPrivateAddress(ip) {
  if (isLoopbackAddress(ip)) return true;
  if (/^10\./.test(ip) || /^192\.168\./.test(ip) || /^169\.254\./.test(ip)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(ip)) return true;
  return false;
}

function shouldAutoAuth(req) {
  if (UI_AUTO_AUTH === 'off' || !PROXY_API_KEY) return false;
  if (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.headers.forwarded) return false;
  const ip = normalizeClientIp(req.socket.remoteAddress);
  if (UI_AUTO_AUTH === 'local') return isLoopbackAddress(ip);
  return isPrivateAddress(ip);
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Authorization, Content-Type, x-api-key, anthropic-version, anthropic-beta, x-request-id, x-qoder-account',
  );
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Expose-Headers', 'X-Qoder-Context-Window, X-Qoder-Account');
}

function checkAuth(req) {
  if (!PROXY_API_KEY) return true;
  const auth = req.headers.authorization || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  return bearer === PROXY_API_KEY || req.headers['x-api-key'] === PROXY_API_KEY;
}

function sendJson(res, status, payload) {
  if (res.headersSent) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function anthropicErrorType(status) {
  if (status === 400) return 'invalid_request_error';
  if (status === 401) return 'authentication_error';
  if (status === 403) return 'permission_error';
  if (status === 404) return 'not_found_error';
  if (status === 429) return 'rate_limit_error';
  return 'api_error';
}

function sendError(res, err, protocol = 'openai') {
  const status = err instanceof ApiError ? err.status : 502;
  const message = err?.message || 'Internal error';
  if (status >= 500) {
    console.error(`[${new Date().toISOString()}] error status=${status} message=${message}`);
  }

  if (res.headersSent) {
    try {
      if (protocol === 'anthropic') {
        const payload = { type: 'error', error: { type: anthropicErrorType(status), message } };
        res.write(`event: error\ndata: ${JSON.stringify(payload)}\n\n`);
      } else {
        res.write(`data: ${JSON.stringify({ error: { message, type: 'server_error', param: null, code: err?.code || null } })}\n\n`);
        res.write('data: [DONE]\n\n');
      }
      res.end();
    } catch {
      // Client already gone.
    }
    return;
  }

  if (protocol === 'anthropic') {
    sendJson(res, status, { type: 'error', error: { type: anthropicErrorType(status), message } });
    return;
  }
  sendJson(res, status, {
    error: {
      message,
      type: err instanceof ApiError ? err.type : 'server_error',
      param: null,
      code: err instanceof ApiError ? err.code : null,
    },
  });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > MAX_BODY_BYTES) {
      reject(new ApiError(413, 'Request body is too large'));
      return;
    }
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new ApiError(413, 'Request body is too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new ApiError(400, 'Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function contentBlockToText(block) {
  if (typeof block === 'string') return block;
  if (!block || typeof block !== 'object') return '';
  if (block.type === 'text' || block.type === 'input_text') return block.text || '';
  if (block.type === 'image' || block.type === 'image_url' || block.type === 'input_image') {
    throw new ApiError(400, 'Image inputs are not supported by this proxy yet', 'unsupported_content');
  }
  if (block.type === 'tool_result') {
    if (typeof block.content === 'string') return `Tool result: ${block.content}`;
    if (Array.isArray(block.content)) return `Tool result: ${block.content.map(contentBlockToText).filter(Boolean).join('\n')}`;
    return `Tool result: ${JSON.stringify(block.content ?? '')}`;
  }
  if (block.type === 'tool_use') {
    return `[tool use] ${block.name || ''} ${JSON.stringify(block.input || {})}`;
  }
  if (block.type === 'thinking') return '';
  return '';
}

function messageText(message) {
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.content)) {
    return message.content.map(contentBlockToText).filter(Boolean).join('\n');
  }
  return '';
}

function systemText(system) {
  if (!system) return '';
  if (typeof system === 'string') return system;
  if (Array.isArray(system)) return system.map(contentBlockToText).filter(Boolean).join('\n');
  return '';
}

function resolveModel(name, { claudeFallback = false } = {}) {
  const key = typeof name === 'string' ? name.trim() : '';
  if (!key) return DEFAULT_MODEL;
  const found = MODEL_LOOKUP.get(key);
  if (found) return found;
  if (claudeFallback && /^claude/i.test(key)) return DEFAULT_MODEL;
  throw new ApiError(
    404,
    `Model '${key}' is not available. Available: ${MODEL_CATALOG.map((m) => m.alias).join(', ')}`,
    'model_not_found',
  );
}

function resolveContextWindow(value, modelMeta) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new ApiError(400, 'context_window must be a positive integer', 'invalid_context_window');
  }
  if (!modelMeta.contextWindows.includes(parsed)) {
    throw new ApiError(
      400,
      `context_window ${parsed} is not supported by ${modelMeta.display}. Supported: ${modelMeta.contextWindows.join(', ')}`,
      'invalid_context_window',
    );
  }
  return parsed;
}

function resolveRequestAccount(req, body) {
  refreshAccountStore();
  const selector =
    (typeof body?.account === 'string' && body.account.trim()) ||
    (typeof req.headers['x-qoder-account'] === 'string' && req.headers['x-qoder-account'].trim()) ||
    '';
  if (selector === 'auto' || selector === '__auto__' || (!selector && ACCOUNT_STORE.loadBalance !== false)) {
    const balanced = pickBalancedAccount(ACCOUNT_STORE);
    if (!balanced) {
      throw new ApiError(
        503,
        '没有健康账号可用，请检查账号状态或重新登录。',
        'no_healthy_account',
      );
    }
    return balanced;
  }
  const account = findAccount(ACCOUNT_STORE, selector);
  if (!account) {
    throw new ApiError(
      404,
      selector
        ? `Account '${selector}' not found`
        : 'No account configured. Run ./accounts.sh add "name" and ./accounts.sh login <id>.',
      'account_not_found',
    );
  }
  if (account.status === 'login_required') {
    throw new ApiError(
      409,
      `账号「${account.label}」需要登录。运行 ./accounts.sh login ${account.id}`,
      'account_login_required',
    );
  }
  if (account.status === 'error') {
    throw new ApiError(
      409,
      `账号「${account.label}」当前不可用：${account.lastError || '未知错误'}`,
      'account_unavailable',
    );
  }
  if (account.status === 'login_pending') {
    throw new ApiError(
      409,
      `账号「${account.label}」正在等待 OAuth 授权，请在浏览器完成登录。`,
      'account_login_pending',
    );
  }
  return account;
}

function isAuthError(message) {
  return /auth|login|unauthorized|401|token|credential|凭据|登录/i.test(String(message || ''));
}

function buildPrompt(messages, extraSystemParts, modelMeta) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new ApiError(400, 'messages must be a non-empty array');
  }

  const userSystemParts = [];
  const turns = [];
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    const text = messageText(message);
    if (message.role === 'system' || message.role === 'developer') {
      if (text) userSystemParts.push(text);
      continue;
    }
    let line = text;
    if (message.role === 'assistant' && Array.isArray(message.tool_calls) && message.tool_calls.length) {
      line += `${line ? '\n' : ''}[tool calls] ${JSON.stringify(message.tool_calls)}`;
    }
    if (message.role === 'tool') line = `Tool result: ${line}`;
    if (!line) continue;
    turns.push({ role: message.role, text: line });
  }

  if (!turns.length) throw new ApiError(400, 'messages must contain at least one user message');
  if (!turns.some((turn) => turn.role === 'user')) throw new ApiError(400, 'messages must contain a user message');

  const systemPrompt = [
    `You are ${modelMeta.display} (model id ${modelMeta.id}), exposed through an OpenAI/Anthropic compatible chat API.`,
    'Answer directly and helpfully in the same language as the user. You are a conversational assistant, not a coding agent: do not use tools, do not read or write files, and do not ask for permission.',
    ...userSystemParts,
    ...extraSystemParts.filter(Boolean),
  ].join('\n\n');

  let prompt;
  if (turns.length === 1 && turns[0].role === 'user') {
    prompt = turns[0].text;
  } else {
    const lines = ['Continue this conversation. Respond to the latest user message as the assistant.', ''];
    for (const turn of turns) {
      const label = turn.role === 'user' ? 'User' : turn.role === 'assistant' ? 'Assistant' : 'Tool';
      lines.push(`${label}: ${turn.text}`, '');
    }
    lines.push('Assistant:');
    prompt = lines.join('\n');
  }

  return { systemPrompt, prompt };
}

function mapOpenAiFinish(reason) {
  if (reason === 'max_tokens') return 'length';
  if (reason === 'tool_use') return 'tool_calls';
  return 'stop';
}

function mapAnthropicStop(reason) {
  if (reason === 'max_tokens') return 'max_tokens';
  if (reason === 'tool_use') return 'tool_use';
  return 'end_turn';
}

function usageFrom(result) {
  const usage = result?.usage || {};
  const promptTokens = Number(usage.input_tokens || 0);
  const completionTokens = Number(usage.output_tokens || 0);
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
  };
}

let active = 0;
const waiting = [];

async function acquire() {
  if (active < MAX_CONCURRENT) {
    active += 1;
    return;
  }
  if (waiting.length >= QUEUE_LIMIT) {
    throw new ApiError(429, 'Too many concurrent requests', 'rate_limit_exceeded');
  }
  await new Promise((resolve) => waiting.push(resolve));
  active += 1;
}

function release() {
  active = Math.max(0, active - 1);
  const next = waiting.shift();
  if (next) next();
}

async function writeRaw(res, data) {
  if (res.destroyed || res.writableEnded) throw new Error('Client disconnected');
  if (!res.write(data)) await once(res, 'drain');
}

function createBackendContext(req, res) {
  const abortController = new AbortController();
  let clientClosed = false;
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    abortController.abort(new Error('Request timed out'));
  }, REQUEST_TIMEOUT_MS);
  timeout.unref?.();
  const onClose = () => {
    if (!res.writableEnded) {
      clientClosed = true;
      abortController.abort(new Error('Client disconnected'));
    }
  };
  res.on('close', onClose);
  return {
    abortController,
    get clientClosed() {
      return clientClosed;
    },
    get timedOut() {
      return timedOut;
    },
    cleanup() {
      clearTimeout(timeout);
      res.off('close', onClose);
    },
  };
}

async function runQuery({ modelMeta, prompt, systemPrompt, contextWindow, account, abortController, onText, onThinking }) {
  let text = '';
  let thinking = '';
  let result = null;

  if (!account) throw new ApiError(500, 'No account selected', 'account_not_selected');
  let authOptions;
  if (account.authType === 'env') {
    if (!PAT) throw new ApiError(503, 'PAT 未配置', 'pat_missing');
    authOptions = { auth: sdk.accessToken(PAT) };
  } else {
    if (!account.configDir) throw new ApiError(500, '账号配置目录缺失', 'account_invalid');
    authOptions = {
      auth: sdk.qodercliAuth(),
      env: { QODERCN_CONFIG_DIR: account.configDir, QODERCN_CLI_HOME: account.configDir },
    };
  }

  const query = sdk.query({
    prompt,
    options: {
      cwd: WORKDIR,
      model: modelMeta.id,
      ...authOptions,
      pathToQoderWorkerRuntime: RUNTIME_PATH,
      maxTurns: 1,
      permissionMode: 'default',
      includePartialMessages: true,
      persistSession: false,
      settingSources: [],
      disallowedTools: ['*'],
      systemPrompt,
      abortController,
      ...(contextWindow ? { extraArgs: { 'context-window': String(contextWindow) } } : {}),
    },
  });

  for await (const message of query) {
    if (message.type === 'stream_event') {
      const event = message.event;
      if (event?.type !== 'content_block_delta') continue;
      if (event.delta?.type === 'text_delta' && event.delta.text) {
        text += event.delta.text;
        if (onText) await onText(event.delta.text);
      } else if (event.delta?.type === 'thinking_delta' && event.delta.thinking) {
        thinking += event.delta.thinking;
        if (onThinking) await onThinking(event.delta.thinking);
      }
    } else if (message.type === 'result') {
      result = message;
    }
  }

  if (!text && typeof result?.result === 'string' && result.result) {
    text = result.result;
    if (onText) await onText(text);
  }
  if (result?.is_error) throw new ApiError(502, result.result || 'Qoder backend returned an error');
  if (!text) throw new ApiError(502, 'Qoder backend returned no text');

  return { text, thinking, result };
}

function openAiChunk(id, created, modelName, delta, finishReason = null) {
  return `data: ${JSON.stringify({
    id,
    object: 'chat.completion.chunk',
    created,
    model: modelName,
    choices: [{ index: 0, delta, finish_reason: finishReason, logprobs: null }],
  })}\n\n`;
}

async function handleChat(req, res) {
  const body = await readJson(req);
  if (!body || typeof body !== 'object') throw new ApiError(400, 'Invalid JSON body');

  const modelMeta = resolveModel(body.model);
  const contextWindow = resolveContextWindow(body.context_window ?? body.contextWindow, modelMeta);
  const account = resolveRequestAccount(req, body);
  const stream = body.stream === true;
  const includeUsage = stream && body.stream_options?.include_usage === true;
  const { systemPrompt, prompt } = buildPrompt(body.messages, [], modelMeta);
  const id = `chatcmpl-${randomUUID().replace(/-/g, '')}`;
  const created = Math.floor(Date.now() / 1000);
  const startedAt = Date.now();
  res.setHeader('X-Qoder-Context-Window', String(contextWindow ?? modelMeta.defaultContextWindow));
  res.setHeader('X-Qoder-Account', account.id);

  await acquire();
  const ctx = createBackendContext(req, res);
  let heartbeat = null;
  let failure = null;
  let output = null;

  try {
    if (stream) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      await writeRaw(res, ': connected\n\n');
      await writeRaw(res, openAiChunk(id, created, modelMeta.alias, { role: 'assistant', content: '' }));
      heartbeat = setInterval(() => {
        if (!res.writableEnded && !res.destroyed) res.write(': ping\n\n');
      }, 15000);
      heartbeat.unref?.();
    }

    output = await runQuery({
      modelMeta,
      prompt,
      systemPrompt,
      contextWindow,
      account,
      abortController: ctx.abortController,
      onText: stream
        ? async (piece) => writeRaw(res, openAiChunk(id, created, modelMeta.alias, { content: piece }))
        : undefined,
      onThinking: stream
        ? async (piece) => writeRaw(res, openAiChunk(id, created, modelMeta.alias, { reasoning_content: piece }))
        : undefined,
    });
  } catch (err) {
    if (!ctx.clientClosed) {
      failure = ctx.timedOut
        ? new ApiError(504, 'Qoder backend timed out')
        : err instanceof ApiError
          ? err
          : new ApiError(502, err?.message || String(err));
      if (account.authType === 'oauth' && isAuthError(failure.message)) {
        try {
          markAccountAuthError(ACCOUNT_STORE, account);
        } catch {
          // Account metadata write is best-effort.
        }
      }
    }
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    ctx.cleanup();
    release();
  }

  if (ctx.clientClosed) return;
  if (failure) throw failure;

  try {
    markAccountUsed(ACCOUNT_STORE, account);
  } catch {
    // Account metadata write is best-effort.
  }

  const { text, thinking, result } = output;
  const finishReason = mapOpenAiFinish(result?.stop_reason || 'end_turn');
  const usage = usageFrom(result);

  if (stream) {
    await writeRaw(res, openAiChunk(id, created, modelMeta.alias, {}, finishReason));
    if (includeUsage) {
      await writeRaw(res, `data: ${JSON.stringify({
        id,
        object: 'chat.completion.chunk',
        created,
        model: modelMeta.alias,
        choices: [],
        usage,
      })}\n\n`);
    }
    await writeRaw(res, 'data: [DONE]\n\n');
    res.end();
  } else {
    sendJson(res, 200, {
      id,
      object: 'chat.completion',
      created,
      model: modelMeta.alias,
      context_window: contextWindow ?? modelMeta.defaultContextWindow,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: text,
            ...(thinking ? { reasoning_content: thinking } : {}),
          },
          finish_reason: finishReason,
          logprobs: null,
        },
      ],
      usage,
    });
  }

  console.log(`[${new Date().toISOString()}] openai account=${account.id} model=${modelMeta.id} ctx=${contextWindow ?? modelMeta.defaultContextWindow} stream=${stream} ms=${Date.now() - startedAt} chars=${text.length}`);
}

function anthropicEvent(res, type, data) {
  return writeRaw(res, `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
}

async function handleMessages(req, res) {
  const body = await readJson(req);
  if (!body || typeof body !== 'object') throw new ApiError(400, 'Invalid JSON body');

  const modelMeta = resolveModel(body.model, { claudeFallback: true });
  const contextWindow = resolveContextWindow(body.context_window ?? body.contextWindow, modelMeta);
  const account = resolveRequestAccount(req, body);
  const stream = body.stream === true;
  const extraSystem = systemText(body.system) ? [systemText(body.system)] : [];
  const { systemPrompt, prompt } = buildPrompt(body.messages, extraSystem, modelMeta);
  const exposeThinking = body.thinking != null && body.thinking?.type !== 'disabled';
  const id = `msg_${randomUUID().replace(/-/g, '')}`;
  const startedAt = Date.now();
  res.setHeader('X-Qoder-Context-Window', String(contextWindow ?? modelMeta.defaultContextWindow));
  res.setHeader('X-Qoder-Account', account.id);

  await acquire();
  const ctx = createBackendContext(req, res);
  let heartbeat = null;
  let failure = null;
  let output = null;
  let nextIndex = 0;
  let thinkingIndex = -1;
  let textIndex = -1;
  let thinkingOpen = false;
  let textOpen = false;

  async function openThinking() {
    if (!stream || thinkingOpen) return;
    thinkingIndex = nextIndex++;
    await anthropicEvent(res, 'content_block_start', { index: thinkingIndex, content_block: { type: 'thinking', thinking: '' } });
    thinkingOpen = true;
  }

  async function closeThinking() {
    if (!stream || !thinkingOpen) return;
    await anthropicEvent(res, 'content_block_stop', { index: thinkingIndex });
    thinkingOpen = false;
  }

  async function openText() {
    if (!stream || textOpen) return;
    await closeThinking();
    textIndex = nextIndex++;
    await anthropicEvent(res, 'content_block_start', { index: textIndex, content_block: { type: 'text', text: '' } });
    textOpen = true;
  }

  try {
    if (stream) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      await writeRaw(res, ': connected\n\n');
      await anthropicEvent(res, 'message_start', {
        message: {
          id,
          type: 'message',
          role: 'assistant',
          model: modelMeta.alias,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      });
      heartbeat = setInterval(() => {
        if (!res.writableEnded && !res.destroyed) {
          res.write(`event: ping\ndata: ${JSON.stringify({ type: 'ping' })}\n\n`);
        }
      }, 15000);
      heartbeat.unref?.();
    }

    output = await runQuery({
      modelMeta,
      prompt,
      systemPrompt,
      contextWindow,
      account,
      abortController: ctx.abortController,
      onThinking: stream && exposeThinking
        ? async (piece) => {
            await openThinking();
            await anthropicEvent(res, 'content_block_delta', {
              index: thinkingIndex,
              delta: { type: 'thinking_delta', thinking: piece },
            });
          }
        : undefined,
      onText: stream
        ? async (piece) => {
            await openText();
            await anthropicEvent(res, 'content_block_delta', {
              index: textIndex,
              delta: { type: 'text_delta', text: piece },
            });
          }
        : undefined,
    });
  } catch (err) {
    if (!ctx.clientClosed) {
      failure = ctx.timedOut
        ? new ApiError(504, 'Qoder backend timed out')
        : err instanceof ApiError
          ? err
          : new ApiError(502, err?.message || String(err));
      if (account.authType === 'oauth' && isAuthError(failure.message)) {
        try {
          markAccountAuthError(ACCOUNT_STORE, account);
        } catch {
          // Account metadata write is best-effort.
        }
      }
    }
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    ctx.cleanup();
    release();
  }

  if (ctx.clientClosed) return;
  if (failure) throw failure;

  try {
    markAccountUsed(ACCOUNT_STORE, account);
  } catch {
    // Account metadata write is best-effort.
  }

  const { text, thinking, result } = output;
  const stopReason = mapAnthropicStop(result?.stop_reason || 'end_turn');

  if (stream) {
    if (textOpen) {
      await anthropicEvent(res, 'content_block_stop', { index: textIndex });
      textOpen = false;
    } else {
      await closeThinking();
    }
    await anthropicEvent(res, 'message_delta', {
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: 0 },
    });
    await anthropicEvent(res, 'message_stop', {});
    res.end();
  } else {
    const content = [];
    if (exposeThinking && thinking) content.push({ type: 'thinking', thinking, signature: '' });
    content.push({ type: 'text', text });
    sendJson(res, 200, {
      id,
      type: 'message',
      role: 'assistant',
      model: modelMeta.alias,
      context_window: contextWindow ?? modelMeta.defaultContextWindow,
      content,
      stop_reason: stopReason,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    });
  }

  console.log(`[${new Date().toISOString()}] anthropic account=${account.id} model=${modelMeta.id} ctx=${contextWindow ?? modelMeta.defaultContextWindow} stream=${stream} ms=${Date.now() - startedAt} chars=${text.length}`);
}

function serveUi(req, res) {
  if (!UI_HTML) {
    sendJson(res, 500, { error: { message: 'ui.html is missing', type: 'server_error', param: null, code: null } });
    return;
  }
  const autoAuth = shouldAutoAuth(req);
  let html = UI_HTML;
  if (autoAuth) {
    const bootstrap = JSON.stringify({ apiKey: PROXY_API_KEY, auto: true }).replace(/</g, '\\u003c');
    html = html.replace('</head>', `<script>window.__QODER_UI_BOOTSTRAP__ = ${bootstrap};</script></head>`);
  }
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Qoder-UI-AutoAuth': autoAuth ? '1' : '0',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self' data:; base-uri 'none'; form-action 'self'",
  });
  res.end(html);
}

const server = http.createServer(async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const isAnthropic = url.pathname === '/v1/messages';
  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/ui' || url.pathname === '/index.html')) {
      serveUi(req, res);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, {
        status: 'ok',
        backend: 'qoder-agent-sdk',
        default_model: DEFAULT_MODEL.alias,
        models: MODEL_CATALOG.length,
        host: HOST,
        port: PORT,
        lan_ips: LAN_ADDRESSES,
        lan_base_url: LAN_BASE_URL,
        openai_base_url: `${LAN_BASE_URL}/v1`,
        anthropic_base_url: LAN_BASE_URL,
        accounts: ACCOUNT_STORE.accounts.length,
        default_account_id: ACCOUNT_STORE.defaultAccountId,
      });
      return;
    }
    if (!checkAuth(req)) throw new ApiError(401, 'Invalid API key', 'invalid_api_key');
    refreshAccountStore();
    if (req.method === 'GET' && url.pathname === '/v1/models') {
      sendJson(res, 200, {
        object: 'list',
        data: MODEL_CATALOG.map((model) => ({
          id: model.alias,
          object: 'model',
          created: CREATED,
          owned_by: 'qoder',
          display_name: model.display,
          qoder_model_id: model.id,
          vendor: model.vendor,
          free: model.free,
          price_factor: model.priceFactor,
          context_window: model.defaultContextWindow,
          default_context_window: model.defaultContextWindow,
          context_windows: model.contextWindows,
          reasoning: model.reasoning,
        })),
      });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/v1/accounts') {
      sendJson(res, 200, {
        default_account_id: ACCOUNT_STORE.defaultAccountId,
        load_balance: ACCOUNT_STORE.loadBalance !== false,
        healthy_accounts: ACCOUNT_STORE.accounts.filter((account) => account.status === 'ready').length,
        accounts: ACCOUNT_STORE.accounts.map((account) => publicAccount(account, ACCOUNT_STORE)),
      });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/v1/accounts/settings') {
      const body = await readJson(req);
      if (typeof body?.loadBalance !== 'boolean') {
        throw new ApiError(400, 'loadBalance must be a boolean', 'invalid_settings');
      }
      setLoadBalance(ACCOUNT_STORE, body.loadBalance);
      sendJson(res, 200, {
        load_balance: ACCOUNT_STORE.loadBalance,
        healthy_accounts: ACCOUNT_STORE.accounts.filter((account) => account.status === 'ready').length,
        default_account_id: ACCOUNT_STORE.defaultAccountId,
        accounts: ACCOUNT_STORE.accounts.map((account) => publicAccount(account, ACCOUNT_STORE)),
      });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/v1/accounts') {
      const body = await readJson(req);
      let account;
      try {
        account = addOAuthAccount(ACCOUNT_STORE, body?.label);
      } catch (err) {
        throw new ApiError(400, err?.message || 'Failed to create account', 'account_create_failed');
      }
      sendJson(res, 201, {
        account: publicAccount(account, ACCOUNT_STORE),
        login_command: loginCommandHint(account),
      });
      return;
    }
    const accountRoute = url.pathname.match(/^\/v1\/accounts\/([^/]+)(?:\/(test|default|login))?$/);
    if (accountRoute) {
      const accountId = decodeURIComponent(accountRoute[1]);
      const action = accountRoute[2] || '';
      const account = findAccount(ACCOUNT_STORE, accountId);
      if (!account) throw new ApiError(404, `Account '${accountId}' not found`, 'account_not_found');
      if (req.method === 'POST' && action === 'test') {
        await checkAccount(ACCOUNT_STORE, account, { pat: PAT });
        sendJson(res, 200, { account: publicAccount(account, ACCOUNT_STORE) });
        return;
      }
      if (req.method === 'POST' && action === 'login') {
        if (account.authType !== 'oauth') {
          throw new ApiError(400, '只有 OAuth 账号需要登录', 'not_oauth_account');
        }
        try {
          const result = await startOAuthLogin(ACCOUNT_STORE, account);
          sendJson(res, 200, {
            account: publicAccount(account, ACCOUNT_STORE),
            login_url: result.url || null,
            login_pending: account.status === 'login_pending',
            login_command: loginCommandHint(account),
          });
        } catch (err) {
          throw new ApiError(502, `启动 OAuth 登录失败：${err?.message || err}`, 'login_start_failed');
        }
        return;
      }
      if (req.method === 'POST' && action === 'default') {
        setDefaultAccount(ACCOUNT_STORE, account.id);
        sendJson(res, 200, {
          default_account_id: ACCOUNT_STORE.defaultAccountId,
          accounts: ACCOUNT_STORE.accounts.map((item) => publicAccount(item, ACCOUNT_STORE)),
        });
        return;
      }
      if (req.method === 'DELETE' && !action) {
        cancelOAuthLogin(account.id);
        const removed = removeAccount(ACCOUNT_STORE, account.id);
        sendJson(res, 200, {
          removed: removed.id,
          default_account_id: ACCOUNT_STORE.defaultAccountId,
          accounts: ACCOUNT_STORE.accounts.map((item) => publicAccount(item, ACCOUNT_STORE)),
        });
        return;
      }
      throw new ApiError(405, `Unsupported account action: ${req.method} ${url.pathname}`, 'method_not_allowed');
    }
    if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
      await handleChat(req, res);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/v1/messages') {
      await handleMessages(req, res);
      return;
    }
    throw new ApiError(404, `Unknown route: ${req.method} ${url.pathname}`, 'not_found');
  } catch (err) {
    sendError(res, err, isAnthropic ? 'anthropic' : 'openai');
  }
});

server.requestTimeout = 0;
server.headersTimeout = 60000;
server.keepAliveTimeout = 65000;

server.listen(PORT, HOST, () => {
  const host = HOST.includes(':') ? `[${HOST}]` : HOST;
  console.log(`Qoder proxy listening on http://${host}:${PORT}`);
  if (HOST !== '127.0.0.1' && HOST !== 'localhost') {
    console.log(`LAN URL:           ${LAN_BASE_URL}`);
    console.log(`LAN addresses:     ${LAN_ADDRESSES.length ? LAN_ADDRESSES.join(', ') : 'none detected'}`);
  }
  console.log(`Web UI:            http://${host}:${PORT}/`);
  console.log(`OpenAI base URL:   http://${host}:${PORT}/v1   model: ${DEFAULT_MODEL.alias}`);
  console.log(`Anthropic base URL:http://${host}:${PORT}      endpoint: /v1/messages`);
  console.log(`Models: ${MODEL_CATALOG.map((m) => m.alias).join(', ')}`);
  console.log(`Auth: ${PROXY_API_KEY ? 'Bearer / x-api-key required' : 'none (loopback only)'}`);
  console.log(`UI auto auth: ${UI_AUTO_AUTH}${UI_AUTO_AUTH === 'off' ? '' : ' (key embedded for matching clients)'}`);
  console.log(`Accounts: ${ACCOUNT_STORE.accounts.length} (default: ${ACCOUNT_STORE.defaultAccountId || 'none'})`);

  async function refreshAccountHealth() {
    refreshAccountStore();
    for (const account of [...ACCOUNT_STORE.accounts]) {
      if (account.status === 'login_pending') continue;
      try {
        await checkAccount(ACCOUNT_STORE, account, { pat: PAT });
        console.log(`[accounts] ${account.id} -> ${account.status}`);
      } catch (err) {
        console.error(`[accounts] ${account.id} check failed: ${err?.message || err}`);
      }
    }
  }

  console.log(`Load balance: ${ACCOUNT_STORE.loadBalance !== false ? 'on (healthy accounts only)' : 'off (default account)'}`);
  setTimeout(refreshAccountHealth, 2500).unref?.();
  setInterval(refreshAccountHealth, ACCOUNT_HEALTH_INTERVAL_MS).unref?.();
});
