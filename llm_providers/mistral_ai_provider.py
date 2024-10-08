from typing import List, Dict, Any
from mistralai import Mistral
from .base_provider import BaseLLMProvider


class MistralAIProvider(BaseLLMProvider):
    def __init__(self, config: Dict[str, Any]):
        self.api_key = config.get("api_key")
        self.model = config.get("model", "mistral-small-latest")
        self.client = Mistral(api_key=self.api_key)

    def generate(self, prompt: str) -> str:
        try:
            response = self.client.chat.complete(
                model=self.model,
                messages=[
                    {
                        "role": "user",
                        "content": prompt,
                    }
                ],
            )
            return response.choices[0].message.content
        except Exception as e:
            raise Exception(f"Error generating response: {str(e)}")

    def get_embedding(self, text: str) -> List[float]:
        try:
            response = self.client.embeddings.create(
                model="mistral-embed", inputs=[text]
            )
            return response.data[0].embedding
        except Exception as e:
            raise Exception(f"Error generating embedding: {str(e)}")
