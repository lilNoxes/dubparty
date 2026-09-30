import os
import sys
import asyncio
import socket
import uvicorn

# Ensure backend directory is in sys.path
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.join(BASE_DIR, "backend")
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from backend.app.main import app

def is_port_available(host: str, port: int) -> bool:
    """Checks if a port is available for binding."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            s.bind((host, port))
            return True
    except Exception:
        return False

async def main():
    host = os.environ.get("HOST", "0.0.0.0")
    
    # Infrlo PaaS candidate ports (Infrlo defaults to 3000 if PORT is unset)
    candidate_ports = []
    
    env_port = os.environ.get("PORT")
    if env_port:
        try:
            candidate_ports.append(int(env_port))
        except ValueError:
            pass
            
    # List of ports expected by cloud proxies (Infrlo uses 3000 by default)
    for p in [3000, 8000, 8080, 5000]:
        if p not in candidate_ports:
            candidate_ports.append(p)

    active_servers = []
    for port in candidate_ports:
        if is_port_available(host, port):
            config = uvicorn.Config(
                app=app, 
                host=host, 
                port=port, 
                log_level="info",
                access_log=False
            )
            server = uvicorn.Server(config)
            active_servers.append(server)
            print(f"🚀 [MultiPort] DubParty bound to http://{host}:{port}")

    if not active_servers:
        # Fallback to standard 3000
        print("⚠️ No candidate ports available via check, starting standard on 3000...")
        config = uvicorn.Config(app=app, host=host, port=3000, log_level="info")
        active_servers.append(uvicorn.Server(config))

    print(f"🎉 DubParty is serving on {len(active_servers)} port(s) simultaneously!")
    await asyncio.gather(*(s.serve() for s in active_servers))

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, SystemExit):
        print("Stopping DubParty...")
