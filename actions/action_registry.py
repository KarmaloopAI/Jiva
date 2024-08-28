# actions/action_registry.py

from typing import Dict, Callable, Any
from core.llm_interface import LLMInterface
from core.memory import Memory

# Import actions with their existing docstrings
from actions.file_operations import (
    read_file, write_file, append_file, delete_file,
    list_directory, create_directory,
    read_json, write_json,
    read_csv, write_csv
)
from actions.memory_retrieval import (
    retrieve_recent_memory, retrieve_task_result,
    retrieve_context_for_task, query_long_term_memory
)
from actions.think import think

def get_action_registry(llm_interface: LLMInterface, memory: Memory) -> Dict[str, Callable]:
    """
    Get the registry of all available actions.

    Args:
        llm_interface (LLMInterface): The language model interface.
        memory (Memory): The memory interface.

    Returns:
        Dict[str, Callable]: A dictionary mapping action names to their corresponding functions.
    """
    actions = {
        # File operations
        "read_file": read_file,
        "write_file": write_file,
        "append_file": append_file,
        "delete_file": delete_file,
        "list_directory": list_directory,
        "create_directory": create_directory,
        "read_json": read_json,
        "write_json": write_json,
        "read_csv": read_csv,
        "write_csv": write_csv,
        
        # Memory operations
        # "retrieve_recent_memory": lambda n: retrieve_recent_memory(memory, n),
        # "retrieve_task_result": lambda task_description: retrieve_task_result(memory, task_description),
        # "retrieve_context_for_task": lambda task_description, n=5: retrieve_context_for_task(memory, task_description, n),
        # "query_long_term_memory": lambda query, limit=5: query_long_term_memory(memory, query, limit),
        
        # Think action
        "think": lambda prompt, context=None: think(llm_interface, prompt, context)
    }

    # Set docstrings of lambda functions
    actions["think"].__doc__ = think.__doc__

    return actions
