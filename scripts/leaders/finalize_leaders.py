import json,re,datetime
raw=json.load(open('raw.json'))
DROP_IDS={"seed:states-logistics","seed:merestone","osm:node/13368287968","osm:node/13611023439"}
BADNAMES={"About Tim Hovik":"Tim Hovik","Site Search":None,"Passing The Torch":None,"Your Phoenix":None,"Customer Service":None,
 "Chief Amazing Officer":None,"Chief Financial Officer":None,"Murder Mystery Dinner":None}
TITLEFIX={("Justin Steltenpohl",):"CEO"}
now=datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
out={}
for r in raw:
    if not r['people'] or r['id'] in DROP_IDS: continue
    ppl=[]
    for p in r['people']:
        n,t=p['name'],p['title']
        if n in BADNAMES:
            n=BADNAMES[n]
            if not n: continue
        if re.search(r'Administrator',t): continue
        t=re.sub(r'\s*\|\s*Crown Town Restoration, Inc\.','',t)
        t=t.replace(' of ARAC Roof it Forward','').replace(', All Claims Repairs','').replace(' - Bothwell Transport, Inc.','')
        if n=="Tim Hovik": t="Owner"
        if t.isupper() and len(t)>4: t=t.title().replace('Ceo','CEO')
        ppl.append({"name":n,"title":t})
    if r['id']=="seed:p-b-bell": ppl=[{"name":"Justin Steltenpohl","title":"CEO"}]
    if ppl: out[r['id']]={"name":r['name'],"region":r['region'],"people":ppl[:8],"source":r['source'],"checkedAt":now}
doc={"note":"Names and titles published by each company on its own website (team, leadership, or about page). Checked once per site with a few polite requests; robots.txt respected. No personal emails or direct phone numbers collected. US and Canada best-fit leads only.",
 "generatedAt":now,"checked":len(raw),"withLeaders":len(out),"leaders":out}
json.dump(doc,open('leaders.json','w'),indent=1,ensure_ascii=False)
print(len(raw),len(out)); print(sum(1 for r in raw if r['err']),"errors")
for k,v in out.items(): print(k,v['people'])
