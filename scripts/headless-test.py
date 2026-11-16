#!/usr/bin/env python3
"""Headless Chromium checks for the lead globe (local app only)."""
import base64, hashlib, json, os, socket, struct, subprocess, sys, time, urllib.request
from pathlib import Path

ROOT = Path("/workspace/robert-lead-globe")
SHOTS = ROOT / "screenshots"
SHOTS.mkdir(exist_ok=True)
PORT = 9223
BASE = "http://127.0.0.1:8765"
DEBUG = f"http://127.0.0.1:{PORT}"

def http_json(url, data=None, method=None):
    req = urllib.request.Request(url, data=data, method=method)
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode())

class CDP:
    def __init__(self, ws_url):
        assert ws_url.startswith("ws://")
        rest = ws_url[5:]
        hostpath, _, path = rest.partition("/")
        host, _, port = hostpath.partition(":")
        port = int(port or 80)
        path = "/" + path
        self.sock = socket.create_connection((host, port), timeout=60)
        key = base64.b64encode(os.urandom(16)).decode()
        req = (
            f"GET {path} HTTP/1.1\r\n"
            f"Host: {host}:{port}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n"
        )
        self.sock.sendall(req.encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise RuntimeError("WS handshake closed")
            buf += chunk
        if b"101" not in buf.split(b"\r\n", 1)[0]:
            raise RuntimeError("WS handshake failed: " + buf[:200].decode("latin1"))
        self.n = 0
        self.sock.settimeout(60)

    def _send(self, payload):
        data = payload.encode()
        mask = os.urandom(4)
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
        flen = len(data)
        hdr = b"\x81"
        if flen < 126:
            hdr += bytes([0x80 | flen])
        elif flen < 65536:
            hdr += bytes([0x80 | 126]) + struct.pack("!H", flen)
        else:
            hdr += bytes([0x80 | 127]) + struct.pack("!Q", flen)
        self.sock.sendall(hdr + mask + masked)

    def _recv(self):
        def recvn(n):
            buf = b""
            while len(buf) < n:
                chunk = self.sock.recv(n - len(buf))
                if not chunk:
                    raise RuntimeError("WS closed")
                buf += chunk
            return buf
        b1, b2 = recvn(2)
        opcode = b1 & 0x0F
        ln = b2 & 0x7F
        if ln == 126:
            ln = struct.unpack("!H", recvn(2))[0]
        elif ln == 127:
            ln = struct.unpack("!Q", recvn(8))[0]
        if b2 & 0x80:
            mask = recvn(4)
            data = bytes(b ^ mask[i % 4] for i, b in enumerate(recvn(ln)))
        else:
            data = recvn(ln)
        if opcode == 0x8:
            raise RuntimeError("WS close")
        if opcode == 0x1:
            return data.decode()
        if opcode == 0x2:
            return data
        return self._recv()

    def call(self, method, **params):
        self.n += 1
        mid = self.n
        self._send(json.dumps({"id": mid, "method": method, "params": params}))
        while True:
            raw = self._recv()
            msg = json.loads(raw)
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get("result") or {}

    def close(self):
        try:
            self.sock.close()
        except Exception:
            pass

def eval_js(cdp, expr):
    res = cdp.call(
        "Runtime.evaluate",
        expression=expr,
        returnByValue=True,
        awaitPromise=False,
    )
    val = (res.get("result") or {}).get("value")
    return val

def wait_js(cdp, expr, timeout=90, interval=0.5):
    end = time.time() + timeout
    last = None
    while time.time() < end:
        try:
            last = eval_js(cdp, expr)
            if last:
                return last
        except Exception as e:
            last = str(e)
        time.sleep(interval)
    raise TimeoutError(f"timeout waiting for {expr!r}; last={last!r}")

def screenshot(cdp, path):
    res = cdp.call("Page.captureScreenshot", format="png", fromSurface=True)
    Path(path).write_bytes(base64.b64decode(res["data"]))
    print("saved", path, Path(path).stat().st_size)

def open_page(cdp, url):
    cdp.call("Page.enable")
    cdp.call("Runtime.enable")
    cdp.call("Page.navigate", url=url)
    cdp.call("Page.waitForWindow") if False else None
    time.sleep(1.0)
    wait_js(cdp, "document.documentElement.dataset.globe === 'ready'", timeout=40)

def main():
    results = {"ok": [], "fail": []}
    chrome = subprocess.Popen(
        [
            "google-chrome-stable",
            "--headless=new",
            "--no-sandbox",
            "--disable-gpu",
            "--hide-scrollbars",
            "--window-size=1440,900",
            f"--remote-debugging-port={PORT}",
            "--remote-allow-origins=*",
            "--enable-unsafe-swiftshader",
            "about:blank",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        for _ in range(30):
            try:
                tabs = http_json(DEBUG + "/json/list")
                break
            except Exception:
                time.sleep(0.2)
        else:
            raise RuntimeError("Chrome debug port did not open")
        # new tab
        tab = http_json(DEBUG + "/json/new?" + urllib.request.quote(BASE + "/", safe=""), method="PUT")
        ws = tab.get("webSocketDebuggerUrl")
        if not ws:
            # older chrome
            tabs = http_json(DEBUG + "/json/list")
            tab = next(t for t in tabs if t.get("webSocketDebuggerUrl"))
            ws = tab["webSocketDebuggerUrl"]
        cdp = CDP(ws)
        try:
            # 1) overview
            open_page(cdp, BASE + "/?shot=overview")
            # Earth textures often lag the "ready" hook in headless Chrome.
            time.sleep(8)
            globe = eval_js(cdp, "document.documentElement.dataset.globe")
            has_canvas = eval_js(cdp, "!!document.querySelector('#globe canvas, canvas')")
            pins = eval_js(cdp, "document.documentElement.dataset.pins")
            print("overview", globe, "canvas", has_canvas, "pins", pins)
            if globe == "ready" and has_canvas:
                results["ok"].append("globe renders")
            else:
                results["fail"].append("globe did not report ready")
            screenshot(cdp, SHOTS / "overview.png")

            # 2) Arizona seed pins
            open_page(cdp, BASE + "/?region=US-AZ")
            wait_js(cdp, "document.documentElement.dataset.region === 'US-AZ'", timeout=30)
            # wait a moment for pins
            time.sleep(2)
            seed = int(eval_js(cdp, "document.documentElement.dataset.seedPins || '0'") or 0)
            pins = int(eval_js(cdp, "document.documentElement.dataset.pins || '0'") or 0)
            print("arizona seedPins", seed, "pins", pins)
            if seed >= 1:
                results["ok"].append(f"Arizona shows {seed} seed pins")
            else:
                results["fail"].append(f"Arizona seed pins missing (pins={pins}, seed={seed})")
            screenshot(cdp, SHOTS / "arizona-seed.png")

            # 3) Delaware Overpass
            open_page(cdp, BASE + "/?region=US-DE")
            wait_js(cdp, "document.documentElement.dataset.region === 'US-DE'", timeout=30)
            try:
                wait_js(
                    cdp,
                    "['ok','cached'].indexOf(document.documentElement.dataset.osm) >= 0 && Number(document.documentElement.dataset.osmPins||0) > 0",
                    timeout=90,
                )
                osm = int(eval_js(cdp, "document.documentElement.dataset.osmPins || '0'") or 0)
                status = eval_js(cdp, "document.documentElement.dataset.osm")
                print("delaware osm", status, osm)
                if osm >= 1:
                    results["ok"].append(f"Delaware Overpass returned {osm} OSM pins ({status})")
                else:
                    results["fail"].append(f"Delaware OSM pins=0 status={status}")
            except Exception as e:
                status = eval_js(cdp, "document.documentElement.dataset.osm")
                msg = eval_js(cdp, "document.getElementById('status') && document.getElementById('status').textContent")
                results["fail"].append(f"Delaware Overpass did not return pins ({status}: {msg}; {e})")
                print("delaware fail", status, msg)
            screenshot(cdp, SHOTS / "delaware-osm.png")

            # 3b) Kansas: area query shape + Overpass (or clear error + Retry)
            q = eval_js(cdp, "window.LeadGlobe && window.LeadGlobe.buildOverpassQuery && window.LeadGlobe.buildOverpassQuery('US-KS','auto')")
            print("kansas query shape", (q or "")[:240])
            if q and 'ISO3166-2' in q and 'US-KS' in q and q.count('nwr[') <= 8:
                results["ok"].append("Kansas Overpass query uses ISO3166-2 US-KS and is split by category")
            else:
                results["fail"].append(f"Kansas query shape unexpected: {q!r}")
            eval_js(cdp, "try{Object.keys(localStorage).forEach(k=>{if(k.indexOf('leadglobe')===0)localStorage.removeItem(k)})}catch(e){}")
            open_page(cdp, BASE + "/?region=US-KS")
            wait_js(cdp, "document.documentElement.dataset.region === 'US-KS'", timeout=30)
            try:
                wait_js(
                    cdp,
                    "['ok','cached','error'].indexOf(document.documentElement.dataset.osm) >= 0",
                    timeout=150,
                )
            except Exception as e:
                print("kansas wait", e)
            osm = int(eval_js(cdp, "document.documentElement.dataset.osmPins || '0'") or 0)
            status = eval_js(cdp, "document.documentElement.dataset.osm")
            retry = eval_js(cdp, "document.getElementById('osm-retry') && !document.getElementById('osm-retry').hidden")
            msg = eval_js(cdp, "(document.getElementById('status')||{}).textContent||''")
            print("kansas osm", status, osm, "retry", retry, msg)
            if osm >= 1:
                results["ok"].append(f"Kansas Overpass returned {osm} OSM pins ({status})")
            elif status == "error" and retry:
                results["ok"].append("Kansas shows a clear error state and Retry when Overpass is unreachable")
            else:
                results["fail"].append(f"Kansas unexpected: status={status} osm={osm} retry={retry} msg={msg}")
            screenshot(cdp, SHOTS / "kansas-osm.png")

            # 4) Outreach panel (Televerde has a published email)
            open_page(cdp, BASE + "/?shot=outreach")
            wait_js(cdp, "document.documentElement.dataset.outreach === 'ready'", timeout=40)
            time.sleep(2)
            name = eval_js(cdp, "document.documentElement.dataset.selectedLead")
            cat = eval_js(cdp, "document.documentElement.dataset.outreachCategory")
            mailto = eval_js(cdp, "document.documentElement.dataset.outreachMailto")
            body = eval_js(cdp, "(document.getElementById('outreach-body')||{}).value || ''")
            subject = eval_js(cdp, "(document.getElementById('outreach-subject')||{}).value || ''")
            note = eval_js(cdp, "(document.querySelector('.outreach-note')||{}).textContent || ''")
            href = eval_js(cdp, "(document.getElementById('outreach-mailto')||{}).getAttribute('href') || ''")
            option_count = eval_js(cdp, "document.querySelectorAll('#outreach-script option').length")
            has_first = eval_js(cdp, "((document.getElementById('outreach-body')||{}).value || '').indexOf('{first_name}') >= 0")
            has_invite = eval_js(cdp, "((document.getElementById('outreach-body')||{}).value || '').indexOf('https://robertwalker.dataearns.com/invite') >= 0")
            no_dollars = eval_js(cdp, "!/[\\$]|100K|5M|Mode/.test(((document.getElementById('outreach-body')||{}).value || '') + ((document.getElementById('outreach-subject')||{}).value || ''))")
            print("outreach", name, "cat", cat, "mailto", mailto, "options", option_count, "first_name", has_first, "invite", has_invite)
            if name and "Televerde" in str(name) and cat == "call-center" and mailto == "yes" and option_count == 5 and has_first and has_invite and no_dollars and href.startswith("mailto:") and ("info@televerde.com" in href or "info%40televerde.com" in href) and "platform review" in note:
                results["ok"].append("Outreach panel for Televerde (call-center, mailto, placeholders, invite URL, no dollar claims)")
            else:
                results["fail"].append(
                    f"Outreach panel unexpected: name={name} cat={cat} mailto={mailto} options={option_count} first={has_first} invite={has_invite} dollars_ok={no_dollars} href={href!r} note={note[:80]!r}"
                )
            # Confirm mailto is disabled when no published email (Earnhardt)
            eval_js(cdp, "window.LeadGlobe && window.LeadGlobe.selectLead && window.LeadGlobe.findLead && window.LeadGlobe.selectLead((window.LeadGlobe.findLead('Earnhardt')||{}).key, false)")
            time.sleep(0.8)
            no_mail = eval_js(cdp, "document.documentElement.dataset.outreachMailto")
            earn = eval_js(cdp, "document.documentElement.dataset.selectedLead")
            if no_mail == "no" and earn and "Earnhardt" in str(earn):
                results["ok"].append("Open in email disabled for Earnhardt (no published email)")
            else:
                results["fail"].append(f"Expected disabled mailto for Earnhardt, got mailto={no_mail} lead={earn}")
            # Restore Televerde for the screenshot (enabled mailto + scripts visible)
            eval_js(cdp, "window.LeadGlobe && window.LeadGlobe.selectLead && window.LeadGlobe.selectLead((window.LeadGlobe.findLead('Televerde')||{}).key, false)")
            time.sleep(0.8)
            eval_js(cdp, "var d=document.getElementById('detail'); if(d) d.scrollTop=0; true")
            time.sleep(0.6)
            screenshot(cdp, SHOTS / "outreach-panel.png")
        finally:
            cdp.close()
    finally:
        chrome.terminate()
        try:
            chrome.wait(timeout=5)
        except Exception:
            chrome.kill()

    print("\n=== TEST RESULTS ===")
    for x in results["ok"]:
        print("OK ", x)
    for x in results["fail"]:
        print("FAIL", x)
    (ROOT / "scripts" / "test-results.json").write_text(json.dumps(results, indent=2))
    if results["fail"]:
        sys.exit(1)

if __name__ == "__main__":
    main()
