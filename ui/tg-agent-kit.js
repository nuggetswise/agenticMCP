/* TG for Retail agent kit: the reusable pieces of every agent prototype (Direction A), framework-free.
 * One source for prototypes and the OpenText TG Retail Design System. A prototype inlines this file (scripts/kit-inline.mjs)
 * and calls TGAgentKit.<piece>(props), each returning a DOM element. Colours are the design system's tokens as the
 * tg-retail-workspace-prototype skill maps them; nothing here adds a colour. No green, no ticks, no dates.
 *
 * Pieces: header, agentWork, choice, resultList, aviator, queueRow, recordHeader, factRow, interfaceTag, drawer, nowAfter, compareTable, decisionBar, roleTrace, traceLine,
 * timeline, simulated, setupView, governanceView. Helpers: connector(side), injectCss().
 * The page reaches the demo server only through the viewer's own connector (claude.use('mcp')); it holds no key. */
(function (root) {
  'use strict';
  const SERVERS = { ashby: 'RetailStrategy', northfield: 'SupplierRetail' };

  const CSS = `
/*tokens:start*/:root {--ot-blue-900: #00008a; --ot-blue-500: #1968ff; --ot-navy-900: #001c50; --ot-gold-400: #e1bb35;--ot-grad-from: #00008b; --ot-grad-to: #1a6aff; --ot-ink-900: #0f1b2d; --ot-ink-800: #1a2332;--ot-slate-700: #373848; --ot-slate-500: #66677b; --ot-slate-400: #8a92a0; --ot-line-200: #e7e9ec;--ot-surface-100: #fbfbfc; --ot-surface-50: #f4f6f5; --ot-white: #ffffff; --ot-black: #000000;--ot-warn: #8a6d1f; --ot-warn-bar: #e6c766; --ot-warn-tint: #fbefd0;--ot-risk: #c0392b; --ot-risk-bar: #e4a9a9; --ot-risk-tint: #fbeaea;--color-primary: var(--ot-blue-900); --color-action: var(--ot-blue-500); --action-text: #1163ff; --color-accent: var(--ot-gold-400);--text-heading: var(--ot-ink-900); --text-body: var(--ot-slate-700); --text-muted: var(--ot-slate-500); --text-on-dark: var(--ot-white);--link: var(--action-text); --link-hover: var(--ot-blue-900);--surface-page: var(--ot-surface-50); --surface-card: var(--ot-white); --surface-subtle: var(--ot-surface-100); --surface-dark: var(--ot-navy-900);--border-default: var(--ot-line-200); --border-strong: #d3d7dd;--shadow-xs: 0 1px 2px rgba(15,27,45,.05); --shadow-sm: 0 1px 3px rgba(15,27,45,.08); --shadow-md: 0 4px 12px rgba(15,27,45,.08); --shadow-lg: 0 12px 32px rgba(15,27,45,.12);--radius-sm: 6px; --radius-md: 10px; --radius-lg: 12px; --radius-xl: 16px; --radius-pill: 999px;--font-sans: Inter, "Helvetica Neue", Arial, sans-serif; --font-brand: Arial, "Helvetica Neue", Helvetica, system-ui, sans-serif;--font-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;}:root { --soft-action: #e8f0ff; --soft-gold: #faf1d2; }@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {--surface-page: #0b1220; --surface-card: #131e33; --surface-subtle: #17233a; --text-heading: #e7eaef; --text-body: #c9cfd9; --text-muted: #9aa6b8;--border-default: #2b3a52; --border-strong: #22304a; --color-primary: #9a9cff; --color-action: #5c93ff; --link-hover: #8fb4ff; --action-text: #8fb4ff;--soft-action: #12264a; --surface-dark: #0e2350; --ot-warn-bar: #e3be52; --ot-warn: #e3be52; --ot-warn-tint: #3a2e12; --ot-risk: #f07167; --ot-risk-tint: #3a1a18; } }:root[data-theme="dark"] {--surface-page: #0b1220; --surface-card: #131e33; --surface-subtle: #17233a; --text-heading: #e7eaef; --text-body: #c9cfd9; --text-muted: #9aa6b8;--border-default: #2b3a52; --border-strong: #22304a; --color-primary: #9a9cff; --color-action: #5c93ff; --link-hover: #8fb4ff; --action-text: #8fb4ff;--soft-action: #12264a; --surface-dark: #0e2350; --ot-warn-bar: #e3be52; --ot-warn: #e3be52; --ot-warn-tint: #3a2e12; --ot-risk: #f07167; --ot-risk-tint: #3a1a18; }/*tokens:end*/
:root{--tgk-bg:var(--surface-page);--tgk-card:var(--surface-card);--tgk-subtle:var(--surface-subtle);--tgk-ink:var(--text-heading);--tgk-body:var(--text-body);--tgk-muted:var(--text-muted);--tgk-divider:var(--border-default);--tgk-track:var(--border-strong);--tgk-brand:var(--color-primary);--tgk-action:var(--color-action);--tgk-action-hover:var(--link-hover);--tgk-action-text:var(--action-text);--tgk-soft-action:var(--soft-action);--tgk-panel:var(--surface-dark);--tgk-on-panel:var(--text-on-dark);--tgk-from:var(--ot-grad-from);--tgk-to:var(--ot-grad-to);--tgk-amber:var(--ot-warn-bar);--tgk-amber-text:var(--ot-warn);--tgk-soft-amber:var(--ot-warn-tint);--tgk-red:var(--ot-risk);--tgk-soft-red:var(--ot-risk-tint);--tgk-font:var(--font-sans);--tgk-mono:var(--font-mono)}
.tgk,.tgk *{box-sizing:border-box}
.tgk{font-family:var(--tgk-font);color:var(--tgk-body);font-size:13.5px;line-height:1.45;font-variant-numeric:tabular-nums}
.tgk-chip{display:inline-flex;align-items:center;height:22px;padding:0 9px;border-radius:var(--radius-pill);font-size:12px;font-weight:600;white-space:nowrap;background:var(--tgk-subtle);color:var(--tgk-muted);border:1px solid var(--tgk-divider)}
.tgk-chip[data-tone=live]{background:var(--tgk-soft-action);color:var(--tgk-action);border-color:transparent}
.tgk-chip[data-tone=wait]{background:var(--tgk-soft-amber);color:var(--tgk-amber-text);border-color:transparent}
.tgk-chip[data-tone=fail]{background:var(--tgk-soft-red);color:var(--tgk-red);border-color:transparent}
.tgk-chip[data-tone=done]{background:var(--tgk-brand);color:var(--tgk-on-panel);border-color:transparent}
.tgk-label{font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--tgk-brand)}
.tgk-btn{font:600 14px/1 var(--tgk-font);height:38px;padding:0 16px;border-radius:var(--radius-md);border:1px solid var(--tgk-track);background:var(--tgk-card);color:var(--tgk-ink);cursor:pointer;transition:transform .12s}
.tgk-btn:active{transform:scale(.97)}.tgk-btn:focus-visible{outline:3px solid var(--tgk-action);outline-offset:2px}
.tgk-btn[data-primary]{background:var(--tgk-action);border-color:var(--tgk-action);color:var(--tgk-on-panel)}.tgk-btn[data-primary]:hover{background:var(--tgk-action-hover);border-color:var(--tgk-action-hover)}
.tgk-btn[disabled]{opacity:.45;cursor:not-allowed}
/* queue row */
.tgk-qrow{display:grid;grid-template-columns:1fr auto;gap:4px 10px;padding:12px 14px;border:1px solid var(--tgk-divider);border-radius:var(--radius-lg);background:var(--tgk-card);cursor:pointer;text-align:left;width:100%;font:inherit;color:inherit}
.tgk-qrow[aria-current=true]{box-shadow:0 0 0 2px var(--tgk-action);border-color:transparent}
.tgk-qrow .ref{font-weight:600;color:var(--tgk-ink)}.tgk-qrow .line{grid-column:1/-1;color:var(--tgk-body)}.tgk-qrow .clock{grid-column:1/-1;color:var(--tgk-red);font-weight:600;font-size:12.5px}
/* record header */
.tgk-rhead{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 14px;padding-bottom:10px;border-bottom:1px solid var(--tgk-divider)}
.tgk-rhead h2{margin:0;font-size:22px;font-weight:700;color:var(--tgk-ink)}.tgk-rhead .deadline{color:var(--tgk-red);font-weight:600}.tgk-rhead .sub{flex-basis:100%;color:var(--tgk-muted)}
/* facts and interface tags */
.tgk-fact{display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid var(--tgk-divider)}.tgk-fact:last-child{border-bottom:0}
.tgk-fact .text{color:var(--tgk-ink)}
.tgk-tag{background:none;border:0;padding:0;font:400 11px/1.4 var(--tgk-font);color:var(--tgk-muted);cursor:pointer;white-space:nowrap;text-decoration:underline dotted;text-underline-offset:3px}
.tgk-tag:hover{color:var(--tgk-action)}
/* drawer */
.tgk-drawer{position:fixed;inset:0 0 0 auto;width:min(560px,100vw);background:var(--tgk-card);box-shadow:var(--shadow-lg);z-index:60;display:flex;flex-direction:column;transform:translateX(100%);transition:transform .22s ease}
.tgk-drawer[data-open]{transform:none}.tgk-drawer header{display:flex;justify-content:space-between;align-items:center;padding:16px 18px;border-bottom:1px solid var(--tgk-divider)}
.tgk-drawer h3{margin:0;font-size:15px;color:var(--tgk-ink)}
.tgk-drawer .body{padding:14px 18px;overflow:auto;flex:1}
.tgk-doc{display:grid;grid-template-columns:max-content 1fr;gap:8px 16px;margin:0}.tgk-doc dt{color:var(--tgk-muted);font-size:12.5px}.tgk-doc dd{margin:0;color:var(--tgk-ink)}.tgk-doc-text{margin:0 0 10px;color:var(--tgk-ink)}
/* now and after */
.tgk-sugg{border:1px solid var(--tgk-divider);border-radius:var(--radius-lg);background:var(--tgk-card);padding:14px 16px}
.tgk-sugg .head{display:flex;align-items:center;gap:10px;margin-bottom:10px}.tgk-sugg .head b{color:var(--tgk-ink);font-size:14px}
.tgk-na{width:100%;border-collapse:collapse}.tgk-na th{font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--tgk-muted);text-align:left;font-weight:700;padding:6px 8px;border-bottom:1px solid var(--tgk-divider)}
.tgk-na td{padding:9px 8px;border-bottom:1px solid var(--tgk-divider);vertical-align:top}.tgk-na td.after{color:var(--tgk-ink);font-weight:700}.tgk-na .via{color:var(--tgk-muted)}
.tgk-na [contenteditable=true]{outline:1px dashed var(--tgk-action);border-radius:var(--radius-sm);padding:0 3px}.tgk-na .rm{font:600 12px var(--tgk-font);border:0;background:none;color:var(--tgk-red);cursor:pointer}
.tgk-reason{margin-top:10px;color:var(--tgk-body)}.tgk-reason b{color:var(--tgk-ink)}
.tgk-ask{margin-top:10px;padding:10px 12px;background:var(--tgk-soft-amber);border-radius:var(--radius-md);color:var(--tgk-amber-text)}.tgk-ask label{display:block;font-weight:600;margin-bottom:6px}
/* decision bar */
.tgk-bar{margin-top:12px;background:var(--tgk-subtle);border:1px solid var(--tgk-divider);border-radius:var(--radius-md);padding:16px;display:flex;flex-direction:column;gap:12px}
.tgk-bar .says{color:var(--tgk-ink);font-size:15px}.tgk-bar .btns{display:flex;gap:8px}.tgk-bar .nodecision{grid-column:1/-1;color:var(--tgk-muted);font-size:12.5px}
.tgk-bar .sent{grid-column:1/-1;color:var(--tgk-body)}
/* roles and trace */
.tgk-roles{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12px;color:var(--tgk-muted)}.tgk-roles b{color:var(--tgk-ink);font-weight:600}
.tgk-trace{display:grid;grid-template-columns:92px 1fr;gap:2px 10px;padding:7px 0;border-bottom:1px solid var(--tgk-divider);animation:tgk-in .28s ease both}
.tgk-trace .actor{font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--tgk-muted)}.tgk-trace[data-kind=agent] .actor{color:var(--tgk-action)}.tgk-trace[data-kind=person] .actor{color:var(--tgk-brand)}
.tgk-trace .roles{grid-column:2}.tgk-trace .syn{font-size:11px;color:var(--tgk-muted)}
@keyframes tgk-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.tgk-trace{animation:none}.tgk-drawer,.tgk-av-panel{transition:none}}
/* timeline */
.tgk-tl{list-style:none;margin:0;padding:0}.tgk-tl li{position:relative;padding:0 0 12px 22px}.tgk-tl li:before{content:"";position:absolute;left:4px;top:5px;width:9px;height:9px;border-radius:var(--radius-pill);border:2px solid var(--tgk-brand);background:var(--tgk-brand)}
.tgk-tl li:after{content:"";position:absolute;left:8px;top:16px;bottom:0;width:1px;background:var(--tgk-divider)}.tgk-tl li:last-child:after{display:none}
.tgk-tl li[data-state=next]{color:var(--tgk-muted)}.tgk-tl li[data-state=next]:before{background:transparent;border-color:var(--tgk-track)}
.tgk-tl li[data-state=waiting]:before{background:transparent;border-color:var(--tgk-amber)}.tgk-tl li[data-state=settled]{color:var(--tgk-ink);font-weight:600}
/* simulated */
.tgk-sim{display:inline-flex;align-items:center;height:20px;padding:0 8px;border-radius:var(--radius-pill);border:1px dashed var(--tgk-track);color:var(--tgk-muted);font:600 11px var(--tgk-font)}
/* setup and governance */
.tgk-panel{border:1px solid var(--tgk-divider);border-radius:var(--radius-lg);background:var(--tgk-card);padding:16px}
.tgk-panel h3{margin:0 0 4px;font-size:15px;color:var(--tgk-ink)}.tgk-panel .lead{color:var(--tgk-muted);margin:0 0 12px}
.tgk-grid{display:grid;grid-template-columns:minmax(160px,1fr) 1.4fr;gap:8px 14px;align-items:center;padding:8px 0;border-bottom:1px solid var(--tgk-divider)}
.tgk-grid .k{color:var(--tgk-ink);font-weight:600}.tgk-grid .src{grid-column:1/-1;font-size:11px;color:var(--tgk-muted)}
.tgk-panel select,.tgk-panel input,.tgk-panel textarea{font:13px var(--tgk-font);padding:6px 8px;border:1px solid var(--tgk-track);border-radius:var(--radius-sm);background:var(--tgk-card);color:var(--tgk-ink);width:100%}
.tgk-lock{color:var(--tgk-muted)}.tgk-lock:before{content:"Locked · ";font-weight:600}
.tgk-gov{width:100%;border-collapse:collapse}.tgk-gov th,.tgk-gov td{padding:8px;border-bottom:1px solid var(--tgk-divider);text-align:left;vertical-align:top}
.tgk-gov th{font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--tgk-muted)}.tgk-gov td.by{font-weight:600;color:var(--tgk-ink)}
/* aviator: an agent presence (avatar, name, status) that opens a side panel with the conversation and the records it read */
.tgk-av-btn{position:fixed;right:max(20px,env(safe-area-inset-right));bottom:max(20px,env(safe-area-inset-bottom));z-index:70;display:flex;align-items:center;gap:10px;min-height:52px;padding:6px 16px 6px 6px;border-radius:var(--radius-pill);border:1px solid var(--tgk-divider);background:var(--tgk-card);color:var(--tgk-ink);font:inherit;font-family:var(--tgk-font);cursor:pointer;box-shadow:var(--shadow-md);text-align:left;transition:transform .15s cubic-bezier(.23,1,.32,1)}
.tgk-av-btn:active{transform:scale(.97)}.tgk-av-btn:focus-visible{outline:3px solid var(--tgk-action);outline-offset:2px}
.tgk-av-btn[aria-expanded=true]{display:none}
.tgk-av-avatar{flex:0 0 40px;width:40px;height:40px;border-radius:var(--radius-pill);background:linear-gradient(135deg,var(--tgk-from),var(--tgk-to));display:grid;place-items:center;color:var(--tgk-on-panel)}
.tgk-av-avatar svg{width:22px;height:22px}
.tgk-av-avatar[data-busy]{box-shadow:0 0 0 3px var(--tgk-soft-action)}
.tgk-av-id{display:flex;flex-direction:column;line-height:1.2}.tgk-av-id b{font-size:14px;font-weight:600;color:var(--tgk-ink)}
.tgk-av-status{font-size:12px;color:var(--tgk-muted)}.tgk-av-status[data-busy]{color:var(--tgk-action-text)}
.tgk-av-panel{position:fixed;top:0;right:0;bottom:0;z-index:71;width:min(420px,100vw);background:var(--tgk-card);border-left:1px solid var(--tgk-divider);box-shadow:var(--shadow-lg);display:flex;flex-direction:column;transform:translateX(100%);transition:transform .26s cubic-bezier(.23,1,.32,1);visibility:hidden}
.tgk-av-panel[data-open]{transform:none;visibility:visible}
.tgk-av-panel header{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--tgk-divider)}
.tgk-av-panel header .tgk-av-id{flex:1}
.tgk-av-close{border:0;background:none;font:600 13px var(--tgk-font);color:var(--tgk-muted);cursor:pointer;padding:6px}
.tgk-av-log{flex:1;overflow:auto;padding:14px 16px;display:flex;flex-direction:column;gap:10px}
.tgk-av-msg{max-width:92%;padding:9px 11px;border-radius:var(--radius-lg);white-space:pre-wrap}.tgk-av-msg[data-role=user]{align-self:flex-end;background:var(--tgk-soft-action);color:var(--tgk-ink)}
.tgk-av-msg[data-role=model]{align-self:flex-start;background:var(--tgk-subtle);border:1px solid var(--tgk-divider);color:var(--tgk-ink)}.tgk-av-msg .cites{margin-top:6px;font-size:11px;color:var(--tgk-muted)}
.tgk-av-read{border-top:1px solid var(--tgk-divider);padding:10px 16px;max-height:30%;overflow:auto}
.tgk-av-read ul{list-style:none;margin:6px 0 0;padding:0}.tgk-av-read li{display:flex;justify-content:space-between;gap:10px;padding:4px 0;border-bottom:1px solid var(--tgk-divider);font-size:12.5px;color:var(--tgk-ink)}
.tgk-av-read li span{color:var(--tgk-muted);font-size:11px}.tgk-av-read .none{font-size:12px;color:var(--tgk-muted);margin:6px 0 0}
.tgk-av-form{display:flex;gap:8px;padding:10px 12px;border-top:1px solid var(--tgk-divider)}.tgk-av-form input{flex:1;font:13.5px var(--tgk-font);padding:9px 10px;border:1px solid var(--tgk-track);border-radius:var(--radius-md);background:var(--tgk-card);color:var(--tgk-ink)}
@media (prefers-reduced-motion:reduce){.tgk-av-btn{transition:none}}

/* header (board): wordmark, workspace, History and Agents as text links, business clock, person */
.tgk-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;padding:14px 32px;background:var(--tgk-card);border-bottom:1px solid var(--tgk-divider)}
.tgk-head .mark{font-weight:700;font-size:16px;color:var(--tgk-brand)}.tgk-head .ws{color:var(--tgk-muted)}.tgk-head .l,.tgk-head .r{display:flex;align-items:center;gap:12px}.tgk-head .r{gap:16px;color:var(--tgk-muted)}
.tgk-head .link{border:0;background:none;padding:0;font:inherit;color:var(--tgk-muted);cursor:pointer}.tgk-head .link[data-strong]{color:var(--tgk-brand);font-weight:600}.tgk-head .clock{font-weight:700;color:var(--tgk-ink)}
/* queue row additions: consequence and cutoff */
.tgk-qrow .impact{grid-column:1/-1;font-size:12px;color:var(--tgk-muted)}.tgk-qrow .impact b{font-weight:600}
.tgk-qrow .cutoff{grid-column:1/-1;font-size:12px;font-weight:600;color:var(--tgk-muted)}.tgk-qrow .cutoff[data-running]{color:var(--tgk-red)}
.tgk-qrow{animation:tgk-in .26s cubic-bezier(.23,1,.32,1) both}
/* what the agent did */
.tgk-work .hd{display:flex;align-items:center;gap:10px;margin-bottom:8px}.tgk-work .step{display:flex;gap:10px;align-items:baseline;padding:2px 0;animation:tgk-in .26s cubic-bezier(.23,1,.32,1) both}
.tgk-work .dot{flex:0 0 8px;height:8px;border-radius:var(--radius-pill);background:var(--tgk-panel)}.tgk-work .t{flex:1;color:var(--tgk-ink)}
/* choice under the person's rule */
.tgk-choice{display:flex;flex-direction:column;gap:8px}.tgk-opt{display:flex;flex-direction:column;align-items:flex-start;gap:2px;padding:10px 12px;text-align:left;font:inherit;cursor:pointer;background:var(--tgk-card);border:1px solid var(--tgk-divider);border-radius:var(--radius-md)}
.tgk-opt[aria-pressed=true]{background:var(--tgk-soft-action);border:2px solid var(--tgk-action)}.tgk-opt b{font-weight:600;color:var(--tgk-ink)}.tgk-opt span{font-size:12px;color:var(--tgk-muted)}
/* result list */
.tgk-result .row{display:flex;gap:10px;align-items:baseline;padding:2px 0}.tgk-result .dot{flex:0 0 8px;height:8px;border-radius:var(--radius-pill);background:var(--tgk-panel)}
.tgk-result .row[data-state=next] .dot{flex-basis:6px;height:6px;background:transparent;border:2px solid var(--tgk-muted)}.tgk-result .t{flex:1;color:var(--tgk-ink)}.tgk-result .row[data-state=next] .t{color:var(--tgk-muted)}
.tgk-result .row[data-state=settled] .t{font-weight:700}
@media (prefers-reduced-motion:reduce){.tgk-qrow,.tgk-work .step{animation:none}}
`;

  // ---------- tiny DOM helper ----------
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v; else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else if (k === 'text') n.textContent = v; else n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
    return n;
  }
  const kit = (n) => { n.classList.add('tgk'); return n; };

  function injectCss(doc = document) { if (doc.getElementById('tgk-css')) return; const s = doc.createElement('style'); s.id = 'tgk-css'; s.textContent = CSS; doc.head.append(s); }

  /** The viewer's connector for one side. Resolves null when this view cannot reach it (the page then shows what it has, never invents). */
  async function connector(side) {
    const server = SERVERS[side] || side; let mcp = null;
    try { mcp = root.claude && await root.claude.use('mcp'); } catch (e) { mcp = null; }
    if (!mcp) return null;
    return { server, call: async (tool, input) => { const r = await mcp.callTool(server, tool, input || {}); return r && (r.payload ?? r); } };
  }

  // ---------- pieces ----------
  /** A row in the "Needs review" queue: reference, one state chip, one line stating its own problem in values, "If nothing changes:" and its cutoff;
   * only the row with a running clock (running: true) shows the cutoff in red. While the agent checks, pass chip 'Checking' with tone 'live'. */
  function queueRow({ ref, chip, tone, line, impact, cutoff, running, clock, open, onSelect }) {
    const cut = cutoff || clock;
    return kit(el('button', { class: 'tgk-qrow', type: 'button', 'aria-current': open ? 'true' : 'false', onclick: onSelect },
      el('span', { class: 'ref', text: ref }), el('span', { class: 'tgk-chip', 'data-tone': tone, text: chip }), el('span', { class: 'line', text: line }),
      impact ? el('span', { class: 'impact' }, el('b', { text: 'If nothing changes: ' }), impact) : null,
      cut ? el('span', { class: cutoff ? 'cutoff' : 'clock', 'data-running': running || (!cutoff && clock) ? true : null, text: cut }) : null));
  }

  /** The record header: business reference as title, the running deadline in red where one exists. */
  function recordHeader({ title, deadline, sub }) { return kit(el('div', { class: 'tgk-rhead' }, el('h2', { text: title }), deadline ? el('span', { class: 'deadline', text: deadline }) : null, sub ? el('span', { class: 'sub', text: sub }) : null)); }

  /** The interface tag: system and interface in muted 11px text, no box; opens the readable document in the drawer, and nothing more. */
  function interfaceTag({ system, via, doc }) {
    const label = [system, via].filter(Boolean).join(' · ');
    return el('button', { class: 'tgk-tag', type: 'button', 'data-doc': doc ? 'readable' : null, title: doc ? `Open ${doc.title}` : label, onclick: doc ? () => drawer(doc) : null, text: label });
  }

  /** One fact the agent found, in values, ending with its interface tag. */
  function factRow({ text, system, via, doc }) { return kit(el('div', { class: 'tgk-fact' }, el('span', { class: 'text', text }), interfaceTag({ system, via, doc }))); }

  let openDrawer = null;
  /** A drawer holding one readable document: its trade name and reference as the title, then its business values.
   * Pass fields as [label, value] pairs, or content as a short readable text or Node. Nothing else is shown: no raw X12,
   * no segment text, no request or response payload, no format tabs. A legacy tabs list is read for its Readable tab only. */
  const RAW_X12 = /(^|[^A-Za-z0-9])(?:ISA|GS|ST|SE|GE|IEA|[A-Z][A-Z0-9]{1,2})\*[^\n]{0,80}?\*/;
  function drawer({ title, fields, content, tabs }) {
    injectCss(); if (openDrawer) openDrawer.remove();
    if (content == null && !fields && Array.isArray(tabs)) { const t = tabs.find((x) => /readable/i.test(x.label)) || tabs[0]; content = t && t.content; }
    const body = el('div', { class: 'body' });
    if (fields) body.append(el('dl', { class: 'tgk-doc' }, ...fields.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: String(v) })])));
    if (content != null) body.append(typeof content === 'string' ? el('p', { class: 'tgk-doc-text', text: content }) : content);
    if (RAW_X12.test(body.textContent)) { body.replaceChildren(el('p', { class: 'tgk-doc-text', text: 'This document is shown in readable form only.' })); }
    const close = () => { d.removeAttribute('data-open'); setTimeout(() => d.remove(), 240); openDrawer = null; };
    const d = kit(el('aside', { class: 'tgk-drawer', role: 'dialog', 'aria-label': title }, el('header', {}, el('h3', { text: title }), el('button', { class: 'tgk-btn', type: 'button', onclick: close, text: 'Close' })), body));
    document.body.append(d); requestAnimationFrame(() => d.setAttribute('data-open', '')); openDrawer = d;
    document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });
    return d;
  }

  /** The suggestion block: "<Name> Agent suggestion", Ready for review, then Action · Now · After · Goes to, the reason, and any question the agent cannot answer.
   * editable: true turns cells and rows editable (Edit suggestion is taking over); onChange(rows) reports the person's edits. */
  function nowAfter({ agent, rows, reason, chip = 'Ready for review', editable = false, question, onChange, onAnswer }) {
    const state = rows.map((r) => ({ ...r }));
    const table = el('table', { class: 'tgk-na' }, el('thead', {}, el('tr', {}, ...['Action', 'Now', 'After', 'Goes to', editable ? '' : null].filter((x) => x != null).map((h) => el('th', { text: h })))));
    const tb = el('tbody'); table.append(tb);
    const draw = () => { tb.replaceChildren(...state.map((r, i) => el('tr', {},
      el('td', { text: r.action }),
      el('td', { contenteditable: editable ? 'true' : null, oninput: (e) => { r.now = e.target.textContent; onChange && onChange(state); }, text: r.now }),
      el('td', { class: 'after', contenteditable: editable ? 'true' : null, oninput: (e) => { r.after = e.target.textContent; onChange && onChange(state); }, text: r.after }),
      el('td', {}, r.goesTo, r.via ? el('span', { class: 'via', text: ` · ${r.via}` }) : null),
      editable ? el('td', {}, el('button', { class: 'rm', type: 'button', onclick: () => { state.splice(i, 1); draw(); onChange && onChange(state); }, text: 'Remove' })) : null))); };
    draw();
    const ask = question ? el('div', { class: 'tgk-ask' }, el('label', { text: question.text }),
      el('select', { onchange: (e) => onAnswer && onAnswer(e.target.value) }, el('option', { value: '', text: 'Choose' }), ...question.options.map((o) => el('option', { value: o, text: o })))) : null;
    return kit(el('section', { class: 'tgk-sugg', 'aria-label': `${agent} suggestion` },
      el('div', { class: 'head' }, el('b', { text: `${agent} suggestion` }), el('span', { class: 'tgk-chip', 'data-tone': 'wait', text: editable ? 'Edited by you' : chip })),
      table, reason ? el('p', { class: 'tgk-reason' }, el('b', { text: 'Reason. ' }), reason) : null, ask));
  }

  /** A comparison table of values: the same thing under the rule in force and under a change (a rule replay, a
   * baseline beside an agent). strong names the column drawn in bold ink, as After is in the suggestion block. */
  function compareTable({ columns, rows, strong }) {
    return kit(el('table', { class: 'tgk-na' }, el('thead', {}, el('tr', {}, ...columns.map((c) => el('th', { text: c })))),
      el('tbody', {}, ...rows.map((r) => el('tr', {}, ...r.map((v, i) => el('td', { class: i === strong ? 'after' : null, text: v })))))));
  }

  /** The decision bar: one sentence stating exactly what Approve does, then Approve and Edit suggestion, and what happens with no decision.
   * On the retailer side pass decisions: [{label, primary, onClick}] to replace the two controls with the business decision itself. */
  function decisionBar({ says, noDecision, onApprove, onEdit, decisions, busy }) {
    const btns = decisions ? decisions.map((d) => el('button', { class: 'tgk-btn', type: 'button', 'data-primary': d.primary || null, disabled: busy || null, onclick: d.onClick, text: d.label }))
      : [el('button', { class: 'tgk-btn', type: 'button', 'data-primary': true, disabled: busy || null, onclick: onApprove, text: 'Approve' }), el('button', { class: 'tgk-btn', type: 'button', disabled: busy || null, onclick: onEdit, text: 'Edit suggestion' })];
    return kit(el('div', { class: 'tgk-bar', role: 'group', 'aria-label': 'Decision' }, el('div', { class: 'says', text: says }), el('div', { class: 'btns' }, ...btns), noDecision ? el('div', { class: 'nodecision', text: noDecision }) : null));
  }
  /** What replaces the decision bar once the person has decided: the present state in neutral words, never as settled. */
  function sentState({ text }) { return kit(el('div', { class: 'tgk-bar' }, el('div', { class: 'sent', text }))); }

  /** Who recommended, who authorised and who carried out one action. Kept apart on every action. */
  function roleTrace({ recommended, authorised, carriedOut }) {
    return kit(el('div', { class: 'tgk-roles' }, el('span', {}, 'Recommended by ', el('b', { text: recommended || '—' })), el('span', {}, 'Authorised by ', el('b', { text: authorised || 'Waiting' })), el('span', {}, 'Carried out by ', el('b', { text: carriedOut || 'Not yet' }))));
  }

  /** One line of the server's trace, as it happened: actor (Rule, the agent, the person, an outside party, a system), what was done, and the three roles where it is an action. */
  function traceLine({ kind, actor, text, roles, synthetic }) {
    return kit(el('div', { class: 'tgk-trace', 'data-kind': kind }, el('span', { class: 'actor', text: actor }), el('span', {}, text, synthetic ? el('span', { class: 'syn', text: ' · synthetic answer' }) : null), roles ? el('div', { class: 'roles' }, roleTrace(roles)) : null));
  }

  /** The review timeline: done (filled), waiting (amber ring), next (hollow, muted); the last line is the record that settles the job, styled as settled only once it exists. */
  function timeline({ items }) { return kit(el('ol', { class: 'tgk-tl' }, ...items.map((i) => el('li', { 'data-state': i.state || 'done', text: i.text })))); }


  /** The board's header: wordmark, the workspace of the acting person, History and Agents as text links, the business clock, the person. */
  function header({ workspace, clock, person, onHistory, onAgents }) {
    return kit(el('header', { class: 'tgk-head' }, el('div', { class: 'l' }, el('span', { class: 'mark', text: 'Trading Grid' }), el('span', { class: 'ws', text: workspace })),
      el('div', { class: 'r' }, el('button', { class: 'link', type: 'button', onclick: onHistory, text: 'History' }), onAgents ? el('button', { class: 'link', type: 'button', 'data-strong': true, onclick: onAgents, text: 'Agents' }) : null,
        clock ? el('span', { class: 'clock', text: clock }) : null, el('span', { text: person }))));
  }

  /** "What <Name> Agent did": the agent's steps, each a past-tense line ending with its system and interface tag, under a Working or Done chip. */
  function agentWork({ agent, working, steps }) {
    return kit(el('section', { class: 'tgk-work', 'aria-label': `What ${agent} did` }, el('div', { class: 'hd' }, el('span', { class: 'tgk-label', text: `What ${agent} did` }),
      el('span', { class: 'tgk-chip', 'data-tone': working ? 'live' : null, text: working ? 'Working' : 'Done' })),
      ...steps.map((st) => el('div', { class: 'step' }, el('span', { class: 'dot', 'aria-hidden': 'true' }), el('span', { class: 't', text: st.text }), st.system ? interfaceTag({ system: st.system, via: st.via, doc: st.doc }) : null))));
  }

  /** A choice under the person's rule: two valid options as cards, the one the person's rule recommends selected and labelled with that rule. */
  function choice({ label, options, onPick }) {
    const wrap = el('div', { class: 'tgk-choice', role: 'group', 'aria-label': label }, el('span', { class: 'tgk-label', text: label }));
    const draw = (sel) => { wrap.querySelectorAll('.tgk-opt').forEach((n) => n.remove()); options.forEach((o, i) => wrap.append(el('button', { class: 'tgk-opt', type: 'button', 'aria-pressed': String(i === sel), onclick: () => { draw(i); onPick && onPick(o, i); } }, el('b', { text: o.title }), el('span', { text: o.note })))); };
    draw(Math.max(0, options.findIndex((o) => o.recommended))); return kit(wrap);
  }

  /** The Result list: done lines with a filled navy dot, next lines hollow and muted; the last line is the confirming record, bold once it exists (state 'settled'). */
  function resultList({ items }) {
    return kit(el('section', { class: 'tgk-result', 'aria-label': 'Result' }, el('span', { class: 'tgk-label', text: 'Result' }),
      ...items.map((i) => el('div', { class: 'row', 'data-state': i.state || 'done' }, el('span', { class: 'dot', 'aria-hidden': 'true' }), el('span', { class: 't', text: i.text }), i.system ? interfaceTag({ system: i.system, via: i.via, doc: i.doc }) : null))));
  }

  /** The Simulated label: shown on a task card when the model could not answer and a recorded real run is replayed. */
  function simulated({ note = 'Replays the last recorded run' } = {}) { return kit(el('span', { class: 'tgk-sim', title: note, text: 'Simulated' })); }

  /** The setup view: the outside facts and each action's approval mode that may be set before a run, locked rows and guardrails shown as locked.
   * Takes the agent's setup tool payload shape: { facts: [{key, label, recorded, options?, type?, source?}], actions: [{key, label, rule, mode, modes, editable}], guardrails: [{rule, text}] }. */
  /** Turns an agent's setup payload as the server returns it (facts and actions keyed by name) into the list shape setupView draws. */
  function fromServerSetup(s) {
    if (Array.isArray(s.facts)) return s;
    return { facts: Object.entries(s.facts || {}).map(([key, f]) => ({ key, label: f.says, recorded: f.recorded, options: f.values, type: f.values ? null : typeof f.recorded === 'number' || f.min != null ? 'number' : 'text' })),
      actions: Object.entries(s.actions || {}).map(([key, a]) => ({ key, label: a.does, rule: a.rule, mode: a.mode, modes: a.modes, editable: !!(a.priya_may_change ?? a.editable) })),
      guardrails: (s.guardrails || []).map((g) => ({ rule: g.id || g.rule, text: g.text })) };
  }
  function setupView({ title, lead, setup: raw, onStart, startLabel = 'Run with these values' }) {
    const setup = fromServerSetup(raw); const facts = {}, policy = {};
    const factRows = (setup.facts || []).map((f) => {
      const input = f.options ? el('select', { onchange: (e) => { facts[f.key] = e.target.value; } }, ...f.options.map((o) => el('option', { value: String(o), selected: String(o) === String(f.recorded) || null, text: String(o) })))
        : f.type === 'text' ? el('textarea', { rows: 2, oninput: (e) => { facts[f.key] = e.target.value; } }, String(f.recorded ?? '')) : el('input', { type: 'number', value: f.recorded ?? '', oninput: (e) => { facts[f.key] = Number(e.target.value); } });
      return el('div', { class: 'tgk-grid' }, el('span', { class: 'k', text: f.label }), input, f.source ? el('span', { class: 'src', text: `Recorded: ${f.recorded} · ${f.source}` }) : null);
    });
    const actRows = (setup.actions || []).map((a) => el('div', { class: 'tgk-grid' }, el('span', { class: 'k', text: `${a.label} (${a.rule})` }),
      a.editable ? el('select', { onchange: (e) => { policy[a.key] = e.target.value; } }, ...(a.modes || ['approve', 'policy']).map((m) => el('option', { value: m, selected: m === a.mode || null, text: m === 'approve' ? 'Ask before acting' : m === 'policy' ? 'Act within policy' : m === 'suggest' ? 'Suggest only' : m })))
        : el('span', { class: 'tgk-lock', text: a.mode === 'approve' ? 'Always asks' : a.mode })));
    const guard = (setup.guardrails || []).map((g) => el('div', { class: 'tgk-grid' }, el('span', { class: 'k', text: g.rule }), el('span', { class: 'tgk-lock', text: g.text })));
    return kit(el('section', { class: 'tgk-panel', 'aria-label': title },
      el('h3', { text: title }), lead ? el('p', { class: 'lead', text: lead }) : null,
      el('div', { class: 'tgk-label', text: 'Outside facts' }), ...factRows,
      el('div', { class: 'tgk-label', style: 'margin-top:14px', text: 'Approval per action' }), ...actRows,
      guard.length ? el('div', { class: 'tgk-label', style: 'margin-top:14px', text: 'Administrator guardrails' }) : null, ...guard,
      el('div', { style: 'margin-top:14px' }, el('button', { class: 'tgk-btn', type: 'button', 'data-primary': true, onclick: () => onStart && onStart({ facts: { ...facts }, policy: { ...policy } }), text: startLabel }))));
  }

  /** The governance view: the rule baseline beside the agent on the same facts. A step both reach is automation; the agent is credited only where its result differs. */
  function governanceView({ title, lead, rows, baseline, agent }) {
    const head = el('tr', {}, ...['Step', 'Rule baseline', agent.name, 'Credited to'].map((h) => el('th', { text: h })));
    const body = rows.map((r) => el('tr', {}, el('td', { text: r.step }), el('td', { text: r.baseline }), el('td', { text: r.agent }), el('td', { class: 'by', text: r.baseline === r.agent ? 'Automation' : agent.name })));
    return kit(el('section', { class: 'tgk-panel', 'aria-label': title }, el('h3', { text: title }), lead ? el('p', { class: 'lead', text: lead }) : null,
      el('table', { class: 'tgk-gov' }, el('thead', {}, head), el('tbody', {}, ...body)),
      el('p', { class: 'lead', style: 'margin-top:10px' }, `Outcome: ${baseline.outcome} with the rule baseline; ${agent.outcome} with ${agent.name}.`)));
  }

  /** What Aviator read, in business words: the record a read tool returned, never the tool's name. */
  const AV_READS = { get_order: 'Order', get_document: 'Document', orders_needing_attention: 'Orders needing attention', check_deliveries: 'Deliveries', lookup_retailer_rules: 'Northfield rules', lookup_rules: 'Northfield rules', get_scorecard: 'Scorecard', supplier_scorecard: 'Scorecard', list_deductions: 'Deductions', list_deduction_cases: 'Deduction cases', get_deduction_case: 'Deduction case', review_deduction_case: 'Deduction case', explain_rejection: 'Rejection', edi_health_summary: 'Document exchange health', get_access_log: 'Access log', supplier_document_trail: 'Document trail', three_way_match: 'Invoice match', recommend_next_step: 'Next step', compare_with_other_suppliers: 'Other suppliers', read_retailer_records: 'Northfield records', read_supplier_records: 'Supplier records', run_readonly_sql: 'Records query', get_story_calendar: 'Calendar', list_draft_rules: 'Draft rules', replay_draft_rule: 'Rule replay', get_change_list: 'Change list' };
  const avRead = (t) => { const vals = Object.values(t.arguments || {}).filter((v) => typeof v === 'string' || typeof v === 'number').map(String).filter((v) => v.length <= 40); return { what: AV_READS[t.tool] || 'Records', ref: vals.join(', ') }; };
  const AV_GLYPH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><circle cx="12" cy="12" r="4.5"/></svg>';
  /** Aviator: Trading Grid's AI agent for questions, present at the bottom right on every screen and closed until opened. It shows its
   * avatar, name and status (Ready, Reading records), answers through the viewer's own connection (ask_aviator), lists every record it read
   * in its side panel, and never acts: a drafted action goes back to the screen through onDraft as a proposal. context() names the record
   * on screen. The first question on a page waits for claude.ai's one-time permission; a call that could not start while that box was open
   * is sent again once, quietly. */
  function aviator({ side = 'ashby', person, context, suggestions = [], onDraft } = {}) {
    injectCss();
    const history = []; const readList = []; const logBox = el('div', { class: 'tgk-av-log', 'aria-live': 'polite' });
    const say = (role, text, extra) => { const m = el('div', { class: 'tgk-av-msg', 'data-role': role, text }); if (extra) m.append(extra); logBox.append(m); logBox.scrollTop = logBox.scrollHeight; return m; };
    const input = el('input', { type: 'text', placeholder: 'Ask about this record', 'aria-label': 'Ask Aviator' });
    const send = el('button', { class: 'tgk-btn', type: 'submit', 'data-primary': true, text: 'Ask' });
    const avatar = () => { const a = el('span', { class: 'tgk-av-avatar' }); a.innerHTML = AV_GLYPH; return a; };
    const avA = avatar(), avB = avatar();
    const stA = el('span', { class: 'tgk-av-status', text: 'Ready' }), stB = el('span', { class: 'tgk-av-status', text: 'Ready' });
    const setStatus = (text, busy) => { for (const n of [stA, stB]) { n.textContent = text; n.toggleAttribute('data-busy', !!busy); } for (const a of [avA, avB]) a.toggleAttribute('data-busy', !!busy); };
    const readBox = el('ul', {}); const readNone = el('p', { class: 'none', text: 'Nothing read yet' });
    const showReads = () => { readBox.replaceChildren(...readList.map((r) => el('li', {}, r.what, el('span', { text: r.ref })))); readNone.hidden = readList.length > 0; };
    const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
    // The model writes light markdown; show it as text with bold kept and list markers as plain bullets, never as raw symbols.
    const plain = (t) => String(t).replace(/^\s*[*-]\s+/gm, '• ').replace(/`([^`]*)`/g, '$1').split(/\*\*([^*]+)\*\*/g).map((part, i) => i % 2 ? el('b', { text: part }) : document.createTextNode(part.replace(/\*/g, '')));
    async function call(c, input) {
      try { return await c.call('ask_aviator', input); }
      catch (e) { if (e && e.retryable) { await wait(Math.min(e.retryAfterMs || 1500, 8000) + Math.random() * 400); return c.call('ask_aviator', input); } throw e; }
    }
    const NOT = { needs_reauth: 'Reconnect Trading Grid in claude.ai Settings, Connectors, to ask Aviator.', server_not_connected: 'Add Trading Grid in claude.ai Settings, Connectors, to ask Aviator.', approval_required: 'Aviator needs Trading Grid allowed for this page.', consent_required: 'Aviator needs Trading Grid allowed for this page.', not_in_manifest: 'Aviator is not available on this page.', server_unavailable: 'Trading Grid did not answer in time. Ask again.', tool_error: 'Trading Grid refused the question.' };
    async function ask(q) {
      if (!q.trim()) return; say('user', q); input.value = ''; send.disabled = true; setStatus('Reading records', true); const pending = say('model', 'Reading records');
      try {
        const c = await connector(side);
        if (!c) { pending.textContent = 'Aviator answers through your Trading Grid connection, which this view cannot reach.'; return; }
        const out = await call(c, { question: q, history: history.slice(-8), context: context ? context() : undefined });
        if (!out || !out.ok) { pending.textContent = out && out.message ? out.message : 'Aviator did not answer.'; return; }
        pending.replaceChildren(...plain(out.answer)); history.push({ role: 'user', text: q }, { role: 'model', text: out.answer });
        const read = (out.tools_called || []).map(avRead); for (const r of read) if (!readList.some((x) => x.what === r.what && x.ref === r.ref)) readList.push(r); showReads();
        pending.append(el('div', { class: 'cites', text: read.length ? `Read: ${read.map((r) => [r.what, r.ref].filter(Boolean).join(' ')).join('; ')}` : 'Answered without reading a record' }));
        if (onDraft && /propos|would send|approve/i.test(out.answer)) onDraft(out.answer);
      } catch (e) { const code = e && e.code; if (typeof console !== 'undefined') console.warn('[Aviator]', code || e); pending.textContent = NOT[code] || 'Aviator could not answer. Ask again.'; }
      finally { send.disabled = false; setStatus('Ready', false); input.focus(); }
    }
    const form = el('form', { class: 'tgk-av-form', onsubmit: (e) => { e.preventDefault(); ask(input.value); } }, input, send);
    const chips = suggestions.length ? el('div', { style: 'display:flex;flex-wrap:wrap;gap:6px' }, ...suggestions.map((s) => el('button', { class: 'tgk-btn', type: 'button', style: 'height:30px;font-size:12.5px', onclick: () => ask(s), text: s }))) : null;
    if (chips) logBox.append(chips);
    const close = () => { panel.removeAttribute('data-open'); btn.setAttribute('aria-expanded', 'false'); btn.focus(); };
    const panel = kit(el('section', { class: 'tgk-av-panel', role: 'dialog', 'aria-label': 'Aviator' },
      el('header', {}, avB, el('span', { class: 'tgk-av-id' }, el('b', { text: 'Aviator' }), stB), el('span', { class: 'tgk-chip', text: person || 'Trading Grid' }), el('button', { class: 'tgk-av-close', type: 'button', 'aria-label': 'Close Aviator', onclick: close, text: 'Close' })),
      logBox, el('div', { class: 'tgk-av-read' }, el('div', { class: 'tgk-label', text: 'What Aviator read' }), readNone, readBox), form));
    const btn = kit(el('button', { class: 'tgk-av-btn', type: 'button', 'aria-expanded': 'false', 'aria-label': 'Open Aviator', onclick: () => { panel.setAttribute('data-open', ''); btn.setAttribute('aria-expanded', 'true'); input.focus(); } }, avA, el('span', { class: 'tgk-av-id' }, el('b', { text: 'Aviator' }), stA)));
    panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    const wrap = el('div', { class: 'tgk-aviator' }, panel, btn); document.body.append(wrap);
    return { element: wrap, ask, open: () => { panel.setAttribute('data-open', ''); btn.setAttribute('aria-expanded', 'true'); }, close, reads: () => readList.slice() };
  }

  root.TGAgentKit = Object.freeze({ version: '1.4.0', css: CSS, injectCss, connector, el, header, agentWork, choice, resultList, queueRow, recordHeader, interfaceTag, factRow, drawer, nowAfter, compareTable, decisionBar, sentState, roleTrace, traceLine, timeline, simulated, setupView, fromServerSetup, governanceView, aviator, SERVERS });
})(typeof window !== 'undefined' ? window : globalThis);
