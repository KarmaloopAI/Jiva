# sensors/chat_interface.py

import asyncio
import sys
import select
from typing import Any, Dict, Optional
from .sensor_base import Sensor

class ChatInterface(Sensor):
    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self.prompt = config.get('prompt', "Jiva> ")
        print(self.prompt, end='', flush=True)  # Initial prompt

    async def get_input(self) -> Optional[str]:
        """Non-blocking check for input from CLI."""
        if sys.platform == 'win32':
            # Windows implementation
            return await self._get_input_windows()
        else:
            # Unix-like implementation
            return await self._get_input_unix()

    async def _get_input_unix(self) -> Optional[str]:
        # Check if there's data available to read from stdin
        if select.select([sys.stdin], [], [], 0)[0]:
            line = sys.stdin.readline().strip()
            print(self.prompt, end='', flush=True)  # Print new prompt
            return line
        return None

    async def _get_input_windows(self) -> Optional[str]:
        # Windows doesn't support select on stdin
        # Use a thread to check for input
        try:
            input_ready = False

            def check_input():
                return sys.stdin in select.select([sys.stdin], [], [], 0)[0]

            # Run input check in thread pool
            loop = asyncio.get_event_loop()
            input_ready = await loop.run_in_executor(None, check_input)

            if input_ready:
                line = await loop.run_in_executor(None, sys.stdin.readline)
                print(self.prompt, end='', flush=True)  # Print new prompt
                return line.strip()
        except Exception:
            pass
        return None

    async def process_input(self, input_data: str) -> Dict[str, Any]:
        """Process the raw input into a structured format."""
        if not input_data:  # Handle empty input
            return {}
            
        return {
            "type": "chat",
            "content": input_data,
            "timestamp": self.get_timestamp()
        }

    def get_timestamp(self) -> str:
        from datetime import datetime
        return datetime.now().isoformat()
