import os
import sys
import uvicorn

# Ensure backend directory is in sys.path
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.join(BASE_DIR, "backend")
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from backend.app.main import app

if __name__ == "__main__":
    # Infrlo PaaS Nginx Ingress routes traffic to port 3000 by default
    port = int(os.environ.get("PORT", 3000))
    host = os.environ.get("HOST", "0.0.0.0")
    
    print("=" * 60)
    print(f"🚀 Starting DubParty on http://{host}:{port}")
    print(f"📡 Environment PORT: {os.environ.get('PORT', 'not set (using default 3000)')}")
    print("=" * 60)
    
    uvicorn.run(app, host=host, port=port, log_level="info", access_log=True)
