#!/usr/bin/env python3
"""
Hermes Browser Bridge Client API
Gunakan modul ini untuk mengontrol browser Kiwi/Chrome asli pengguna.
"""

import urllib.request
import json

CONTROLLER_URL = "http://127.0.0.1:8766/command"

def send_command(action, params=None):
    payload = json.dumps({"action": action, "params": params or {}}).encode("utf-8")
    req = urllib.request.Request(
        CONTROLLER_URL,
        data=payload,
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        res = json.loads(resp.read().decode("utf-8"))
        if not res.get("success"):
            raise RuntimeError(res.get("error", "Unknown bridge error"))
        return res.get("data")

def get_active_tab():
    return send_command("get_active_tab")

def navigate(url):
    return send_command("navigate", {"url": url})

def execute_script(code):
    return send_command("execute_script", {"code": code})

def get_cookies(domain=None, name=None):
    params = {}
    if domain: params["domain"] = domain
    if name: params["name"] = name
    return send_command("get_cookies", params)

def get_page_content():
    return send_command("get_page_content")

if __name__ == "__main__":
    import sys
    cmd = sys.argv[1] if len(sys.argv) > 1 else "tab"
    if cmd == "tab":
        print(get_active_tab())
    elif cmd == "cookies":
        domain = sys.argv[2] if len(sys.argv) > 2 else None
        print(get_cookies(domain))
    elif cmd == "nav":
        url = sys.argv[2]
        print(navigate(url))
    elif cmd == "eval":
        code = " ".join(sys.argv[2:])
        print(execute_script(code))
    elif cmd == "content":
        print(get_page_content())
