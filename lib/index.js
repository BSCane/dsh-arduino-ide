/**
 * ============================================================================
 * dsh-arduino-ide —— 插件入口（薄 HTTP 壳 + 装配）
 * ============================================================================
 * 方案 A 装配层：
 *   - createArduinoService()：唯一业务实现（见 arduino-service.js）
 *   - webServer 路由：/arduino-ide/api/* —— 浏览器面板使用的 JSON API，
 *     全部转发到 service（行为与旧版一致），新增：
 *       GET  /api/events  —— SSE 活动事件流（activity/compile/state）
 *       POST /api/state   —— 面板 → 服务 状态同步
 *   - ctx.tools.register：注册 arduino_* Agent 工具（见 tools.js）
 *   - ctx.systemPrompt.section：追加 Arduino 开发提示段
 * ============================================================================
 */
import { join, resolve, sep } from 'node:path'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createArduinoService } from './arduino-service.js'
import { registerArduinoTools, ARDUINO_PROMPT } from './tools.js'

export const name = 'arduino-ide'
// 'webServer' 在 LOADER 层注入（与 dsh-undo-savepoint 同款）：冷启动时
// 保证路由注册可靠；tools/systemPrompt 由 Agent 提供。
export const inject = ['tools', 'systemPrompt', 'webServer']

const ROUTE_PREFIX = '/arduino-ide'

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolved, rejected) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      try {
        resolved(raw.trim() ? JSON.parse(raw) : {})
      } catch {
        rejected(new Error('JSON body 解析失败'))
      }
    })
    req.on('error', rejected)
  })
}

/** SSE 推送一个事件。 */
function sseWrite(res, ev) {
  res.write(`data: ${JSON.stringify(ev)}\n\n`)
}

export function apply(ctx, config = {}) {
  const service = createArduinoService(config)

  const handler = async (req, res) => {
    try {
      await dispatch(req, res, service)
    } catch (err) {
      sendJson(res, 500, { error: String(err?.message || err) })
    }
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    handler,
  }), 'dsh-arduino-ide: /arduino-ide api')

  registerArduinoTools(ctx, service)

  ctx.effect(() => ctx.systemPrompt.section({
    name: 'tool:dsh-arduino-ide',
    order: 118,
    text: ARDUINO_PROMPT,
  }), 'dsh-arduino-ide.prompt')
}

async function dispatch(req, res, service) {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const pathname = url.pathname
  const prefix = ROUTE_PREFIX + '/api'
  if (!pathname.startsWith(prefix + '/')) {
    sendJson(res, 404, { error: 'not found' })
    return
  }
  const sub = pathname.slice(prefix.length + 1)
  const method = req.method || 'GET'

  // ---- SSE 活动事件流 ----
  if (sub === 'events' && method === 'GET') {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    res.write(': connected\n\n')
    // 回放最近事件（晚到的面板/回合尾卡能补看）
    for (const ev of service.events.recent(120)) sseWrite(res, ev)
    const onEvent = (ev) => sseWrite(res, ev)
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 15000)
    const unsub = service.events.subscribe(onEvent)
    const done = () => {
      clearInterval(heartbeat)
      unsub()
      res.end()
    }
    req.on('close', done)
    return
  }

  // ---- 面板 → 服务 状态同步 ----
  if (sub === 'state' && method === 'POST') {
    const body = await readBody(req)
    const state = service.setState({
      currentSketch: typeof body.sketch === 'string' ? body.sketch : undefined,
      currentFqbn: typeof body.fqbn === 'string' ? body.fqbn : undefined,
      currentPort: typeof body.port === 'string' ? body.port : undefined,
    }, 'panel')
    sendJson(res, 200, { state })
    return
  }

  // ---- GET 简单接口 ----
  if (method === 'GET') {
    switch (sub) {
      case 'status': {
        sendJson(res, 200, service.status())
        return
      }
      case 'boards': {
        sendJson(res, 200, await service.boards())
        return
      }
      case 'cores': {
        sendJson(res, 200, await service.coresList())
        return
      }
      case 'cores/search': {
        sendJson(res, 200, await service.coresSearch(url.searchParams.get('q')))
        return
      }
      case 'libs': {
        sendJson(res, 200, await service.libsList())
        return
      }
      case 'libs/search': {
        sendJson(res, 200, await service.libsSearch(url.searchParams.get('q')))
        return
      }
      case 'examples': {
        sendJson(res, 200, await service.examplesAll())
        return
      }
      case 'sketches': {
        sendJson(res, 200, { sketches: service.sketches() })
        return
      }
      case 'download': {
        const file = (url.searchParams.get('file') || '').trim()
        const archivesDir = join(service.root, 'archives')
        if (!/^[\w\-\u4e00-\u9fa5]+\.zip$/.test(file)) {
          sendJson(res, 400, { error: '非法文件名' })
          return
        }
        const full = resolve(archivesDir, file)
        if (!full.startsWith(resolve(archivesDir) + sep) || !existsSync(full)) {
          sendJson(res, 404, { error: '文件不存在' })
          return
        }
        const st = statSync(full)
        res.writeHead(200, {
          'content-type': 'application/zip',
          'content-length': st.size,
          'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file)}`,
        })
        createReadStream(full).pipe(res)
        return
      }
      case 'serial/stream': {
        if (!service.serial.connected) {
          sendJson(res, 409, { error: '串口未连接' })
          return
        }
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        })
        res.write(': connected\n\n')
        for (const line of service.serial.lines) res.write(`data: ${JSON.stringify(line)}\n\n`)
        const onLine = (line) => res.write(`data: ${JSON.stringify(line)}\n\n`)
        const heartbeat = setInterval(() => res.write(': ping\n\n'), 15000)
        service.serial.on('line', onLine)
        const done = () => {
          clearInterval(heartbeat)
          service.serial.removeListener('line', onLine)
          res.end()
        }
        service.serial.once('closed', done)
        req.on('close', done)
        return
      }
      default:
        sendJson(res, 404, { error: `unknown endpoint: ${sub}` })
        return
    }
  }

  // ---- POST ----
  if (method !== 'POST') {
    sendJson(res, 405, { error: 'method not allowed' })
    return
  }
  const body = await readBody(req)

  switch (sub) {
    case 'verify': {
      const r = await service.verify({
        sketch: body.sketch,
        files: body.files,
        fqbn: body.fqbn,
      })
      sendJson(res, 200, r)
      return
    }
    case 'upload': {
      const r = await service.upload({
        sketch: body.sketch,
        files: body.files,
        fqbn: body.fqbn,
        port: body.port,
      })
      sendJson(res, 200, r)
      return
    }
    case 'cores/install': {
      sendJson(res, 200, await service.coresInstall(body.name))
      return
    }
    case 'cores/uninstall': {
      sendJson(res, 200, await service.coresUninstall(body.name))
      return
    }
    case 'libs/install': {
      sendJson(res, 200, await service.libsInstall(body.name))
      return
    }
    case 'libs/uninstall': {
      sendJson(res, 200, await service.libsUninstall(body.name))
      return
    }
    case 'examples/open': {
      const r = await service.examplesOpen(body.dir)
      if (r.error) { sendJson(res, 403, r); return }
      sendJson(res, 200, r)
      return
    }
    case 'sketch/save': {
      sendJson(res, 200, service.sketchSave(body.sketch, body.files))
      return
    }
    case 'sketch/open': {
      const r = service.sketchOpen(body.sketch)
      if (r.error) { sendJson(res, 404, r); return }
      sendJson(res, 200, r)
      return
    }
    case 'sketch/delete': {
      sendJson(res, 200, service.sketchDelete(body.sketch))
      return
    }
    case 'sketch/archive': {
      const r = await service.sketchArchive(body.sketch)
      if (r.ok) {
        sendJson(res, 200, { ok: true, file: r.file, url: `${ROUTE_PREFIX}/api/download?file=${encodeURIComponent(r.file)}`, path: r.path })
      } else {
        sendJson(res, 200, r)
      }
      return
    }
    case 'format': {
      sendJson(res, 200, service.format(body.code))
      return
    }
    case 'serial/open': {
      sendJson(res, 200, service.serialOpen(body.port, body.baud))
      return
    }
    case 'serial/write': {
      sendJson(res, 200, service.serialWrite(body.text))
      return
    }
    case 'serial/close': {
      service.serialClose()
      sendJson(res, 200, { ok: true })
      return
    }
    default:
      sendJson(res, 404, { error: `unknown endpoint: ${sub}` })
  }
}
