from typing import List, Dict, Any
from mistralai import Mistral
from .base_provider import BaseLLMProvider

class MistralAIProvider(BaseLLMProvider):
    def __init__(self, config: Dict[str, Any]):
        self.client = Mistral(api_key=config.get('api_key'))
        self.model = config.get('model', 'mistral-small-latest')

    async def generate(self, prompt: str) -> str:
        try:
            response = await self.client.chat.complete_async(
                model=self.model,
                messages=[
                    {
                        "content": prompt,
                        "role": "user",
                    },
                ],
            )
            return response.choices[0].message.content
        except Exception as e:
            raise Exception(f"Error generating response: {str(e)}")

    async def get_embedding(self, text: str) -> List[float]:
        try:
            response = await self.client.embeddings.create_async(
                model="mistral-embed",
                input=text
            )
            return response.data[0].embedding
        except Exception as e:
            raise Exception(f"Error generating embedding: {str(e)}")
