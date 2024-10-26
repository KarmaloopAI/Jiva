import json
import aiohttp
from typing import List, Dict, Any
from .base_provider import BaseLLMProvider

class OllamaProvider(BaseLLMProvider):
    def __init__(self, config: Dict[str, Any]):
        self.api_base_url = config.get('api_base_url', 'http://localhost:11434/api')
        self.model = config.get('model', 'gemma')
        self.max_retries = config.get('max_retries', 3)
        self.timeout = config.get('timeout', 60)

    async def generate(self, prompt: str) -> str:
        url = f"{self.api_base_url}/generate"
        payload = json.dumps({
            "model": self.model,
            "prompt": prompt,
            "stream": False
        })
        headers = {'Content-Type': 'application/json'}
        async with aiohttp.ClientSession() as session:
            async with session.post(url, headers=headers, data=payload, timeout=self.timeout) as response:
                response.raise_for_status()
                result = await response.json()
                return result['response']

    async def get_embedding(self, text: str) -> List[float]:
        url = f"{self.api_base_url}/embeddings"
        payload = json.dumps({
            "model": self.model,
            "prompt": text
        })
        headers = {'Content-Type': 'application/json'}
        async with aiohttp.ClientSession() as session:
            async with session.post(url, headers=headers, data=payload, timeout=self.timeout) as response:
                response.raise_for_status()
                result = await response.json()
                return result['embedding']
