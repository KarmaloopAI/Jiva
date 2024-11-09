from openai import AsyncOpenAI
from typing import List, Dict, Any
from .base_provider import BaseLLMProvider

class OpenAIProvider(BaseLLMProvider):
    def __init__(self, config: Dict[str, Any]):
        self.client = AsyncOpenAI(api_key=config['api_key'])
        self.model = config.get('model', 'gpt-3.5-turbo')

    async def generate(self, prompt: str) -> str:
        response = await self.client.chat.completions.create(
            model=self.model,
            messages=[{"role": "user", "content": prompt}]
        )
        return response.choices[0].message.content

    async def get_embedding(self, text: str) -> List[float]:
        response = await self.client.embeddings.create(
            input=[text],
            model="text-embedding-ada-002"
        )
        return response.data[0].embedding
