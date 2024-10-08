# core/action_manager.py

from typing import Dict, Any, Callable
import logging
from core.ethical_framework import EthicalFramework
from core.memory import Memory
from core.llm_interface import LLMInterface
from actions.action_registry import get_action_registry


class ActionManager:
    def __init__(
        self,
        ethical_framework: EthicalFramework,
        memory: Memory,
        llm_interface: LLMInterface,
    ):
        self.ethical_framework = ethical_framework
        self.memory = memory
        self.llm_interface = llm_interface
        self.actions: Dict[str, Callable] = get_action_registry(llm_interface, memory)
        self.logger = logging.getLogger("Jiva.ActionManager")

    def execute_action(self, action_name: str, parameters: Dict[str, Any]) -> Any:
        """Execute an action if it's ethical."""
        if action_name not in self.actions:
            error_msg = f"Action '{action_name}' is not registered."
            self.logger.error(error_msg)
            raise ValueError(error_msg)

        # Evaluate the action ethically
        if self.ethical_framework.evaluate_action(action_name, parameters):
            self.logger.info(f"Executing action: {action_name}")
            try:
                # Retrieve context for the action
                # context = self.memory.get_context_for_task(f"Action: {action_name}")

                # Add context to parameters
                # parameters['context'] = context

                # Execute the action
                result = self.actions[action_name](**parameters)

                # Store the result in memory
                self.memory.add_to_short_term(
                    {"action": action_name, "parameters": parameters, "result": result}
                )

                self.logger.info(f"Action '{action_name}' executed successfully")
                return result
            except Exception as e:
                error_msg = f"Error executing action '{action_name}': {str(e)}"
                self.logger.error(error_msg)
                return {"error": error_msg}
        else:
            # If the action is deemed unethical, don't execute it
            ethical_explanation = self.ethical_framework.get_ethical_explanation(
                f"{action_name}: {parameters}", is_task=False
            )
            error_msg = (
                f"Action not executed due to ethical concerns: {ethical_explanation}"
            )
            self.logger.warning(error_msg)
            return {"error": error_msg}

    def get_available_actions(self) -> Dict[str, Dict[str, Any]]:
        """Get a dictionary of all available actions with their descriptions and parameters."""
        action_info = {}
        for name, func in self.actions.items():
            doc = func.__doc__ or "No description available."
            params = self._get_function_parameters(func)
            action_info[name] = {"description": doc, "parameters": params}
        return action_info

    def _get_function_parameters(self, func: Callable) -> Dict[str, str]:
        """Extract parameter names and annotations from a function."""
        import inspect

        params = {}
        signature = inspect.signature(func)
        for name, param in signature.parameters.items():
            if name not in ["self", "cls"]:
                params[name] = (
                    str(param.annotation)
                    if param.annotation != inspect.Parameter.empty
                    else "Any"
                )
        return params

    def get_action_ethical_summary(
        self, action_name: str, parameters: Dict[str, Any]
    ) -> str:
        """Get an ethical summary for a specific action."""
        if action_name not in self.actions:
            return f"Action '{action_name}' is not registered."

        is_ethical = self.ethical_framework.evaluate_action(action_name, parameters)
        explanation = self.ethical_framework.get_ethical_explanation(
            f"{action_name}: {parameters}", is_task=False
        )

        return f"Action: {action_name}\nParameters: {parameters}\nEthical: {'Yes' if is_ethical else 'No'}\nExplanation: {explanation}"


if __name__ == "__main__":
    # This is a mock implementation for testing purposes
    from unittest.mock import MagicMock

    class MockEthicalFramework:
        def evaluate_action(self, action, params):
            return action != "delete_user_data"

        def get_ethical_explanation(self, description, is_task=True):
            if "delete_user_data" in description:
                return "Deleting user data without explicit consent violates privacy principles."
            return "This action aligns with our ethical principles."

    mock_memory = MagicMock()
    mock_llm = MagicMock()

    am = ActionManager(MockEthicalFramework(), mock_memory, mock_llm)

    # Test executing an ethical action
    result = am.execute_action("think", {"prompt": "What is the capital of France?"})
    print(result)

    # Test executing an unethical action
    result = am.execute_action("delete_user_data", {"user_id": "12345"})
    print(result)

    # Get ethical summaries
    print(
        am.get_action_ethical_summary(
            "think", {"prompt": "What is the capital of France?"}
        )
    )
    print(am.get_action_ethical_summary("delete_user_data", {"user_id": "12345"}))

    # List available actions
    print("Available actions:", am.get_available_actions())
