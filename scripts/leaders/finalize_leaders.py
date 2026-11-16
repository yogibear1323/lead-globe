import json,re,datetime
import os
prev=json.load(open('leaders.json')) if os.path.exists('leaders.json') else {"leaders":{}}
prevAt={k:v['checkedAt'] for k,v in prev['leaders'].items()}
raw=[]
for f in ['raw.json','raw2.json']:
    if os.path.exists(f): raw+=json.load(open(f))
DROP_IDS={"seed:states-logistics","seed:merestone","osm:node/13368287968","osm:node/13611023439",
 # round 2 review: portal/CTA text, testimonials, franchise-network owners of other locations, parent-company page on another domain
 "osm:node/11035799003","osm:way/231405686","osm:node/14373646741","osm:way/426036508","osm:node/7299447717",
 "osm:way/873090088","osm:node/11919478628","osm:node/11268790251","osm:node/8715315810","osm:way/1503465662"}
BADNAMES={"About Tim Hovik":"Tim Hovik","Site Search":None,"Passing The Torch":None,"Your Phoenix":None,"Customer Service":None,
 "Chief Amazing Officer":None,"Chief Financial Officer":None,"Murder Mystery Dinner":None,"Dolly Parton":None}
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
        t=re.sub(r'^[–\-]\s*','',t)
        t=re.sub(r'\s*\(Selling cars.*\)$','',t)
        t=t.replace(' - Your Plumber','').replace(', Legacy Heating & Cooling','').replace(' American Concrete Repair LLC','').replace('Genesis General Manager','General Manager')
        if t.isupper() and len(t)>4: t=t.title().replace('Ceo','CEO')
        ppl.append({"name":n,"title":t})
    if r['id']=="seed:p-b-bell": ppl=[{"name":"Justin Steltenpohl","title":"CEO"}]
    if ppl: out[r['id']]={"name":r['name'],"region":r['region'],"people":ppl[:8],"source":r['source'],"checkedAt":prevAt.get(r['id'],now)}
doc={"note":"Names and titles published by each company on its own website (team, leadership, or about page). Checked once per site with a few polite requests; robots.txt respected. No personal emails or direct phone numbers collected. US and Canada best-fit leads only.",
 "generatedAt":now,"checked":len(raw),"withLeaders":len(out),"leaders":out}
json.dump(doc,open('leaders.json','w'),indent=1,ensure_ascii=False)
print(len(raw),len(out)); print(sum(1 for r in raw if r['err']),"errors")
for k,v in out.items(): print(k,v['people'])
