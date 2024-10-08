import json
import requests
from typing import List, Dict, Any
from .base_provider import BaseLLMProvider


class OllamaProvider(BaseLLMProvider):
    def __init__(self, config: Dict[str, Any]):
        self.api_base_url = config.get("api_base_url", "http://localhost:11434/api")
        self.model = config.get("model", "gemma")
        self.max_retries = config.get("max_retries", 3)
        self.timeout = config.get("timeout", 60)

    def generate(self, prompt: str) -> str:
        url = f"{self.api_base_url}/generate"
        payload = json.dumps({"model": self.model, "prompt": prompt, "stream": False})
        headers = {"Content-Type": "application/json"}
        response = requests.post(
            url, headers=headers, data=payload, timeout=self.timeout
        )
        response.raise_for_status()
        return response.json()["response"]

    def get_embedding(self, text: str) -> List[float]:
        url = f"{self.api_base_url}/embeddings"
        payload = json.dumps({"model": self.model, "prompt": text})
        headers = {"Content-Type": "application/json"}
        response = requests.post(
            url, headers=headers, data=payload, timeout=self.timeout
        )
        response.raise_for_status()
        return response.json()["embedding"]
