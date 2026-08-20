/**
 * dsh-arduino-ide 宿主半侧冒烟测试（不依赖 DSH 运行时）：
 * 1) 装配：路由 / 工具注册 / 系统提示段
 * 2) Agent 工具：直接执行 arduino_status / arduino_boards（真实 service）
 * 3) HTTP API：status / boards / verify(真实编译) / sketches / format / state
 * 4) SSE /api/events：verify 期间应收到 activity+compile 事件
 */
import { apply } from './lib/index.js'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

// 让 tools.js 的 defineTool 解析落到 DSH 共享模块回退目录
process.env.DSH_HOME = 'D:\\Program Files\\DSH\\box_0\\instances\\container-1787194922\\profile'

const workRoot = join(process.cwd(), '.smoke-arduino')
rmSync(workRoot, { recursive: true, force: true })
mkdirSync(workRoot, { recursive: true })

let route = null
const tools = []
const sections = []
const ctx = {
  effect(fn) { fn() },
  webServer: {
    register(r) { route = r },
  },
  tools: {
    register(t) { tools.push(t) },
  },
  systemPrompt: {
    section(s) { sections.push(s) },
  },
}

apply(ctx, { workRoot })

let failures = 0
function check(name, cond, extra) {
  if (cond) console.log('PASS:', name)
  else { failures++; console.error('FAIL:', name, extra !== undefined ? JSON.stringify(extra) : '') }
}

// ---- 装配 ----
check('route registered', route && route.kind === 'prefix' && route.path === '/arduino-ide', route && route.path)
check('tools registered (>=17)', tools.length >= 17, `count=${tools.length}`)
const toolNames = tools.map((t) => t.name)
for (const must of ['arduino_status', 'arduino_boards', 'arduino_sketch_new', 'arduino_sketch_save', 'arduino_verify', 'arduino_upload', 'arduino_serial_open', 'arduino_serial_read', 'arduino_cores_install', 'arduino_libs_install', 'arduino_examples_list', 'arduino_archive']) {
  check('tool exists: ' + must, toolNames.includes(must))
}
check('prompt section registered', sections.length === 1 && sections[0].name === 'tool:dsh-arduino-ide', sections[0])

// ---- 工具执行（真实 service）----
const statusTool = tools.find((t) => t.name === 'arduino_status')
const boardsTool = tools.find((t) => t.name === 'arduino_boards')
check('status tool is function', typeof statusTool.execute === 'function')
const statusText = await statusTool.execute({})
check('arduino_status: cli found', /arduino-cli: 可用/.test(statusText), statusText.slice(0, 200))
check('arduino_status: workRoot', statusText.includes(workRoot), statusText.slice(0, 200))
const boardsText = await boardsTool.execute({})
check('arduino_boards: uno fqbn', /arduino:avr:uno/.test(boardsText), boardsText.slice(0, 300))

// ---- HTTP 模拟 ----
function makeRes() {
  return { status: 0, headers: null, body: '', chunks: [], writeHead(s, h) { this.status = s; this.headers = h }, write(c) { this.body += c; this.chunks.push(String(c)) }, end(c) { if (c) { this.body += c; this.chunks.push(String(c)) } this.done = true }, destroy() {} }
}
function makeReq(method, url, body) {
  const chunks = body !== undefined ? [Buffer.from(JSON.stringify(body))] : []
  return {
    url, method,
    on(evt, cb) { if (evt === 'data') chunks.forEach((c) => cb(c)); if (evt === 'end') cb(); if (evt === 'error') {} },
  }
}
async function get(url) {
  const res = makeRes()
  await route.handler(makeReq('GET', url), res)
  return { status: res.status, data: res.body ? JSON.parse(res.body) : null }
}
async function post(url, data) {
  const res = makeRes()
  await route.handler(makeReq('POST', url, data), res)
  return { status: res.status, data: res.body ? JSON.parse(res.body) : null }
}
const base = route.path + '/api'

const status = await get(base + '/status')
check('status: cli found', status.data.cli && status.data.cli.found, status.data.cli)
check('status: has state', status.data.state && typeof status.data.state.currentSketch === 'string', status.data.state)

const boards = await get(base + '/boards')
check('boards: uno', boards.data.boards.some((b) => b.fqbn === 'arduino:avr:uno'))
check('boards: COM4', boards.data.ports.some((p) => p.address === 'COM4'))

// ---- SSE 事件流：verify 期间应收到 activity/compile ----
const sse = makeRes()
const sseReq = { url: base + '/events', method: 'GET', on(evt, cb) { if (evt === 'close') this._close = cb }, _close: null }
route.handler(sseReq, sse).then(() => {})
await new Promise((r) => setTimeout(r, 50))
const sseConnected = sse.headers && sse.headers['content-type'] === 'text/event-stream; charset=utf-8'
check('events SSE: content-type', sseConnected)

const blinky = 'void setup() {\n  pinMode(LED_BUILTIN, OUTPUT);\n}\n\nvoid loop() {\n  digitalWrite(LED_BUILTIN, HIGH);\n  delay(1000);\n  digitalWrite(LED_BUILTIN, LOW);\n  delay(1000);\n}\n'
console.log('--- 真实编译中（arduino:avr:uno，SSE 并行监听）… ---')
const t0 = Date.now()
const verify = await post(base + '/verify', { sketch: 'SmokeBlink', files: { 'SmokeBlink.ino': blinky }, fqbn: 'arduino:avr:uno' })
console.log('编译耗时(ms):', Date.now() - t0)
check('verify: ok', verify.data.ok === true, { code: verify.data.code, error: verify.data.error })
check('verify: output has stats', /Sketch uses/i.test(verify.data.output || ''), (verify.data.output || '').slice(0, 200))

await new Promise((r) => setTimeout(r, 100))
const sseBody = sse.body
check('events SSE: activity events', sseBody.includes('"action":"verify"') && sseBody.includes('"status":"done"'), sseBody.slice(-300))
check('events SSE: compile events', sseBody.includes('"type":"compile"'), sseBody.slice(0, 200))
check('events SSE: state event', sseBody.includes('"type":"state"'), sseBody.slice(-200))

// ---- 状态同步 ----
const stateBefore = await get(base + '/status')
check('state: currentFqbn updated by verify', stateBefore.data.state.currentFqbn === 'arduino:avr:uno', stateBefore.data.state)
const st = await post(base + '/state', { fqbn: 'arduino:avr:nano', port: 'COM9' })
check('state: POST updates', st.data.state.currentFqbn === 'arduino:avr:nano' && st.data.state.currentPort === 'COM9', st.data.state)
const stateAfter = await get(base + '/status')
check('state: persisted in service', stateAfter.data.state.currentFqbn === 'arduino:avr:nano', stateAfter.data.state)

// ---- 其余端点 ----
const save = await post(base + '/sketch/save', { sketch: 'SmokeBlink', files: { 'SmokeBlink.ino': blinky, 'extra.h': '#define T 1000\n' } })
check('sketch/save: ok', save.data.ok === true)
const sketches = await get(base + '/sketches')
check('sketches: contains SmokeBlink', sketches.data.sketches.includes('SmokeBlink'), sketches.data)
const fmt = await post(base + '/format', { code: 'void setup(){\npinMode(13,OUTPUT);\n}\n' })
check('format: reindented', fmt.data.code === 'void setup(){\n  pinMode(13,OUTPUT);\n}\n', fmt.data)
const examples = await get(base + '/examples')
check('examples: builtin non-empty', examples.data.builtin.length > 0, { builtin: examples.data.builtin.length })

// 工具里跑一个写入类动作（arduino_sketch_new）
const newTool = tools.find((t) => t.name === 'arduino_sketch_new')
const newText = await newTool.execute({ name: 'AgentSketch' })
check('arduino_sketch_new: creates + sets state', /已新建 Sketch「AgentSketch」/.test(newText), newText)
const state3 = await get(base + '/status')
check('arduino_sketch_new: currentSketch synced', state3.data.state.currentSketch === 'AgentSketch', state3.data.state)

// 清理：关闭 SSE 连接（释放心跳定时器），并显式退出进程
if (sseReq._close) sseReq._close()
rmSync(workRoot, { recursive: true, force: true })

if (failures) {
  console.error(`\n${failures} 项失败`)
  process.exit(1)
}
console.log('\n全部冒烟测试通过 ✔（含 Agent 工具 + 事件流 + 状态同步）')
process.exit(0)
