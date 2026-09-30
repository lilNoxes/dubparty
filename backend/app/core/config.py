import os
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    USE_GEMINI: bool = False
    GEMINI_API_KEY: str = ""
    HF_AUTH_TOKEN: str = "" # Required for PyAnnote Diarization
    HOST_IP: str = "0.0.0.0"
    PORT: int = 8000
    CUDA_DEVICE: str = "cuda"
    COMPUTE_TYPE: str = "float16" # Use float16 for RTX 3060 to save VRAM

    class Config:
        env_file = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), ".env")

settings = Settings()
