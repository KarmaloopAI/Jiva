# models/embeddings.py

import json
import requests
from typing import List

OLLAMA_API_BASE_URL = "http://localhost:11434/api"
EMBED_MODEL = "mxbai-embed-large"


def get_embedding(text: str) -> List[float]:
    """
    Get the embedding for a given text using Ollama's mxbai-embed-large model.

    Args:
    text (str): The input text to be embedded.

    Returns:
    List[float]: The embedding vector.
    """
    url = f"{OLLAMA_API_BASE_URL}/embeddings"

    payload = json.dumps({"model": EMBED_MODEL, "prompt": text})

    headers = {"Content-Type": "application/json"}

    response = requests.post(url, headers=headers, data=payload)
    response.raise_for_status()  # Raise an exception for HTTP errors

    result = response.json()
    return result["embedding"]


if __name__ == "__main__":
    # This allows us to run some basic tests
    test_text = "Hello, world!"
    embedding = get_embedding(test_text)
    print(f"Embedding for '{test_text}':")
    print(f"Vector length: {len(embedding)}")
    print(f"First few values: {embedding[:5]}")
