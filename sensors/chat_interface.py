import asyncio
from .sensor_base import Sensor
from typing import Any, Dict

class ChatInterface(Sensor):
    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self.prompt = config.get('prompt', "Enter your message: ")

    async def get_input(self) -> str:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, input, self.prompt)

    async def process_input(self, input_data: str) -> Dict[str, Any]:
        return {
            "type": "chat",
            "content": input_data,
            "timestamp": self.get_timestamp()
        }

    def get_timestamp(self) -> str:
        from datetime import datetime
        return datetime.now().isoformat()