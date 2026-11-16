// Renders the approved board locally with a minimal stand-in for the canvas runtime (sc-for, sc-if, {{bindings}}).
import { readFileSync } from 'node:fs';
const { chromium } = (await import('/opt/npm-tools/node_modules/playwright/index.js')).default;
const tpl = readFileSync('AgentLive.dc.html', 'utf8'); const logic = readFileSync('logic.js', 'utf8'); const tok = readFileSync('tokens.css', 'utf8');
const shim = `
class DCLogic{constructor(p){this.props=p}setState(o){Object.assign(this.state,o);render()}}
${logic}
const T=document.getElementById('tpl').content; const root=document.getElementById('root'); const c=new Component({});
function get(sc,expr){return expr.trim().split('.').reduce((o,k)=>o==null?o:o[k],sc)}
function interp(s,sc){const m=s.match(/^\\{\\{([^}]+)\\}\\}$/);if(m)return get(sc,m[1]);return s.replace(/\\{\\{([^}]+)\\}\\}/g,(_,e)=>{const v=get(sc,e);return v==null?'':v})}
function build(node,sc,out){
 if(node.nodeType===3){out.appendChild(document.createTextNode(interp(node.nodeValue,sc)));return}
 if(node.nodeType!==1)return;
 const tag=node.tagName.toLowerCase();
 if(tag==='helmet'){return}
 if(tag==='sc-for'){const list=interp(node.getAttribute('list'),sc)||[];const as=node.getAttribute('as');list.forEach(it=>{const s2=Object.assign(Object.create(sc),{[as]:it});node.childNodes.forEach(ch=>build(ch,s2,out))});return}
 if(tag==='sc-if'){if(interp(node.getAttribute('value'),sc))node.childNodes.forEach(ch=>build(ch,sc,out));return}
 const el=document.createElement(tag);
 for(const a of node.attributes){const v=interp(a.value,sc);if(a.name==='onclick'){if(typeof v==='function')el.addEventListener('click',v)}else if(a.name==='defaultvalue'){el.value=v}else el.setAttribute(a.name,v)}
 node.childNodes.forEach(ch=>build(ch,sc,el));out.appendChild(el)}
function render(){const v=c.renderVals();root.textContent='';T.querySelector('x-dc').childNodes.forEach(n=>build(n,v,root))}
render();c.componentDidMount();`;
const helmet = tpl.match(/<helmet>([\s\S]*?)<\/helmet>/)[1];
const html = `<!doctype html><html><head><meta charset="utf-8"><style>${tok}</style>${helmet}</head><body><template id="tpl">${tpl}</template><div id="root"></div><script>${shim}</script></body></html>`;
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const out = process.argv[2] || '.';
const p = await b.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' });
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.setContent(html); await p.waitForTimeout(400);
await p.screenshot({ path: `${out}/board-1-proposal.png`, fullPage: true });
await p.click('button:has-text("Approve")'); await p.waitForTimeout(3800);
await p.screenshot({ path: `${out}/board-2-replan.png`, fullPage: true });
await p.click('button:has-text("Approve")'); await p.waitForTimeout(1900);
await p.screenshot({ path: `${out}/board-3-result.png`, fullPage: true });
const p2 = await b.newPage({ viewport: { width: 1440, height: 1100 } }); await p2.setContent(html); await p2.waitForTimeout(3300);
await p2.screenshot({ path: `${out}/board-0-checking.png`, fullPage: true });
console.log('errors', errs);
await b.close();
