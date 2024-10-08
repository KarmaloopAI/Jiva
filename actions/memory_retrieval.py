# actions/memory_retrieval.py

from typing import Dict, Any, List
from core.memory import Memory


def retrieve_recent_memory(memory: Memory, n: int = 5) -> List[Dict[str, Any]]:
    """
    Retrieve the n most recent items from short-term memory.

    Args:
        n (int): The number of recent items to retrieve. Defaults to 5.

    Returns:
        List[Dict[str, Any]]: A list of dictionaries representing the most recent memory items.
    """
    return memory.get_recent_short_term_memory(n)


def retrieve_task_result(memory: Memory, task_description: str) -> Dict[str, Any]:
    """
    Retrieve the result of a specific task from memory.

    Args:
        task_description (str): The unique identifier of the task whose result is to be retrieved.

    Returns:
        Dict[str, Any]: A dictionary containing the result of the task. Will always contain a key called result, value of which will be the result
    """
    return memory.get_task_result(task_description)


def retrieve_context_for_task(
    memory: Memory, task_description: str, n: int = 5
) -> Dict[str, Any]:
    """
    Retrieve relevant context for a task from both short-term and long-term memory.

    Args:
        task_description (str): The description of the task for which context is needed.
        n (int): The number of relevant context items to retrieve. Defaults to 5.

    Returns:
        Dict[str, Any]: A dictionary containing the relevant context for the task.
    """
    return memory.get_context_for_task(task_description, n)


def query_long_term_memory(
    memory: Memory, query: str, limit: int = 5
) -> List[Dict[str, Any]]:
    """
    Query long-term memory based on semantic similarity.

    Args:
        query (str): The query string to search for in long-term memory.
        limit (int): The maximum number of results to return. Defaults to 5.

    Returns:
        List[Dict[str, Any]]: A list of dictionaries representing the query results from long-term memory.
    """
    return memory.query_long_term_memory(query, limit)


# Example usage:
# recent_memories = retrieve_recent_memory(memory_instance, 3)
# task_result = retrieve_task_result(memory_instance, "task_123")
# context = retrieve_context_for_task(memory_instance, "Write a story about two friends")
# relevant_memories = query_long_term_memory(memory_instance, "friendship stories", 2)
