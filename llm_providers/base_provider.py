from abc import ABC, abstractmethod
from typing import List, Dict, Any


class BaseLLMProvider(ABC):
    @abstractmethod
    def generate(self, prompt: str) -> str:
        pass

    @abstractmethod
    def get_embedding(self, text: str) -> List[float]:
        pass
