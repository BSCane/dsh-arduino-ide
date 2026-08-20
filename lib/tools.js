/**
 * ============================================================================
 * dsh-arduino-ide —— Agent 工具集（方案 A 的 4.2）
 * ============================================================================
 * 用 @deepseek-ai/dsh-tools 的 defineTool 注册 arduino_* 工具，使 Agent
 * （本会话）可以直接调用 Arduino 开发能力：环境探测 → 编写/打开 Sketch →
 * 编译 → 修复 → 上传 → 串口观察 → 板卡/库/示例管理。
 *
 * 与 dsh-undo-savepoint 相同的注册模式：
 *   ctx.tools.register(defineTool({ name, description, parameters, output,
 *   isConcurrencySafe, execute }))
 *
 * defineTool 的多锚点解析：
 *   1) 本插件位置（createRequire(import.meta.url)）——标准 pnpm 安装
 *   2) $DSH_HOME/profiles/node_modules —— DSH 共享模块回退目录（本地
 *      link: 安装到工作区、不在 profile 依赖树内时也能解析）
 *   3) $DSH_ROOT —— 显式安装根
 * ============================================================================
 */
import { createRequire } from 'node:module'
import { join } from 'node:path'
import os from 'node:os'
import { existsSync } from 'node:fs'

let defineTool = null

function resolveDefineTool() {
  if (defineTool) return defineTool
  const anchors = []
  try { anchors.push(createRequire(import.meta.url)) } catch { /* ignore */ }
  const dshHome = process.env.DSH_HOME || join(os.homedir(), '.dsh')
  const fallbackDir = join(dshHome, 'profiles', 'node_modules')
  if (existsSync(fallbackDir)) {
    try { anchors.push(createRequire(join(fallbackDir, 'package.json'))) } catch { /* ignore */ }
  }
  const dshRoot = process.env.DSH_ROOT
  if (dshRoot) {
    try { anchors.push(createRequire(join(dshRoot, 'package.json'))) } catch { /* ignore */ }
  }
  for (const anchor of anchors) {
    try {
      const mod = anchor('@deepseek-ai/dsh-tools')
      if (mod && typeof mod.defineTool === 'function') {
        defineTool = mod.defineTool
        return defineTool
      }
    } catch { /* try next anchor */ }
  }
  throw new Error(
    'dsh-arduino-ide: cannot resolve "@deepseek-ai/dsh-tools". Install the plugin via `dsh plugin add` '
    + '(peer deps resolve automatically), or set DSH_ROOT to your DSH install root for local junction mounts.',
  )
}

const TEXT_OUTPUT = {
  schema: { type: 'string' },
  render: (_args, value) => [{ type: 'text', text: String(value) }],
}

/** 输出截断到 maxLines 行，避免撑爆工具结果。 */
function cap(text, maxLines = 120) {
  const s = String(text ?? '')
  const lines = s.split(/\r?\n/)
  if (lines.length <= maxLines) return s
  return lines.slice(0, maxLines).join('\n') + `\n…（输出过长，已截断，共 ${lines.length} 行）`
}

function fmtBoardList(ports, boards) {
  const p = ports.length
    ? ports.map((x) => `  - ${x.address}${x.label && x.label !== x.address ? ` (${x.label})` : ''}`).join('\n')
    : '  （未检测到串口）'
  const b = boards.length
    ? boards.slice(0, 40).map((x) => `  - ${x.name} → ${x.fqbn}`).join('\n') + (boards.length > 40 ? `\n  …（共 ${boards.length} 个）` : '')
    : '  （无可用板卡，先安装核心，如 arduino:avr）'
  return `端口：\n${p}\n可用板卡：\n${b}`
}

/**
 * 注册全部 arduino_* 工具与系统提示段落。
 * @param {import('@deepseek-ai/cordis').Context} ctx - 插件上下文（注入 tools/systemPrompt/webServer）
 * @param {ReturnType<import('./arduino-service.js').createArduinoService>} service
 */
export function registerArduinoTools(ctx, service) {
  const define = resolveDefineTool()

  const tool = (name, description, parameters, execute, opts = {}) => {
    ctx.effect(() => ctx.tools.register(define({
      name,
      description,
      parameters,
      output: TEXT_OUTPUT,
      isConcurrencySafe: () => true,
      execute: async (args) => execute(args),
      ...opts,
    })), `dsh-arduino-ide.tool.${name}`)
  }

  // ---- 环境 / 状态 ----
  tool('arduino_status', '查询 Arduino 开发环境与当前状态：arduino-cli 是否可用及版本、工作区路径、当前 Sketch/板卡(FQBN)/端口。执行任何 Arduino 任务前先调用它。', {}, async () => {
    const s = service.status()
    const state = s.state || {}
    return [
      `arduino-cli: ${s.cli.found ? `可用 (${s.cli.path})` : `不可用：${s.cli.error}`}`,
      s.cli.version ? `版本: ${s.cli.version}` : '',
      `工作区: ${s.workRoot}`,
      `当前 Sketch: ${state.currentSketch || '（无）'}`,
      `当前板卡: ${state.currentFqbn || '（未选择）'}`,
      `当前端口: ${state.currentPort || '（未选择）'}`,
    ].filter(Boolean).join('\n')
  })

  tool('arduino_boards', '列出当前连接的串口端口与所有可用开发板（含 FQBN）。选择板卡/端口前调用；端口热插拔后带 refresh=true 重新获取。', {
    refresh: { type: 'boolean', description: '强制刷新（跳过缓存）' },
  }, async (args) => {
    const d = await service.boards()
    if (d.cliError) return `arduino-cli 不可用：${d.cliError}`
    return fmtBoardList(d.ports, d.boards)
  })

  // ---- Sketch ----
  tool('arduino_sketch_new', '新建（或重置）一个 Sketch：生成 <name>.ino 并写入默认 Blink 模板。当前状态切换到该 Sketch。', {
    name: { type: 'string', required: true, description: 'Sketch 名称（字母数字下划线中文，不含扩展名）' },
  }, async (args) => {
    const name = String(args?.name || '')
    const r = service.sketchSave(name, { [`${name}.ino`]: BLINK_TEMPLATE })
    if (r.error) return `失败：${r.error}`
    service.setState({ currentSketch: r.sketch })
    return `已新建 Sketch「${r.sketch}」并保存到 ${r.dir}\n已写入 ${r.sketch}.ino（Blink 模板），可用 arduino_verify 编译。`
  })

  tool('arduino_sketch_open', '打开一个已保存的 Sketch，返回其全部文件内容（含 .ino/.h/.cpp）。当前状态切换到该 Sketch。', {
    name: { type: 'string', required: true, description: 'Sketch 名称' },
  }, async (args) => {
    const name = String(args?.name || '')
    const r = service.sketchOpen(name)
    if (r.error) return `失败：${r.error}（可用 arduino_sketch_list 查看已有 Sketch）`
    service.setState({ currentSketch: r.sketch })
    const files = Object.entries(r.files || {}).map(([f, c]) => `### ${f}\n${String(c).slice(0, 2000)}${String(c).length > 2000 ? '\n…（已截断）' : ''}`).join('\n\n')
    return `已打开 Sketch「${r.sketch}」：\n${files}`
  })

  tool('arduino_sketch_list', '列出工作区中所有已保存的 Sketch。', {}, async () => {
    const list = service.sketches()
    if (!list.length) return '（工作区暂无已保存 Sketch）'
    return `已保存 Sketch：\n${list.map((s) => `  - ${s}`).join('\n')}`
  })

  tool('arduino_sketch_save', '保存当前多文件 Sketch（主文件必须为 <name>.ino）。保存后可被 arduino_sketch_open / arduino_verify / arduino_upload 使用。', {
    name: { type: 'string', required: true, description: 'Sketch 名称' },
    files: { type: 'object', required: true, additionalProperties: true, description: '文件内容映射 { "MySketch.ino": "代码…", "extra.h": "…" }。主 .ino 文件名必须与 Sketch 名一致。' },
  }, async (args) => {
    const r = service.sketchSave(String(args?.name || ''), args?.files)
    if (r.error) return `失败：${r.error}`
    service.setState({ currentSketch: r.sketch })
    return `已保存 Sketch「${r.sketch}」(${Object.keys(args?.files || {}).length} 个文件) → ${r.dir}`
  })

  tool('arduino_sketch_delete', '删除一个已保存的 Sketch（含全部文件）。', {
    name: { type: 'string', required: true, description: 'Sketch 名称' },
  }, async (args) => {
    const r = service.sketchDelete(String(args?.name || ''))
    return r.error ? `失败：${r.error}` : `已删除 Sketch「${args.name}」`
  })

  // ---- 编译 / 上传 ----
  tool('arduino_verify', '编译验证当前（或指定）Sketch：写入工作区后用 arduino-cli compile --fqbn <板卡> 编译。返回完整编译输出；失败时输出中含错误行号，据此修复后重试。成功会更新当前板卡状态。', {
    sketch: { type: 'string', description: 'Sketch 名称（缺省用当前状态）' },
    files: { type: 'object', additionalProperties: true, description: '文件内容映射；缺省用工作区已保存内容' },
    fqbn: { type: 'string', description: '板卡 FQBN，如 arduino:avr:uno（缺省用当前状态）' },
  }, async (args) => {
    const r = await service.verify({
      sketch: args?.sketch || service.getState().currentSketch,
      files: args?.files,
      fqbn: args?.fqbn || service.getState().currentFqbn,
    })
    return r.ok
      ? `✔ 编译通过（${args?.sketch || service.getState().currentSketch}）\n${cap(r.output, 60)}`
      : `✘ 编译失败 (exit ${r.code})${r.timedOut ? '（超时）' : ''}\n${cap(r.output, 120)}`
  })

  tool('arduino_upload', '编译并把 Sketch 烧录到指定端口：arduino-cli upload -p <端口> --fqbn <板卡>。上传前若串口监视器占用同一端口会失败，先 arduino_serial_close。', {
    sketch: { type: 'string', description: 'Sketch 名称（缺省用当前状态）' },
    files: { type: 'object', additionalProperties: true, description: '文件内容映射；缺省用工作区已保存内容' },
    fqbn: { type: 'string', description: '板卡 FQBN（缺省用当前状态）' },
    port: { type: 'string', description: '串口端口，如 COM4（缺省用当前状态）' },
  }, async (args) => {
    const st = service.getState()
    const r = await service.upload({
      sketch: args?.sketch || st.currentSketch,
      files: args?.files,
      fqbn: args?.fqbn || st.currentFqbn,
      port: args?.port || st.currentPort,
    })
    if (r.ok) return `✔ 烧录成功（${args?.sketch || st.currentSketch} → ${args?.port || st.currentPort}）\n${cap(r.output, 60)}`
    return `✘ 烧录失败 (exit ${r.code})${r.timedOut ? '（超时）' : ''}\n${cap(r.output, 120)}`
  })

  // ---- 串口 ----
  tool('arduino_serial_open', '打开串口监视会话（独占端口）。打开后板卡通过 Serial.print 输出的数据会被缓存，可用 arduino_serial_read 读取。', {
    port: { type: 'string', required: true, description: '串口端口，如 COM4' },
    baud: { type: 'number', description: '波特率，默认 9600，须与 Serial.begin() 一致' },
  }, async (args) => {
    const r = service.serialOpen(String(args?.port || ''), args?.baud)
    return r.ok
      ? `串口已打开：${args.port} @ ${args.baud || 9600}（数据自动缓存，可 arduino_serial_read）`
      : `串口打开失败：${r.error}`
  })

  tool('arduino_serial_write', '向已打开的串口发送一行文本（自动补 \\r\\n）。', {
    text: { type: 'string', required: true, description: '要发送的内容' },
  }, async (args) => {
    const r = service.serialWrite(String(args?.text ?? ''))
    return r.ok ? `已发送：${args.text}` : `发送失败：${r.error}`
  })

  tool('arduino_serial_read', '读取串口缓存中收到的行（自打开/上次读取以来）。clear=true 时读取后清空缓存。用于观察板卡输出、调试传感器数据。', {
    clear: { type: 'boolean', description: '读取后清空缓存' },
  }, async (args) => {
    const st = service.getState()
    if (!service.serial.connected) return `串口未连接（当前端口：${st.currentPort || '未选择'}）。先 arduino_serial_open。`
    const lines = service.serial.lines
    const count = lines.length
    if (args?.clear) service.serial.lines.length = 0
    if (!count) return '（缓存中暂无新数据）'
    const body = lines.slice(-80).join('\n')
    return count > 80 ? `收到 ${count} 行（显示最近 80 行）：\n${body}` : `收到 ${count} 行：\n${body}`
  })

  tool('arduino_serial_close', '关闭串口监视会话，释放端口（上传前若占用需先关闭）。', {}, async () => {
    service.serialClose()
    return '串口已关闭'
  })

  // ---- 板卡核心 / 库 ----
  tool('arduino_cores_list', '列出已安装的开发板核心（如 arduino:avr）。', {}, async () => {
    const d = await service.coresList()
    if (d.cliError) return `arduino-cli 不可用：${d.cliError}`
    const list = d.platforms.filter((p) => p.installed)
    return list.length
      ? `已安装核心：\n${list.map((p) => `  - ${p.id} @ ${p.installed}${p.latest && p.latest !== p.installed ? `（可更新至 ${p.latest}）` : ''}`).join('\n')}`
      : '（未安装任何核心，先 arduino_cores_install 如 arduino:avr）'
  })

  tool('arduino_cores_search', '搜索可安装的开发板核心。', {
    q: { type: 'string', required: true, description: '搜索词，如 esp32 / avr / stm32' },
  }, async (args) => {
    const d = await service.coresSearch(String(args?.q || ''))
    return d.platforms.length
      ? `搜索结果（${args.q}）：\n${d.platforms.map((p) => `  - ${p.id} (latest ${p.latest || '?'})`).join('\n')}`
      : `（无匹配结果：${args.q}）`
  })

  tool('arduino_cores_install', '安装开发板核心（联网下载，可能耗时数分钟）。', {
    name: { type: 'string', required: true, description: '核心 id，如 esp32:esp32 / arduino:avr' },
  }, async (args) => {
    const r = await service.coresInstall(String(args?.name || ''))
    return r.ok ? `✔ 核心已安装：${args.name}` : `✘ 安装失败：${args.name}\n${cap(r.output, 60)}`
  })

  tool('arduino_cores_uninstall', '卸载开发板核心。', {
    name: { type: 'string', required: true, description: '核心 id' },
  }, async (args) => {
    const r = await service.coresUninstall(String(args?.name || ''))
    return r.ok ? `✔ 核心已卸载：${args.name}` : `✘ 卸载失败：${args.name}\n${cap(r.output, 60)}`
  })

  tool('arduino_libs_list', '列出已安装的第三方库。', {}, async () => {
    const d = await service.libsList()
    if (d.cliError) return `arduino-cli 不可用：${d.cliError}`
    return d.libraries.length
      ? `已安装库（${d.libraries.length}）：\n${d.libraries.map((l) => `  - ${l.name}${l.version ? ` @ ${l.version}` : ''}`).join('\n')}`
      : '（未安装任何库）'
  })

  tool('arduino_libs_search', '搜索可安装的第三方库。', {
    q: { type: 'string', required: true, description: '搜索词，如 Servo / LiquidCrystal / FastLED' },
  }, async (args) => {
    const d = await service.libsSearch(String(args?.q || ''))
    return d.libraries.length
      ? `搜索结果（${args.q}）：\n${d.libraries.slice(0, 30).map((l) => `  - ${l.name} (latest ${l.latest || '?'})`).join('\n')}${d.libraries.length > 30 ? `\n  …（共 ${d.libraries.length} 条）` : ''}`
      : `（无匹配结果：${args.q}）`
  })

  tool('arduino_libs_install', '安装第三方库（联网下载，可能耗时数分钟）。', {
    name: { type: 'string', required: true, description: '库名称，如 Servo / FastLED' },
  }, async (args) => {
    const r = await service.libsInstall(String(args?.name || ''))
    return r.ok ? `✔ 库已安装：${args.name}` : `✘ 安装失败：${args.name}\n${cap(r.output, 60)}`
  })

  tool('arduino_libs_uninstall', '卸载第三方库。', {
    name: { type: 'string', required: true, description: '库名称' },
  }, async (args) => {
    const r = await service.libsUninstall(String(args?.name || ''))
    return r.ok ? `✔ 库已卸载：${args.name}` : `✘ 卸载失败：${args.name}\n${cap(r.output, 60)}`
  })

  // ---- 示例 / 格式化 / 归档 ----
  tool('arduino_examples_list', '浏览官方示例：内置核心示例（按核心/库分组）与已装库示例。', {}, async () => {
    const d = await service.examplesAll()
    const builtin = d.builtin.length
      ? d.builtin.map((b) => `  ${b.library} (${b.arch})：\n${b.examples.map((e) => `    - ${e.split(/[\\/]/).pop()} → ${e}`).join('\n')}`).join('\n')
      : '  （无内置核心示例）'
    const libs = d.libraries.length
      ? d.libraries.map((l) => `  ${l.library}：\n${l.examples.map((e) => `    - ${e.split(/[\\/]/).pop()} → ${e}`).join('\n')}`).join('\n')
      : '  （无库示例）'
    return `内置核心示例：\n${builtin}\n库示例：\n${libs}`
  })

  tool('arduino_examples_open', '载入一个示例到工作区（复制其 .ino/.h/.cpp 内容），成为当前 Sketch。dir 用 arduino_examples_list 给出的完整路径。', {
    dir: { type: 'string', required: true, description: '示例目录完整路径' },
  }, async (args) => {
    const r = await service.examplesOpen(String(args?.dir || ''))
    if (r.error) return `失败：${r.error}`
    const files = Object.entries(r.files || {}).map(([f, c]) => `### ${f}\n${String(c).slice(0, 1500)}${String(c).length > 1500 ? '\n…（已截断）' : ''}`).join('\n\n')
    service.setState({ currentSketch: r.sketch })
    return `已载入示例「${r.sketch}」：\n${files}`
  })

  tool('arduino_format', '对代码做自动格式化（缩进整理）。', {
    code: { type: 'string', required: true, description: '要格式化的代码' },
  }, async (args) => {
    const r = service.format(String(args?.code ?? ''))
    return r.code
  })

  tool('arduino_archive', '把当前 Sketch 打包为 .zip 归档（存于工作区 archives 目录）。', {
    sketch: { type: 'string', description: 'Sketch 名称（缺省用当前状态）' },
  }, async (args) => {
    const r = await service.sketchArchive(String(args?.sketch || service.getState().currentSketch))
    return r.ok ? `✔ 已归档：${r.file} → ${r.path}` : `归档失败：${r.error}`
  })
}

const BLINK_TEMPLATE = 'void setup() {\n  pinMode(LED_BUILTIN, OUTPUT);\n}\n\nvoid loop() {\n  digitalWrite(LED_BUILTIN, HIGH);\n  delay(1000);\n  digitalWrite(LED_BUILTIN, LOW);\n  delay(1000);\n}\n'

export const ARDUINO_PROMPT = `## Arduino 开发（dsh-arduino-ide）
用户下达 Arduino 开发任务（写/改 Sketch、编译、烧录、看串口、装板卡/库、找示例）时，优先使用 arduino_* 工具而非手敲 arduino-cli 或 pwsh：
1. 先 arduino_status / arduino_boards 确认环境与板卡/端口；
2. 写代码用 arduino_sketch_save（或直接给 arduino_verify 传 files）；编译用 arduino_verify（失败时读错误行号修复后重试）；
3. 烧录用 arduino_upload（若端口被串口占用先 arduino_serial_close）；观察输出用 arduino_serial_open + arduino_serial_read；
4. 每次动作都会广播到 IDE 面板的「Agent 活动」页，用户可实时看到进度；当前板卡/端口/Sketch 会自动同步到面板工具栏。`
