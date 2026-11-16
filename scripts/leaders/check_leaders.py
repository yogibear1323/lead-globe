import json,glob,re,time,sys,urllib.parse as up,urllib.robotparser as rp
from concurrent.futures import ThreadPoolExecutor
import requests
from bs4 import BeautifulSoup
UA="LeadGlobeLeadershipCheck/1.0 (+https://yogibear1323.github.io/lead-globe/; one-time check of published leadership pages, max 3 requests per site)"
H={"User-Agent":UA,"Accept":"text/html"}
def slug(s): return re.sub(r'[^a-z0-9]+','-',s.lower()).strip('-')
import os
SKIP=set(filter(None,os.environ.get('SKIP_REGIONS','').split(',')))  # regions already checked
OUTFILE=os.environ.get('OUT','raw.json')
cands=[]
for l in ([] if os.environ.get('NO_SEEDS') else json.load(open('seeds.json'))):
    cands.append({"id":"seed:"+slug(l['name']),"name":l['name'],"website":l['website'],"region":"US-AZ"})
for f in sorted(glob.glob('/tmp/lg/data/regions/*.json')):
    rid=f.split('/')[-1][:-5]
    if not (rid.startswith('US-') or rid.startswith('CA-')) or rid in SKIP: continue
    d=json.load(open(f)); ls=[l for l in d.get('leads',[]) if l.get('website')]
    ls.sort(key=lambda l:-(l.get('fit') or 0))
    for l in ls[:10]:
        cands.append({"id":"osm:"+l['osmId'],"name":l['name'],"website":l['website'],"region":rid})
KW=re.compile(r'leadership|our[- ]team|meet[- ]the[- ]team|\bteam\b|management|executive|about[- ]us|\babout\b|who[- ]we[- ]are|our[- ]people|staff|owners?',re.I)
def score(t):
    t=t.lower()
    for i,k in enumerate(['leadership','executive','management','meet the team','our team','team','our people','staff','owner','who we are','about us','about']):
        if k in t: return i
    return 99
TITLE=re.compile(r"\b(CEO|C\.E\.O\.|CFO|COO|CTO|CMO|CIO|Chief [A-Z][a-z]+ Officer|President|Vice President|VP\b|Owner|Co-Owner|Founder|Co-Founder|General Manager|Managing Partner|Managing Director|Principal|Chairman|Executive Director|Dealer Principal|Partner|Director of [A-Z][a-z]+|Medical Director|Administrator)\b")
NAME=re.compile(r"^(?:Dr\.\s)?[A-Z][a-z'’\-]+(?:\s[A-Z]\.)?(?:\s[A-Z][a-z'’\-]+){1,2}(?:,?\s(?:Jr\.|Sr\.|III|II|MD|M\.D\.|DDS|DMD|CPA|PE|PhD|Esq\.))?$")
BAD=set("The Our About Contact Home Team Meet Leadership Services Phoenix Arizona Read More Learn Call Us Company Management Group Inc LLC View Bio Click Here Privacy Policy Terms".split())
def pairs(html):
    soup=BeautifulSoup(html,'html.parser')
    for t in soup(['script','style','noscript','nav','footer','header']): t.decompose()
    lines=[re.sub(r'\s+',' ',x).strip() for x in soup.get_text('\n').split('\n')]
    lines=[x for x in lines if x]
    out=[]
    for i,x in enumerate(lines):
        # "Name, Title" / "Name - Title" in one line
        m=re.match(r"^([A-Z][\w'’.\- ]{3,40}?)\s*[,|–—\-]\s*(.{2,80})$",x)
        if m and NAME.match(m.group(1).strip()) and TITLE.search(m.group(2)) and len(m.group(2))<80:
            out.append((m.group(1).strip(),m.group(2).strip()));continue
        if NAME.match(x) and not (set(x.split())&BAD) and i+1<len(lines):
            nx=lines[i+1]
            if len(nx)<70 and TITLE.search(nx): out.append((x,nx))
    seen=set();res=[]
    for n,t in out:
        if n in seen: continue
        seen.add(n);res.append({"name":n,"title":t})
    return res[:12]
def get(s,url):
    r=s.get(url,headers=H,timeout=15,allow_redirects=True)
    if 'html' not in r.headers.get('content-type',''): return r.url,""
    return r.url,r.text[:2_000_000]
def check(c):
    rec={"id":c["id"],"name":c["name"],"website":c["website"],"region":c["region"],"people":[],"source":None,"pages":[],"err":None}
    try:
        s=requests.Session()
        u=c["website"]; p=up.urlparse(u); base=f"{p.scheme}://{p.netloc}"
        robots=rp.RobotFileParser()
        try:
            rr=s.get(base+"/robots.txt",headers=H,timeout=10)
            robots.parse(rr.text.splitlines() if rr.status_code==200 else [])
        except Exception: robots.parse([])
        root=base+"/"
        if not robots.can_fetch(UA,root): rec["err"]="robots disallow";return rec
        time.sleep(1)
        fu,html=get(s,root); rec["pages"].append(fu)
        found=pairs(html)
        if found and TITLE.search(" ".join(x['title'] for x in found)): rec["people"]=found;rec["source"]=fu
        soup=BeautifulSoup(html,'html.parser'); host=up.urlparse(fu).netloc
        links=[]
        for a in soup.find_all('a',href=True):
            t=(a.get_text(' ',strip=True)+' '+a['href'])
            if KW.search(t):
                h=up.urljoin(fu,a['href']).split('#')[0]
                if up.urlparse(h).netloc.replace('www.','')==host.replace('www.','') and h.rstrip('/')!=fu.rstrip('/'):
                    links.append((score(t),h))
        links=sorted(set(links))
        for _,h in links[:2]:
            if not robots.can_fetch(UA,h): continue
            time.sleep(1.5)
            try:
                pu,ph=get(s,h); rec["pages"].append(pu)
                f2=pairs(ph)
                if len(f2)>len(rec["people"]): rec["people"]=f2;rec["source"]=pu
                if f2 and score(h)<=5: break
            except Exception as e: rec["err"]=str(e)[:100]
    except Exception as e: rec["err"]=str(e)[:100]
    return rec
if __name__=="__main__":
    print(len(cands),file=sys.stderr)
    with ThreadPoolExecutor(12) as ex: res=list(ex.map(check,cands))
    json.dump(res,open(OUTFILE,'w'),indent=1)
    print(sum(1 for r in res if r['people']),"with people",file=sys.stderr)
