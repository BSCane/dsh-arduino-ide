/**
 * 客户端 bundle 加载冒烟：用最小 stub 环境加载 lib/client.js，
 * 验证 __ModuleLoader__.load 注册 + Cordis 三件套导出 + 高亮管线纯函数。
 */
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

// ---- 从 client.js 提取高亮管线（复制自该文件，保持逐字一致）----
const SRC = readFileSync(new URL('./lib/client.js', import.meta.url), 'utf8')
const FACTORY_BODY = SRC.slice(SRC.indexOf('factory: (require) => {') + 'factory: (require) => {'.length, SRC.lastIndexOf('return module.exports;'))

// 在受限作用域里执行 factory，捕获导出的函数（通过闭包变量）
const sandbox = {
  window: { __ModuleLoader__: { load: (h) => { sandbox.handoff = h } } },
  document: {
    createElement: () => ({ dataset: {}, style: {}, set textContent(v) {}, }),
    querySelector: () => null,
    head: { appendChild: () => {} },
  },
  console,
}
sandbox.window.__ModuleLoader__ = { load: (h) => { sandbox.handoff = h } }
vm.createContext(sandbox)
vm.runInContext(SRC, sandbox)

let failures = 0
const check = (name, cond, extra) => {
  if (cond) console.log('PASS:', name)
  else { failures++; console.error('FAIL:', name, extra !== undefined ? JSON.stringify(extra) : '') }
}

check('load() registered with id dsh-arduino-ide', sandbox.handoff && sandbox.handoff.id === 'dsh-arduino-ide', sandbox.handoff && sandbox.handoff.id)

// 执行 factory 拿到导出
const stubComp = () => null;
const exportsObj = sandbox.handoff.factory((spec) => {
  if (spec === 'react' || spec === 'react/jsx-runtime') {
    return { useEffect: () => {}, useRef: () => ({}), useState: (v) => [v, () => {}], useCallback: (f) => f, useMemo: (f) => f(), jsx: () => null }
  }
  if (spec === '@deepseek-ai/dsh-client-ui-primitives') {
    const ui = {};
    for (const n of ['Button', 'Input', 'Pill', 'Menu', 'StateDot', 'TerminalBlock', 'DisclosureRow', 'ConnectionBanner']) ui[n] = stubComp;
    for (const n of ['IconCheckOutline16', 'IconPlayOutline16', 'IconRefreshOutline16', 'IconCloseOutline16', 'IconPlusOutline16', 'IconTrashOutline16', 'IconSearchOutline16', 'IconDownloadOutline16', 'IconFolderOpenOutline16', 'IconFolderClose16', 'IconChevronDownOutline14', 'IconSendOutline16', 'IconCodeOutline16', 'IconDataOutline16', 'IconLoadingOutline16', 'IconEllipsisOutline16', 'IconArchiveOutline20', 'IconSettingsOutline16', 'IconStopFill16', 'IconListPenOutline16', 'IconWarningOutline16', 'IconRightUpOutline16']) ui[n] = stubComp;
    return ui;
  }
  throw new Error('unexpected require: ' + spec)
})
check('exports.apply is function', typeof exportsObj.apply === 'function')
check('exports.inject = ["slots"]', Array.isArray(exportsObj.inject) && exportsObj.inject[0] === 'slots')
check('exports.name = arduino-ide', exportsObj.name === 'arduino-ide')

// ---- 高亮管线：直接评估源码中定义的纯函数 ----
const pureSrc = [
  /const KEYWORDS = new Set\(\[[\s\S]*?\n\t\t\]\)/.exec(SRC)[0].replace('const KEYWORDS', 'var KEYWORDS'),
  /const TOKEN_RE = [^\n]+/.exec(SRC)[0].replace('const TOKEN_RE', 'var TOKEN_RE'),
  /function escapeHtml[\s\S]*?\n\t\t}/.exec(SRC)[0],
  /function tokenize[\s\S]*?\n\t\t}/.exec(SRC)[0],
  /function applyMarks[\s\S]*?\n\t\t}/.exec(SRC)[0],
  /function segHtml[\s\S]*?\n\t\t}/.exec(SRC)[0],
  /function findRanges[\s\S]*?\n\t\t}/.exec(SRC)[0],
  /function bracketPair[\s\S]*?\n\t\t}/.exec(SRC)[0],
  /function matchPair[\s\S]*?\n\t\t}/.exec(SRC)[0],
  /function matchPairBack[\s\S]*?\n\t\t}/.exec(SRC)[0],
].join('\n')
const ctx = { KEYWORDS: undefined, TOKEN_RE: undefined, escapeHtml: undefined, tokenize: undefined, applyMarks: undefined, segHtml: undefined, findRanges: undefined, bracketPair: undefined, matchPair: undefined, matchPairBack: undefined }
vm.createContext(ctx)
vm.runInContext(pureSrc, ctx)

const code = 'void setup() {\n  pinMode(LED_BUILTIN, OUTPUT); // 注释\n}\n'
const html = ctx.applyMarks(ctx.tokenize(code), [])
check('highlight: keyword span', html.includes('class="kw"') && html.includes('void'), html.slice(0, 120))
check('highlight: comment span', html.includes('class="cm"'), html.slice(0, 200))
check('highlight: escapes <', ctx.applyMarks(ctx.tokenize('a < b'), []).includes('&lt;'))
const html2 = ctx.applyMarks(ctx.tokenize('(a)'), [{ start: 0, end: 1, cls: 'dsh-ai-bm' }, { start: 2, end: 3, cls: 'dsh-ai-bm' }])
check('highlight: bracket marks', html2.split('dsh-ai-bm').length - 1 === 2, html2)
check('findRanges: counts', ctx.findRanges('aaabbbaa', 'aa').length === 2)
const bp = ctx.bracketPair('void f() {\n}', 7)
check('bracketPair: matches ( ) at 6-7', bp && bp.a === 6 && bp.b === 7, bp)
const bpClose = ctx.bracketPair('void f() {\n}', 11)
check('bracketPair: matches { } at 9-11', bpClose && bpClose.a === 9 && bpClose.b === 11, bpClose)
const bp2 = ctx.bracketPair('x = (1 + 2);', 10)
check('bracketPair: matches ( ) at 4-10', bp2 && bp2.a === 4 && bp2.b === 10, bp2)
check('bracketPair: no match', ctx.bracketPair('void f( {', 6) === null || ctx.bracketPair('void f( {', 6) === undefined)

if (failures) { console.error('\n' + failures + ' 项失败'); process.exit(1) }
console.log('\n客户端 bundle 冒烟测试通过 ✔')
