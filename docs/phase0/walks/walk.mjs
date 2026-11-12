import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'fs';
const [,, name, policy='primary', maxSteps='80', pre=''] = process.argv;
const file = `/home/claude/work/src/${name}.html`;
const out = `/home/claude/work/walk/out/${name}-${policy}${pre?'-'+pre:''}`; fs.mkdirSync(out,{recursive:true});
const b = await chromium.launch({ executablePath:'/usr/bin/google-chrome', args:['--no-sandbox'] });
const ctx = await b.newContext({ viewport:{width:1440,height:1000}, reducedMotion:'reduce' });
const p = await ctx.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(String(e).slice(0,200)));
await p.goto('file://'+file); await p.waitForTimeout(1200);
const EXCL=/^(History|Rules|Records|Agents|Work|Start over|Start again|Reset|Close|Show|Hide|Pause|Resume|Not now|Reset to defaults|Email \(PDF\)|EDI|‹.*|\d+ notices?|\d+ events?)$/;
let waited=0; const counts={}; const log=[]; const seen={};
if(pre){ for(const sel of pre.split(',')){ if(sel.startsWith('wait:')){await p.waitForTimeout(+sel.slice(5));continue;} if(sel.startsWith('text:')){try{await p.getByText(sel.slice(5),{exact:false}).first().click({timeout:5000});}catch(e){log.push({pre:sel,err:String(e).slice(0,80)})} await p.waitForTimeout(700); continue;} try{ await p.click(sel,{timeout:2000}); await p.waitForTimeout(700);}catch(e){log.push({pre:sel,err:String(e).slice(0,80)})} } }
async function frame(i,act){
  const text = await p.evaluate(()=>document.body.innerText);
  fs.writeFileSync(`${out}/${String(i).padStart(2,'0')}.txt`, `ACTION: ${act}\n\n`+text);
  await p.screenshot({path:`${out}/${String(i).padStart(2,'0')}.png`, fullPage:false});
  return text;
}
let t0=await frame(0,'load');
for(let i=1;i<=+maxSteps;i++){
  const filled = await p.evaluate((pol)=>{ let n=0; document.querySelectorAll('select').forEach(sel=>{ if(sel.offsetParent===null||sel.disabled||sel.value) return; const opts=[...sel.options].filter(o=>o.value); if(!opts.length) return; sel.value=(pol==='secondary'?opts[opts.length-1]:opts[0]).value; sel.dispatchEvent(new Event('input',{bubbles:true})); sel.dispatchEvent(new Event('change',{bubbles:true})); n++; });
    document.querySelectorAll('textarea,input[type=text]').forEach(t=>{ if(t.offsetParent===null||t.disabled||t.readOnly||t.value) return; t.value='Walk test note'; t.dispatchEvent(new Event('input',{bubbles:true})); t.dispatchEvent(new Event('change',{bubbles:true})); n++; }); return n; }, policy);
  if(filled){ log.push({i,filled}); await p.waitForTimeout(600); }
  const cands = await p.evaluate(()=>{ const all=[...document.querySelectorAll('button,[role=button],label,[role=radio],[role=option],a[href^="#"],div,span,li,tr,td')];
    const out=[]; all.forEach((b,ix)=>{ const tag=b.tagName; const isBtn=tag==='BUTTON'||b.getAttribute('role')==='button';
      if(!isBtn){ if(getComputedStyle(b).cursor!=='pointer') return; if(b.querySelector('button,label,[role=button]')) return; if(b.closest('button,label')!==b && b.closest('button,label')) return; }
      const r=b.getBoundingClientRect(); const vis=b.offsetParent!==null&&r.width>0&&r.height>0;
      const inHdr=!!b.closest('header,.top,.band,.app,nav,.drawer,[role=dialog],.tabs,[role=tablist],.fmt,.map,.route,svg');
      if(!vis||inHdr||b.disabled||b.classList.contains('sw')||b.id==='agentSw'||b.closest('summary')) return;
      b.setAttribute('data-wk',String(ix));
      out.push({ix,t:(b.innerText||b.getAttribute('aria-label')||'').trim().replace(/\s+/g,' ').slice(0,70),c:String(b.className||''),
        ds:Object.entries(b.dataset).filter(([k])=>k!=='wk').map(([k,v])=>k+'='+v).join(',')}); });
    return out; });
  let c = cands.filter(x=>x.t && !EXCL.test(x.t) && !/^(tab|sel|exp|view|fmt|fmtv|theme|mtext|peek|step|f|s)=/.test(x.ds) && !/\b(val|lnk|tab|crumb|tbtn|fchip)\b/.test(x.c));
  if(!c.length && process.env.SWITCH && !globalThis.sw && waited>3){ globalThis.sw=1; await p.click(process.env.SWITCH); await p.waitForTimeout(1500); log.push({i,switch:process.env.SWITCH}); i--; continue; }
  if(!c.length){ waited=(typeof waited==='number'?waited:0)+1; if(waited>60){ log.push({i,stop:'no actions'}); break; } await p.waitForTimeout(1500); i--; continue; }
  waited=0;
  const pri = x=>/\b(pri|primary)\b/.test(x.c)||/^btn$/.test(x.c.trim())?0:1;
  const key = x=>x.t+'|'+x.ds;
  c.sort((a,b2)=>{const ca=counts[key(a)]||0, cb=counts[key(b2)]||0; if(ca!==cb) return ca-cb;
     if(policy==='primary') return pri(a)-pri(b2); if(policy==='secondary') return pri(b2)-pri(a); if(policy==='last') return b2.ix-a.ix; return 0;});
  const pick=c[0]; counts[key(pick)]=(counts[key(pick)]||0)+1;
  if(counts[key(pick)]>6){ log.push({i,stop:'loop on '+pick.t}); break; }
  try{ await p.click(`[data-wk="${pick.ix}"]`,{timeout:3000}); }catch(e){ log.push({i,err:String(e).slice(0,100),pick:pick.t}); break; }
  await p.waitForTimeout(1500);
  // wait while busy
  for(let k=0;k<10;k++){ const busy=await p.evaluate(()=>!![...document.querySelectorAll('button')].find(b=>b.offsetParent&&b.disabled&&/pri|primary|btn/.test(b.className))); if(!busy)break; await p.waitForTimeout(600);}
  const txt=await frame(i,pick.t+' ['+pick.ds+']');
  log.push({i,click:pick.t,ds:pick.ds,options:c.map(x=>x.t).slice(0,8)});
  const h=txt.length+':'+txt.slice(-300); seen[h]=(seen[h]||0)+1; if(seen[h]>10){log.push({i,stop:'state repeats'});break;}
}
fs.writeFileSync(`${out}/log.json`, JSON.stringify({errs,log},null,1));
console.log(name,policy,pre,'steps',log.filter(x=>x.click).length,'errors',errs.length, JSON.stringify(log.slice(-2)));
await b.close();
