# core/ethical_framework.py

from typing import List, Dict, Any, Union
import logging
from core.llm_interface import LLMInterface
from core.prompt_manager import PromptManager

class EthicalFramework:
    def __init__(self, llm_interface: LLMInterface, config: Dict[str, Any], prompt_manager: PromptManager):
        self.llm_interface = llm_interface
        self.prompt_manager = prompt_manager
        self.logger = logging.getLogger("Jiva.EthicalFramework")
        
        self.ethical_principles = config.get('principles', [
            "Doing is better than not doing",
            "Do not assume everything is evil or malicious unless there is explicit evidence",
            "Do no evil"
        ])
        self.enabled = config.get('enabled', True)
        self.logger.info(f"Ethical Framework initialized. Enabled: {self.enabled}")

    def set_enabled(self, enabled: bool):
        """Enable or disable the ethical framework."""
        self.enabled = enabled
        self.logger.info(f"Ethical Framework {'enabled' if enabled else 'disabled'}")

    def evaluate_task(self, task: Union[str, Dict[str, Any]]) -> bool:
        if not self.enabled:
            self.logger.info("Ethical Framework is disabled. Task approved without evaluation.")
            return True

        if isinstance(task, dict):
            task_description = task.get('description', str(task))
        else:
            task_description = str(task)

        self.logger.info(f"Evaluating task: {task_description}")
        
        # Simplified evaluation for basic tasks
        basic_tasks = ['write', 'create', 'generate', 'compose', 'draft']
        if any(word in task_description.lower() for word in basic_tasks):
            self.logger.info(f"Task '{task_description}' is considered a basic task and automatically approved.")
            return True

        # For more complex tasks, use the existing evaluation logic
        prompt = self.prompt_manager.get_prompt(
            "ethical.evaluate_task",
            task_description=task_description,
            principles=self.ethical_principles
        )

        response = self.llm_interface.generate(prompt)
        self.logger.debug(f"LLM response: {response}")

        try:
            evaluation = self.llm_interface.parse_json(response)
            self.logger.debug(f"Parsed evaluation: {evaluation}")
            is_ethical = evaluation['overall_assessment'] == 'ethical'
            self.logger.info(f"Task ethical assessment: {'Ethical' if is_ethical else 'Unethical'}")
            return is_ethical
        except Exception as e:
            self.logger.error(f"Error parsing ethical evaluation: {e}")
            return True  # Default to allowing the task if there's an error

    async def evaluate_action(self, action: str, params: Dict[str, Any]) -> bool:
        if not self.enabled:
            self.logger.info("Ethical Framework is disabled. Action approved without evaluation.")
            return True

        prompt = self.prompt_manager.get_prompt(
            "ethical.evaluate_action",
            action=action,
            params=params,
            principles=self.ethical_principles
        )

        response = await self.llm_interface.generate(prompt)
        try:
            evaluation = self.llm_interface.parse_json(response)
            return evaluation['overall_assessment'] == 'ethical'
        except:
            # If there's an error in parsing or unexpected response, err on the side of caution
            return False

    async def get_ethical_explanation(self, task_or_action: str, is_task: bool = True) -> str:
        if not self.enabled:
            return "Ethical Framework is disabled. No ethical evaluation performed."

        prompt = self.prompt_manager.get_prompt(
            "ethical.get_explanation",
            task_or_action_type="Task" if is_task else "Action",
            description=task_or_action,
            principles=self.ethical_principles
        )

        return await self.llm_interface.generate(prompt)

    def update_ethical_principles(self, new_principles: List[str]):
        """
        Update the ethical principles. This method could be called to evolve the ethical framework over time.
        """
        self.ethical_principles = new_principles

    async def get_ethical_dilemma_resolution(self, scenario: str) -> str:
        if not self.enabled:
            return "Ethical Framework is disabled. No ethical dilemma resolution performed."

        prompt = self.prompt_manager.get_prompt(
            "ethical.resolve_dilemma",
            scenario=scenario,
            principles=self.ethical_principles
        )

        return await self.llm_interface.generate(prompt)

if __name__ == "__main__":
    # This is a mock implementation for testing purposes
    class MockLLMInterface:
        def generate(self, prompt):
            return '{"principle_evaluations": [{"principle": "Do no harm", "evaluation": "aligns"}], "overall_assessment": "ethical", "reasoning": "The task does not appear to cause harm."}'
        def parse_json(self, json_str):
            import json
            return json.loads(json_str)

    # Test with ethical framework enabled
    ef_enabled = EthicalFramework(MockLLMInterface(), enabled=True)
    task = "Analyze user data to improve system performance"
    is_ethical = ef_enabled.evaluate_task(task)
    print(f"Ethical Framework Enabled - Is the task ethical? {is_ethical}")

    # Test with ethical framework disabled
    ef_disabled = EthicalFramework(MockLLMInterface(), enabled=False)
    is_ethical = ef_disabled.evaluate_task(task)
    print(f"Ethical Framework Disabled - Is the task ethical? {is_ethical}")

    # Test enabling/disabling
    ef_disabled.set_enabled(True)
    is_ethical = ef_disabled.evaluate_task(task)
    print(f"Ethical Framework Re-enabled - Is the task ethical? {is_ethical}")
