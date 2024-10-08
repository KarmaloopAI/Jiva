# utils/qdrant_handler.py

from typing import List, Dict, Any
from qdrant_client import QdrantClient
from qdrant_client.http.models import Distance, VectorParams, PointStruct, UpdateStatus
from qdrant_client.http.exceptions import ResponseHandlingException, UnexpectedResponse
import logging
import uuid


class QdrantHandler:
    def __init__(self, host: str, port: int, collection_name: str, vector_size: int):
        self.client = QdrantClient(host=host, port=port)
        self.vector_size = vector_size
        self.collection_name = collection_name
        self.logger = logging.getLogger("Jiva.QdrantHandler")
        self._ensure_collection_exists()

    def _ensure_collection_exists(self):
        try:
            collections = self.client.get_collections().collections
            collection_exists = any(
                collection.name == self.collection_name for collection in collections
            )

            if not collection_exists:
                self._create_collection()
            else:
                self.logger.info(f"Collection {self.collection_name} already exists")
                # We won't try to verify the vector size here to avoid potential compatibility issues
        except Exception as e:
            self.logger.error(f"Error ensuring collection exists: {e}")
            # Instead of raising the exception, we'll attempt to create the collection
            self._create_collection()

    def _create_collection(self):
        try:
            self.client.create_collection(
                collection_name=self.collection_name,
                vectors_config=VectorParams(
                    size=self.vector_size, distance=Distance.COSINE
                ),
            )
            self.logger.info(
                f"Created new collection: {self.collection_name} with vector size {self.vector_size}"
            )
        except Exception as e:
            self.logger.error(f"Error creating collection: {e}")
            raise

    def add_point(self, vector: List[float], payload: Dict[str, Any]) -> str:
        try:
            if len(vector) != self.vector_size:
                raise ValueError(
                    f"Vector dimension mismatch. Expected {self.vector_size}, got {len(vector)}"
                )
            point_id = str(uuid.uuid4())
            self.client.upsert(
                collection_name=self.collection_name,
                points=[PointStruct(id=point_id, vector=vector, payload=payload)],
            )
            self.logger.debug(f"Added point with id: {point_id}")
            return point_id
        except (ResponseHandlingException, UnexpectedResponse) as e:
            self.logger.error(f"Unexpected response from Qdrant: {e}")
            # Here you might want to implement a retry mechanism or fallback storage
            return None
        except Exception as e:
            self.logger.error(f"Error adding point: {e}")
            return None

    def search(self, query_vector: List[float], limit: int = 5) -> List[Dict[str, Any]]:
        try:
            results = self.client.search(
                collection_name=self.collection_name,
                query_vector=query_vector,
                limit=limit,
            )
            return [
                {"id": result.id, "payload": result.payload, "score": result.score}
                for result in results
            ]
        except (ResponseHandlingException, UnexpectedResponse) as e:
            self.logger.error(f"Unexpected response from Qdrant during search: {e}")
            return []
        except Exception as e:
            self.logger.error(f"Error during search: {e}")
            return []

    def update_point(
        self, id: str, vector: List[float], payload: Dict[str, Any]
    ) -> UpdateStatus:
        return self.client.upsert(
            collection_name=self.collection_name,
            points=[PointStruct(id=id, vector=vector, payload=payload)],
        )

    def delete_point(self, id: str) -> UpdateStatus:
        return self.client.delete(
            collection_name=self.collection_name, points_selector=[id]
        )

    def get_point(self, id: str) -> Dict[str, Any]:
        results = self.client.retrieve(collection_name=self.collection_name, ids=[id])
        if results:
            return {"id": results[0].id, "payload": results[0].payload}
        return None

    def delete_collection(self):
        try:
            self.client.delete_collection(self.collection_name)
            self.logger.info(f"Deleted collection: {self.collection_name}")
        except Exception as e:
            self.logger.error(f"Error deleting collection: {e}")


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
