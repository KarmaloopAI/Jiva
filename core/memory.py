# core/memory.py

from typing import Any, Dict, List
from datetime import datetime
import json
import logging

from core.llm_interface import LLMInterface
from utils.qdrant_handler import QdrantHandler, VECTOR_SIZE
from models.embeddings import get_embedding

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
        self.qdrant_handler = QdrantHandler(
            config['qdrant_host'],
            config['qdrant_port'],
            config['collection_name']
        )
        self.max_short_term_memory = config.get('max_short_term_memory', 100)
        self.logger = logging.getLogger("Jiva.Memory")
        self.json_encoder = DateTimeEncoder()

    def add_to_short_term(self, data: Dict[str, Any]):
        """Add a memory item to short-term memory."""
        timestamp = datetime.now().isoformat()
        memory_item = {
            'timestamp': timestamp,
            'data': data
        }
        self.short_term_memory.append(memory_item)
        self.logger.debug(f"Added to short-term memory: {self.json_encoder.encode(memory_item)}")
        
        if len(self.short_term_memory) > self.max_short_term_memory:
            self._transfer_to_long_term(self.short_term_memory.pop(0))

    def _transfer_to_long_term(self, memory_item: Dict[str, Any]):
        """Transfer a memory item from short-term to long-term memory."""
        try:
            serialized_item = self.json_encoder.encode(memory_item)
            embedding = self.llm_interface.get_embedding(serialized_item)
            
            if len(embedding) != VECTOR_SIZE:
                self.logger.error(f"Embedding size mismatch. Expected {VECTOR_SIZE}, got {len(embedding)}")
                return
            
            point_id = self.qdrant_handler.add_point(
                vector=embedding,
                payload=json.loads(serialized_item)
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

    def consolidate(self):
        """Consolidate short-term memory into long-term memory."""
        self.logger.info(f"Consolidating {len(self.short_term_memory)} memories")
        for memory_item in self.short_term_memory:
            self._transfer_to_long_term(memory_item)
        self.short_term_memory.clear()
        self.logger.info("Memory consolidation completed")

    def query_long_term_memory(self, query: str, limit: int = 5) -> List[Dict[str, Any]]:
        """Query long-term memory based on semantic similarity."""
        try:
            query_embedding = self.llm_interface.get_embedding(query)
            results = self.qdrant_handler.search(
                query_vector=query_embedding,
                limit=limit
            )
            return [result.payload for result in results]
        except Exception as e:
            self.logger.error(f"Failed to query long-term memory: {e}")
            return []

    def prepare_fine_tuning_dataset(self) -> List[Dict[str, Any]]:
        """Prepare a dataset for fine-tuning based on recent memories."""
        recent_memories = self.short_term_memory + self.query_long_term_memory("", limit=100)
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
            embedding = get_embedding(json.dumps(updated_data))
            self.qdrant_handler.update_point(
                id=memory_id,
                vector=embedding,
                payload={'data': updated_data, 'timestamp': datetime.now().isoformat()}
            )
            self.logger.info(f"Updated long-term memory: {memory_id}")
        except Exception as e:
            self.logger.error(f"Failed to update long-term memory: {e}")
