import json
import logging
import re
from typing import Any, Dict, List, Union
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type,
)

from llm_providers.base_provider import BaseLLMProvider
from llm_providers.ollama_provider import OllamaProvider
from llm_providers.openai_provider import OpenAIProvider
from llm_providers.anthropic_provider import AnthropicProvider
from llm_providers.mistral_ai_provider import MistralAIProvider


class JSONParseError(Exception):
    pass


class LLMInterface:
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.provider = self._get_provider()
        self.logger = logging.getLogger("Jiva.LLMInterface")

    def _get_provider(self) -> BaseLLMProvider:
        provider_name = self.config.get("provider", "ollama").lower()
        if provider_name == "ollama":
            return OllamaProvider(self.config)
        elif provider_name == "openai":
            return OpenAIProvider(self.config)
        elif provider_name == "anthropic":
            return AnthropicProvider(self.config)
        elif provider_name == "mistralai":
            return MistralAIProvider(self.config)
        else:
            raise ValueError(f"Unsupported LLM provider: {provider_name}")

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=4, max=10),
        retry=retry_if_exception_type((Exception,)),
        reraise=True,
    )
    def generate(self, prompt: str) -> str:
        """Generate a response from the LLM."""
        try:
            return self.provider.generate(prompt)
        except Exception as e:
            self.logger.error(f"Error generating response: {str(e)}")
            raise

    def parse_json(self, response: str) -> Union[Any, Dict[str, str]]:
        """
        Extract and parse a JSON object from an LLM response.

        Args:
        response (str): The full response from the LLM.

        Returns:
        Any: The parsed JSON object, or an error dictionary if parsing fails.
        """
        logger = logging.getLogger(__name__)

        # Attempt to directly parse the response as JSON
        parsed_json = self._attempt_parse(response)
        if parsed_json is not None:
            return parsed_json

        # Attempt to extract JSON from markdown-style code blocks or other common patterns
        json_string = self._extract_json_from_response(response)
        if json_string:
            json_string = self._fix_json_syntax(json_string)
            parsed_json = self._attempt_parse(json_string)
            if parsed_json is not None:
                return parsed_json

        # If all attempts fail, try to construct a JSON-like structure
        constructed_json = self._construct_json_from_text(response)
        if constructed_json:
            return constructed_json

        # If all attempts fail, return an error dictionary with the raw response
        logger.error("Failed to parse JSON after all attempts")
        return {"error": "Failed to parse JSON", "raw_response": response}

    def _attempt_parse(self, json_string: str) -> Union[Any, None]:
        """
        Attempt to parse a string as JSON.

        Args:
        json_string (str): The string to parse.

        Returns:
        Any: The parsed JSON object, or None if parsing fails.
        """
        try:
            return json.loads(json_string)
        except json.JSONDecodeError:
            return None

    def _extract_json_from_response(self, response: str) -> Union[str, None]:
        """
        Extract JSON string from different potential formats in the response.

        Args:
        response (str): The full response string.

        Returns:
        str: The extracted JSON string, or None if no valid JSON is found.
        """
        logger = logging.getLogger(__name__)

        # Look for JSON in markdown code block with or without "json" identifier
        json_match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", response)
        if json_match:
            logger.info("Found JSON in code block")
            return json_match.group(1).strip()

        # Look for the first JSON-like structure in the text
        json_match = re.search(r"(\{.*?\}|\[.*?\])", response, re.DOTALL)
        if json_match:
            logger.info("Found JSON-like structure in response")
            return json_match.group(1).strip()

        logger.warning("No JSON structure found in response")
        return None

    def _fix_json_syntax(self, json_string: str) -> str:
        """
        Attempt to fix common JSON syntax errors.

        Args:
        json_string (str): The JSON string with potential syntax errors.

        Returns:
        str: A cleaned JSON string with common syntax issues fixed.
        """
        # Remove any text after the last closing bracket or brace
        json_string = re.sub(r"([}\]])\s*[^}\]]*$", r"\1", json_string, flags=re.DOTALL)

        # Fix missing commas between array elements
        json_string = re.sub(r"(\}\s*\{|\]\s*\[)", r"\1,", json_string)

        # Fix trailing commas in arrays and objects
        json_string = re.sub(r",\s*([\]}])", r"\1", json_string)

        # Fix unclosed quotes
        json_string = re.sub(
            r'(?<!\\)"([^"]*?)(?<!\\)"(?=\s*[:,\]}])', r'"\1"', json_string
        )

        # Remove newlines and extra spaces between keys and values
        json_string = re.sub(r'"\s*:\s*"', '":"', json_string)
        json_string = re.sub(r'"\s*:\s*\[', '":[', json_string)
        json_string = re.sub(r'"\s*:\s*\{', '":{', json_string)

        return json_string

    def _construct_json_from_text(self, text: str) -> Union[Dict[str, Any], None]:
        """
        Attempt to construct a JSON-like structure from free text.

        Args:
        text (str): The text to parse.

        Returns:
        Dict[str, Any]: A constructed JSON-like dictionary, or None if parsing fails.
        """
        logger = logging.getLogger(__name__)

        # Look for key-value pairs in the text
        pairs = re.findall(
            r'(?:^|\n)(["\w\s]+?):\s*(.+?)(?=\n["\w\s]+?:|$)', text, re.DOTALL
        )
        if pairs:
            result = {}
            for key, value in pairs:
                key = key.strip().strip('"')
                value = value.strip()
                # Check if value looks like a list
                if value.startswith("[") and value.endswith("]"):
                    try:
                        value = json.loads(value)
                    except json.JSONDecodeError:
                        # If parsing as JSON fails, split by commas and strip whitespace
                        value = [v.strip().strip('"') for v in value[1:-1].split(",")]
                elif value.lower() in ["true", "false"]:
                    value = value.lower() == "true"
                elif value.isdigit():
                    value = int(value)
                elif value.replace(".", "", 1).isdigit():
                    value = float(value)
                else:
                    value = value.strip('"')
                result[key] = value
            logger.info("Constructed JSON-like structure from text")
            return result

        logger.warning("Failed to construct JSON-like structure from text")
        return None

    def process(self, input_data: Any) -> Dict[str, Any]:
        """Process input data and return structured information."""
        prompt = f"""
        Input: {input_data}

        Analyze the above input, break it down into action_items to fulfil the overall goal of the input.
        Carefully analyse the input to ensure you have factored it in its entirety.
        Provide a summary and other relevant details structured into the JSON object below.
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
                "action_items": ["Retry processing the input"],
            }

    @retry(
        stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=4, max=10)
    )
    def get_embedding(self, text: str) -> List[float]:
        """Get the embedding for a given text."""
        try:
            return self.provider.get_embedding(text)
        except Exception as e:
            self.logger.error(f"Error getting embedding: {str(e)}")
            raise

    def fine_tune(self, dataset: List[Dict[str, Any]]):
        """Prepare and initiate fine-tuning of the model."""
        # Note: Fine-tuning might not be available for all providers
        # Implement provider-specific fine-tuning logic here if available
        self.logger.warning("Fine-tuning is not implemented for the current provider.")


if __name__ == "__main__":
    # This allows us to run some basic tests
    config = {
        "provider": "ollama",
        "api_base_url": "http://localhost:11434/api",
        "model": "gemma",
        "max_retries": 3,
        "timeout": 30,
    }
    llm = LLMInterface(config)

    # Test generation
    prompt = "Explain the concept of artificial intelligence in one sentence."
    response = llm.generate(prompt)
    print(f"Generation test:\nPrompt: {prompt}\nResponse: {response}\n")

    # Test embedding
    text = "Artificial Intelligence"
    embedding = llm.get_embedding(text)
    print(
        f"Embedding test:\nText: {text}\nEmbedding (first 5 values): {embedding[:5]}\n"
    )
