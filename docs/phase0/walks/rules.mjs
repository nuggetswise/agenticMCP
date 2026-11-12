import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'fs';
const b = await chromium.launch({ executablePath:'/usr/bin/google-chrome', args:['--no-sandbox'] });
for (const id of ['P1','P2','P4','P5','P6','P7','P8','P9','NS','ERP']) {
  const p = await (await b.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'})).newPage();
  await p.goto(`file:///home/claude/work/src/${id}.html`); await p.waitForTimeout(1200);
  const sels=['[data-view=rules]','#b-rules','#btnRules','button:has-text("Rules")','summary:has-text("Rules")'];
  let got=''; for (const s of sels){ const el=await p.$(s); if(el && await el.isVisible()){ try{await el.click({timeout:2000}); await p.waitForTimeout(800); got=s; break;}catch(e){} } }
  const t = await p.evaluate(()=>document.body.innerText);
  fs.writeFileSync(`/home/claude/work/texts/${id}/zz_rules.txt`, `ACTION: rules view ${got}\n\n`+t); console.log(id, got||'no rules view');
}
await b.close();
