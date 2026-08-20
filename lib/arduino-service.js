/**
 * ============================================================================
 * dsh-arduino-ide —— 共享服务层（唯一业务实现）
 * ============================================================================
 * 方案 A（Arduino开发流程Agent友好化与可视化方案讨论.md）的 4.1：
 *   - 宿主 HTTP 路由与 Agent 工具共用这里的同一套逻辑
 *   - 事件总线：每次动作发出结构化事件（activity/compile/serial/state），
 *     供 SSE 推给浏览器（面板活动页、实时编译流、状态同步）
 *   - 状态单一事实来源：currentSketch / currentFqbn / currentPort
 *
 * 依赖策略：零外部 npm 依赖，只用 node 内建模块。
 * ============================================================================
 */
import { spawn, spawnSync } from 'node:child_process'
import {
  existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync,
  rmSync, createReadStream,
} from 'node:fs'
import { join, resolve, basename, dirname, sep } from 'node:path'
import os from 'node:os'
import { EventEmitter } from 'node:events'
import { createInterface } from 'node:readline'

// ---------------------------------------------------------------------------
// 事件总线
// ---------------------------------------------------------------------------

const EVENT_BUFFER_MAX = 300

export class ArduinoEventBus {
  constructor() {
    this.emitter = new EventEmitter()
    this.buffer = []
  }

  /** 广播一个结构化事件。payload 必须是纯 JSON。 */
  emit(type, payload) {
    const ev = { type, ts: Date.now(), payload }
    this.buffer.push(ev)
    if (this.buffer.length > EVENT_BUFFER_MAX) this.buffer.shift()
    this.emitter.emit('event', ev)
  }

  /** 订阅全部事件；返回退订函数。 */
  subscribe(fn) {
    this.emitter.on('event', fn)
    return () => this.emitter.off('event', fn)
  }

  /** 最近 n 条事件（供晚到面板/回合尾卡回放）。 */
  recent(n = 50) {
    return this.buffer.slice(-n)
  }
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/** DSH 主目录（与 @deepseek-ai/dsh-home-paths 的默认值一致）。 */
function dshHome() {
  return process.env.DSH_HOME || join(os.homedir(), '.dsh')
}

/** 工作区根：配置覆盖 > $DSH_HOME/arduino-ide */
function workRoot(config) {
  return config?.workRoot ? String(config.workRoot) : join(dshHome(), 'arduino-ide')
}

/** 串口数据目录（Arduino15）。 */
function arduinoDataDir() {
  if (process.env.LOCALAPPDATA) return join(process.env.LOCALAPPDATA, 'Arduino15')
  return join(os.homedir(), '.arduino15')
}

/** 用户 Sketchbook（第三方库示例所在）。 */
function sketchbookDir() {
  const home = os.homedir()
  const docs = process.env.USERPROFILE ? join(process.env.USERPROFILE, 'Documents') : join(home, 'Documents')
  const candidates = [
    process.env.ARDUINO_SKETCHBOOK_DIR,
    join(docs, 'Arduino'),
    join(home, 'Arduino'),
  ].filter(Boolean)
  for (const c of candidates) if (existsSync(c)) return c
  return candidates[0]
}

const SAFE_NAME = /^[A-Za-z0-9_\u4e00-\u9fa5][A-Za-z0-9_\u4e00-\u9fa5\- ]*$/
function sanitizeSketchName(raw) {
  if (typeof raw !== 'string') return undefined
  const s = raw.trim().replace(/\.ino$/i, '')
  return SAFE_NAME.test(s) && !s.startsWith('.') ? s : undefined
}
const SAFE_FILE = /^[A-Za-z0-9_\u4e00-\u9fa5][A-Za-z0-9_\u4e00-\u9fa5\- ]*\.[A-Za-z0-9]+$/
function sanitizeFileName(raw) {
  if (typeof raw !== 'string') return undefined
  const s = raw.trim()
  if (s.includes('/') || s.includes('\\') || s.includes('..')) return undefined
  return SAFE_FILE.test(s) && /\.(ino|h|cpp|c|txt|md)$/i.test(s) ? s : undefined
}

/** 从可能混有日志的文本里抽出第一个 JSON 对象。 */
function parseJson(text) {
  if (typeof text !== 'string') return undefined
  const start = text.indexOf('{')
  if (start < 0) return undefined
  try {
    return JSON.parse(text.slice(start))
  } catch {
    return undefined
  }
}

// ---------------------------------------------------------------------------
// arduino-cli 探测与执行
// ---------------------------------------------------------------------------

const CLI_CANDIDATES = () => {
  const pf = process.env.PROGRAMFILES || 'C:\\Program Files'
  const lpa = process.env.LOCALAPPDATA || ''
  return [
    'D:\\Program Files\\arduino-cli_1.5.2-rc.1_Windows_64bit\\arduino-cli.exe',
    join(pf, 'arduino-cli_1.5.2-rc.1_Windows_64bit', 'arduino-cli.exe'),
    join(pf, 'Arduino CLI', 'arduino-cli.exe'),
    join(pf, 'Arduino', 'arduino-cli.exe'),
    join(lpa, 'Programs', 'Arduino CLI', 'arduino-cli.exe'),
    join(lpa, 'Arduino15', 'arduino-cli.exe'),
  ].filter(Boolean)
}

function detectCli(config) {
  const explicit = [
    config?.cliPath,
    process.env.ARDUINO_CLI_PATH,
  ].filter((x) => typeof x === 'string' && x.length > 0)
  for (const c of explicit) if (existsSync(c)) return c
  for (const c of CLI_CANDIDATES()) if (existsSync(c)) return c
  try {
    const r = process.platform === 'win32'
      ? spawnSync('cmd', ['/c', 'where', 'arduino-cli'], { encoding: 'utf8', timeout: 8000 })
      : spawnSync('which', ['arduino-cli'], { encoding: 'utf8', timeout: 8000 })
    if (r.status === 0 && r.stdout) {
      const line = String(r.stdout).split(/\r?\n/).find((l) => l.trim().length > 0)
      if (line && existsSync(line.trim())) return line.trim()
    }
  } catch {
    /* PATH 探测失败不致命 */
  }
  return undefined
}

let cliStateCache = null

function cliInfo(config) {
  if (cliStateCache) return cliStateCache
  const path = detectCli(config)
  if (!path) {
    cliStateCache = {
      found: false, path: undefined, version: undefined,
      error: '未找到 arduino-cli。请安装 arduino-cli 并放入 PATH，或在 cordis.patch.yml 的 config.cliPath / 环境变量 ARDUINO_CLI_PATH 中指定路径。',
    }
    return cliStateCache
  }
  try {
    const v = spawnSync(path, ['version'], { encoding: 'utf8', timeout: 15000 })
    const version = v.status === 0 ? String(v.stdout || v.stderr || '').trim().split(/\r?\n/)[0] : undefined
    cliStateCache = { found: true, path, version, error: undefined }
  } catch (e) {
    cliStateCache = { found: false, path, version: undefined, error: String(e?.message || e) }
  }
  return cliStateCache
}

/** 运行 arduino-cli，收集完整输出。 */
function runCli(cliPath, args, { timeoutMs = 300000, input } = {}) {
  return new Promise((resolved) => {
    let child
    try {
      child = spawn(cliPath, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (e) {
      resolved({ code: -1, stdout: '', stderr: '', timedOut: false, error: String(e?.message || e) })
      return
    }
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      try { child.kill() } catch { /* ignore */ }
      resolved({ code: -1, stdout, stderr, timedOut: true, error: '命令超时' })
    }, timeoutMs)
    child.stdout?.on('data', (d) => { stdout += String(d) })
    child.stderr?.on('data', (d) => { stderr += String(d) })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolved({ code, stdout, stderr, timedOut: false })
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      resolved({ code: -1, stdout, stderr, timedOut: false, error: err.message })
    })
    if (input !== undefined) {
      child.stdin?.write(input)
      child.stdin?.end()
    }
  })
}

/** 运行 arduino-cli，逐行回调（供实时推送），同时收集完整输出。 */
function runCliStream(cliPath, args, { timeoutMs = 900000, onLine } = {}) {
  return new Promise((resolved) => {
    let child
    try {
      child = spawn(cliPath, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (e) {
      resolved({ code: -1, stdout: '', stderr: '', timedOut: false, error: String(e?.message || e) })
      return
    }
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      try { child.kill() } catch { /* ignore */ }
      resolved({ code: -1, stdout, stderr, timedOut: true, error: '命令超时' })
    }, timeoutMs)
    const pump = (chunk, isErr) => {
      const text = String(chunk)
      if (isErr) stderr += text
      else stdout += text
      if (typeof onLine !== 'function') return
      for (const line of text.split(/\r?\n/)) {
        const l = line.replace(/\r$/, '').trim()
        if (l) onLine(l, isErr)
      }
    }
    child.stdout?.on('data', (d) => pump(d, false))
    child.stderr?.on('data', (d) => pump(d, true))
    child.on('close', (code) => {
      clearTimeout(timer)
      resolved({ code, stdout, stderr, timedOut: false })
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      resolved({ code: -1, stdout, stderr, timedOut: false, error: err.message })
    })
  })
}

// ---------------------------------------------------------------------------
// 归一化（arduino-cli 1.5.x 输出形状各版本不同）
// ---------------------------------------------------------------------------

const normCore = (p) => ({
  id: p.id,
  name: p.name || p.id,
  installed: p.installed_version || p.installed || '',
  latest: p.latest_version || p.latest || '',
})
const normPort = (dp) => {
  const p = dp.port || dp
  return {
    address: p.address,
    label: p.label || p.address,
    protocol: p.protocol,
    protocolLabel: p.protocol_label,
  }
}
const normLibInstalled = (il) => {
  const l = il.library || il
  return { name: l.name, version: l.version || '', location: l.location || '' }
}
const normLibSearch = (l) => {
  const versions = Object.keys(l.releases || {})
  return { name: l.name, latest: l.latest || versions[versions.length - 1] || '' }
}

// ---------------------------------------------------------------------------
// Sketch 工作区
// ---------------------------------------------------------------------------

function sketchDir(config, sketchName) {
  return join(workRoot(config), 'sketches', sketchName)
}

/** 把 files 写入 sketch 目录，返回目录绝对路径。 */
function writeSketch(config, sketchName, files) {
  const dir = sketchDir(config, sketchName)
  mkdirSync(dir, { recursive: true })
  const entries = { ...(files || {}) }
  const mainName = sketchName + '.ino'
  if (!Object.prototype.hasOwnProperty.call(entries, mainName)) {
    const existingIno = Object.keys(entries).find((f) => f.endsWith('.ino'))
    if (existingIno) {
      entries[mainName] = entries[existingIno]
      delete entries[existingIno]
    } else {
      entries[mainName] = ''
    }
  }
  for (const [fname, content] of Object.entries(entries)) {
    const safe = sanitizeFileName(fname)
    if (!safe) continue
    writeFileSync(join(dir, safe), String(content ?? ''), 'utf8')
  }
  return dir
}

function readSketch(config, sketchName) {
  const dir = sketchDir(config, sketchName)
  if (!existsSync(dir)) return undefined
  const files = {}
  for (const f of readdirSync(dir)) {
    const full = join(dir, f)
    if (!statSync(full).isFile()) continue
    try {
      files[f] = readFileSync(full, 'utf8')
    } catch {
      /* 二进制等忽略 */
    }
  }
  return { sketch: sketchName, files }
}

function listSketches(config) {
  const root = join(workRoot(config), 'sketches')
  if (!existsSync(root)) return []
  return readdirSync(root)
    .filter((d) => {
      try {
        return statSync(join(root, d)).isDirectory() && existsSync(join(root, d, `${d}.ino`))
      } catch {
        return false
      }
    })
    .sort()
}

// ---------------------------------------------------------------------------
// 串口监视器（PowerShell + .NET SerialPort 桥）
// ---------------------------------------------------------------------------

const BRIDGE_SCRIPT = [
  "param([string]$Port, [int]$Baud)",
  "$ErrorActionPreference = 'Stop'",
  '$port = New-Object System.IO.Ports.SerialPort',
  '$port.PortName = $Port',
  '$port.BaudRate = $Baud',
  '$port.Parity = [System.IO.Ports.Parity]::None',
  '$port.DataBits = 8',
  '$port.StopBits = [System.IO.Ports.StopBits]::One',
  '$port.Handshake = [System.IO.Ports.Handshake]::None',
  '$port.DtrEnable = $true',
  '$port.RtsEnable = $true',
  '$port.NewLine = "`n"',
  '$port.ReadTimeout = 500',
  "try { $port.Open() } catch { Write-Output (\"___ERROR \" + $_.Exception.Message); [Console]::Out.Flush(); exit 1 }",
  'Write-Output ("___CONNECTED " + $Port + " " + $Baud)',
  '[Console]::Out.Flush()',
  '$script:port = $port',
  '$reader = New-Object System.Threading.Thread([System.Threading.ThreadStart]{',
  '  try {',
  '    while ($true) {',
  '      $line = [Console]::In.ReadLine()',
  '      if ($null -eq $line) { break }',
  '      try { $script:port.Write($line + "`r`n") } catch { break }',
  '    }',
  '  } catch { }',
  '})',
  '$reader.IsBackground = $true',
  '$reader.Start()',
  'try {',
  '  while ($true) {',
  '    try { $line = $script:port.ReadLine() } catch { continue }',
  '    [Console]::Out.WriteLine($line)',
  '    [Console]::Out.Flush()',
  '  }',
  '} finally {',
  '  try { $script:port.Close() } catch { }',
  '}',
].join('\r\n')

function powershellPath() {
  if (process.platform !== 'win32') return 'powershell'
  const sys = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  return existsSync(sys) ? sys : 'powershell'
}

class SerialManager extends EventEmitter {
  constructor(config) {
    super()
    this.config = config
    this.child = null
    this.port = null
    this.baud = null
    this.lines = []
  }

  get connected() {
    return this.child !== null && !this.child.killed
  }

  open(port, baud) {
    if (this.connected) return { ok: false, error: `串口 ${this.port} 已被占用，请先断开` }
    const bridge = join(workRoot(this.config), 'serial-bridge.ps1')
    mkdirSync(dirname(bridge), { recursive: true })
    writeFileSync(bridge, BRIDGE_SCRIPT, 'utf8')
    const child = spawn(powershellPath(), [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', bridge, '-Port', String(port), '-Baud', String(baud),
    ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    this.child = child
    this.port = String(port)
    this.baud = Number(baud)
    this.lines = []
    let announced = false

    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity })
    rl.on('line', (line) => {
      if (line.startsWith('___CONNECTED')) {
        announced = true
        this.emit('connected')
        return
      }
      if (line.startsWith('___ERROR')) {
        this.emit('error', line.slice(8).trim() || '串口打开失败')
        this.close()
        return
      }
      const clean = line.replace(/\r$/, '')
      this.lines.push(clean)
      if (this.lines.length > 2000) this.lines.shift()
      this.emit('line', clean)
    })
    rl.on('close', () => {
      if (this.child === child) this.child = null
      this.emit('closed', announced ? undefined : '串口进程退出')
    })
    child.on('error', (err) => {
      this.emit('error', `串口进程启动失败: ${err.message}`)
      this.child = null
    })
    child.stderr?.on('data', (d) => {
      const s = String(d).trim()
      if (s) this.emit('stderr', s)
    })
    return { ok: true }
  }

  write(text) {
    if (!this.connected) return { ok: false, error: '串口未连接' }
    try {
      this.child.stdin.write(String(text ?? '') + '\n')
      return { ok: true }
    } catch (e) {
      return { ok: false, error: String(e?.message || e) }
    }
  }

  close() {
    const child = this.child
    this.child = null
    if (!child) return
    try { child.stdin.end() } catch { /* ignore */ }
    const timer = setTimeout(() => {
      try { child.kill() } catch { /* ignore */ }
    }, 1500)
    child.once('close', () => clearTimeout(timer))
  }
}

// ---------------------------------------------------------------------------
// 示例
// ---------------------------------------------------------------------------

/** 内置核心示例树。 */
function listBuiltinExamples() {
  const packagesDir = join(arduinoDataDir(), 'packages')
  if (!existsSync(packagesDir)) return []
  const out = []
  try {
    for (const vendor of readdirSync(packagesDir)) {
      const vendorDir = join(packagesDir, vendor)
      if (!statSync(vendorDir).isDirectory()) continue
      const hwDir = join(vendorDir, 'hardware')
      if (!existsSync(hwDir)) continue
      for (const arch of readdirSync(hwDir)) {
        const archDir = join(hwDir, arch)
        if (!statSync(archDir).isDirectory()) continue
        for (const ver of readdirSync(archDir)) {
          const verDir = join(archDir, ver)
          const libsDir = join(verDir, 'libraries')
          if (!existsSync(libsDir)) continue
          for (const lib of readdirSync(libsDir)) {
            const examplesDir = join(libsDir, lib, 'examples')
            if (!existsSync(examplesDir)) continue
            const examples = readdirSync(examplesDir)
              .filter((e) => statSync(join(examplesDir, e)).isDirectory())
              .map((e) => join(examplesDir, e))
            if (examples.length) {
              out.push({ vendor, arch, version: ver, library: lib, examples })
            }
          }
        }
      }
    }
  } catch {
    /* 目录遍历失败返回已收集部分 */
  }
  return out
}

/** 解析 `arduino-cli lib examples` 文本输出。 */
function parseLibExamplesText(text) {
  const out = []
  let current = null
  for (const raw of String(text || '').split(/\r?\n/)) {
    const libMatch = /^Examples for library (.+)$/.exec(raw.trim())
    if (libMatch) {
      current = { library: libMatch[1].trim(), examples: [] }
      out.push(current)
      continue
    }
    const dirMatch = /^-\s+(.+)$/.exec(raw.trim())
    if (dirMatch && current) current.examples.push(dirMatch[1].trim())
  }
  return out.filter((e) => e.examples.length > 0)
}

// ---------------------------------------------------------------------------
// 自动格式化
// ---------------------------------------------------------------------------

function autoFormat(code) {
  const lines = String(code ?? '').split(/\r?\n/)
  let indent = 0
  const out = []
  for (const raw of lines) {
    let line = raw.trim()
    if (/^\}/.test(line)) indent = Math.max(0, indent - 1)
    out.push('  '.repeat(indent) + line)
    const opens = (line.match(/\{/g) || []).length
    const closes = (line.match(/\}/g) || []).length
    indent = Math.max(0, indent + opens - closes)
  }
  return out.join('\n')
}

// ---------------------------------------------------------------------------
// 服务工厂
// ---------------------------------------------------------------------------

export function createArduinoService(config = {}) {
  const events = new ArduinoEventBus()
  const serial = new SerialManager(config)
  const root = workRoot(config)
  mkdirSync(join(root, 'sketches'), { recursive: true })
  mkdirSync(join(root, 'archives'), { recursive: true })

  // 状态单一事实来源
  const state = {
    currentSketch: 'MySketch',
    currentFqbn: '',
    currentPort: '',
    serialConnected: false,
  }

  serial.on('connected', () => {
    state.serialConnected = true
    emitState()
    events.emit('activity', { action: 'serial_open', status: 'done', summary: `串口已连接 ${serial.port} @ ${serial.baud}` })
  })
  serial.on('closed', (err) => {
    state.serialConnected = false
    emitState()
    if (err) events.emit('activity', { action: 'serial_close', status: 'failed', summary: String(err) })
    else events.emit('activity', { action: 'serial_close', status: 'done', summary: '串口已断开' })
  })
  serial.on('error', (msg) => {
    events.emit('activity', { action: 'serial_open', status: 'failed', summary: String(msg) })
  })

  function emitState() {
    events.emit('state', { ...state })
  }

  const service = {
    events,
    config,
    root,
    serial,

    getState() {
      return { ...state }
    },

    /** 更新状态（agent 工具或面板调用）；origin 用于区分来源，避免回声。 */
    setState(patch, origin = 'agent') {
      let changed = false
      if (typeof patch.currentSketch === 'string' && patch.currentSketch !== state.currentSketch) {
        state.currentSketch = patch.currentSketch
        changed = true
      }
      if (typeof patch.currentFqbn === 'string' && patch.currentFqbn !== state.currentFqbn) {
        state.currentFqbn = patch.currentFqbn
        changed = true
      }
      if (typeof patch.currentPort === 'string' && patch.currentPort !== state.currentPort) {
        state.currentPort = patch.currentPort
        changed = true
      }
      if (changed) {
        events.emit('state', { ...state, origin })
        events.emit('activity', {
          action: 'state',
          status: 'done',
          summary: summarizeStatePatch(patch),
          origin,
        })
      }
      return { ...state }
    },

    status() {
      const info = cliInfo(config)
      return {
        cli: info,
        workRoot: root,
        dataDir: arduinoDataDir(),
        sketchbook: sketchbookDir(),
        state: { ...state },
      }
    },

    async boards() {
      const info = cliInfo(config)
      if (!info.found) return { ports: [], boards: [], cliError: info.error }
      const [r1, r2] = await Promise.all([
        runCli(info.path, ['board', 'list', '--format', 'json'], { timeoutMs: 30000 }),
        runCli(info.path, ['board', 'listall', '--format', 'json'], { timeoutMs: 60000 }),
      ])
      return {
        ports: (parseJson(r1.stdout)?.detected_ports ?? []).map(normPort),
        boards: (parseJson(r2.stdout)?.boards ?? []).map((b) => ({ name: b.name, fqbn: b.fqbn })),
      }
    },

    async verify({ sketch, files, fqbn }) {
      const sketchName = sanitizeSketchName(sketch)
      if (!sketchName) return { ok: false, output: 'sketch 名称不合法', code: -1 }
      const info = cliInfo(config)
      if (!info.found) return { ok: false, output: info.error, code: -1 }
      const fqbnVal = fqbn || state.currentFqbn
      state.currentSketch = sketchName
      if (fqbn) state.currentFqbn = fqbn
      emitState()
      const dir = writeSketch(config, sketchName, files || {})
      const cmd = `arduino-cli compile --fqbn ${fqbnVal || '<未选择板卡>'} ${sketchName}`
      events.emit('activity', { action: 'verify', status: 'running', summary: `编译 ${sketchName}`, command: cmd })
      const args = ['compile']
      if (fqbnVal) args.push('--fqbn', fqbnVal)
      args.push(dir)
      const r = await runCliStream(info.path, args, {
        timeoutMs: 900000,
        onLine: (line) => events.emit('compile', { sketch: sketchName, fqbn: fqbnVal, line }),
      })
      const output = r.stdout + r.stderr
      const ok = r.code === 0
      const tail = summaryOf(output, 4)
      events.emit('activity', {
        action: 'verify',
        status: ok ? 'done' : 'failed',
        summary: ok ? `编译通过：${sketchName}` : `编译失败（exit ${r.code}）`,
        detail: tail,
        output,
        command: cmd,
        ok,
        durationMs: r.timedOut ? undefined : undefined,
      })
      return { ok, code: r.code, output, timedOut: r.timedOut, error: r.error }
    },

    async upload({ sketch, files, fqbn, port }) {
      const sketchName = sanitizeSketchName(sketch)
      if (!sketchName) return { ok: false, output: 'sketch 名称不合法', code: -1 }
      const info = cliInfo(config)
      if (!info.found) return { ok: false, output: info.error, code: -1 }
      const fqbnVal = fqbn || state.currentFqbn
      const portVal = port || state.currentPort
      if (!fqbnVal) return { ok: false, output: '未选择开发板（FQBN）', code: -1 }
      if (!portVal) return { ok: false, output: '未选择端口', code: -1 }
      if (serial.connected && serial.port === portVal) {
        return { ok: false, output: `端口 ${portVal} 正被串口监视器占用，请先断开（arduino_serial_close）`, code: -1 }
      }
      state.currentSketch = sketchName
      if (fqbn) state.currentFqbn = fqbn
      if (port) state.currentPort = port
      emitState()
      const dir = writeSketch(config, sketchName, files || {})
      const cmd = `arduino-cli upload -p ${portVal} --fqbn ${fqbnVal} ${sketchName}`
      events.emit('activity', { action: 'upload', status: 'running', summary: `烧录 ${sketchName} → ${portVal}`, command: cmd })
      const args = ['upload', '-p', portVal, '--fqbn', fqbnVal, dir]
      const r = await runCliStream(info.path, args, {
        timeoutMs: 900000,
        onLine: (line) => events.emit('compile', { sketch: sketchName, fqbn: fqbnVal, line }),
      })
      const output = r.stdout + r.stderr
      const ok = r.code === 0
      events.emit('activity', {
        action: 'upload',
        status: ok ? 'done' : 'failed',
        summary: ok ? `烧录成功：${sketchName}` : `烧录失败（exit ${r.code}）`,
        detail: summaryOf(output, 4),
        output,
        command: cmd,
        ok,
      })
      return { ok, code: r.code, output, timedOut: r.timedOut, error: r.error }
    },

    async coresList() {
      const info = cliInfo(config)
      if (!info.found) return { platforms: [], cliError: info.error }
      const r = await runCli(info.path, ['core', 'list', '--format', 'json'], { timeoutMs: 30000 })
      return { platforms: (parseJson(r.stdout)?.platforms ?? []).map(normCore), cliError: r.code === 0 ? undefined : (r.stderr || r.stdout) }
    },

    async coresSearch(q) {
      const info = cliInfo(config)
      if (!info.found) return { platforms: [], cliError: info.error }
      const query = String(q || '').trim()
      if (!query) return { platforms: [] }
      const r = await runCli(info.path, ['core', 'search', query, '--format', 'json'], { timeoutMs: 60000 })
      return { platforms: (parseJson(r.stdout)?.platforms ?? []).map(normCore) }
    },

    async coresInstall(name) {
      const info = cliInfo(config)
      if (!info.found) return { ok: false, output: info.error, code: -1 }
      const target = String(name || '').trim()
      if (!target) return { ok: false, output: '缺少核心名称', code: -1 }
      events.emit('activity', { action: 'core_install', status: 'running', summary: `安装核心 ${target}` })
      const r = await runCli(info.path, ['core', 'install', target], { timeoutMs: 1800000 })
      const ok = r.code === 0
      events.emit('activity', { action: 'core_install', status: ok ? 'done' : 'failed', summary: ok ? `已安装核心 ${target}` : `安装核心失败：${target}`, detail: summaryOf(r.stdout + r.stderr, 3), ok })
      return { ok, code: r.code, output: r.stdout + r.stderr, error: r.error }
    },

    async coresUninstall(name) {
      const info = cliInfo(config)
      if (!info.found) return { ok: false, output: info.error, code: -1 }
      const target = String(name || '').trim()
      if (!target) return { ok: false, output: '缺少核心名称', code: -1 }
      const r = await runCli(info.path, ['core', 'uninstall', target], { timeoutMs: 600000 })
      return { ok: r.code === 0, code: r.code, output: r.stdout + r.stderr, error: r.error }
    },

    async libsList() {
      const info = cliInfo(config)
      if (!info.found) return { libraries: [], cliError: info.error }
      const r = await runCli(info.path, ['lib', 'list', '--format', 'json'], { timeoutMs: 30000 })
      return { libraries: (parseJson(r.stdout)?.installed_libraries ?? []).map(normLibInstalled), cliError: r.code === 0 ? undefined : (r.stderr || r.stdout) }
    },

    async libsSearch(q) {
      const info = cliInfo(config)
      if (!info.found) return { libraries: [], cliError: info.error }
      const query = String(q || '').trim()
      if (!query) return { libraries: [] }
      const r = await runCli(info.path, ['lib', 'search', query, '--format', 'json'], { timeoutMs: 60000 })
      return { libraries: (parseJson(r.stdout)?.libraries ?? []).map(normLibSearch) }
    },

    async libsInstall(name) {
      const info = cliInfo(config)
      if (!info.found) return { ok: false, output: info.error, code: -1 }
      const target = String(name || '').trim()
      if (!target) return { ok: false, output: '缺少库名称', code: -1 }
      events.emit('activity', { action: 'lib_install', status: 'running', summary: `安装库 ${target}` })
      const r = await runCli(info.path, ['lib', 'install', target], { timeoutMs: 1800000 })
      const ok = r.code === 0
      events.emit('activity', { action: 'lib_install', status: ok ? 'done' : 'failed', summary: ok ? `已安装库 ${target}` : `安装库失败：${target}`, detail: summaryOf(r.stdout + r.stderr, 3), ok })
      return { ok, code: r.code, output: r.stdout + r.stderr, error: r.error }
    },

    async libsUninstall(name) {
      const info = cliInfo(config)
      if (!info.found) return { ok: false, output: info.error, code: -1 }
      const target = String(name || '').trim()
      if (!target) return { ok: false, output: '缺少库名称', code: -1 }
      const r = await runCli(info.path, ['lib', 'uninstall', target], { timeoutMs: 600000 })
      return { ok: r.code === 0, code: r.code, output: r.stdout + r.stderr, error: r.error }
    },

    async examplesAll() {
      const info = cliInfo(config)
      const builtin = listBuiltinExamples()
      let libraries = []
      if (info.found) {
        const r = await runCli(info.path, ['lib', 'examples'], { timeoutMs: 60000 })
        libraries = parseLibExamplesText(r.stdout)
      }
      allowedExampleDirs = new Set()
      for (const b of builtin) for (const e of b.examples) allowedExampleDirs.add(e)
      for (const l of libraries) for (const e of l.examples) allowedExampleDirs.add(e)
      return { builtin, libraries }
    },

    async examplesOpen(dir) {
      const d = String(dir || '')
      if (!d || !allowedExampleDirs.has(d) || !existsSync(d)) {
        return { error: '示例路径不在允许列表内' }
      }
      const files = {}
      for (const f of readdirSync(d)) {
        const full = join(d, f)
        if (!statSync(full).isFile()) continue
        if (!/\.(ino|h|cpp|c|txt)$/i.test(f)) continue
        try { files[f] = readFileSync(full, 'utf8') } catch { /* ignore */ }
      }
      const base = basename(d)
      const sketch = files[`${base}.ino`] ? base : (Object.keys(files).find((f) => f.endsWith('.ino')) || '').replace(/\.ino$/, '')
      return { sketch, files }
    },

    sketches() {
      return listSketches(config)
    },

    sketchSave(sketch, files) {
      const sketchName = sanitizeSketchName(sketch)
      if (!sketchName) return { error: 'sketch 名称不合法' }
      writeSketch(config, sketchName, files || {})
      return { ok: true, sketch: sketchName, dir: sketchDir(config, sketchName) }
    },

    sketchOpen(sketch) {
      const sketchName = sanitizeSketchName(sketch)
      if (!sketchName) return { error: 'sketch 名称不合法' }
      const data = readSketch(config, sketchName)
      if (!data) return { error: 'sketch 不存在' }
      return data
    },

    sketchDelete(sketch) {
      const sketchName = sanitizeSketchName(sketch)
      if (!sketchName) return { error: 'sketch 名称不合法' }
      const dir = sketchDir(config, sketchName)
      if (!existsSync(dir)) return { error: 'sketch 不存在' }
      rmSync(dir, { recursive: true, force: true })
      return { ok: true }
    },

    async sketchArchive(sketch) {
      const sketchName = sanitizeSketchName(sketch)
      if (!sketchName) return { error: 'sketch 名称不合法' }
      const dir = sketchDir(config, sketchName)
      if (!existsSync(dir)) return { error: 'sketch 不存在' }
      const archivesDir = join(root, 'archives')
      mkdirSync(archivesDir, { recursive: true })
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      const zipPath = join(archivesDir, `${sketchName}-${stamp}.zip`)
      const ps = spawnSync(powershellPath(), [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
        `Compress-Archive -Path '${dir}\\*' -DestinationPath '${zipPath}' -Force`,
      ], { encoding: 'utf8', timeout: 120000 })
      if (ps.status === 0 && existsSync(zipPath)) {
        return { ok: true, file: basename(zipPath), path: zipPath }
      }
      return { ok: false, error: ps.stderr || ps.stdout || '压缩失败' }
    },

    format(code) {
      return { code: autoFormat(code) }
    },

    serialOpen(port, baud) {
      const p = String(port || '').trim()
      if (!p) return { ok: false, error: '缺少串口' }
      return serial.open(p, Number(baud || 9600))
    },

    serialWrite(text) {
      return serial.write(String(text ?? ''))
    },

    serialClose() {
      serial.close()
      return { ok: true }
    },
  }

  return service
}

let allowedExampleDirs = new Set()

/** 取输出末尾若干行作为摘要。 */
function summaryOf(text, n = 4) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  return lines.slice(-n).join('\n')
}

/** 状态变更的人类可读摘要。 */
function summarizeStatePatch(patch) {
  const parts = []
  if (typeof patch.currentSketch === 'string') parts.push(`sketch=${patch.currentSketch}`)
  if (typeof patch.currentFqbn === 'string') parts.push(`fqbn=${patch.currentFqbn}`)
  if (typeof patch.currentPort === 'string') parts.push(`port=${patch.currentPort}`)
  return parts.length ? `状态更新：${parts.join(' ')}` : '状态更新'
}
