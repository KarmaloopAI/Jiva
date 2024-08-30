import openai
from typing import List, Dict, Any
from .base_provider import BaseLLMProvider

class OpenAIProvider(BaseLLMProvider):
    def __init__(self, config: Dict[str, Any]):
        openai.api_key = config['api_key']
        self.model = config.get('model', 'gpt-3.5-turbo')

    def generate(self, prompt: str) -> str:
        response = openai.ChatCompletion.create(
            model=self.model,
            messages=[{"role": "user", "content": prompt}]
        )
        return response.choices[0].message.content

    def get_embedding(self, text: str) -> List[float]:
        response = openai.Embedding.create(
            input=[text],
            model="text-embedding-ada-002"
        )
        return response['data'][0]['embedding']
