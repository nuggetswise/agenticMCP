import os,re,glob,collections,sys
NUM=re.compile(r'\$[\d,]+(?:\.\d+)?|\b\d+(?:\.\d+)?%|\b\d{1,3}(?:,\d{3})+\b|\b\d{2,}\b(?! ?(?:min|h|am|pm))')
SR=re.compile(r'^(Route between|Ashby Supplier ERP connects|Shelf Agent runs inside|.*\bto Trading Grid by\b)')
for d in sorted(glob.glob('*')):
  if not os.path.isdir(d): continue
  worst={}
  frames=sorted(glob.glob(d+'/*.txt'))
  for f in frames:
    lines=[l for l in open(f).read().split('\n')[2:] if l.strip() and not SR.match(l.strip())]
    c=collections.Counter(m for l in lines for m in NUM.findall(l))
    for k,v in c.items():
      if v>=3 and v>worst.get(k,(0,''))[0]: worst[k]=(v,os.path.basename(f))
  top=sorted(worst.items(),key=lambda x:-x[1][0])[:8]
  print(f"{d} [{len(frames)} frames]: "+'; '.join(f"{k}×{v[0]}@{v[1][:2]}" for k,v in top))
