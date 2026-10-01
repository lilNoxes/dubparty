import re

with open('backend/app/api/media.py', 'r', encoding='utf-8') as f:
    content = f.read()

patch = """
from pydantic import BaseModel

class ManifestUpdateData(BaseModel):
    manifest_filename: str
    manifest_data: dict

@router.post("/manifests/update")
def update_manifest(data: ManifestUpdateData):
    file_path = os.path.join(MOVIES_DIR, data.manifest_filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Manifest not found")
        
    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(data.manifest_data, f, indent=2, ensure_ascii=False)
        
    return {"status": "success", "message": "Manifest updated successfully"}
"""

if "update_manifest" not in content:
    content += "\n" + patch
    with open('backend/app/api/media.py', 'w', encoding='utf-8') as f:
        f.write(content)
