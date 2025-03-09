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
import actions.python_coder as py
import actions.memory_retrieval as mem
import actions.think as think

import actions.web_interface as wi

def get_action_registry(llm_interface: LLMInterface, memory: Memory) -> Dict[str, Callable]:
    """
    Get the registry of all available actions.

    Args:
        llm_interface (LLMInterface): The language model interface.
        memory (Memory): The memory interface.

    Returns:
        Dict[str, Callable]: A dictionary mapping action names to their corresponding functions.
    """
    wi.set_llm_interface(llm=llm_interface)
    think.set_llm_interface(llm=llm_interface)
    py.set_llm_interface(llm=llm_interface)
    mem.set_memory(memory_instance=memory)

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
        
        # Python coding actions
        "generate_python_code": py.generate_python_code,
        "write_python_code": py.write_python_code,
        "execute_python_code": py.execute_python_code,
        "analyze_python_code": py.analyze_python_code,
        "test_python_function": py.test_python_function,
        
        # Memory operations
        # "retrieve_recent_memory": lambda n: retrieve_recent_memory(memory, n),
        # "retrieve_task_result": lambda task_description: retrieve_task_result(memory, task_description),
        # "retrieve_context_for_task": lambda task_description, n=5: retrieve_context_for_task(memory, task_description, n),
        "query_long_term_memory": mem.query_long_term_memory,
        
        # Think action
        "think": think.think,
        "replan_tasks": think.replan_tasks,
        "sleep": think.sleep,
        "rerun_tasks": think.rerun_tasks,

        # Web search actions
        "web_search": wi.web_search,
        "visit_page": wi.visit_page,
        "find_links": wi.find_links,
    }


    return actions
