# actions/think.py

from typing import Dict, Any, Optional
from core.llm_interface import LLMInterface

def think(llm_interface: LLMInterface, prompt: str, context: Optional[Dict[str, Any]] = None) -> str:
    """
    Use the LLM to generate a response based on a prompt and optional context.

    Args:
        prompt (str): The prompt to send to the LLM. Preferrably, keep this as static text when required_inputs is empty.
        context (Optional[Dict[str, Any]]): Additional context for the prompt. Defaults to None.

    Returns:
        str: The generated response from the LLM.
    """
    full_prompt = f"Context: {context}\n\nPrompt: {prompt}" if context else prompt
    return llm_interface.generate(full_prompt)

# Example usage:
# story = think(llm_interface, "Write a short story about two friends", {"genre": "comedy", "word_limit": 200})
