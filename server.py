"""Rosto Cam V1 - servidor de sinalização WebRTC (1 emissor, N espectadores).
O vídeo NÃO passa por aqui: vai direto de navegador para navegador."""
import json
import os
from pathlib import Path
from uuid import uuid4

from aiohttp import web, WSMsgType

BASE = Path(__file__).parent
HOST = os.environ.get("HOST", "0.0.0.0" if os.environ.get("RENDER") else "127.0.0.1")
PORT = int(os.environ.get("PORT", "8080"))
SENHA = os.environ.get("SENHA", "")          # opcional; vazio = sem senha


def ice_servers():
    servers = [{"urls": "stun:stun.l.google.com:19302"}]
    turn = os.environ.get("TURN_URL")
    if turn:
        servers.append({
            "urls": turn,
            "username": os.environ.get("TURN_USER", ""),
            "credential": os.environ.get("TURN_PASS", ""),
        })
    return servers


class Hub:
    def __init__(self):
        self.pusher = None
        self.viewers = {}


hub = Hub()


async def safe_send(ws, data):
    try:
        await ws.send_json(data)
    except Exception:
        pass


async def ws_handler(request):
    role = request.query.get("role")
    if SENHA and request.query.get("key") != SENHA:
        return web.Response(status=403, text="Senha incorreta")
    if role not in ("push", "view"):
        return web.Response(status=400, text="role inválido")

    ws = web.WebSocketResponse(heartbeat=20)
    await ws.prepare(request)
    vid = None

    if role == "push":
        old, hub.pusher = hub.pusher, ws
        if old is not None and not old.closed:
            await old.close()
        for v in list(hub.viewers):
            await safe_send(ws, {"type": "viewer-joined", "id": v})
    else:
        vid = uuid4().hex[:8]
        hub.viewers[vid] = ws
        if hub.pusher is not None:
            await safe_send(hub.pusher, {"type": "viewer-joined", "id": vid})

    try:
        async for msg in ws:
            if msg.type != WSMsgType.TEXT:
                continue
            try:
                data = json.loads(msg.data)
            except ValueError:
                continue
            if role == "push":
                if data.get("type") == "state":
                    for v in list(hub.viewers.values()):
                        await safe_send(v, data)
                else:
                    target = hub.viewers.get(data.get("to"))
                    if target is not None:
                        await safe_send(target, data)
            elif hub.pusher is not None:
                data["from"] = vid
                await safe_send(hub.pusher, data)
    finally:
        if role == "push" and hub.pusher is ws:
            hub.pusher = None
            for v in list(hub.viewers.values()):
                await safe_send(v, {"type": "push-left"})
        elif role == "view":
            hub.viewers.pop(vid, None)
            if hub.pusher is not None:
                await safe_send(hub.pusher, {"type": "viewer-left", "id": vid})
    return ws


def page(name):
    async def handler(request):
        return web.FileResponse(BASE / name, headers={"Cache-Control": "no-store"})
    return handler


async def config(request):
    return web.json_response({"iceServers": ice_servers()})


def main():
    if os.environ.get("RENDER") and not SENHA:
        raise SystemExit("Defina a variavel SENHA no Render antes de iniciar.")
    app = web.Application()
    app.add_routes([
        web.get("/", page("push.html")),
        web.get("/view", page("view.html")),
        web.get("/config", config),
        web.get("/ws", ws_handler),
        web.get("/push.js", page("push.js")),
        web.get("/view.js", page("view.js")),
    ])
    print(f"Emissor:  http://localhost:{PORT}/")
    print(f"Visualizar (Prism): http://localhost:{PORT}/view")
    web.run_app(app, host=HOST, port=PORT, print=None)


if __name__ == "__main__":
    main()
