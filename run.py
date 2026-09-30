import os
import sys
import uvicorn

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    host = os.environ.get("HOST", "0.0.0.0")
    print(f"🚀 Starting DubParty on http://{host}:{port}")
    uvicorn.run("backend.app.main:app", host=host, port=port, reload=False)
