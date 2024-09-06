# Adding New Actions to Jiva

This guide explains how to add new actions to the Jiva Framework, allowing you to extend its capabilities.

## Understanding Actions

Actions in Jiva are functions that the agent can perform. They are registered in the action registry and can be called by the task manager. The docstring of each action is crucial as it's used by the LLM to understand the action's purpose and parameters.

## Steps to Add a New Action

1. Create a new Python file in the `actions/` directory (or an appropriate subdirectory).

2. Define your action function. It should take necessary parameters and return a result.

3. Add type hints and a detailed docstring to your function. This is critical for the LLM's understanding of the action.

   Example:
   ```python
   # actions/custom_actions.py

   def calculate_fibonacci(n: int) -> int:
       """
       Calculate the nth Fibonacci number.

       This function computes the Fibonacci number at the specified position
       in the Fibonacci sequence using a recursive approach.

       Args:
           n (int): The position in the Fibonacci sequence (1-indexed).
                    Must be a positive integer.

       Returns:
           int: The nth Fibonacci number.

       Raises:
           ValueError: If n is less than 1.

       Example:
           >>> calculate_fibonacci(10)
           55
       """
       if n < 1:
           raise ValueError("n must be a positive integer")
       if n <= 2:
           return 1
       else:
           return calculate_fibonacci(n-1) + calculate_fibonacci(n-2)
   ```

4. Register your action in `actions/action_registry.py`:

   ```python
   # actions/action_registry.py

   from .custom_actions import calculate_fibonacci

   def get_action_registry(llm_interface: LLMInterface, memory: Memory) -> Dict[str, Callable]:
       actions = {
           # ... existing actions ...
           "calculate_fibonacci": calculate_fibonacci,
       }
       return actions
   ```

5. If your action requires access to the LLM or memory, modify its signature and update the registration using a lambda function. When doing this, it's crucial to explicitly set the docstring for the lambda:

   ```python
   def calculate_fibonacci(n: int, llm_interface: LLMInterface) -> int:
       """
       Calculate the nth Fibonacci number.

       This function computes the Fibonacci number at the specified position
       in the Fibonacci sequence using a recursive approach. It has access
       to the LLM interface for potential future enhancements.

       Args:
           n (int): The position in the Fibonacci sequence (1-indexed).
                    Must be a positive integer.
           llm_interface (LLMInterface): The interface to the language model.

       Returns:
           int: The nth Fibonacci number.

       Raises:
           ValueError: If n is less than 1.

       Example:
           >>> calculate_fibonacci(10, llm_interface)
           55
       """
       # ... implementation ...

   # In action_registry.py
   actions = {
       # ... other actions ...
       "calculate_fibonacci": lambda n: calculate_fibonacci(n, llm_interface),
   }

   # Explicitly set the docstring for the lambda function
   actions["calculate_fibonacci"].__doc__ = calculate_fibonacci.__doc__
   ```

   This step is crucial because lambda functions don't preserve the original function's docstring. By explicitly setting the docstring, we ensure that the LLM can access the necessary information about the action.

## Importance of Docstrings

Docstrings are critical in Jiva for several reasons:

1. LLM Understanding: The LLM uses the docstring to understand the purpose, parameters, and expected output of each action. A well-written docstring enables the LLM to use the action effectively.

2. Task Generation: When generating tasks, the LLM relies on action docstrings to determine which actions are appropriate for specific goals.

3. Parameter Handling: The docstring helps the LLM understand how to properly populate the action's parameters when creating tasks.

4. Error Handling: By documenting possible exceptions or error conditions, the docstring helps the LLM anticipate and handle potential issues.

Always ensure your docstrings are comprehensive, including:
- A brief description of the action
- Detailed explanations of all parameters
- The return value and its type
- Any exceptions that might be raised
- An example of usage, if applicable

## Testing Your New Action

1. Add unit tests for your action in the `tests/` directory.

2. Run the tests to ensure your action works as expected.

## Using Your New Action

Once registered, Jiva can use your new action in tasks. For example:

```
Jiva> What's the 10th Fibonacci number?
```

Jiva should now be able to use the `calculate_fibonacci` action to answer this query.

## Best Practices

- Keep actions simple and focused on a single task.
- Use descriptive names for your actions.
- Provide clear and comprehensive documentation in the function's docstring.
- Handle potential errors gracefully within your action.
- Consider the ethical implications of your action and how it aligns with Jiva's ethical framework.
- When using lambda functions for registration, always explicitly set the docstring.

By following these steps and best practices, you can continually expand Jiva's capabilities with new, well-documented actions that the LLM can effectively utilize.
