# core/memory.py

from typing import Any, Dict, List
from datetime import datetime
import json

from core.llm_interface import LLMInterface
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct

from utils.qdrant_handler import QdrantHandler
from models.embeddings import get_embedding

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

    def add_to_short_term(self, data: Dict[str, Any]):
        """Add a memory item to short-term memory."""
        timestamp = datetime.now().isoformat()
        memory_item = {
            'timestamp': timestamp,
            'data': data
        }
        self.short_term_memory.append(memory_item)
        
        if len(self.short_term_memory) > self.max_short_term_memory:
            self._transfer_to_long_term(self.short_term_memory.pop(0))

    def _transfer_to_long_term(self, memory_item: Dict[str, Any]):
        """Transfer a memory item from short-term to long-term memory."""
        embedding = self.llm_interface.get_embedding(json.dumps(memory_item['data']))
        self.qdrant_handler.add_point(
            id=memory_item['timestamp'],
            vector=embedding,
            payload=memory_item
        )

    def get_short_term_memory(self) -> List[Dict[str, Any]]:
        """Retrieve all items from short-term memory."""
        return self.short_term_memory

    def query_long_term_memory(self, query: str, limit: int = 5) -> List[Dict[str, Any]]:
        """Query long-term memory based on semantic similarity."""
        query_embedding = self.llm_interface.get_embedding(query)
        results = self.qdrant_handler.search(
            query_vector=query_embedding,
            limit=limit
        )
        return [result.payload for result in results]

    def consolidate(self):
        """Consolidate short-term memory into long-term memory."""
        for memory_item in self.short_term_memory:
            self._transfer_to_long_term(memory_item)
        self.short_term_memory.clear()

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
        embedding = get_embedding(json.dumps(updated_data))
        self.qdrant_handler.update_point(
            id=memory_id,
            vector=embedding,
            payload={'data': updated_data, 'timestamp': datetime.now().isoformat()}
        )

if __name__ == "__main__":
    # This allows us to run some basic tests
    config = {
        'qdrant_host': 'localhost',
        'qdrant_port': 6333,
        'collection_name': 'jiva_memories',
        'max_short_term_memory': 10
    }
    memory = Memory(config)
    
    # Test adding to short-term memory
    memory.add_to_short_term({'type': 'test', 'content': 'This is a test memory'})
    
    # Test querying long-term memory
    results = memory.query_long_term_memory("test memory")
    print(f"Query results: {results}")
    
    # Test consolidation
    memory.consolidate()
    print(f"Short-term memory after consolidation: {memory.get_short_term_memory()}")
