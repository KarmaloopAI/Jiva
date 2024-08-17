# utils/qdrant_handler.py

from typing import List, Dict, Any
from qdrant_client import QdrantClient
from qdrant_client.http.models import Distance, VectorParams, PointStruct, UpdateStatus

class QdrantHandler:
    def __init__(self, host: str, port: int, collection_name: str):
        self.client = QdrantClient(host=host, port=port)
        self.collection_name = collection_name
        self._ensure_collection_exists()

    def _ensure_collection_exists(self):
        collections = self.client.get_collections().collections
        if not any(collection.name == self.collection_name for collection in collections):
            self.client.create_collection(
                collection_name=self.collection_name,
                vectors_config=VectorParams(size=1024, distance=Distance.COSINE)
            )

    def add_point(self, id: str, vector: List[float], payload: Dict[str, Any]):
        self.client.upsert(
            collection_name=self.collection_name,
            points=[PointStruct(id=id, vector=vector, payload=payload)]
        )

    def search(self, query_vector: List[float], limit: int = 5) -> List[Dict[str, Any]]:
        results = self.client.search(
            collection_name=self.collection_name,
            query_vector=query_vector,
            limit=limit
        )
        return [{"id": result.id, "payload": result.payload, "score": result.score} for result in results]

    def update_point(self, id: str, vector: List[float], payload: Dict[str, Any]) -> UpdateStatus:
        return self.client.upsert(
            collection_name=self.collection_name,
            points=[PointStruct(id=id, vector=vector, payload=payload)]
        )

    def delete_point(self, id: str) -> UpdateStatus:
        return self.client.delete(
            collection_name=self.collection_name,
            points_selector=[id]
        )

    def get_point(self, id: str) -> Dict[str, Any]:
        results = self.client.retrieve(
            collection_name=self.collection_name,
            ids=[id]
        )
        if results:
            return {"id": results[0].id, "payload": results[0].payload}
        return None

if __name__ == "__main__":
    # This allows us to run some basic tests
    handler = QdrantHandler("localhost", 6333, "test_collection")
    
    # Test adding a point
    handler.add_point("test1", [0.1] * 1024, {"data": "Test data"})
    
    # Test searching
    results = handler.search([0.1] * 1024, limit=1)
    print(f"Search results: {results}")
    
    # Test updating a point
    handler.update_point("test1", [0.2] * 1024, {"data": "Updated test data"})
    
    # Test getting a point
    point = handler.get_point("test1")
    print(f"Retrieved point: {point}")
    
    # Test deleting a point
    handler.delete_point("test1")
