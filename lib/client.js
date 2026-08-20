/**
 * ============================================================================
 * dsh-arduino-ide —— 浏览器半侧（browser half）· DSH 原生风格版
 * ============================================================================
 * 在 DSH Web 界面里提供一个可拖动/缩放的 Arduino IDE 工作区窗口。
 * 视觉与交互全部对齐 DSH 设计系统（参照 dsh-better-sidebar）：
 *   - 组件：@deepseek-ai/dsh-client-ui-primitives（Button / Input / Pill /
 *     Menu / StateDot / TerminalBlock / DisclosureRow / ConnectionBanner）
 *   - 颜色/字体：--dsw-alias-* / --dsw-font-* 设计 token（自动适配明暗主题）
 *   - 下拉：Menu（板卡/端口/文件菜单），不再用裸 <select>
 *   - 编译/上传输出：TerminalBlock（原生终端卡片）
 *
 * 槽位：
 *   - sidebar.footer.action  → 侧边栏底部 "Arduino" 开关
 *   - shell.overlay          → 浮动 IDE 面板
 * ============================================================================
 */
window.__ModuleLoader__.load({
	id: 'dsh-arduino-ide',

	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;

		let react = require('react');
		let { useEffect, useRef, useState, useCallback, useMemo } = react;
		let { jsx: h } = require('react/jsx-runtime');
		let primitives = require('@deepseek-ai/dsh-client-ui-primitives');
		let {
			Button, Input, Pill, Menu, StateDot, TerminalBlock, DisclosureRow, ConnectionBanner,
			IconCheckOutline16, IconPlayOutline16, IconRefreshOutline16, IconCloseOutline16,
			IconPlusOutline16, IconTrashOutline16, IconSearchOutline16, IconDownloadOutline16,
			IconFolderOpenOutline16, IconFolderClose16, IconChevronDownOutline14, IconSendOutline16,
			IconCodeOutline16, IconDataOutline16, IconLoadingOutline16, IconEllipsisOutline16,
			IconArchiveOutline20, IconSettingsOutline16, IconStopFill16, IconListPenOutline16,
			IconWarningOutline16, IconRightUpOutline16,
		} = primitives;

		// ============================================================================
		// 内联 CSS —— 只保留布局/结构；颜色字体全部走 DSH token
		// ============================================================================
		const css = [
			// ---- 面板骨架 ----
			'.dsh-ai-root{position:fixed;z-index:1000;display:flex;flex-direction:column;overflow:hidden;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);box-shadow:0 14px 44px var(--dsw-alias-bg-mask-1);font-family:inherit;font-size:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-primary);user-select:none}',
			'.dsh-ai-header{display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--dsw-alias-bg-layer-2);border-bottom:1px solid var(--dsw-alias-border-l1);cursor:move;flex:0 0 auto}',
			'.dsh-ai-title{display:inline-flex;align-items:center;gap:6px;font-weight:600;font-size:var(--dsw-font-xs-strong-13);color:var(--dsw-alias-label-primary);white-space:nowrap}',
			'.dsh-ai-title .logo{color:var(--dsw-alias-brand-primary);display:inline-flex}',
			'.dsh-ai-toolbar{display:flex;align-items:center;gap:6px;flex:1;min-width:0;overflow:hidden}',
			'.dsh-ai-sep{width:1px;height:18px;background:var(--dsw-alias-border-l1);flex:0 0 auto;margin:0 2px}',
			// ---- 视图标签（Pill 行）----
			'.dsh-ai-tabs{display:flex;align-items:center;gap:4px;padding:6px 10px 4px;background:var(--dsw-alias-bg-layer-1);border-bottom:1px solid var(--dsw-alias-border-l1);flex:0 0 auto;overflow-x:auto}',
			'.dsh-ai-tabs::-webkit-scrollbar{height:6px}.dsh-ai-tabs::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2);border-radius:3px}',
			'.dsh-ai-body{flex:1;overflow:hidden;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base)}',
			'.dsh-ai-statusbar{display:flex;align-items:center;gap:12px;padding:5px 12px;background:var(--dsw-alias-bg-layer-2);border-top:1px solid var(--dsw-alias-border-l1);font-size:var(--dsw-font-xxxs-11);color:var(--dsw-alias-label-secondary);flex:0 0 auto;overflow:hidden;white-space:nowrap}',
			'.dsh-ai-statusbar b{color:var(--dsw-alias-label-primary);font-weight:600}',
			'.dsh-ai-status-item{display:inline-flex;align-items:center;gap:5px;min-width:0}',
			'.dsh-ai-resize{position:absolute;right:0;bottom:0;width:16px;height:16px;cursor:nwse-resize;background:linear-gradient(135deg,transparent 50%,var(--dsw-alias-border-l2) 50%)}',
			// ---- 编辑器 ----
			'.dsh-ai-editor-toolbar{display:flex;align-items:center;gap:6px;padding:6px 10px;background:var(--dsw-alias-bg-layer-1);border-bottom:1px solid var(--dsw-alias-border-l1);flex:0 0 auto;flex-wrap:wrap}',
			'.dsh-ai-editor{flex:1;display:flex;overflow:hidden;position:relative;background:var(--dsw-alias-bg-base)}',
			'.dsh-ai-gutter{width:54px;flex:0 0 auto;overflow:hidden;background:var(--dsw-alias-bg-layer-1);border-right:1px solid var(--dsw-alias-border-l1);user-select:none}',
			'.dsh-ai-gutter pre{margin:0;padding:10px 8px 10px 0;text-align:right;font-family:var(--ds-font-family-code);font-size:var(--dsw-font-xxs-12);line-height:1.55;color:var(--dsw-alias-label-tertiary);overflow:hidden}',
			'.dsh-ai-code-wrap{flex:1;position:relative;overflow:hidden}',
			'.dsh-ai-code{margin:0;position:absolute;inset:0;padding:10px;font-family:var(--ds-font-family-code);font-size:var(--dsw-font-xxs-12);line-height:1.55;color:var(--dsw-alias-label-primary);white-space:pre;overflow:hidden;tab-size:4;word-break:normal}',
			'.dsh-ai-editor textarea{position:absolute;inset:0;width:100%;height:100%;margin:0;padding:10px;border:0;outline:0;resize:none;background:transparent;color:transparent;caret-color:var(--dsw-alias-label-primary);font-family:var(--ds-font-family-code);font-size:var(--dsw-font-xxs-12);line-height:1.55;white-space:pre;overflow:auto;tab-size:4;word-break:normal;user-select:text;box-sizing:border-box}',
			'.dsh-ai-editor textarea::selection{background:var(--dsw-alias-interactive-bg-hover-accent)}',
			'.dsh-ai-editor textarea::-webkit-scrollbar,.dsh-ai-serial-out::-webkit-scrollbar{width:10px;height:10px}',
			'.dsh-ai-editor textarea::-webkit-scrollbar-thumb,.dsh-ai-serial-out::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2);border-radius:5px}',
			// 语法高亮：用 token 派生色，自动适配明暗主题
			'.tok-kw{color:var(--dsw-alias-brand-primary)}.tok-cm{color:var(--dsw-alias-label-secondary);font-style:italic}.tok-pp{color:var(--dsw-alias-state-warn-primary)}.tok-st{color:var(--dsw-alias-state-success-primary)}.tok-nu{color:var(--dsw-alias-state-warn-primary)}.tok-id{color:var(--dsw-alias-label-primary)}.tok-pl{color:var(--dsw-alias-label-primary)}',
			'.dsh-ai-bm{background:var(--dsw-alias-state-warn-tertiary);outline:1px solid var(--dsw-alias-state-warn-primary);border-radius:2px}',
			'.dsh-ai-fm{background:var(--dsw-alias-interactive-bg-hover-accent);border-radius:2px}',
			'.dsh-ai-fm-cur{background:var(--dsw-alias-state-warn-tertiary);outline:1px solid var(--dsw-alias-state-warn-primary);border-radius:2px}',
			// ---- 查找栏 ----
			'.dsh-ai-findbar{display:flex;align-items:center;gap:6px;padding:6px 10px;background:var(--dsw-alias-bg-layer-1);border-top:1px solid var(--dsw-alias-border-l1);flex:0 0 auto;flex-wrap:wrap}',
			'.dsh-ai-findcount{color:var(--dsw-alias-label-secondary);font-size:var(--dsw-font-xxxs-11);min-width:44px}',
			// ---- 串口 ----
			'.dsh-ai-serial{display:flex;flex-direction:column;flex:1;overflow:hidden}',
			'.dsh-ai-serial-toolbar{display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--dsw-alias-bg-layer-1);border-bottom:1px solid var(--dsw-alias-border-l1);flex:0 0 auto;flex-wrap:wrap}',
			'.dsh-ai-serial-out{flex:1;overflow:auto;padding:8px 12px;font-family:var(--ds-font-family-code);font-size:var(--dsw-font-xxs-12);line-height:1.6;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);user-select:text;white-space:pre-wrap;word-break:break-all}',
			'.dsh-ai-serial-input{display:flex;gap:6px;padding:8px 10px;background:var(--dsw-alias-bg-layer-1);border-top:1px solid var(--dsw-alias-border-l1);flex:0 0 auto}',
			'.dsh-ai-grow-input{flex:1}',
			'.dsh-ai-canvas{flex:1;width:100%;background:var(--dsw-alias-bg-base)}',
			'.dsh-ai-serial-empty{display:flex;align-items:center;justify-content:center;flex:1;color:var(--dsw-alias-label-secondary);font-size:var(--dsw-font-xs-13)}',
			// ---- 管理器 / 示例 ----
			'.dsh-ai-mgr{flex:1;overflow:auto;padding:10px 12px;display:flex;flex-direction:column;gap:10px;background:var(--dsw-alias-bg-base)}',
			'.dsh-ai-mgr-search{display:flex;gap:8px;align-items:center;flex:0 0 auto}',
			'.dsh-ai-mgr-search .grow{flex:1}',
			'.dsh-ai-card{display:flex;align-items:center;gap:10px;padding:6px 8px;border-radius:8px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1)}',
			'.dsh-ai-card:hover{background:var(--dsw-alias-interactive-bg-hover)}',
			'.dsh-ai-card .grow{flex:1;min-width:0}',
			'.dsh-ai-card .nm{font-weight:600;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'.dsh-ai-card .ver{color:var(--dsw-alias-label-secondary);font-size:var(--dsw-font-xxxs-11)}',
			'.dsh-ai-examples{flex:1;overflow:auto;padding:8px 10px;display:flex;flex-direction:column;gap:2px;background:var(--dsw-alias-bg-base)}',
			'.dsh-ai-example{display:flex;align-items:center;gap:8px;width:100%;padding:5px 10px 5px 22px;border-radius:6px;cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:var(--dsw-font-xxs-12);text-align:left;background:transparent;border:0}',
			'.dsh-ai-example:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
			'.dsh-ai-hint{color:var(--dsw-alias-label-secondary);font-size:var(--dsw-font-xxs-12);padding:6px 4px}',
			'.dsh-ai-loading{display:flex;align-items:center;justify-content:center;flex:1;color:var(--dsw-alias-label-secondary);gap:8px}',
			// ---- 侧边栏开关 ----
			'.dsh-ai-toggle{display:inline-flex;align-items:center;gap:8px;width:100%;padding:7px 12px;border-radius:8px;background:transparent;border:0;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:var(--dsw-font-xs-13);text-align:left}',
			'.dsh-ai-toggle:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
			'.dsh-ai-toggle.active{color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-interactive-bg-active)}',
			'.dsh-ai-toggle .logo{color:var(--dsw-alias-brand-primary);display:inline-flex}',
			'.dsh-ai-banner-row{padding:8px 12px 0}',
			'.dsh-ai-menu-trigger{display:inline-flex;align-items:center;gap:6px;max-width:210px}',
			'.dsh-ai-menu-trigger .grow{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			// ---- Agent 活动页 ----
			'.dsh-ai-activity{flex:1;overflow:auto;padding:8px 10px;display:flex;flex-direction:column;gap:4px;background:var(--dsw-alias-bg-base)}',
			'.dsh-ai-act{display:flex;align-items:flex-start;gap:8px;padding:7px 8px;border-radius:8px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1)}',
			'.dsh-ai-act:hover{background:var(--dsw-alias-interactive-bg-hover)}',
			'.dsh-ai-act .ic{display:inline-flex;margin-top:2px;color:var(--dsw-alias-label-secondary)}',
			'.dsh-ai-act .grow{flex:1;min-width:0}',
			'.dsh-ai-act .sum{color:var(--dsw-alias-label-primary);font-weight:600;font-size:var(--dsw-font-xs-13)}',
			'.dsh-ai-act .meta{color:var(--dsw-alias-label-secondary);font-size:var(--dsw-font-xxxs-11);margin-top:1px}',
			'.dsh-ai-act .cmd{color:var(--dsw-alias-label-tertiary);font-family:var(--ds-font-family-code);font-size:var(--dsw-font-xxxs-11);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
			'.dsh-ai-act .detail{margin-top:6px;padding:6px 8px;border-radius:6px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);font-family:var(--ds-font-family-code);font-size:var(--dsw-font-xxxs-11);color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-all;max-height:200px;overflow:auto;user-select:text}',
			'.dsh-ai-act-ok{color:var(--dsw-alias-state-success-primary)}',
			'.dsh-ai-act-err{color:var(--dsw-alias-state-error-primary)}',
			'.dsh-ai-activity-empty{display:flex;align-items:center;justify-content:center;flex:1;color:var(--dsw-alias-label-secondary);font-size:var(--dsw-font-xs-13);text-align:center;padding:20px;line-height:1.8}',
			// ---- 回合尾卡 ----
			'.dsh-ai-tail{display:flex;align-items:flex-start;gap:8px;padding:8px 10px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);font-size:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-primary)}',
			'.dsh-ai-tail .ic{display:inline-flex;margin-top:2px;color:var(--dsw-alias-brand-primary)}',
			'.dsh-ai-tail .grow{flex:1;min-width:0}',
			'.dsh-ai-tail .title{font-weight:600;color:var(--dsw-alias-label-primary);font-size:var(--dsw-font-xs-13);margin-bottom:4px}',
			'.dsh-ai-tail .rows{display:flex;flex-direction:column;gap:3px}',
			'.dsh-ai-tail .row{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-label-secondary)}',
			'.dsh-ai-tail .row .t{font-family:var(--ds-font-family-code);font-size:var(--dsw-font-xxxs-11);color:var(--dsw-alias-label-tertiary)}',
			// ---- 工具调用卡 ----
			'.dsh-ai-toolcard{display:flex;flex-direction:column;gap:6px;padding:8px 10px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);font-size:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-primary)}',
			'.dsh-ai-toolcard .head{display:flex;align-items:center;gap:8px}',
			'.dsh-ai-toolcard .head .nm{font-weight:600;font-family:var(--ds-font-family-code);font-size:var(--dsw-font-xs-13)}',
			'.dsh-ai-toolcard .head .st{color:var(--dsw-alias-label-secondary);font-size:var(--dsw-font-xxxs-11)}',
			'.dsh-ai-toolcard .out{padding:6px 8px;border-radius:6px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);font-family:var(--ds-font-family-code);font-size:var(--dsw-font-xxxs-11);color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-all;max-height:260px;overflow:auto;user-select:text}',
			'.dsh-ai-toolcard .args{color:var(--dsw-alias-label-tertiary);font-family:var(--ds-font-family-code);font-size:var(--dsw-font-xxxs-11);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
		].join('\n');
		const cssTag = 'dsh-arduino-ide/style.css';
		if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="' + cssTag + '"]') === null) {
			const tag = document.createElement('style');
			tag.dataset.plugin = 'dsh-arduino-ide';
			tag.dataset.pluginCss = cssTag;
			tag.textContent = css;
			document.head.appendChild(tag);
		}

		// ============================================================================
		// 面板开关共享状态
		// ============================================================================
		const store = {
			open: false,
			listeners: new Set(),
			toggle() { this.open = !this.open; this.emit(); },
			set(v) { if (this.open === v) return; this.open = v; this.emit(); },
			emit() { for (const fn of this.listeners) fn(this.open); },
			subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
		};

		function usePanelOpen() {
			const [open, setOpen] = useState(store.open);
			useEffect(() => store.subscribe(setOpen), []);
			return open;
		}

		// ============================================================================
		// 活动事件总线（SSE /api/events）：Agent 工具动作 → 面板活动页/实时流/状态同步
		// ============================================================================
		const evBus = {
			started: false,
			buffer: [],
			listeners: new Set(),
			start() {
				if (this.started) return;
				this.started = true;
				const es = new EventSource(API + '/events');
				this.es = es;
				es.onmessage = (ev) => {
					try {
						const data = JSON.parse(ev.data);
						if (data && data.type) {
							this.buffer.push(data);
							if (this.buffer.length > 600) this.buffer.shift();
							for (const fn of this.listeners) fn(data);
						}
					} catch { /* 忽略坏帧 */ }
				};
				es.onerror = () => { /* EventSource 自动重连 */ };
			},
			subscribe(fn) {
				this.listeners.add(fn);
				return () => this.listeners.delete(fn);
			},
		};

		const ACTION_META = {
			verify: { label: '编译验证', icon: IconCheckOutline16 },
			upload: { label: '上传烧录', icon: IconPlayOutline16 },
			serial_open: { label: '打开串口', icon: IconDataOutline16 },
			serial_close: { label: '关闭串口', icon: IconStopFill16 },
			core_install: { label: '安装核心', icon: IconDownloadOutline16 },
			lib_install: { label: '安装库', icon: IconDownloadOutline16 },
			state: { label: '状态更新', icon: IconSettingsOutline16 },
		};
		function actionMeta(action) {
			return ACTION_META[action] || { label: action, icon: IconCodeOutline16 };
		}
		function fmtTime(ts) {
			const d = new Date(ts);
			const p = (n) => String(n).padStart(2, '0');
			return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
		}

		/** 面板订阅活动事件（activity 类），返回 [列表, 清空]。 */
		function useActivity() {
			const [activity, setActivity] = useState(() => evBus.buffer.filter((e) => e.type === 'activity'));
			useEffect(() => {
				evBus.start();
				return evBus.subscribe((ev) => {
					if (ev.type === 'activity') {
						setActivity((prev) => [...prev.slice(-299), ev]);
					}
				});
			}, []);
			const clear = useCallback(() => {
				evBus.buffer = [];
				setActivity([]);
			}, []);
			return [activity, clear];
		}

		// ============================================================================
		// API 封装
		// ============================================================================
		const API = '/arduino-ide/api';
		async function api(path, opts) {
			const res = await fetch(API + path, opts);
			let data = null;
			try { data = await res.json(); } catch { /* ignore */ }
			if (!res.ok) throw new Error((data && data.error) || ('HTTP ' + res.status));
			return data;
		}
		const post = (path, body) => api(path, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body || {}),
		});

		// ============================================================================
		// 语法高亮（token 派生色）
		// ============================================================================
		const KEYWORDS = new Set([
			'void','int','float','double','char','byte','boolean','long','unsigned','short','const','static','volatile',
			'if','else','for','while','do','switch','case','default','break','continue','return','class','struct','enum',
			'union','typedef','public','private','protected','new','delete','true','false','NULL','nullptr','sizeof',
			'setup','loop','pinMode','digitalWrite','digitalRead','analogRead','analogWrite','analogReference',
			'delay','delayMicroseconds','millis','micros','Serial','println','print','begin','HIGH','LOW','INPUT',
			'OUTPUT','INPUT_PULLUP','INPUT_PULLDOWN','LED_BUILTIN','A0','A1','A2','A3','A4','A5',
			'String','Stream','Wire','SPI','attachInterrupt','detachInterrupt','noInterrupts','interrupts',
		]);
		const TOKEN_RE = /(\/\/[^\n]*)|(\/\*[\s\S]*?\*\/)|(#[^\n]*)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(\b\d[\d_]*(?:\.[\d_]+)?(?:[eE][+-]?\d+)?[uUlL]*\b)|([A-Za-z_]\w*)|(\s+)|(.)/g;

		function escapeHtml(s) {
			return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
		}

		function tokenize(text) {
			const segs = [];
			TOKEN_RE.lastIndex = 0;
			let m;
			while ((m = TOKEN_RE.exec(text))) {
				let cls = 'pl';
				if (m[1] || m[2]) cls = 'cm';
				else if (m[3]) cls = 'pp';
				else if (m[4]) cls = 'st';
				else if (m[5]) cls = 'nu';
				else if (m[6]) cls = KEYWORDS.has(m[6]) ? 'kw' : 'id';
				else if (m[7]) cls = 'ws';
				segs.push({ start: m.index, end: m.index + m[0].length, cls, text: m[0] });
			}
			return segs;
		}

		function applyMarks(segs, marks) {
			if (!marks || marks.length === 0) {
				return segs.map((s) => '<span class="' + s.cls + '">' + escapeHtml(s.text) + '</span>').join('');
			}
			const bounds = new Set([0, Infinity]);
			for (const mk of marks) { bounds.add(mk.start); bounds.add(mk.end); }
			const pts = [...bounds].sort((a, b) => a - b);
			let out = '';
			for (const s of segs) {
				let cursor = s.start;
				for (const p of pts) if (p > s.start && p < s.end) {
					out += segHtml(s, cursor, p, marks);
					cursor = p;
				}
				out += segHtml(s, cursor, s.end, marks);
			}
			return out;
		}

		function segHtml(seg, from, to, marks) {
			if (to <= from) return '';
			const cls = [seg.cls];
			for (const mk of marks) if (mk.start <= from && to <= mk.end) cls.push(mk.cls);
			return '<span class="' + cls.join(' ') + '">' + escapeHtml(seg.text.slice(from - seg.start, to - seg.start)) + '</span>';
		}

		function findRanges(text, query) {
			const out = [];
			if (!query) return out;
			let i = 0;
			while ((i = text.indexOf(query, i)) !== -1) { out.push({ start: i, end: i + query.length }); i += query.length; }
			return out;
		}

		function bracketPair(text, pos) {
			const openers = { '(': ')', '[': ']', '{': '}' };
			const closers = { ')': '(', ']': '[', '}': '{' };
			const before = text[pos - 1];
			if (before && openers[before]) {
				const close = matchPair(text, pos - 1, before, openers[before]);
				if (close !== null) return { a: pos - 1, b: close };
			}
			const at = text[pos];
			if (at && closers[at]) {
				const open = matchPairBack(text, pos, at, closers[at]);
				if (open !== null) return { a: open, b: pos };
			}
			return null;
		}
		function matchPair(text, openIdx, open, close) {
			let depth = 0;
			for (let i = openIdx; i < text.length; i++) {
				const c = text[i];
				if (c === open) depth++;
				else if (c === close) { depth--; if (depth === 0) return i; }
			}
			return null;
		}
		function matchPairBack(text, closeIdx, close, open) {
			let depth = 0;
			for (let i = closeIdx; i >= 0; i--) {
				const c = text[i];
				if (c === close) depth++;
				else if (c === open) { depth--; if (depth === 0) return i; }
			}
			return null;
		}

		// ============================================================================
		// 编辑器
		// ============================================================================
		const BLINK = 'void setup() {\n  pinMode(LED_BUILTIN, OUTPUT);\n}\n\nvoid loop() {\n  digitalWrite(LED_BUILTIN, HIGH);\n  delay(1000);\n  digitalWrite(LED_BUILTIN, LOW);\n  delay(1000);\n}\n';

		function lineColOf(text, pos) {
			let line = 1, last = -1;
			for (let i = 0; i < pos; i++) if (text[i] === '\n') { line++; last = i; }
			return { line, col: pos - last };
		}

		function Editor(props) {
			const {
				files, activeFile, savedList, onChangeFile, onVerify, onUpload, onSave, onNew, onFormat,
				onOpenSerial, onAddFile, onDeleteFile, onArchive, onOpenSketch, board, port,
			} = props;
			const code = (files[activeFile] || '');
			const taRef = useRef(null);
			const preRef = useRef(null);
			const gutterRef = useRef(null);
			const [findOpen, setFindOpen] = useState(false);
			const [query, setQuery] = useState('');
			const [repl, setRepl] = useState('');
			const [cur, setCur] = useState(0);
			const [cursor, setCursor] = useState({ line: 1, col: 1, bm: null });
			const [matches, setMatches] = useState([]);
			const [filesMenu, setFilesMenu] = useState(false);

			const syncScroll = useCallback(() => {
				const ta = taRef.current;
				if (!ta) return;
				if (preRef.current) { preRef.current.scrollTop = ta.scrollTop; preRef.current.scrollLeft = ta.scrollLeft; }
				if (gutterRef.current) gutterRef.current.firstChild.scrollTop = ta.scrollTop;
			}, []);

			const updateCursor = useCallback(() => {
				const ta = taRef.current;
				if (!ta) return;
				const pos = ta.selectionStart;
				const lc = lineColOf(ta.value, pos);
				const bm = bracketPair(ta.value, pos);
				setCursor((prev) => (prev.line === lc.line && prev.col === lc.col && prev.bm === bm ? prev : { line: lc.line, col: lc.col, bm }));
			}, []);

			useEffect(() => {
				const fm = findRanges(code, query);
				setMatches(fm);
				setCur((c) => (fm.length ? Math.min(c, fm.length - 1) : 0));
			}, [code, query]);

			const html = useMemo(() => {
				const marks = [];
				const bm = cursor.bm;
				if (bm) {
					marks.push({ start: bm.a, end: bm.a + 1, cls: 'dsh-ai-bm' });
					marks.push({ start: bm.b, end: bm.b + 1, cls: 'dsh-ai-bm' });
				}
				matches.forEach((m, i) => marks.push({ start: m.start, end: m.end, cls: i === cur ? 'dsh-ai-fm-cur' : 'dsh-ai-fm' }));
				return applyMarks(tokenize(code), marks);
			}, [code, cursor, matches, cur]);

			const lineCount = useMemo(() => code.split('\n').length, [code]);
			const lineHtml = useMemo(() => {
				const arr = [];
				for (let i = 1; i <= lineCount; i++) arr.push(String(i));
				return arr.join('\n');
			}, [lineCount]);

			const setCode = (next) => onChangeFile(activeFile, next);

			const insertText = (text) => {
				const ta = taRef.current;
				if (!ta) return;
				const s = ta.selectionStart, e = ta.selectionEnd;
				const next = ta.value.slice(0, s) + text + ta.value.slice(e);
				ta.value = next;
				onChangeFile(activeFile, next);
				const pos = s + text.length;
				ta.focus();
				ta.setSelectionRange(pos, pos);
				updateCursor();
			};

			const onKeyDown = (e) => {
				if (e.ctrlKey || e.metaKey) {
					const k = e.key.toLowerCase();
					if (k === 'r') { e.preventDefault(); onVerify(); return; }
					if (k === 'u') { e.preventDefault(); onUpload(); return; }
					if (k === 's') { e.preventDefault(); onSave(); return; }
					if (k === 'n') { e.preventDefault(); onNew(); return; }
					if (k === 'f') { e.preventDefault(); setFindOpen(true); return; }
					if (k === 'm' && e.shiftKey) { e.preventDefault(); onOpenSerial(); return; }
					return;
				}
				const ta = taRef.current;
				if (!ta) return;
				if (e.key === 'Tab') { e.preventDefault(); insertText('  '); return; }
				if (e.key === 'Enter') {
					e.preventDefault();
					const before = ta.value.slice(0, ta.selectionStart);
					const line = before.slice(before.lastIndexOf('\n') + 1);
					const indent = (line.match(/^\s*/) || [''])[0];
					insertText('\n' + indent + (/\{\s*$/.test(line) ? '  ' : ''));
					return;
				}
			};

			const selectMatch = (i) => {
				const ta = taRef.current;
				if (!ta || !matches.length) return;
				const idx = ((i % matches.length) + matches.length) % matches.length;
				setCur(idx);
				ta.focus();
				ta.setSelectionRange(matches[idx].start, matches[idx].end);
				updateCursor();
			};

			const replaceCurrent = () => {
				if (!matches.length || !query) return;
				const ta = taRef.current;
				const m = matches[cur];
				const next = code.slice(0, m.start) + repl + code.slice(m.end);
				ta.value = next;
				onChangeFile(activeFile, next);
				const pos = m.start + repl.length;
				ta.focus();
				ta.setSelectionRange(pos, pos);
				updateCursor();
			};

			const replaceAll = () => {
				if (!query) return;
				const ta = taRef.current;
				const next = code.split(query).join(repl);
				ta.value = next;
				onChangeFile(activeFile, next);
				ta.focus();
			};

			const filesList = Object.keys(files);
			const fileMenuItems = [
				{ id: 'new', label: '新建 Sketch', icon: h(IconPlusOutline16, {}) },
				...(savedList.length ? [{ id: 'open', label: '打开 Sketch…', icon: h(IconFolderOpenOutline16, {}), submenu: savedList.map((s) => ({ id: 'sk:' + s, label: s })) }] : []),
				{ id: 'addfile', label: '新建文件 (.h/.cpp)', icon: h(IconPlusOutline16, {}) },
				...(filesList.length > 1 ? [{ id: 'delfile', label: '删除当前文件', danger: true, icon: h(IconTrashOutline16, {}) }] : []),
				{ type: 'separator', id: 'sep1' },
				{ id: 'save', label: '保存', icon: h(IconDownloadOutline16, {}) },
				{ id: 'format', label: '自动格式化', icon: h(IconCodeOutline16, {}) },
				{ id: 'archive', label: '项目归档 (.zip)', icon: h(IconArchiveOutline20, { size: 16 }) },
			];
			const onFileMenu = (id) => {
				setFilesMenu(false);
				if (id.startsWith('sk:')) { onOpenSketch(id.slice(3)); return; }
				if (id === 'new') onNew();
				else if (id === 'open') { /* submenu 直接回调叶子项 */ }
				else if (id === 'save') onSave();
				else if (id === 'format') onFormat();
				else if (id === 'archive') onArchive();
				else if (id === 'addfile') onAddFile();
				else if (id === 'delfile') onDeleteFile(activeFile);
			};

			return [
				h('div', { key: 'toolbar', className: 'dsh-ai-editor-toolbar', children: [
					h('span', { className: 'dsh-ai-title', style: { fontSize: 'var(--dsw-font-xxs-12)', marginRight: 4 }, children: '文件' }),
					filesList.map((f) => h(Pill, {
						key: f,
						active: f === activeFile,
						onClick: () => onChangeFile(f),
						children: f,
					})),
					h(Button, {
						variant: 'ghost', size: 'sm',
						title: '新建 .h/.cpp 文件',
						icon: h(IconPlusOutline16, {}),
						onClick: onAddFile,
					}),
					filesList.length > 1 ? h(Button, {
						variant: 'ghost', size: 'sm',
						title: '删除当前文件（.ino 不可删）',
						icon: h(IconTrashOutline16, {}),
						disabled: activeFile.endsWith('.ino'),
						onClick: () => onDeleteFile(activeFile),
					}) : null,
					h('span', { style: { flex: 1 } }),
					h(Button, { variant: 'outline', size: 'sm', onClick: onNew, title: 'Ctrl+N', children: '新建' }),
					h(Button, { variant: 'outline', size: 'sm', onClick: onFormat, title: '自动格式化代码', children: '格式化' }),
					h(Button, {
						variant: 'outline', size: 'sm',
						icon: h(IconSearchOutline16, {}),
						onClick: () => setFindOpen(!findOpen),
						title: '查找/替换 (Ctrl+F)',
						children: findOpen ? '关闭查找' : '查找',
					}),
					h(Button, { variant: 'primary', size: 'sm', icon: h(IconDownloadOutline16, {}), onClick: onSave, title: '保存到工作区 (Ctrl+S)', children: '保存' }),
					h(Menu, {
						open: filesMenu,
						anchor: h(Button, { variant: 'ghost', size: 'sm', icon: h(IconEllipsisOutline16, {}), onClick: () => setFilesMenu(true), 'aria-label': '更多操作' }),
						items: fileMenuItems,
						onSelect: onFileMenu,
						onClose: () => setFilesMenu(false),
						side: 'bottom', align: 'end', portal: true,
					}),
				] }),

				h('div', { key: 'editor', className: 'dsh-ai-editor', children: [
					h('div', { className: 'dsh-ai-gutter', ref: gutterRef, children: h('pre', { dangerouslySetInnerHTML: { __html: lineHtml } }) }),
					h('div', { className: 'dsh-ai-code-wrap', children: [
						h('pre', { ref: preRef, className: 'dsh-ai-code', 'aria-hidden': 'true', dangerouslySetInnerHTML: { __html: html } }),
						h('textarea', {
							ref: taRef, value: code, spellCheck: false, wrap: 'off',
							onChange: (e) => setCode(e.target.value),
							onScroll: syncScroll,
							onKeyDown: onKeyDown,
							onSelect: updateCursor,
							onClick: updateCursor,
							onBlur: updateCursor,
						}),
					] }),
				] }),

				findOpen ? h('div', { key: 'findbar', className: 'dsh-ai-findbar', children: [
					h(Input, { style: { width: 150 }, placeholder: '查找', value: query, onChange: (e) => setQuery(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') selectMatch(cur + 1); if (e.key === 'Escape') setFindOpen(false); } }),
					h(Input, { style: { width: 130 }, placeholder: '替换为', value: repl, onChange: (e) => setRepl(e.target.value) }),
					h('span', { className: 'dsh-ai-findcount', children: matches.length ? (cur + 1) + '/' + matches.length : '0' }),
					h(Button, { variant: 'ghost', size: 'sm', onClick: () => selectMatch(cur - 1), children: '‹' }),
					h(Button, { variant: 'ghost', size: 'sm', onClick: () => selectMatch(cur + 1), children: '›' }),
					h(Button, { variant: 'outline', size: 'sm', disabled: !matches.length, onClick: replaceCurrent, children: '替换' }),
					h(Button, { variant: 'outline', size: 'sm', disabled: !query, onClick: replaceAll, children: '全部替换' }),
					h(Button, { variant: 'ghost', size: 'sm', icon: h(IconCloseOutline16, {}), onClick: () => setFindOpen(false), 'aria-label': '关闭查找' }),
				] }) : null,

				h('div', { key: 'statusbar', className: 'dsh-ai-statusbar', children: [
					h('span', { className: 'dsh-ai-status-item', children: ['行 ', h('b', { children: cursor.line }), ' : ', h('b', { children: cursor.col })] }),
					h('span', { className: 'dsh-ai-status-item', children: ['板卡 ', h('b', { children: board || '未选择' })] }),
					h('span', { className: 'dsh-ai-status-item', children: ['端口 ', h('b', { children: port || '-' })] }),
					h('span', { style: { flex: 1 } }),
					h('span', { className: 'dsh-ai-status-item', children: [String(code.length), ' 字符'] }),
				] }),
			];
		}

		// ============================================================================
		// 编译/上传控制台 —— 原生 TerminalBlock 卡片列表
		// ============================================================================
		function ConsoleView(props) {
			const { entries, clear } = props;
			const ref = useRef(null);
			useEffect(() => {
				if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
			}, [entries.length]);
			return h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', background: 'var(--dsw-alias-bg-base)' }, children: [
				h('div', { className: 'dsh-ai-editor-toolbar', children: [
					h('span', { className: 'dsh-ai-title', style: { fontSize: 'var(--dsw-font-xxs-12)' }, children: '输出控制台' }),
					h('span', { style: { flex: 1 } }),
					h(Button, { variant: 'ghost', size: 'sm', onClick: clear, children: '清空' }),
				] }),
				h('div', { ref: ref, style: { flex: 1, overflow: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }, children:
					entries.length
						? entries.map((e, i) => h(TerminalBlock, {
							key: i,
							command: e.command,
							output: e.output,
							exitCode: e.done ? (e.ok ? 0 : 1) : undefined,
							running: !e.done,
							maxLines: Infinity,
							labels: {
								running: '执行中…',
								done: '完成',
								failed: '失败',
								noOutput: '（无输出）',
								copy: '复制',
								copied: '已复制',
								expand: (hidden) => '展开 ' + hidden + ' 行',
								collapse: '收起',
							},
						}))
						: h('div', { className: 'dsh-ai-hint', style: { padding: 20 }, children: '点击「✓ 验证」或「→ 上传」后，编译/烧录输出会显示在这里。' }),
				}),
			] });
		}

		// ============================================================================
		// 串口监视器 + 绘图器
		// ============================================================================
		function SerialView(props) {
			const { ports, onLog } = props;
			const [port, setPort] = useState('');
			const [baud, setBaud] = useState(9600);
			const [connected, setConnected] = useState(false);
			const [lines, setLines] = useState([]);
			const [input, setInput] = useState('');
			const [plot, setPlot] = useState(false);
			const [series, setSeries] = useState([]);
			const [portMenu, setPortMenu] = useState(false);
			const [baudMenu, setBaudMenu] = useState(false);
			const esRef = useRef(null);
			const outRef = useRef(null);

			useEffect(() => {
				if (ports.length && !port) setPort(ports[0].address);
			}, [ports, port]);

			useEffect(() => {
				if (outRef.current) outRef.current.scrollTop = outRef.current.scrollHeight;
			}, [lines]);

			useEffect(() => () => { if (esRef.current) esRef.current.close(); }, []);

			const pushLine = useCallback((text) => {
				setLines((prev) => [...prev.slice(-499), text]);
				const t = String(text).trim();
				if (t && /^[\d\s,;.\-+eE]+$/.test(t) && /[\d]/.test(t)) {
					const nums = t.split(/[\s,;]+/).filter((x) => x !== '' && !isNaN(Number(x))).map(Number);
					if (nums.length) setSeries((prev) => nums.map((n, i) => [...(prev[i] || []).slice(-299), n]));
				}
			}, []);

			const connect = async () => {
				if (!port) { onLog('请先选择串口'); return; }
				try {
					const r = await post('/serial/open', { port, baud });
					if (!r.ok) { onLog('串口打开失败: ' + (r.error || '')); return; }
					setConnected(true);
					setLines([]);
					setSeries([]);
					const es = new EventSource(API + '/serial/stream');
					esRef.current = es;
					es.onmessage = (ev) => { try { pushLine(JSON.parse(ev.data)); } catch { pushLine(ev.data); } };
					es.onerror = () => { es.close(); setConnected(false); onLog('串口连接已断开'); };
					onLog('已连接 ' + port + ' @ ' + baud);
				} catch (e) {
					onLog('串口打开失败: ' + e.message);
				}
			};

			const disconnect = async () => {
				try { await post('/serial/close', {}); } catch { /* ignore */ }
				if (esRef.current) { esRef.current.close(); esRef.current = null; }
				setConnected(false);
				onLog('串口已断开');
			};

			const send = async () => {
				if (!connected || !input) return;
				try {
					await post('/serial/write', { text: input });
					setInput('');
				} catch (e) { onLog('发送失败: ' + e.message); }
			};

			const canvasRef = useRef(null);
			useEffect(() => {
				if (!plot || !canvasRef.current) return;
				const cv = canvasRef.current;
				const dpr = window.devicePixelRatio || 1;
				const w = cv.clientWidth, hgt = cv.clientHeight;
				if (!w || !hgt) return;
				cv.width = w * dpr;
				cv.height = hgt * dpr;
				const g = cv.getContext('2d');
				g.setTransform(dpr, 0, 0, dpr, 0, 0);
				g.clearRect(0, 0, w, hgt);
				if (!series.length) return;
				let mn = Infinity, mx = -Infinity;
				for (const s of series) for (const v of s) { if (v < mn) mn = v; if (v > mx) mx = v; }
				if (!isFinite(mn) || !isFinite(mx)) return;
				if (mn === mx) { mn -= 1; mx += 1; }
				const colors = ['#6ec3c6', '#e5c07b', '#c678dd', '#98c379', '#d19a66', '#e06c75'];
				const maxLen = Math.max(...series.map((s) => s.length));
				g.strokeStyle = 'var(--dsw-alias-border-l1)';
				g.lineWidth = 1;
				for (let i = 1; i < 5; i++) {
					const y = (hgt / 5) * i;
					g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
				}
				series.forEach((s, si) => {
					g.strokeStyle = colors[si % colors.length];
					g.lineWidth = 1.8;
					g.beginPath();
					s.forEach((v, i) => {
						const x = maxLen > 1 ? (i / (maxLen - 1)) * w : 0;
						const y = hgt - ((v - mn) / (mx - mn)) * (hgt - 12) - 6;
						if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
					});
					g.stroke();
				});
				g.fillStyle = 'var(--dsw-alias-label-secondary)';
				g.font = '11px var(--ds-font-family-code)';
				g.fillText('min ' + mn.toFixed(3), 6, 12);
				g.fillText('max ' + mx.toFixed(3), 6, hgt - 6);
			}, [series, plot]);

			const baudOptions = [300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 74880, 115200, 230400, 460800, 921600];

			return h('div', { className: 'dsh-ai-serial', children: [
				h('div', { className: 'dsh-ai-serial-toolbar', children: [
					h('span', { className: 'dsh-ai-title', style: { fontSize: 'var(--dsw-font-xxs-12)', marginRight: 4 }, children: '串口监视器' }),
					h(Menu, {
						open: portMenu,
						anchor: h(Button, {
							variant: 'outline', size: 'sm', disabled: connected,
							className: 'dsh-ai-menu-trigger',
							icon: h(IconFolderOpenOutline16, {}),
							onClick: () => setPortMenu(true),
							children: [
								h('span', { className: 'grow', children: port || '选择端口' }),
								h(IconChevronDownOutline14, {}),
							],
						}),
						items: ports.length
							? ports.map((p) => ({ id: p.address, label: p.address + (p.label && p.label !== p.address ? ' · ' + p.label : '') }))
							: [{ type: 'label', id: 'lbl', text: '未检测到串口' }],
						selectedId: port || undefined,
						onSelect: (id) => { setPort(id); setPortMenu(false); },
						onClose: () => setPortMenu(false),
						side: 'bottom', portal: true, dense: true,
					}),
					h(Menu, {
						open: baudMenu,
						anchor: h(Button, {
							variant: 'outline', size: 'sm', disabled: connected,
							className: 'dsh-ai-menu-trigger',
							onClick: () => setBaudMenu(true),
							children: [
								h('span', { className: 'grow', children: String(baud) + ' baud' }),
								h(IconChevronDownOutline14, {}),
							],
						}),
						items: baudOptions.map((b) => ({ id: String(b), label: String(b) })),
						selectedId: String(baud),
						onSelect: (id) => { setBaud(Number(id)); setBaudMenu(false); },
						onClose: () => setBaudMenu(false),
						side: 'bottom', portal: true, dense: true,
					}),
					connected
						? h(Button, { variant: 'outline', size: 'sm', onClick: disconnect, icon: h(IconStopFill16, {}), children: '断开' })
						: h(Button, { variant: 'primary', size: 'sm', onClick: connect, icon: h(IconPlayOutline16, {}), children: '连接' }),
					h('span', { style: { flex: 1 } }),
					h(Button, {
						variant: plot ? 'primary' : 'outline', size: 'sm',
						icon: h(IconDataOutline16, {}),
						onClick: () => setPlot(!plot),
						children: plot ? '文本视图' : '绘图器',
					}),
					h(Button, { variant: 'ghost', size: 'sm', onClick: () => { setLines([]); setSeries([]); }, children: '清空' }),
				] }),
				!plot && !lines.length && !connected
					? h('div', { className: 'dsh-ai-serial-empty', children: '选择端口并点击「连接」，即可查看开发板通过 Serial.print() 输出的数据' })
					: null,
				plot
					? h('canvas', { ref: canvasRef, className: 'dsh-ai-canvas' })
					: h('div', { ref: outRef, className: 'dsh-ai-serial-out', children: lines.map((l, i) => h('div', { key: i, children: l })) }),
				h('div', { className: 'dsh-ai-serial-input', children: [
					h(Input, {
						className: 'dsh-ai-grow-input',
						placeholder: '发送数据到开发板 (Enter 发送)',
						value: input,
						disabled: !connected,
						onChange: (e) => setInput(e.target.value),
						onKeyDown: (e) => { if (e.key === 'Enter') send(); },
					}),
					h(Button, { variant: 'primary', size: 'sm', icon: h(IconSendOutline16, {}), disabled: !connected, onClick: send, children: '发送' }),
				] }),
			] });
		}

		// ============================================================================
		// 开发板管理器
		// ============================================================================
		function BoardsView(props) {
			const { onLog } = props;
			const [installed, setInstalled] = useState([]);
			const [results, setResults] = useState([]);
			const [q, setQ] = useState('');
			const [busy, setBusy] = useState('');
			const [cliError, setCliError] = useState('');

			const load = useCallback(async () => {
				try {
					const d = await api('/cores');
					setInstalled((d.platforms || []).filter((p) => p.installed));
					setCliError(d.cliError || '');
				} catch (e) { setCliError(e.message); }
			}, []);

			useEffect(() => { load(); }, [load]);

			const search = async () => {
				if (!q.trim()) return;
				setBusy('search');
				try {
					const d = await api('/cores/search?q=' + encodeURIComponent(q.trim()));
					setResults(d.platforms || []);
				} catch (e) { onLog('搜索失败: ' + e.message); }
				setBusy('');
			};

			const install = async (name) => {
				setBusy(name);
				try {
					const r = await post('/cores/install', { name });
					onLog((r.ok ? '✔ 核心 ' : '✘ 核心 ') + name + (r.ok ? ' 安装完成' : ' 安装失败'));
					if (!r.ok && r.output) onLog(r.output);
					await load();
				} catch (e) { onLog('安装失败: ' + e.message); }
				setBusy('');
			};

			const uninstall = async (name) => {
				setBusy(name);
				try {
					const r = await post('/cores/uninstall', { name });
					onLog((r.ok ? '✔ 已卸载 ' : '✘ 卸载失败 ') + name);
					await load();
				} catch (e) { onLog('卸载失败: ' + e.message); }
				setBusy('');
			};

			return h('div', { className: 'dsh-ai-mgr', children: [
				cliError ? h('div', { className: 'dsh-ai-banner-row', children: h(ConnectionBanner, { reconnecting: true, label: cliError }) }) : null,
				h('div', { className: 'dsh-ai-mgr-search', children: [
					h(Input, { className: 'grow', placeholder: '搜索开发板核心，如 esp32 / avr / stm32', value: q, onChange: (e) => setQ(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') search(); } }),
					h(Button, { variant: 'primary', size: 'sm', icon: h(IconSearchOutline16, {}), disabled: busy === 'search', onClick: search, children: busy === 'search' ? '搜索中…' : '搜索' }),
				] }),
				results.length ? h(DisclosureRow, {
					icon: h(IconSearchOutline16, {}),
					title: '搜索结果 (' + results.length + ')',
					open: true, expandable: false, onToggle: () => {},
					children: results.map((p) => h('div', { key: p.id, className: 'dsh-ai-card', style: { marginTop: 6 }, children: [
						h('div', { className: 'grow', children: [
							h('div', { className: 'nm', children: p.name || p.id }),
							h('div', { className: 'ver', children: [p.id, ' · latest ', p.latest || '?'] }),
						] }),
						h(Button, { variant: 'primary', size: 'sm', disabled: busy === p.id, onClick: () => install(p.id), children: busy === p.id ? '安装中…' : '安装' }),
					] })),
				}) : null,
				h(DisclosureRow, {
					icon: h(IconSettingsOutline16, {}),
					title: '已安装核心 (' + installed.length + ')',
					open: true, expandable: false, onToggle: () => {},
					children: installed.length
						? installed.map((p) => h('div', { key: p.id, className: 'dsh-ai-card', style: { marginTop: 6 }, children: [
							h('div', { className: 'grow', children: [
								h('div', { className: 'nm', children: p.name || p.id }),
								h('div', { className: 'ver', children: [p.id, ' · ', p.installed, p.latest && p.latest !== p.installed ? ' (最新 ' + p.latest + ')' : ''] }),
							] }),
							h(Button, { variant: 'outline', size: 'sm', disabled: busy === p.id, onClick: () => uninstall(p.id), children: '卸载' }),
						] }))
						: h('div', { className: 'dsh-ai-hint', children: '尚未安装开发板核心（如 arduino:avr、esp32:esp32）' }),
				}),
			] });
		}

		// ============================================================================
		// 库管理器
		// ============================================================================
		function LibrariesView(props) {
			const { onLog } = props;
			const [installed, setInstalled] = useState([]);
			const [results, setResults] = useState([]);
			const [q, setQ] = useState('');
			const [busy, setBusy] = useState('');
			const [cliError, setCliError] = useState('');

			const load = useCallback(async () => {
				try {
					const d = await api('/libs');
					setInstalled(d.libraries || []);
					setCliError(d.cliError || '');
				} catch (e) { setCliError(e.message); }
			}, []);

			useEffect(() => { load(); }, [load]);

			const search = async () => {
				if (!q.trim()) return;
				setBusy('search');
				try {
					const d = await api('/libs/search?q=' + encodeURIComponent(q.trim()));
					setResults(d.libraries || []);
				} catch (e) { onLog('搜索失败: ' + e.message); }
				setBusy('');
			};

			const install = async (name) => {
				setBusy(name);
				try {
					const r = await post('/libs/install', { name });
					onLog((r.ok ? '✔ 库 ' : '✘ 库 ') + name + (r.ok ? ' 安装完成' : ' 安装失败'));
					if (!r.ok && r.output) onLog(r.output);
					await load();
				} catch (e) { onLog('安装失败: ' + e.message); }
				setBusy('');
			};

			const uninstall = async (name) => {
				setBusy(name);
				try {
					const r = await post('/libs/uninstall', { name });
					onLog((r.ok ? '✔ 已卸载 ' : '✘ 卸载失败 ') + name);
					await load();
				} catch (e) { onLog('卸载失败: ' + e.message); }
				setBusy('');
			};

			return h('div', { className: 'dsh-ai-mgr', children: [
				cliError ? h('div', { className: 'dsh-ai-banner-row', children: h(ConnectionBanner, { reconnecting: true, label: cliError }) }) : null,
				h('div', { className: 'dsh-ai-mgr-search', children: [
					h(Input, { className: 'grow', placeholder: '搜索库，如 Servo / LiquidCrystal / FastLED', value: q, onChange: (e) => setQ(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') search(); } }),
					h(Button, { variant: 'primary', size: 'sm', icon: h(IconSearchOutline16, {}), disabled: busy === 'search', onClick: search, children: busy === 'search' ? '搜索中…' : '搜索' }),
				] }),
				results.length ? h(DisclosureRow, {
					icon: h(IconSearchOutline16, {}),
					title: '搜索结果 (' + results.length + ')',
					open: true, expandable: false, onToggle: () => {},
					children: results.map((l) => h('div', { key: l.name, className: 'dsh-ai-card', style: { marginTop: 6 }, children: [
						h('div', { className: 'grow', children: [
							h('div', { className: 'nm', children: l.name }),
							h('div', { className: 'ver', children: 'latest ' + (l.latest || '?') }),
						] }),
						h(Button, { variant: 'primary', size: 'sm', disabled: busy === l.name, onClick: () => install(l.name), children: busy === l.name ? '安装中…' : '安装' }),
					] })),
				}) : null,
				h(DisclosureRow, {
					icon: h(IconFolderOpenOutline16, {}),
					title: '已安装库 (' + installed.length + ')',
					open: true, expandable: false, onToggle: () => {},
					children: installed.length
						? installed.map((l) => h('div', { key: l.name, className: 'dsh-ai-card', style: { marginTop: 6 }, children: [
							h('div', { className: 'grow', children: [
								h('div', { className: 'nm', children: l.name }),
								h('div', { className: 'ver', children: [l.version || '', l.location ? ' · ' + l.location : ''] }),
							] }),
							h(Button, { variant: 'outline', size: 'sm', disabled: busy === l.name, onClick: () => uninstall(l.name), children: '卸载' }),
						] }))
						: h('div', { className: 'dsh-ai-hint', children: '尚未安装任何第三方库' }),
				}),
			] });
		}

		// ============================================================================
		// 示例浏览（DisclosureRow 分组，可折叠）
		// ============================================================================
		function ExGroup(props) {
			const { icon, title, children } = props;
			const [open, setOpen] = useState(false);
			return h(DisclosureRow, {
				icon, title, open, expandable: true,
				onToggle: () => setOpen(!open),
				children,
			});
		}

		function ExamplesView(props) {
			const { onOpen, onLog } = props;
			const [data, setData] = useState(null);
			const [loading, setLoading] = useState(true);

			useEffect(() => {
				api('/examples')
					.then(setData)
					.catch((e) => onLog('加载示例失败: ' + e.message))
					.finally(() => setLoading(false));
			}, [onLog]);

			const open = async (dir) => {
				try {
					const r = await post('/examples/open', { dir });
					onOpen(r);
				} catch (e) { onLog('打开示例失败: ' + e.message); }
			};

			if (loading) return h('div', { className: 'dsh-ai-loading', children: [h(IconLoadingOutline16, {}), '加载示例中…'] });

			const exRow = (dir) => h('button', { key: dir, className: 'dsh-ai-example', onClick: () => open(dir), children: dir.split(/[\\/]/).pop() });

			return h('div', { className: 'dsh-ai-examples', children: [
				h(ExGroup, {
					icon: h(IconCodeOutline16, {}),
					title: '内置核心示例',
					children: data && data.builtin.length
						? data.builtin.map((b) => h(ExGroup, {
							key: b.vendor + '/' + b.arch + '/' + b.library,
							icon: h(IconFolderClose16, {}),
							title: b.library + ' · ' + b.arch,
							children: b.examples.map(exRow),
						}))
						: h('div', { className: 'dsh-ai-hint', children: '未发现内置核心示例' }),
				}),
				h(ExGroup, {
					icon: h(IconFolderOpenOutline16, {}),
					title: '库示例',
					children: data && data.libraries.length
						? data.libraries.map((l) => h(ExGroup, {
							key: l.library,
							icon: h(IconFolderClose16, {}),
							title: l.library,
							children: l.examples.map(exRow),
						}))
						: h('div', { className: 'dsh-ai-hint', children: '未发现库示例（安装带示例的库后自动出现）' }),
				}),
			] });
		}

		// ============================================================================
		// Agent 活动页（时间线）
		// ============================================================================
		function ActivityView(props) {
			const { activity, clear } = props;
			const ref = useRef(null);
			useEffect(() => {
				if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
			}, [activity.length]);
			const [expanded, setExpanded] = useState({});

			return h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }, children: [
				h('div', { className: 'dsh-ai-editor-toolbar', children: [
					h('span', { className: 'dsh-ai-title', style: { fontSize: 'var(--dsw-font-xxs-12)' }, children: 'Agent 活动' }),
					h('span', { className: 'dsh-ai-findcount', children: activity.length + ' 条' }),
					h('span', { style: { flex: 1 } }),
					h(Button, { variant: 'ghost', size: 'sm', onClick: clear, children: '清空' }),
				] }),
				activity.length
					? h('div', { ref: ref, className: 'dsh-ai-activity', children: activity.slice().reverse().map((ev, i) => {
						const meta = actionMeta(ev.payload.action);
						const status = ev.payload.status;
						const dotState = status === 'running' ? 'ongoing' : (status === 'done' ? 'done' : (status === 'failed' ? 'error' : 'warning'));
						const open = !!expanded[ev.ts + ':' + i];
						return h('div', {
							key: ev.ts + ':' + i,
							className: 'dsh-ai-act',
							children: [
								h('span', { className: 'ic', children: h(meta.icon, {}) }),
								h('div', { className: 'grow', children: [
									h('div', { className: 'dsh-ai-act-row', style: { display: 'flex', alignItems: 'center', gap: 6 }, children: [
										h(StateDot, { state: dotState, size: 8 }),
										h('span', { className: 'sum', children: ev.payload.summary || meta.label }),
									] }),
									h('div', { className: 'meta', children: [fmtTime(ev.ts), ' · ', meta.label, ev.payload.origin === 'panel' ? ' · 面板' : ' · Agent'] }),
									ev.payload.command ? h('div', { className: 'cmd', children: ev.payload.command }) : null,
									(ev.payload.detail || (ev.payload.output && open)) ? h('div', {
										className: 'detail',
										style: { display: open ? undefined : 'none' },
										children: ev.payload.detail || ev.payload.output,
									}) : null,
									(ev.payload.detail || ev.payload.output) ? h(Button, {
										variant: 'ghost', size: 'sm', style: { padding: '0 4px', marginTop: 2 },
										onClick: () => setExpanded((p) => ({ ...p, [ev.ts + ':' + i]: !open })),
										children: open ? '收起' : '查看输出',
									}) : null,
								] }),
								status === 'failed' ? h('span', { className: 'dsh-ai-act-err', children: '✘' }) : (status === 'done' ? h('span', { className: 'dsh-ai-act-ok', children: '✔' }) : null),
							],
						});
					}) })
					: h('div', { className: 'dsh-ai-activity-empty', children: ['暂无活动记录。\n当我调用 arduino_* 工具执行任务（探测/编译/烧录/串口等）时，每次动作都会实时显示在这里。'] }),
			] });
		}

		// ============================================================================
		// 回合尾卡（conversation.chat.turnTail）—— 本轮 Arduino 活动摘要
		// ============================================================================
		function TurnTailCard(props) {
			const [activity, setActivity] = useState(() => evBus.buffer.filter((e) => e.type === 'activity'));
			useEffect(() => {
				evBus.start();
				return evBus.subscribe((ev) => { if (ev.type === 'activity') setActivity((prev) => [...prev.slice(-49), ev]); });
			}, []);
			const recent = activity.filter((e) => Date.now() - e.ts < 300000);
			if (!recent.length) return null;
			const counts = {};
			let failed = 0;
			for (const e of recent) {
				counts[e.payload.action] = (counts[e.payload.action] || 0) + 1;
				if (e.payload.status === 'failed') failed++;
			}
			const last = recent[recent.length - 1];
			const nameOf = (action) => actionMeta(action).label;
			return h('div', { className: 'dsh-ai-tail', children: [
				h('span', { className: 'ic', children: h(IconListPenOutline16, {}) }),
				h('div', { className: 'grow', children: [
					h('div', { className: 'title', children: 'Arduino 活动摘要' }),
					h('div', { className: 'rows', children: Object.entries(counts).map(([a, n]) => h('div', { key: a, className: 'row', children: [
						h('span', { children: nameOf(a) }),
						h('span', { className: 't', children: '× ' + n }),
					] })) }),
					h('div', { className: 'row', style: { marginTop: 4 }, children: [
						h('span', { className: failed ? 'dsh-ai-act-err' : 'dsh-ai-act-ok', children: failed ? '有失败动作，请查看详情' : '全部完成' }),
						h('span', { style: { flex: 1 } }),
						h('span', { className: 't', children: last ? fmtTime(last.ts) + ' · ' + (last.payload.summary || '') : '' }),
					] }),
				] }),
			] });
		}

		// ============================================================================
		// 工具调用卡定制（tool.call.toolview，按 arduino_* 工具名）
		// ============================================================================
		function extractToolBlock(block) {
			const isResult = block && block.kind === 'tool-result';
			const name = isResult ? (block.call && block.call.name) : (block && block.name);
			const argsRaw = isResult ? (block.call && block.call.argsRaw) : (block && block.argsRaw);
			let text = '';
			let isError = false;
			if (isResult) {
				isError = !!block.isError;
				for (const c of block.content || []) {
					if (c && c.type === 'text' && typeof c.text === 'string') text += c.text;
				}
			}
			return { name: name || 'arduino', argsRaw, text, isError, running: !isResult };
		}

		function ArduinoToolCard(props) {
			const { block } = props;
			const info = extractToolBlock(block);
			const meta = actionMeta(info.name.replace(/^arduino_/, ''));
			const dotState = info.running ? 'ongoing' : (info.isError ? 'error' : 'done');
			const shortArgs = (info.argsRaw || '').slice(0, 120);
			return h('div', { className: 'dsh-ai-toolcard', children: [
				h('div', { className: 'head', children: [
					h('span', { style: { color: 'var(--dsw-alias-brand-primary)', display: 'inline-flex' }, children: h(meta.icon, {}) }),
					h('span', { className: 'nm', children: info.name }),
					h(StateDot, { state: dotState, size: 8 }),
					h('span', { className: 'st', children: info.running ? '执行中…' : (info.isError ? '失败' : '完成') }),
				] }),
				info.running && shortArgs ? h('div', { className: 'args', children: shortArgs }) : null,
				!info.running ? h('div', { className: 'out', children: info.text || (info.isError ? '（无输出）' : '（无输出）') }) : null,
			] });
		}

		// ============================================================================
		// IDE 面板
		// ============================================================================
		function IdePanel() {
			const open = usePanelOpen();
			const [geom, setGeom] = useState(() => {
				try {
					return JSON.parse(localStorage.getItem('dsh-arduino-ide-geom') || 'null') || { x: 90, y: 60, w: 960, h: 680 };
				} catch {
					return { x: 90, y: 60, w: 960, h: 680 };
				}
			});
			const [tab, setTab] = useState('editor');
			const [sketch, setSketch] = useState('MySketch');
			const [files, setFiles] = useState({ 'MySketch.ino': BLINK });
			const [activeFile, setActiveFile] = useState('MySketch.ino');
			const [board, setBoard] = useState('');
			const [port, setPort] = useState('');
			const [boards, setBoards] = useState([]);
			const [ports, setPorts] = useState([]);
			const [cli, setCli] = useState(null);
			const [busy, setBusy] = useState('');
			const [consoleEntries, setConsoleEntries] = useState([]);
			const [savedList, setSavedList] = useState([]);
			const [boardMenu, setBoardMenu] = useState(false);
			const [portMenu, setPortMenu] = useState(false);
			const [activity, clearActivity] = useActivity();

			useEffect(() => {
				localStorage.setItem('dsh-arduino-ide-geom', JSON.stringify(geom));
			}, [geom]);

			// 状态同步：Agent 工具改板卡/端口/Sketch → 面板工具栏自动更新
			useEffect(() => {
				evBus.start();
				return evBus.subscribe((ev) => {
					if (ev.type !== 'state') return;
					const p = ev.payload || {};
					if (typeof p.currentFqbn === 'string') setBoard((prev) => (p.currentFqbn !== prev ? p.currentFqbn : prev));
					if (typeof p.currentPort === 'string') setPort((prev) => (p.currentPort !== prev ? p.currentPort : prev));
					if (typeof p.currentSketch === 'string') setSketch((prev) => (p.currentSketch !== prev ? p.currentSketch : prev));
				});
			}, []);

			// 实时编译流：Agent 编译/烧录时，行级事件追加到正在执行的终端条目
			useEffect(() => {
				evBus.start();
				return evBus.subscribe((ev) => {
					if (ev.type !== 'compile') return;
					const line = (ev.payload && ev.payload.line) || '';
					if (!line) return;
					setConsoleEntries((prev) => {
						if (!prev.length) return prev;
						const last = prev[prev.length - 1];
						if (last.done) return prev;
						const next = [...prev];
						next[next.length - 1] = { ...last, output: last.output + line + '\n' };
						return next;
					});
				});
			}, []);

			// 面板 → 服务 状态同步（用户手动选择板卡/端口/打开 Sketch 时）
			const postState = useCallback((patch) => {
				fetch(API + '/state', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(patch),
				}).catch(() => { /* 忽略 */ });
			}, []);

			const onLog = useCallback((text) => {
				setConsoleEntries((prev) => [...prev.slice(-49), { command: 'info', output: String(text), done: true, ok: true }]);
			}, []);

			// 初始加载
			useEffect(() => {
				api('/status').then((d) => {
					setCli(d.cli);
					if (!d.cli.found) onLog(d.cli.error);
				}).catch((e) => onLog('状态获取失败: ' + e.message));
				api('/boards').then((d) => {
					setPorts(d.ports || []);
					setBoards(d.boards || []);
					if (d.cliError) onLog(d.cliError);
				}).catch((e) => onLog('板卡列表获取失败: ' + e.message));
				api('/sketches').then((d) => setSavedList(d.sketches || [])).catch(() => { /* ignore */ });
				// eslint-disable-next-line react-hooks/exhaustive-deps
			}, []);

			const refreshBoards = async () => {
				try {
					const d = await api('/boards');
					setPorts(d.ports || []);
					setBoards(d.boards || []);
				} catch (e) { onLog('刷新失败: ' + e.message); }
			};

			const setFileContent = useCallback((name, content) => {
				setFiles((prev) => ({ ...prev, [name]: content }));
			}, []);

			const doVerify = async () => {
				if (busy) return;
				setBusy('verify');
				setTab('console');
				setConsoleEntries((prev) => [...prev.slice(-19), { command: 'arduino-cli compile --fqbn ' + (board || '<未选择板卡>') + ' ' + sketch, done: false, ok: true, output: '' }]);
				try {
					const r = await post('/verify', { sketch, files, fqbn: board || undefined });
					setConsoleEntries((prev) => {
						const next = [...prev];
						const last = next[next.length - 1];
						next[next.length - 1] = { command: last.command, done: true, ok: r.ok, output: (r.output || '') + (r.ok ? '\n✔ 验证通过' : '\n✘ 验证失败（见上方错误）') };
						return next;
					});
				} catch (e) {
					setConsoleEntries((prev) => {
						const next = [...prev];
						const last = next[next.length - 1];
						next[next.length - 1] = { command: last.command, done: true, ok: false, output: '验证失败: ' + e.message };
						return next;
					});
				}
				setBusy('');
			};

			const doUpload = async () => {
				if (busy) return;
				if (!board) { onLog('请先选择开发板'); return; }
				if (!port) { onLog('请先选择端口'); return; }
				setBusy('upload');
				setTab('console');
				setConsoleEntries((prev) => [...prev.slice(-19), { command: 'arduino-cli upload -p ' + port + ' --fqbn ' + board + ' ' + sketch, done: false, ok: true, output: '' }]);
				try {
					const r = await post('/upload', { sketch, files, fqbn: board, port });
					setConsoleEntries((prev) => {
						const next = [...prev];
						const last = next[next.length - 1];
						next[next.length - 1] = { command: last.command, done: true, ok: r.ok, output: (r.output || '') + (r.ok ? '\n✔ 上传成功' : '\n✘ 上传失败（见上方错误）') };
						return next;
					});
				} catch (e) {
					setConsoleEntries((prev) => {
						const next = [...prev];
						const last = next[next.length - 1];
						next[next.length - 1] = { command: last.command, done: true, ok: false, output: '上传失败: ' + e.message };
						return next;
					});
				}
				setBusy('');
			};

			const doSave = async () => {
				try {
					const r = await post('/sketch/save', { sketch, files });
					onLog('✔ 已保存: ' + (r.dir || sketch));
					postState({ sketch });
					api('/sketches').then((d) => setSavedList(d.sketches || [])).catch(() => { /* ignore */ });
				} catch (e) { onLog('保存失败: ' + e.message); }
			};

			const doNew = () => {
				if (!window.confirm('新建 Sketch 将丢弃当前未保存的修改，继续？')) return;
				const nm = 'MySketch';
				setSketch(nm);
				setFiles({ [nm + '.ino']: BLINK });
				setActiveFile(nm + '.ino');
				setTab('editor');
				postState({ sketch: nm });
				onLog('已新建 Sketch: ' + nm);
			};

			const doOpenSketch = async (name) => {
				try {
					const r = await post('/sketch/open', { sketch: name });
					const fs = r.files || {};
					if (!fs[name + '.ino'] && Object.keys(fs).length) {
						const ino = Object.keys(fs).find((f) => f.endsWith('.ino'));
						if (ino) { fs[name + '.ino'] = fs[ino]; delete fs[ino]; }
					}
					setSketch(name);
					setFiles(Object.keys(fs).length ? fs : { [name + '.ino']: '' });
					setActiveFile(name + '.ino');
					setTab('editor');
					postState({ sketch: name });
					onLog('已打开 Sketch: ' + name);
				} catch (e) { onLog('打开失败: ' + e.message); }
			};

			const doOpenExample = (r) => {
				const fs = r.files || {};
				const name = r.sketch || 'Example';
				if (!fs[name + '.ino'] && Object.keys(fs).length) {
					const ino = Object.keys(fs).find((f) => f.endsWith('.ino'));
					if (ino) { fs[name + '.ino'] = fs[ino]; delete fs[ino]; }
				}
				setSketch(name);
				setFiles(Object.keys(fs).length ? fs : { [name + '.ino']: '' });
				setActiveFile(name + '.ino');
				setTab('editor');
				onLog('已载入示例: ' + name);
			};

			const doFormat = async () => {
				try {
					const r = await post('/format', { code: files[activeFile] || '' });
					setFileContent(activeFile, r.code);
					onLog('✔ 已自动格式化 ' + activeFile);
				} catch (e) { onLog('格式化失败: ' + e.message); }
			};

			const doAddFile = () => {
				const kind = window.prompt('新建文件类型？输入 .h 或 .cpp（如 extra.h）', 'extra.h');
				if (!kind) return;
				const nm = kind.trim();
				if (!/^[A-Za-z0-9_\-\u4e00-\u9fa5]+\.(h|cpp|c)$/.test(nm)) { onLog('文件名不合法，需以 .h/.cpp/.c 结尾'); return; }
				if (files[nm]) { onLog('文件已存在: ' + nm); return; }
				setFiles((prev) => ({ ...prev, [nm]: '' }));
				setActiveFile(nm);
				onLog('已新建文件: ' + nm);
			};

			const doDeleteFile = (nm) => {
				if (nm.endsWith('.ino')) return;
				if (!window.confirm('删除文件 ' + nm + '？')) return;
				setFiles((prev) => {
					const next = { ...prev };
					delete next[nm];
					return next;
				});
				setActiveFile(sketch + '.ino');
				onLog('已删除文件: ' + nm);
			};

			const doArchive = async () => {
				try {
					const r = await post('/sketch/archive', { sketch });
					if (r.ok) {
						onLog('✔ 已归档: ' + r.file);
						const a = document.createElement('a');
						a.href = r.url;
						a.download = r.file;
						document.body.appendChild(a);
						a.click();
						a.remove();
					} else {
						onLog('归档失败: ' + (r.error || ''));
					}
				} catch (e) { onLog('归档失败: ' + e.message); }
			};

			// 拖动 / 缩放
			const onHeaderDown = (e) => {
				if (e.target.closest('button,input,textarea,[role="menu"]')) return;
				const startX = e.clientX, startY = e.clientY;
				const { x, y } = geom;
				const onMove = (ev) => setGeom((g) => ({ ...g, x: Math.max(-g.w + 220, x + ev.clientX - startX), y: Math.max(0, y + ev.clientY - startY) }));
				const onUp = () => {
					window.removeEventListener('pointermove', onMove);
					window.removeEventListener('pointerup', onUp);
				};
				window.addEventListener('pointermove', onMove);
				window.addEventListener('pointerup', onUp);
			};
			const onResizeDown = (e) => {
				e.stopPropagation();
				const startX = e.clientX, startY = e.clientY;
				const { w, h } = geom;
				const onMove = (ev) => setGeom((g) => ({ ...g, w: Math.max(600, w + ev.clientX - startX), h: Math.max(440, h + ev.clientY - startY) }));
				const onUp = () => {
					window.removeEventListener('pointermove', onMove);
					window.removeEventListener('pointerup', onUp);
				};
				window.addEventListener('pointermove', onMove);
				window.addEventListener('pointerup', onUp);
			};

			const doOpenSerial = () => setTab('serial');

			const tabs = [
				{ id: 'editor', label: '编辑器', icon: h(IconCodeOutline16, {}) },
				{ id: 'serial', label: '串口监视器', icon: h(IconDataOutline16, {}) },
				{ id: 'boards', label: '开发板', icon: h(IconSettingsOutline16, {}) },
				{ id: 'libs', label: '库', icon: h(IconFolderOpenOutline16, {}) },
				{ id: 'examples', label: '示例', icon: h(IconPlayOutline16, {}) },
				{ id: 'console', label: '控制台', icon: h(IconCodeOutline16, {}) },
				{ id: 'activity', label: 'Agent 活动', icon: h(IconListPenOutline16, {}) },
			];

			const busyText = busy === 'verify' ? '编译中…' : busy === 'upload' ? '上传中…' : '';
			const dotState = busy ? 'ongoing' : (cli && cli.found ? 'done' : 'error');

			const body = {
				editor: h(Editor, {
					files, activeFile, savedList,
					onChangeFile: (n, c) => { if (c === undefined) setActiveFile(n); else setFileContent(n, c); },
					onVerify: doVerify, onUpload: doUpload, onSave: doSave, onNew: doNew, onFormat: doFormat,
					onOpenSerial: doOpenSerial, onAddFile: doAddFile, onDeleteFile: doDeleteFile, onArchive: doArchive,
					onOpenSketch: doOpenSketch,
					board, port,
				}),
				serial: h(SerialView, { ports, onLog }),
				boards: h(BoardsView, { onLog }),
				libs: h(LibrariesView, { onLog }),
				examples: h(ExamplesView, { onOpen: doOpenExample, onLog }),
				console: h(ConsoleView, { entries: consoleEntries, clear: () => setConsoleEntries([]) }),
				activity: h(ActivityView, { activity, clear: clearActivity }),
			};

			return h('div', {
				className: 'dsh-ai-root',
				style: { left: geom.x, top: geom.y, width: geom.w, height: geom.h, display: open ? 'flex' : 'none' },
				children: [
					h('div', { className: 'dsh-ai-header', onPointerDown: onHeaderDown, children: [
						h('span', { className: 'dsh-ai-title', children: [h('span', { className: 'logo', children: h(IconCodeOutline16, {}) }), 'Arduino IDE'] }),
						h(Menu, {
							open: boardMenu,
							anchor: h(Button, {
								variant: 'toolbar', size: 'sm', className: 'dsh-ai-menu-trigger',
								disabled: !boards.length,
								title: '开发板 (FQBN)',
								onClick: () => setBoardMenu(true),
								children: [
									h('span', { className: 'grow', children: board || '选择开发板' }),
									h(IconChevronDownOutline14, {}),
								],
							}),
							items: boards.map((b) => ({ id: b.fqbn, label: b.name + ' · ' + b.fqbn })),
							selectedId: board || undefined,
							onSelect: (id) => { setBoard(id); setBoardMenu(false); postState({ fqbn: id }); },
							onClose: () => setBoardMenu(false),
							side: 'bottom', portal: true, dense: true,
						}),
						h(Menu, {
							open: portMenu,
							anchor: h(Button, {
								variant: 'toolbar', size: 'sm', className: 'dsh-ai-menu-trigger',
								disabled: !ports.length,
								title: '串口端口',
								onClick: () => setPortMenu(true),
								children: [
									h('span', { className: 'grow', children: port || '选择端口' }),
									h(IconChevronDownOutline14, {}),
								],
							}),
							items: ports.length
								? ports.map((p) => ({ id: p.address, label: p.address + (p.label && p.label !== p.address ? ' · ' + p.label : '') }))
								: [{ type: 'label', id: 'lbl', text: '未检测到串口' }],
							selectedId: port || undefined,
							onSelect: (id) => { setPort(id); setPortMenu(false); postState({ port: id }); },
							onClose: () => setPortMenu(false),
							side: 'bottom', portal: true, dense: true,
						}),
						h(Button, { variant: 'ghost', size: 'sm', icon: h(IconRefreshOutline16, {}), title: '刷新端口/板卡', onClick: refreshBoards }),
						h('span', { className: 'dsh-ai-sep' }),
						h('span', { style: { flex: 1 } }),
						h(Button, {
							variant: 'primary', size: 'sm', icon: h(IconCheckOutline16, {}),
							disabled: !!busy || !cli || !cli.found,
							title: '验证/编译 (Ctrl+R)',
							onClick: doVerify,
							children: busy === 'verify' ? '编译中…' : '验证',
						}),
						h(Button, {
							variant: 'primary', size: 'sm', icon: h(IconPlayOutline16, {}),
							disabled: !!busy || !cli || !cli.found,
							title: '上传 (Ctrl+U)',
							onClick: doUpload,
							children: busy === 'upload' ? '上传中…' : '上传',
						}),
						h(Button, { variant: 'ghost', size: 'sm', icon: h(IconDownloadOutline16, {}), title: '保存 (Ctrl+S)', onClick: doSave }),
						h(Button, { variant: 'ghost', size: 'sm', icon: h(IconArchiveOutline20, { size: 16 }), title: '项目归档 (.zip)', onClick: doArchive }),
						h(Button, { variant: 'ghost', size: 'sm', icon: h(IconCloseOutline16, {}), title: '关闭', onClick: () => store.set(false) }),
					] }),
					h('div', { className: 'dsh-ai-tabs', children: tabs.map((t) => h(Pill, {
						key: t.id, active: tab === t.id, onClick: () => setTab(t.id),
						children: [t.icon, ' ', t.label],
					})) }),
					cli && !cli.found ? h('div', { className: 'dsh-ai-banner-row', children: h(ConnectionBanner, { reconnecting: true, label: cli.error }) }) : null,
					h('div', { className: 'dsh-ai-body', children: body[tab] || null }),
					h('div', { className: 'dsh-ai-statusbar', children: [
						h(StateDot, { state: dotState }),
						h('span', { className: 'dsh-ai-status-item', children: busyText || (cli && cli.found ? '就绪' : '未就绪') }),
						h('span', { className: 'dsh-ai-status-item', children: ['Sketch ', h('b', { children: sketch })] }),
						h('span', { className: 'dsh-ai-status-item', children: ['cli ', h('b', { children: cli ? (cli.version || (cli.found ? 'ok' : '未找到')) : '…' })] }),
						h('span', { style: { flex: 1 } }),
						busy ? h('span', { className: 'dsh-ai-status-item', children: h(IconLoadingOutline16, {}) }) : null,
					] }),
					h('div', { className: 'dsh-ai-resize', onPointerDown: onResizeDown }),
				],
			});
		}

		// ============================================================================
		// 侧边栏开关
		// ============================================================================
		function SidebarToggle() {
			const open = usePanelOpen();
			return h('button', {
				className: 'dsh-ai-toggle' + (open ? ' active' : ''),
				title: 'Arduino IDE 工作区',
				onClick: () => store.toggle(),
				children: [
					h('span', { className: 'logo', children: h(IconCodeOutline16, {}) }),
					h('span', { children: 'Arduino' }),
				],
			});
		}

		// ============================================================================
		// 插件主体
		// ============================================================================
		const name = 'arduino-ide';
		const inject = ['slots'];

		function apply(ctx, config) {
			ctx.slots.inject('sidebar.footer.action', function* () {
				yield ctx.slots.register({
					name: 'sidebar.footer.action',
					id: 'arduino-ide-toggle',
					order: 900,
				}, () => h(SidebarToggle, {}));
			});
			ctx.slots.inject('shell.overlay', function* () {
				yield ctx.slots.register({
					name: 'shell.overlay',
					id: 'arduino-ide-panel',
					order: 1000,
				}, (ownerProps) => h(IdePanel, { config, ...ownerProps }));
			});
			// 回合尾卡：本回合有 Arduino 活动时显示摘要
			ctx.slots.inject('conversation.chat.turnTail', function* () {
				yield ctx.slots.register({
					name: 'conversation.chat.turnTail',
					select: (owner) => {
						const now = Date.now();
						for (const ev of evBus.buffer) {
							if (ev.type === 'activity' && now - ev.ts < 300000) return { key: 'arduino-activity' };
						}
						return null;
					},
				}, (props) => h(TurnTailCard, props));
			});
			// 工具调用卡定制：arduino_* 工具的对话卡片可视化
			const TOOL_CARD_KEYS = ['arduino_verify', 'arduino_upload', 'arduino_status', 'arduino_serial_read', 'arduino_serial_open', 'arduino_sketch_open', 'arduino_examples_open'];
			ctx.slots.inject('tool.call.toolview', function* () {
				for (const key of TOOL_CARD_KEYS) {
					yield ctx.slots.register({
						name: 'tool.call.toolview',
						key,
					}, (ownerProps) => h(ArduinoToolCard, ownerProps));
				}
			});
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	},
});
