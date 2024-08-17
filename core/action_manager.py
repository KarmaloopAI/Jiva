# core/action_manager.py

from typing import Dict, Any, List, Callable
from core.ethical_framework import EthicalFramework

class ActionManager:
    def __init__(self, ethical_framework: EthicalFramework):
        self.actions: Dict[str, Callable] = {}
        self.ethical_framework = ethical_framework

    def register_action(self, name: str, action_function: Callable):
        """Register a new action."""
        self.actions[name] = action_function

    def execute_action(self, action_name: str, params: Dict[str, Any]) -> Any:
        """Execute an action if it's ethical."""
        if action_name not in self.actions:
            raise ValueError(f"Action '{action_name}' is not registered.")

        # Evaluate the action ethically
        if self.ethical_framework.evaluate_action(action_name, params):
            return self.actions[action_name](**params)
        else:
            # If the action is deemed unethical, don't execute it
            ethical_explanation = self.ethical_framework.get_ethical_explanation(f"{action_name}: {params}", is_task=False)
            return f"Action not executed due to ethical concerns: {ethical_explanation}"

    def get_available_actions(self) -> List[str]:
        """Get a list of all available actions."""
        return list(self.actions.keys())

    def get_action_ethical_summary(self, action_name: str, params: Dict[str, Any]) -> str:
        """Get an ethical summary for a specific action."""
        if action_name not in self.actions:
            return f"Action '{action_name}' is not registered."
        
        is_ethical = self.ethical_framework.evaluate_action(action_name, params)
        explanation = self.ethical_framework.get_ethical_explanation(f"{action_name}: {params}", is_task=False)
        
        return f"Action: {action_name}\nParameters: {params}\nEthical: {'Yes' if is_ethical else 'No'}\nExplanation: {explanation}"

if __name__ == "__main__":
    # This is a mock implementation for testing purposes
    class MockEthicalFramework:
        def evaluate_action(self, action, params):
            return action != "delete_user_data"
        def get_ethical_explanation(self, description, is_task=True):
            if "delete_user_data" in description:
                return "Deleting user data without explicit consent violates privacy principles."
            return "This action aligns with our ethical principles."

    def mock_send_email(recipient: str, content: str):
        print(f"Sending email to {recipient}: {content}")

    def mock_delete_user_data(user_id: str):
        print(f"Deleting data for user {user_id}")

    am = ActionManager(MockEthicalFramework())
    am.register_action("send_email", mock_send_email)
    am.register_action("delete_user_data", mock_delete_user_data)

    # Test executing an ethical action
    result = am.execute_action("send_email", {"recipient": "user@example.com", "content": "Hello!"})
    print(result)

    # Test executing an unethical action
    result = am.execute_action("delete_user_data", {"user_id": "12345"})
    print(result)

    # Get ethical summaries
    print(am.get_action_ethical_summary("send_email", {"recipient": "user@example.com", "content": "Hello!"}))
    print(am.get_action_ethical_summary("delete_user_data", {"user_id": "12345"}))

    # List available actions
    print("Available actions:", am.get_available_actions())
