import os
import sys
import threading
import time
import uvicorn

# Ensure backend directory is in sys.path
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.join(BASE_DIR, "backend")
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from backend.app.main import app

def run_server(host: str, port: int):
    try:
        print(f"🚀 [DubParty] Starting listener on http://{host}:{port}")
        uvicorn.run(app, host=host, port=port, log_level="warning", access_log=False)
    except Exception as e:
        print(f"⚠️ [DubParty] Port {port} notice: {e}")

if __name__ == "__main__":
    host = os.environ.get("HOST", "0.0.0.0")
    
    # Mirroring lilNoxes/news-portal candidate ports for Infrlo PaaS Nginx Ingress
    candidate_ports = []
    env_port = os.environ.get("PORT")
    if env_port:
        try:
            candidate_ports.append(int(env_port))
        except ValueError:
            pass
            
    for p in [3000, 8000, 8080, 5000, 3001]:
        if p not in candidate_ports:
            candidate_ports.append(p)

    print("=" * 60)
    print(f"🎉 DubParty launching multi-port listeners: {candidate_ports}")
    print(f"📡 Environment PORT: {os.environ.get('PORT', 'undefined')}")
    print("=" * 60)

    # Launch all ports concurrently so whatever port Infrlo forwards to will respond!
    main_port = candidate_ports[0]
    other_ports = candidate_ports[1:]

    for p in other_ports:
        t = threading.Thread(target=run_server, args=(host, p), daemon=True)
        t.start()

    time.sleep(0.5)
    run_server(host, main_port)
