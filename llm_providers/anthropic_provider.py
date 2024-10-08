from typing import List, Dict, Any
import json
import requests
from anthropic import Anthropic
from .base_provider import BaseLLMProvider


class AnthropicProvider(BaseLLMProvider):
    def __init__(self, config: Dict[str, Any]):
        self.anthropic_api_key = config.get("anthropic_api_key")
        self.anthropic_model = config.get("anthropic_model", "claude-3-opus-20240229")
        self.anthropic_client = Anthropic(api_key=self.anthropic_api_key)

        # Ollama configuration for embeddings
        self.ollama_api_base_url = config.get(
            "ollama_api_base_url", "http://localhost:11434/api"
        )
        self.ollama_embedding_model = config.get(
            "ollama_embedding_model", "nomic-embed-text"
        )
        self.ollama_timeout = config.get("ollama_timeout", 30)

    def generate(self, prompt: str) -> str:
        try:
            message = self.anthropic_client.messages.create(
                model=self.anthropic_model,
                max_tokens=1024,
                messages=[
                    {
                        "role": "user",
                        "content": prompt,
                    }
                ],
            )
            return message.content
        except Exception as e:
            raise Exception(f"Error generating response from Anthropic: {str(e)}")

    def get_embedding(self, text: str) -> List[float]:
        url = f"{self.ollama_api_base_url}/embeddings"
        payload = json.dumps({"model": self.ollama_embedding_model, "prompt": text})
        headers = {"Content-Type": "application/json"}

        try:
            response = requests.post(
                url, headers=headers, data=payload, timeout=self.ollama_timeout
            )
            response.raise_for_status()
            result = response.json()
            return result["embedding"]
        except requests.RequestException as e:
            raise Exception(f"Error getting embedding from Ollama: {str(e)}")
