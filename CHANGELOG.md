# Changelog

本插件（dsh-arduino-ide）的开发记录。当前为本地开发（`dsh plugin --profile web add link:<目录>`），
代码变更通过 Junction 实时生效，重启 DSH 后加载新 bundle。

## 0.2.0 — Agent 友好化与可视化（方案 A）

按《Arduino 开发流程 Agent 友好化与可视化方案讨论》方案 A 实现：

- **共享服务层**（`lib/arduino-service.js`）：唯一业务实现，HTTP 与工具共用；事件总线
  （activity / compile / state）+ 状态单一事实来源（currentSketch / currentFqbn / currentPort）；
  编译/烧录行级流式输出（`runCliStream`）。
- **Agent 工具集**（`lib/tools.js`）：`@deepseek-ai/dsh-tools` defineTool 注册 17+ 个
  `arduino_*` 工具（status / boards / sketch×5 / verify / upload / serial×4 / cores×4 /
  libs×4 / examples×2 / format / archive）；多锚点解析（本插件位置 → `$DSH_HOME/profiles/node_modules`
  回退 → DSH_ROOT）；`systemPrompt` 提示段引导 Agent 使用。
- **薄 HTTP 壳**（`lib/index.js`）：原 `/arduino-ide/api/*` 全部转发 service；新增
  `GET /api/events`（SSE 事件流，含最近 120 条回放）、`POST /api/state`（面板→服务状态同步）。
- **浏览器半侧**（`lib/client.js`）：
  - 面板新增「Agent 活动」页：时间线（动作图标 + StateDot + 摘要 + 展开输出 + Agent/面板来源）；
  - 编译/烧录行级事件实时追加到正在执行的终端条目；
  - 状态双向同步：Agent 改板卡/端口/Sketch → 面板自动更新；面板手动操作 → 回写服务；
  - `conversation.chat.turnTail` 回合尾卡：本回合有 Arduino 活动时自动显示摘要；
  - `tool.call.toolview` 工具卡定制（7 个 arduino_* key）：对话中可视化呈现。
- 验证：宿主冒烟 38/38（真实编译 + SSE + 状态同步）、客户端冒烟 13/13；
  真实任务：Arduino Nano（COM4）D4Blink 编写→编译→烧录成功。

## 0.1.1 — DSH 原生风格重构

参照 dsh-better-sidebar 重构浏览器半侧：

- 组件切换为 `@deepseek-ai/dsh-client-ui-primitives`（Button / Input / Pill / Menu /
  StateDot / TerminalBlock / DisclosureRow / ConnectionBanner + 官方图标集）；
- 颜色/字体全部改用 `--dsw-alias-*` / `--dsw-font-*` 设计 token，自动适配明暗主题；
- 板卡/端口/文件操作改为原生下拉 Menu；编译/上传输出改为 TerminalBlock 终端卡片；
- 语法高亮改用 token 派生色。

## 0.1.0 — 初始实现

参照《Arduino IDE 基础功能总结》实现第一版：

- 宿主半侧：`/arduino-ide/api/*` JSON API，真实封装 arduino-cli（板卡/编译/上传/串口/库/核心/
  示例/草稿/格式化/归档）；串口经 PowerShell + .NET SerialPort 桥接 + SSE 推流；零外部 npm 依赖。
- 浏览器半侧：`sidebar.footer.action` 开关 + `shell.overlay` 浮动 IDE 面板（编辑器/串口/板卡/库/示例/控制台）。
- 验证：宿主冒烟 20/20。
