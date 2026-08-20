#!/usr/bin/env node
/**
 * ============================================================================
 * prepack-check.js —— 发布前健康检查（npm publish / npm pack 前自动运行）
 * ============================================================================
 * 由 package.json 的 "prepack" 脚本触发。任何一项失败都会置 exit code 为 1，
 * 阻止发布一个坏包。
 *
 * 检查项：
 *   1. 必需文件存在（宿主/服务/工具/客户端/patch/文档/许可）
 *   2. client.js 是官方 bundle 形态（__ModuleLoader__.load + exports.apply）
 *   3. package.json 声明了 dsh.bundle 和 dsh.client（否则装不上）
 *   4. 包总大小 < 50MB（npm 体积软上限）
 * ============================================================================
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const fail = (msg) => { console.error(`[prepack-check] FAIL: ${msg}`); process.exitCode = 1 }
const ok = (msg) => console.log(`[prepack-check] ok: ${msg}`)

// ---- 1. 必需文件存在性 ----
const required = [
  'lib/index.js',
  'lib/arduino-service.js',
  'lib/tools.js',
  'lib/client.js',
  'cordis.patch.yml',
  'README.md',
  'LICENSE',
]
for (const f of required) {
  existsSync(join(ROOT, f)) ? ok(`exists ${f}`) : fail(`missing ${f}`)
}

// ---- 2. client.js 必须是官方 bundle 形态 ----
const client = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8')
client.includes('__ModuleLoader__.load') ? ok('client bundle shape OK') : fail('lib/client.js missing __ModuleLoader__.load')
client.includes('exports.apply') ? ok('client exports apply') : fail('lib/client.js missing exports.apply')

// ---- 3. package.json 必须声明 bundle + client ----
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
pkg.dsh?.bundle?.patch ? ok('dsh.bundle.patch declared') : fail('package.json missing dsh.bundle.patch')
pkg.dsh?.client?.platform === 'web' ? ok('dsh.client platform web declared') : fail('package.json missing dsh.client platform web')
pkg.exports?.['./client'] ? ok('exports["./client"] declared') : fail('package.json missing exports["./client"]')
pkg.name ? ok(`name: ${pkg.name}`) : fail('package.json missing name')
pkg.version ? ok(`version: ${pkg.version}`) : fail('package.json missing version')

// ---- 4. 包总大小估算（排除 node_modules/.git） ----
let total = 0
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!['node_modules', '.git'].includes(entry.name)) walk(p)
    } else if (!entry.name.endsWith('.map')) {
      total += statSync(p).size
    }
  }
}
walk(ROOT)
const mb = (total / 1e6).toFixed(1)
total > 50e6 ? fail(`package too large for npm: ${mb}MB (limit ~50MB)`) : ok(`package size ${mb}MB`)

// ---- 汇总 ----
if (process.exitCode) console.error('\n[prepack-check] fix the failures above before publishing.')
else console.log('\n[prepack-check] all checks passed — ready to pack/publish.')
