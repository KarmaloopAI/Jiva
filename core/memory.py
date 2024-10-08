# core/memory.py

from typing import Any, Dict, List, Optional
from datetime import datetime
import json
import logging

from core.llm_interface import LLMInterface
from utils.qdrant_handler import QdrantHandler


class DateTimeEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, datetime):
            return obj.isoformat()
        return super().default(obj)


class Memory:
    def __init__(self, config: Dict[str, Any], llm_interface: LLMInterface):
        self.config = config
        self.llm_interface = llm_interface
        self.short_term_memory: List[Dict[str, Any]] = []
        self.vector_size = config.get("vector_size", 3072)
        self.max_short_term_memory = config.get("max_short_term_memory", 100)
        self.logger = logging.getLogger("Jiva.Memory")
        self.json_encoder = DateTimeEncoder()
        try:
            self.qdrant_handler = QdrantHandler(
                config["qdrant_host"],
                config["qdrant_port"],
                config["collection_name"],
                self.vector_size,
            )
        except Exception as e:
            self.logger.error(
                "Qdrant could not be connected to. Jiva will operate with limited memory capabilities."
            )

    def add_to_short_term(self, data: Dict[str, Any]):
        """Add a memory item to short-term memory."""
        timestamp = datetime.now().isoformat()
        memory_item = {"timestamp": timestamp, "data": data}
        self.short_term_memory.append(memory_item)
        self.logger.debug(
            f"Added to short-term memory: {self.json_encoder.encode(memory_item)}"
        )

        if len(self.short_term_memory) > self.max_short_term_memory:
            self._transfer_to_long_term(self.short_term_memory.pop(0))

    def _transfer_to_long_term(self, memory_item: Dict[str, Any]):
        """Transfer a memory item from short-term to long-term memory."""
        try:
            serialized_item = self.json_encoder.encode(memory_item)
            embedding = self.llm_interface.get_embedding(serialized_item)

            if len(embedding) != self.vector_size:
                self.logger.error(
                    f"Embedding size mismatch. Expected {self.vector_size}, got {len(embedding)}"
                )
                return

            point_id = self.qdrant_handler.add_point(
                vector=embedding, payload=json.loads(serialized_item)
            )
            if point_id:
                self.logger.info(f"Transferred memory to long-term storage: {point_id}")
            else:
                self.logger.warning("Failed to transfer memory to long-term storage")
        except Exception as e:
            self.logger.error(f"Failed to transfer memory to long-term storage: {e}")

    def get_short_term_memory(self) -> List[Dict[str, Any]]:
        """Retrieve all items from short-term memory."""
        return self.short_term_memory

    def get_recent_short_term_memory(self, n: int = 5) -> List[Dict[str, Any]]:
        """Retrieve the n most recent items from short-term memory."""
        return self.short_term_memory[-n:]

    def consolidate(self):
        """Consolidate short-term memory into long-term memory."""
        self.logger.info(f"Consolidating {len(self.short_term_memory)} memories")
        for memory_item in self.short_term_memory:
            self._transfer_to_long_term(memory_item)
        self.short_term_memory.clear()
        self.logger.info("Memory consolidation completed")

    def query_long_term_memory(
        self, query: str, limit: int = 5
    ) -> List[Dict[str, Any]]:
        """Query long-term memory based on semantic similarity."""
        try:
            query_embedding = self.llm_interface.get_embedding(query)
            results = self.qdrant_handler.search(
                query_vector=query_embedding, limit=limit
            )
            return [result.payload for result in results]
        except Exception as e:
            self.logger.error(f"Failed to query long-term memory: {e}")
            return []

    def prepare_fine_tuning_dataset(self) -> List[Dict[str, Any]]:
        """Prepare a dataset for fine-tuning based on recent memories."""
        recent_memories = self.short_term_memory + self.query_long_term_memory(
            "", limit=100
        )
        # This is a placeholder. In a real implementation, you'd process these
        # memories into a format suitable for fine-tuning your specific LLM.
        return recent_memories

    def forget(self, threshold: float):
        """Remove old or less relevant memories from long-term storage."""
        # This is a placeholder. Implementation would depend on your specific
        # criteria for "forgetting" and the Qdrant API's capabilities.
        pass

    def update_long_term_memory(self, memory_id: str, updated_data: Dict[str, Any]):
        """Update a specific memory in long-term storage."""
        try:
            embedding = self.llm_interface.get_embedding(json.dumps(updated_data))
            self.qdrant_handler.update_point(
                id=memory_id,
                vector=embedding,
                payload={"data": updated_data, "timestamp": datetime.now().isoformat()},
            )
            self.logger.info(f"Updated long-term memory: {memory_id}")
        except Exception as e:
            self.logger.error(f"Failed to update long-term memory: {e}")

    def get_task_result(self, task_description: str) -> Optional[Dict[str, Any]]:
        """
        Retrieve the result of the most recent task matching the given description.

        Args:
            task_description (str): The description of the task to retrieve.

        Returns:
            Optional[Dict[str, Any]]: The task result if found, None otherwise.
        """
        # Search in short-term memory first
        for memory_item in reversed(self.short_term_memory):
            if (
                memory_item["data"].get("type") == "task_result"
                and memory_item["data"].get("description") == task_description
            ):
                return {
                    "result": memory_item["data"].get("result"),
                    "task_id": memory_item["data"].get("task_id"),
                    "timestamp": memory_item["timestamp"],
                }

        # If not found in short-term memory, check long-term memory
        query = f'type:task_result AND description:"{task_description}"'
        long_term_results = self.query_long_term_memory(query, limit=1)
        if long_term_results:
            result = long_term_results[0]
            return {
                "result": result.get("result"),
                "task_id": result.get("task_id"),
                "timestamp": result.get("timestamp"),
            }

        return None

    def get_context_for_task(self, task_description: str, n: int = 5) -> Dict[str, Any]:
        """Retrieve relevant context for a task from both short-term and long-term memory."""
        context = {
            "short_term": self.get_recent_short_term_memory(n),
            "long_term": self.query_long_term_memory(task_description, n),
        }
        return context


if __name__ == "__main__":
    # This allows us to run some basic tests
    from unittest.mock import MagicMock

    # Mock LLMInterface and QdrantHandler
    mock_llm = MagicMock()
    mock_llm.get_embedding.return_value = [0.1] * 3072

    config = {
        "qdrant_host": "localhost",
        "qdrant_port": 6333,
        "collection_name": "test_collection",
        "max_short_term_memory": 5,
    }

    memory = Memory(config, mock_llm)

    # Test adding to short-term memory
    for i in range(7):
        memory.add_to_short_term({"test_data": f"Data {i}"})

    print(f"Short-term memory size: {len(memory.get_short_term_memory())}")

    # Test querying long-term memory
    mock_llm.get_embedding.return_value = [0.2] * 3072
    results = memory.query_long_term_memory("test query")
    print(f"Long-term memory query results: {results}")

    # Test getting task result
    memory.add_to_short_term(
        {"task_id": "test_task", "result": {"output": "Test output"}}
    )
    result = memory.get_task_result("test_task")
    print(f"Task result: {result}")

    # Test getting context for task
    context = memory.get_context_for_task("Test task description")
    print(f"Context for task: {context}")

    print("Memory tests completed.")
