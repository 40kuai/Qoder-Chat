#!/usr/bin/env node
import {
  ACCOUNTS_FILE,
  CLI_INSTALL_HINT,
  POOL_HOME,
  addOAuthAccount,
  checkAccount,
  ensureLegacyAccount,
  findAccount,
  loadStore,
  loginAccount,
  loginCommandHint,
  removeAccount,
  resolveCli,
  setDefaultAccount,
} from './accounts.mjs';

const PAT = (process.env.QODER_PAT || process.env.QODERCN_PERSONAL_ACCESS_TOKEN || process.env.QODER_PERSONAL_ACCESS_TOKEN || '').trim();
const store = loadStore();
ensureLegacyAccount(store, PAT);

const args = process.argv.slice(2);
const command = args[0] || 'help';

function shortId(id) {
  return id.length > 16 ? `${id.slice(0, 16)}…` : id;
}

function printList() {
  if (!store.accounts.length) {
    console.log('账号池为空。');
    console.log('创建 OAuth 账号：./accounts.sh add "账号名称"');
    console.log('然后登录：      ./accounts.sh login <账号ID或名称>');
    return;
  }
  const rows = store.accounts.map((account) => ({
    id: shortId(account.id),
    label: account.label,
    type: account.authType === 'oauth' ? 'OAuth' : 'PAT',
    status: account.status,
    default: store.defaultAccountId === account.id ? 'yes' : '',
  }));
  const widths = {
    id: Math.max(2, ...rows.map((row) => row.id.length)),
    label: Math.max(5, ...rows.map((row) => row.label.length)),
    type: 5,
    status: 14,
    default: 7,
  };
  const line = (row) =>
    `${row.id.padEnd(widths.id)}  ${row.label.padEnd(widths.label)}  ${row.type.padEnd(widths.type)}  ${row.status.padEnd(widths.status)}  ${row.default}`;
  console.log(`${'ID'.padEnd(widths.id)}  ${'名称'.padEnd(widths.label)}  ${'类型'.padEnd(widths.type)}  ${'状态'.padEnd(widths.status)}  默认`);
  console.log('-'.repeat(widths.id + widths.label + widths.type + widths.status + 16));
  for (const row of rows) console.log(line(row));
  console.log(`\n账号文件：${ACCOUNTS_FILE}`);
  console.log('提示：OAuth 账号需要在本机终端执行 login，浏览器会打开官方授权页。');
}

async function main() {
  if (command === 'help' || command === '--help' || command === '-h') {
    console.log(`Qoder 账号池管理

用法：
  ./accounts.sh list                       列出账号
  ./accounts.sh add "名称"                 创建 OAuth 账号（独立配置目录）
  ./accounts.sh login <ID或名称>           用官方 CLI 完成浏览器 OAuth 登录
  ./accounts.sh test [ID或名称]            检查账号可用性（不指定则检查全部）
  ./accounts.sh default <ID或名称>         设置默认账号
  ./accounts.sh remove <ID或名称>          删除账号元数据（不删除配置目录）
  ./accounts.sh install-cli                查看官方 CLI 安装方式

说明：
- 只管理你本人或团队自有并授权的账号。
- 本工具不做自动轮换、共享、转售或按额度切换。
- OAuth 账号配置目录位于 ${POOL_HOME}/accounts/<id>/cli（权限 700）。
- 如已安装官方 CLI，会优先使用；否则回退到 npx 官方包。
`);
    return;
  }

  if (command === 'install-cli') {
    console.log('推荐安装官方 Qoder CN CLI：');
    console.log(`  ${CLI_INSTALL_HINT}`);
    console.log('或使用 npm：');
    console.log('  npm install -g @qodercn-ai/qoderclicn');
    try {
      const cli = resolveCli();
      console.log(`\n当前解析到：${cli.source}`);
    } catch {
      console.log('\n当前未找到 qoderclicn；login/test 会尝试使用 npx 官方包。');
    }
    return;
  }

  if (command === 'list') {
    printList();
    return;
  }

  if (command === 'add') {
    const label = args.slice(1).join(' ').trim();
    const account = addOAuthAccount(store, label);
    console.log(`已创建 OAuth 账号：${account.label}`);
    console.log(`账号 ID：${account.id}`);
    if (account.labelAuto) console.log('未填写名称：登录成功后会自动使用授权账号身份命名。');
    console.log(`下一步：${loginCommandHint(account)}`);
    console.log(`登录后检查：./accounts.sh test ${account.id}`);
    return;
  }

  if (command === 'login') {
    const selector = args.slice(1).join(' ').trim();
    if (!selector) throw new Error('用法：./accounts.sh login <ID或名称>');
    const account = findAccount(store, selector);
    if (!account) throw new Error(`账号不存在：${selector}`);
    if (account.authType !== 'oauth') throw new Error('PAT 兼容账号不需要 OAuth 登录');
    const updated = await loginAccount(store, account, { noBrowser: process.env.NO_BROWSER === '1' });
    console.log(`\n登录结果：${updated.status}`);
    console.log(`账号名称：${updated.label}`);
    if (updated.lastError) console.log(`说明：${updated.lastError}`);
    return;
  }

  if (command === 'test') {
    const selector = args.slice(1).join(' ').trim();
    const targets = selector
      ? [findAccount(store, selector)].filter(Boolean)
      : store.accounts;
    if (!targets.length) throw new Error(selector ? `账号不存在：${selector}` : '账号池为空');
    for (const account of targets) {
      console.log(`检查中：${account.label} (${account.id})…`);
      await checkAccount(store, account, { pat: PAT });
      console.log(`  状态：${account.status}${account.lastError ? ` — ${account.lastError}` : ''}`);
    }
    return;
  }

  if (command === 'default') {
    const selector = args.slice(1).join(' ').trim();
    if (!selector) throw new Error('用法：./accounts.sh default <ID或名称>');
    const account = setDefaultAccount(store, selector);
    console.log(`默认账号已设为：${account.label} (${account.id})`);
    return;
  }

  if (command === 'remove') {
    const selector = args.slice(1).join(' ').trim();
    if (!selector) throw new Error('用法：./accounts.sh remove <ID或名称>');
    const account = removeAccount(store, selector);
    console.log(`已删除账号：${account.label} (${account.id})`);
    if (account.configDir) console.log(`其 OAuth 配置目录仍保留在 ${account.configDir}，如不再使用可手动删除。`);
    return;
  }

  throw new Error(`未知命令：${command}`);
}

main().catch((error) => {
  console.error(`错误：${error?.message || error}`);
  process.exitCode = 1;
});
