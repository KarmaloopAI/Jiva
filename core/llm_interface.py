# core/llm_interface.py

import json
import re
import requests
import logging
from typing import Any, Dict, List
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

EMBEDDING_SIZE = 3072  # Update this to match the actual size of your embeddings

class LLMInterface:
    def __init__(self, config: Dict[str, Any]):
        self.api_base_url = config.get('api_base_url', 'http://localhost:11434/api')
        self.model = config.get('model', 'gemma')
        self.max_retries = config.get('max_retries', 3)
        self.timeout = config.get('timeout', 60)  # Increased timeout
        self.logger = logging.getLogger("Jiva.LLMInterface")

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=4, max=10),
        retry=retry_if_exception_type((requests.exceptions.RequestException, json.JSONDecodeError)),
        reraise=True
    )
    def generate(self, prompt: str) -> str:
        """Generate a response from the LLM."""
        url = f"{self.api_base_url}/generate"
        
        payload = json.dumps({
            "model": self.model,
            "prompt": prompt,
            "stream": False
        })
        
        headers = {
            'Content-Type': 'application/json'
        }
        
        self.logger.debug(f"Sending request to Ollama API: {url}")
        try:
            response = requests.post(url, headers=headers, data=payload, timeout=self.timeout)
            response.raise_for_status()
            
            result = response.json()
            self.logger.debug("Successfully received response from Ollama API")
            return result['response']
        except requests.exceptions.RequestException as e:
            self.logger.error(f"Error communicating with Ollama API: {str(e)}")
            raise
        except json.JSONDecodeError as e:
            self.logger.error(f"Error decoding JSON response from Ollama API: {str(e)}")
            raise

    def parse_json(self, json_string: str) -> Any:
        """Parse a JSON string into a Python object, attempting to fix common syntax errors."""
        # Remove code block markers if present
        json_string = json_string.strip('`')
        if json_string.startswith('json\n'):
            json_string = json_string[5:]
        
        # Attempt to fix common JSON syntax errors
        json_string = self._fix_json_syntax(json_string)
        
        try:
            return json.loads(json_string)
        except json.JSONDecodeError as e:
            self.logger.warning(f"Failed to parse JSON: {json_string}")
            self.logger.warning(f"JSON decode error: {str(e)}")
            
            # If we still can't parse it, return an error message
            return {
                "error": "Failed to parse JSON",
                "raw_response": json_string,
                "parse_error": str(e)
            }
    
    def _fix_json_syntax(self, json_string: str) -> str:
        """Attempt to fix common JSON syntax errors."""
        # Fix unclosed strings
        json_string = re.sub(r'("(?:[^"\\]|\\.)*)"(?=[,\]}])', r'\1"', json_string)
        
        # Fix missing commas between array elements
        json_string = re.sub(r'(\w+"|true|false|\d+)\s*\n\s*("|\w+:)', r'\1,\n\2', json_string)
        
        # Fix trailing commas in arrays and objects
        json_string = re.sub(r',\s*([\]}])', r'\1', json_string)
        
        return json_string

    def process(self, input_data: Any) -> Dict[str, Any]:
        """Process input data and return structured information."""
        prompt = f"""
        Input: {input_data}

        Analyze the above input and extract key information. Provide a summary and any relevant details.
        Format your response as a JSON object with the following structure:
        {{
            "summary": "A brief summary of the input",
            "key_points": ["List of key points"],
            "entities": ["List of important entities mentioned"],
            "sentiment": "Overall sentiment (positive, negative, or neutral)",
            "action_items": ["List of suggested actions based on the input"]
        }}
        
        Ensure the response is valid JSON without any additional formatting or code block markers.
        """
        
        try:
            response = self.generate(prompt)
            return self.parse_json(response)
        except Exception as e:
            self.logger.error(f"Error processing input: {str(e)}")
            return {
                "summary": "Error processing input",
                "key_points": [],
                "entities": [],
                "sentiment": "neutral",
                "action_items": ["Retry processing the input"]
            }

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=4, max=10))
    def get_embedding(self, text: str) -> List[float]:
        """Get the embedding for a given text."""
        url = f"{self.api_base_url}/embeddings"
        
        payload = json.dumps({
            "model": self.model,
            "prompt": text
        })
        
        headers = {
            'Content-Type': 'application/json'
        }
        
        response = requests.post(url, headers=headers, data=payload, timeout=self.timeout)
        response.raise_for_status()
        
        result = response.json()
        embedding = result['embedding']
        
        if len(embedding) != EMBEDDING_SIZE:
            self.logger.warning(f"Unexpected embedding size. Expected {EMBEDDING_SIZE}, got {len(embedding)}")
        
        return embedding

    def fine_tune(self, dataset: List[Dict[str, Any]]):
        """Prepare and initiate fine-tuning of the model."""
        # Note: As of my knowledge cutoff, Ollama doesn't support fine-tuning via API.
        # This method is a placeholder for future implementation.
        print("Fine-tuning is not currently supported for Ollama models.")
        print(f"Received dataset with {len(dataset)} examples for future fine-tuning implementation.")

if __name__ == "__main__":
    # This allows us to run some basic tests
    config = {
        'api_base_url': 'http://localhost:11434/api',
        'model': 'gemma',
        'max_retries': 3,
        'timeout': 30
    }
    llm = LLMInterface(config)
    
    # Test generation
    prompt = "Explain the concept of artificial intelligence in one sentence."
    response = llm.generate(prompt)
    print(f"Generation test:\nPrompt: {prompt}\nResponse: {response}\n")
    
    # Test processing
    input_data = "The new AI system has shown remarkable progress in natural language understanding, but concerns about privacy and ethical use remain."
    processed = llm.process(input_data)
    print(f"Processing test:\nInput: {input_data}\nProcessed: {json.dumps(processed, indent=2)}\n")
    
    # Test embedding
    text = "Artificial Intelligence"
    embedding = llm.get_embedding(text)
    print(f"Embedding test:\nText: {text}\nEmbedding (first 5 values): {embedding[:5]}\n")
    
    # Test fine-tuning (placeholder)
    dataset = [{"input": "Hello", "output": "Hi there!"}, {"input": "How are you?", "output": "I'm doing well, thank you!"}]
    llm.fine_tune(dataset)
