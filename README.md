# dsh-arduino-ide

[![stars](https://img.shields.io/github/stars/BSCane/dsh-arduino-ide?style=social)](https://github.com/BSCane/dsh-arduino-ide)
[![license](https://img.shields.io/github/license/BSCane/dsh-arduino-ide?color=orange)](https://github.com/BSCane/dsh-arduino-ide/blob/main/LICENSE)

DSH Web 界面内的 **Arduino IDE 工作区 + Agent 友好化开发链路**（静态插件 / bundle plugin）。
参照《Arduino IDE 基础功能总结》实现人用工作台，并按《Arduino 开发流程 Agent 友好化与可视化方案讨论》方案 A
实现 Agent 可执行的工具链路与全过程可视化：编写 Sketch → 验证编译 → 选择板卡/端口 → 上传 → 串口调试。

> 设计文档：见 `../Arduino开发流程Agent友好化与可视化方案讨论.md`（同工作区）

## 安装

```sh
# 从 GitHub 安装
dsh plugin --profile web add github:BSCane/dsh-arduino-ide
```

安装完成后**重启 DSH**（bundle 层栈在启动时装配）。卸载：`dsh plugin --profile web remove dsh-arduino-ide`。

## 功能

| 功能 | 说明 |
| --- | --- |
| Sketch 编辑器 | 语法高亮（Arduino/C++）、行号、自动缩进、括号匹配高亮、查找/替换、多文件（.ino/.h/.cpp） |
| 验证 / 编译 | 真实调用 `arduino-cli compile --fqbn <板卡>` |
| 上传 | 真实调用 `arduino-cli upload -p <端口> --fqbn <板卡>` |
| 串口监视器 | 波特率选择、连接/断开、发送/接收；**串口绘图器**（纯数字行画曲线） |
| 开发板管理器 | 已装核心列表、搜索与安装（如 `esp32:esp32`、`arduino:avr`） |
| 库管理器 | 已装库列表、搜索与安装（如 `Servo`、`FastLED`） |
| 示例浏览 | 内置核心示例 + 已装库示例，一键载入编辑器 |
| 工具菜单 | 自动格式化、项目归档（.zip 下载）、保存/打开/删除 Sketch |
| 快捷键 | Ctrl+R 验证、Ctrl+U 上传、Ctrl+S 保存、Ctrl+Shift+M 串口、Ctrl+N 新建、Ctrl+F 查找 |
| **Agent 工具** | 17+ 个 `arduino_*` 工具，Agent 可直接执行全部开发任务（见下） |
| **Agent 可视化** | 面板「Agent 活动」页时间线、编译/烧录实时滚动、回合尾卡、工具卡片（见下） |

## 界面形态（DSH 原生风格）

- 侧边栏底部新增 **Arduino** 开关按钮（图标 + 文案，跟随 DSH 设计 token）
- 点击后弹出可拖动/缩放的浮动 IDE 窗口（位置与大小自动记忆）
- 视觉与交互对齐 DSH 设计系统（参照 dsh-better-sidebar）：
  - 组件全部来自 `@deepseek-ai/dsh-client-ui-primitives`（Button / Input / Pill / Menu /
    StateDot / TerminalBlock / DisclosureRow / ConnectionBanner + 官方图标集）
  - 颜色/字体全部使用 `--dsw-alias-*` / `--dsw-font-*` 设计 token，自动适配明暗主题
  - 板卡/端口选择、文件操作菜单为原生下拉 Menu（替代裸 `<select>`）
  - 编译/上传输出为原生 TerminalBlock 终端卡片；状态栏为 StateDot 状态点

## 前置条件

- **arduino-cli**：编译/上传/串口/板卡/库/示例都需要。未找到时插件会给出提示。
  自动探测顺序：`config.cliPath` → 环境变量 `ARDUINO_CLI_PATH` → 常见安装目录 → PATH。
- **开发板核心**：通过"开发板"标签页搜索安装（如 `arduino:avr`）。
- Sketch 工作区默认在 `$DSH_HOME/arduino-ide/sketches/`，可用 patch 的 `workRoot` 覆盖。

## 配置（cordis.patch.yml）

```yaml
- insert:
    - id: arduino-ide
      name: 'dsh-arduino-ide'
      config:
        cliPath: 'D:\\Program Files\\arduino-cli_1.5.2-rc.1_Windows_64bit\\arduino-cli.exe'
        workRoot: 'D:\\arduino-ide-workspace'
```

## 架构

- `lib/arduino-service.js` — 共享服务层（唯一业务实现）：板卡/编译/上传/串口/库/示例/草稿 +
  事件总线（activity/compile/state）+ 状态单一事实来源。零外部 npm 依赖。
- `lib/index.js` — 薄 HTTP 壳：`/arduino-ide/api/*`（浏览器面板）+ `/api/events`（SSE 事件流）+
  `/api/state`（面板→服务状态同步）。
- `lib/tools.js` — **Agent 工具集**：注册 17+ 个 `arduino_*` 工具（`@deepseek-ai/dsh-tools`
  defineTool，与 dsh-undo-savepoint 同款），使 Agent 可直接执行 Arduino 开发任务；
  每次调用自动广播事件 + 更新状态。
- `lib/client.js` — 浏览器半侧：IDE 面板（新增 **「Agent 活动」页**：时间线实时显示 Agent 的
  探测/编译/烧录/串口等动作）、编译输出实时滚动流、板卡/端口/Sketch 双向状态同步、
  `conversation.chat.turnTail` 回合尾卡（本回合 Arduino 活动摘要）、
  `tool.call.toolview` 工具调用卡定制（arduino_* 工具对话卡片可视化）。

## Agent 友好化（方案 A 已实现）

| 能力 | 说明 |
| --- | --- |
| `arduino_*` 工具 | status / boards / sketch_new·open·save·list·delete / verify / upload / serial_open·write·read·close / cores_list·search·install·uninstall / libs_list·search·install·uninstall / examples_list·open / format / archive |
| 实时可视化 | Agent 每次工具动作 → SSE 事件 → 面板「Agent 活动」页时间线；编译/烧录行级输出实时滚动 |
| 状态双向同步 | Agent 选板卡/端口/Sketch → 面板工具栏自动更新；用户在面板手动操作 → 回写服务，Agent 下轮 `arduino_status` 可读 |
| 回合尾卡 | 每轮对话若有 Arduino 活动，消息下方自动出现活动摘要 |
| 工具卡片 | `arduino_*` 工具调用在对话中以可视化卡片呈现（状态点 + 输出） |

## 快速上手（Agent 对话示例）

用户说："把 Blink 改成呼吸灯并烧录到 Uno" → Agent 依次执行：

```
arduino_status            # 环境探测
arduino_boards            # 端口/板卡发现（选择 arduino:avr:uno + COM4）
arduino_sketch_save       # 写入呼吸灯代码
arduino_verify            # 编译（错误则读取行号修复重试）
arduino_upload            # 烧录
arduino_serial_open/read  # 串口观察输出
```

用户全程可在面板「Agent 活动」页实时看到每一步（状态点 + 摘要 + 展开输出）。

## 验证记录

| 项 | 结果 |
| --- | --- |
| 宿主冒烟测试（`smoke-test.mjs`） | 38/38 通过：装配/工具注册/工具执行/真实编译/SSE 事件流/状态同步 |
| 客户端冒烟测试（`client-smoke.mjs`） | 13/13 通过：bundle 注册/高亮/括号匹配/查找管线 |
| 真实任务 | 已在 Arduino Nano（COM4）上完成 D4Blink 编写→编译（924B/3%）→烧录成功 |

## License

MIT
