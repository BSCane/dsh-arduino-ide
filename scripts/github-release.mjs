/**
 * 发布辅助：用 git 凭据中的 GitHub token 调 API：
 *   1. 创建 GitHub Release（v0.2.0）
 *   2. 设置仓库 topics（dsh-plugin 等，让生态可发现）
 * token 只在进程内使用，绝不打印。
 */
import { spawnSync } from 'node:child_process'

const OWNER = 'BSCane'
const REPO = 'dsh-arduino-ide'
const TAG = 'v0.2.0'

// ---- 取凭据：优先 GITHUB_TOKEN 环境变量（推荐，避免 token 进会话），否则 git credential ----
function gitCredential() {
  const r = spawnSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n',
    encoding: 'utf8',
    timeout: 20000,
  })
  if (r.status !== 0) throw new Error('git credential fill failed: ' + (r.stderr || r.stdout))
  const out = {}
  for (const line of String(r.stdout || '').split(/\r?\n/)) {
    const i = line.indexOf('=')
    if (i > 0) out[line.slice(0, i)] = line.slice(i + 1)
  }
  if (!out.username || !out.password) throw new Error('git credential: missing username/password')
  return out
}

const envToken = process.env.GITHUB_TOKEN
let username
let TOKEN
if (envToken) {
  username = 'token'
  TOKEN = envToken
  console.log('使用 GITHUB_TOKEN 环境变量（长度', TOKEN.length, '）')
} else {
  const cred = gitCredential()
  username = cred.username
  TOKEN = cred.password
  console.log('使用 git 凭据，user:', username)
}

async function api(method, path, body) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'dsh-arduino-ide-release',
      'x-github-api-version': '2022-11-28',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  return { status: res.status, data }
}

// ---- 1. 创建 Release（已存在则跳过） ----const existing = await api('GET', `/repos/${OWNER}/${REPO}/releases/tags/${TAG}`)
if (existing.status === 200) {
  console.log('Release 已存在，跳过创建')
} else {
  const rel = await api('POST', `/repos/${OWNER}/${REPO}/releases`, {
    tag_name: TAG,
    name: 'dsh-arduino-ide v0.2.0',
    body: [
      '## v0.2.0 — Agent 友好化与可视化（方案 A）',
      '',
      '- 17+ 个 `arduino_*` Agent 工具（status/boards/sketch/verify/upload/serial/cores/libs/examples/format/archive）',
      '- 事件总线 + SSE：面板「Agent 活动」页时间线、编译/烧录实时滚动、回合尾卡、工具卡片',
      '- 板卡/端口/Sketch 双向状态同步',
      '- 安装：`dsh plugin --profile web add dsh-arduino-ide`',
    ].join('\n'),
    draft: false,
    prerelease: false,
  })
  console.log('Release 创建:', rel.status, rel.status === 201 ? '✔' : JSON.stringify(rel.data).slice(0, 300))
}

// ---- 2. 设置 topics ----
const top = await api('PUT', `/repos/${OWNER}/${REPO}/topics`, {
  names: ['dsh-plugin', 'dsh', 'deepseek-harness', 'arduino', 'arduino-ide', 'agent-tools', 'embedded', 'serial-monitor', 'web-ui'],
})
console.log('topics 设置:', top.status, top.status === 200 ? JSON.stringify(top.data?.names) : JSON.stringify(top.data).slice(0, 200))
