# task_manager.py

import re
from typing import List, Dict, Any, Optional
from queue import PriorityQueue
from datetime import datetime
import uuid
import logging

from core.llm_interface import LLMInterface
from core.ethical_framework import EthicalFramework
from core.action_manager import ActionManager
from core.memory import Memory


def parse_int_or_default(value, default=1):
    """
    Parse a string as an integer, or return a default value if parsing fails.
    """
    try:
        return int(value)
    except (ValueError, TypeError):
        return default


class Task:
    def __init__(
        self,
        description: str,
        action: str,
        parameters: Dict[str, Any],
        priority: int = 1,
        deadline: Optional[datetime] = None,
        parent_id: Optional[str] = None,
        required_inputs: Dict[str, Any] = None,
        goal: str = None,
    ):
        self.id = str(uuid.uuid4())
        self.description = description
        self.action = action
        self.parameters = parameters
        self.priority = parse_int_or_default(priority)
        self.deadline = deadline
        self.created_at = datetime.now()
        self.completed_at = None
        self.status = "pending"
        self.result = None
        self.parent_id = parent_id
        self.subtasks: List[str] = []
        self.ethical_evaluation: Optional[Dict[str, Any]] = None
        self.required_inputs = required_inputs or {}
        self.output = None
        self.goal = goal

    def __lt__(self, other):
        if not isinstance(other, Task):
            return NotImplemented
        if self.priority == other.priority:
            return self.created_at < other.created_at
        return self.priority > other.priority

    def __eq__(self, other):
        if not isinstance(other, Task):
            return NotImplemented
        return self.id == other.id

    def __repr__(self):
        return f"Task(id={self.id}, description='{self.description}', priority={self.priority}, status='{self.status}')"


class TaskManager:
    def __init__(
        self,
        llm_interface: LLMInterface,
        ethical_framework: EthicalFramework,
        action_manager: ActionManager,
        memory: Memory,
    ):
        self.task_queue = PriorityQueue()
        self.completed_tasks: List[Task] = []
        self.all_tasks: Dict[str, Task] = {}
        self.llm_interface = llm_interface
        self.ethical_framework = ethical_framework
        self.action_manager = action_manager
        self.memory = memory
        self.logger = logging.getLogger("Jiva.TaskManager")

    def get_relevant_actions(self, goal: str, context: Dict[str, Any]) -> List[str]:
        # Get available actions with their descriptions and parameters
        available_actions = self.action_manager.get_available_actions()

        # Format the actions and their parameters for the prompt
        action_descriptions = []
        for action_name, action_info in available_actions.items():
            # param_desc = action_info['description']
            action_descriptions.append(f"""- {action_name}\n
            """)

        actions_str = "\n\n".join(action_descriptions)

        prompt = f"""
        # Given the below goal and context, identify the relevant actions from the list of actions below that would be required to complete this task. Respond with comma separated action names with no spaces.
        Please make sure action names you return match exactly with the action names provided in the list below. Your task is to pick the relevant ones.
        # Goal
        {goal}

        # Context
        {context}
        
        # Available actions and their parameters
        {actions_str}
        """

        response = self.llm_interface.generate(prompt)
        action_names = []
        if "," in response:
            split_result = response.split(",")
            for action in split_result:
                action_names.append(action.strip())

        return action_names

    def generate_tasks(
        self, goal: str, context: Dict[str, Any]
    ) -> List[Dict[str, Any]]:
        # Get available actions with their descriptions and parameters
        available_actions = self.action_manager.get_available_actions()

        # Get actions relevant to this run.
        relevant_actions = self.get_relevant_actions(goal=goal, context=context)
        # Mandatory actions fo context
        mandatory_actions = ["think", "replan_tasks"]

        # Format the actions and their parameters for the prompt
        action_descriptions = []
        for action_name, action_info in available_actions.items():
            if action_name in relevant_actions or action_name in mandatory_actions:
                param_desc = action_info["description"]
                action_descriptions.append(f"""## {action_name}\n
                ### Description (docstring)
                {param_desc}
                """)

        actions_str = "\n\n".join(action_descriptions)

        prompt = f"""
        # Goal
        {goal}

        ## Your approach
        You strive to achieve a given task in as few steps as possible

        # Your Task
        Generate a list of tasks to achieve the goal. Each task should have:
        1. A description
        2. An action name (from the available actions)
        3. Parameters for the action (matching the required parameters)
        4. A list of required inputs (task descriptions that this task depends on)

        Include 'think' actions to process information or make decisions, and other actions to perform specific operations.
        'think' actions will require static prompts, so design these tasks well to accomplish the goal.
        Ensure that tasks are properly sequenced and that information flows correctly between tasks.
        Use the required_inputs key to create a parameter name and value dependency between tasks. Once the action is called,
        it will be invoked with parameter value obtained from a previous task.

        The value of required_inputs should be a dictionary of parameter name (from the function) and the exact task description of a previous task.

        If you do not have enough information to plan all of the tasks at once, you can create some initial tasks and temporarily end with a replan_tasks action.
        Once information is gathered from previous tasks, a replan_tasks will prepare a fresh set of next tasks.

        # Context
        ## Understanding the context
        The context below is a series of short term memory objects of which the last one is the most recent input
        ## The context items
        {context}
        
        # Available actions and their parameters
        {actions_str}

        Respond only with a JSON array of tasks and nothing else. Each task should be an object with the following structure:
        {{
            "description": "Task description",
            "action": "action_name",
            "parameters": {{
                "param1": "static_value_1",
                "param2": "{{{{value2}}}}"
            }},
            "required_inputs": {{"value2": "Exact Description of prerequisite task"}}
        }}

        Please ensure that the response adheres to the structure defined, and if there are any required_inputs, then they have been referenced with a placeholder like {{value}} in the parameters as shown in the example.
        """

        self.logger.debug(f"Generating tasks with prompt: {prompt}")
        response = self.llm_interface.generate(prompt)
        self.logger.debug(f"LLM response: {response}")

        try:
            tasks = self.llm_interface.parse_json(response)
            self.logger.debug(f"Parsed tasks: {tasks}")
            if not isinstance(tasks, list):
                raise ValueError("Expected a list of tasks")

            processed_tasks = self.add_raw_tasks(tasks, goal)
            return processed_tasks
        except Exception as e:
            self.logger.error(f"Error parsing LLM response: {e}")
            return [
                {
                    "description": f"Analyze goal: {goal}",
                    "action": "think",
                    "parameters": {"prompt": goal},
                    "required_inputs": [],
                }
            ]

    def add_raw_tasks(self, raw_tasks: Dict[str, Any], goal: str) -> List[Task]:
        tasks: List[Task] = []
        last_task_id = None
        for raw_task in raw_tasks:
            task = Task(**raw_task)
            task.goal = goal

            # Reset the last_task_id if this current task is a think task.
            if task.action.strip().lower() == "think":
                last_task_id = None

            task.parent_id = last_task_id if last_task_id else None
            tasks.append(task)
            self.task_queue.put(task)
            self.all_tasks[task.id] = task
            if last_task_id and last_task_id in self.all_tasks:
                self.all_tasks[last_task_id].subtasks.append(task.id)

            # If this is a think task, make it the parent for the next set of tasks.
            if task and task.action.strip().lower() == "think":
                last_task_id = task.id

        return tasks

    def add_task(
        self,
        description: str,
        action: str,
        parameters: Dict[str, Any],
        priority: int = 1,
        deadline: Optional[datetime] = None,
        parent_id: Optional[str] = None,
        required_inputs: Dict[str, Any] = None,
    ) -> Optional[str]:
        if self.ethical_framework.evaluate_task(description):
            task = Task(
                description,
                action,
                parameters,
                priority,
                deadline,
                parent_id,
                required_inputs,
            )
            self.task_queue.put(task)
            self.all_tasks[task.id] = task
            if parent_id and parent_id in self.all_tasks:
                self.all_tasks[parent_id].subtasks.append(task.id)

            task.ethical_evaluation = {
                "explanation": self.ethical_framework.get_ethical_explanation(
                    description
                ),
                "is_ethical": True,
            }
            return task.id
        else:
            return None

    def get_next_task(self) -> Optional[Task]:
        if not self.task_queue.empty():
            return self.task_queue.get()
        return None

    def complete_task(self, task_id: str, result: Any) -> bool:
        if task_id in self.all_tasks:
            task = self.all_tasks[task_id]
            task.status = "completed"
            task.completed_at = datetime.now()
            task.result = result
            task.output = result
            self.completed_tasks.append(task)

            # Remove from queue if it's still there
            new_queue = PriorityQueue()
            while not self.task_queue.empty():
                queued_task = self.task_queue.get()
                if queued_task.id != task_id:
                    new_queue.put(queued_task)
            self.task_queue = new_queue

            self.logger.info(
                f"Task {task_id} completed. Remaining tasks: {self.task_queue.qsize()}"
            )
            return True
        return False

    def get_task_status(self, task_id: str) -> Optional[Dict[str, Any]]:
        if task_id in self.all_tasks:
            task = self.all_tasks[task_id]
            return {
                "id": task.id,
                "description": task.description,
                "status": task.status,
                "created_at": task.created_at,
                "completed_at": task.completed_at,
                "priority": task.priority,
                "deadline": task.deadline,
                "result": task.result,
                "parent_id": task.parent_id,
                "subtasks": task.subtasks,
                "ethical_evaluation": task.ethical_evaluation,
                "action": task.action,
                "parameters": task.parameters,
                "required_inputs": task.required_inputs,
                "output": task.output,
            }
        return None

    def execute_task(self, task: Task) -> Any:
        self.logger.info(f"Executing task: {task.description}")
        try:
            # Resolve parameters based on required inputs
            for param, required_task_desc in task.required_inputs.items():
                input_task_result = self.get_input_task_result(required_task_desc)
                if input_task_result is not None:
                    # Replace the placeholder in all parameters
                    for key, value in task.parameters.items():
                        if isinstance(value, str) and f"{{{{{param}}}}}" in str(value):
                            task.parameters[key] = str(value).replace(
                                f"{{{{{param}}}}}", str(input_task_result)
                            )
                else:
                    self.logger.warning(
                        f"Could not find result for required input: {required_task_desc}"
                    )

            # Check if any parameters still contain unresolved placeholders
            for key, value in task.parameters.items():
                if isinstance(value, str) and "{{" in value and "}}" in value:
                    self.logger.warning(
                        f"Parameter '{key}' contains unresolved placeholder: {value}"
                    )

            if task.action == "replan_tasks":
                new_tasks = self.replan_tasks(task)
                result = str(new_tasks)
            else:
                result = self.action_manager.execute_action(
                    task.action, task.parameters
                )
            self.logger.info(f"Task executed successfully: {result}")

            # Store the result
            task.result = result
            task.output = result
            self.complete_task(task.id, result)

            # Store in memory
            self.memory.add_to_short_term(
                {"task_id": task.id, "description": task.description, "result": result}
            )

            return result
        except Exception as e:
            self.logger.error(f"Error executing task: {str(e)}", exc_info=True)
            return f"Error executing task: {str(e)}"

    def replan_tasks(self, task: Task):
        """
        Replans all tasks to achieve goal state.
        """
        current_tasks = []
        for task_id in self.all_tasks:
            t = self.all_tasks[task_id]
            if t.goal == task.goal:
                current_tasks.append(
                    {
                        "description": t.description,
                        "action": t.action,
                        "parameters": t.parameters,
                        "required_inputs": t.required_inputs,
                        "result": str(t.result)[:100],
                    }
                )

        context = {"previous_tasks": current_tasks}

        replan_prompt = f"""
        Replan tasks to achieve this goal: {task.goal}
        You have partially executed some tasks to achieve this task and then requested replanning. The previous tasks and their results are available in context.
        """

        new_tasks = self.generate_tasks(task.goal, context)
        return new_tasks

    def get_input_task_result(self, task_description: str) -> Any:
        """
        Find the result of a task based on its exact description.
        """
        for task in reversed(
            self.all_tasks.values()
        ):  # Start from the most recent task
            if task.description.strip() == task_description.strip():
                return task.result

        for task in reversed(
            self.all_tasks.values()
        ):  # Start from the most recent task
            if task_description.strip() in task.description.strip():
                return task.result

        return None

    def has_pending_tasks(self) -> bool:
        return not self.task_queue.empty()

    def get_pending_task_count(self) -> int:
        return self.task_queue.qsize()

    def log_task_queue_state(self):
        tasks = list(self.task_queue.queue)
        self.logger.info(f"Current task queue state:")
        for i, task in enumerate(tasks):
            self.logger.info(
                f"  {i+1}. ID: {task.id}, Description: {task.description}, Priority: {task.priority}"
            )


if __name__ == "__main__":
    # This allows us to run some basic tests
    from unittest.mock import MagicMock

    # Mock dependencies
    llm_interface = MagicMock()
    ethical_framework = MagicMock()
    action_manager = MagicMock()
    memory = MagicMock()

    # Set up logging
    logging.basicConfig(level=logging.INFO)

    # Create TaskManager instance
    task_manager = TaskManager(llm_interface, ethical_framework, action_manager, memory)

    # Test task generation
    llm_interface.generate.return_value = '[{"description": "Test task", "priority": 3, "action": "think", "parameters": {"prompt": "Test prompt"}, "required_inputs": []}]'
    llm_interface.parse_json.return_value = [
        {
            "description": "Test task",
            "priority": 3,
            "action": "think",
            "parameters": {"prompt": "Test prompt"},
            "required_inputs": [],
        }
    ]
    ethical_framework.evaluate_task.return_value = True
    ethical_framework.get_ethical_explanation.return_value = "Ethical explanation"

    task_ids = task_manager.generate_tasks("Test goal", {})
    print(f"Generated task IDs: {task_ids}")

    # Test task execution
    action_manager.execute_action.return_value = "Task result"
    task = task_manager.get_next_task()
    if task:
        result = task_manager.execute_task(task)
        print(f"Task execution result: {result}")

    # Test task queue state logging
    task_manager.log_task_queue_state()

    print("TaskManager tests completed.")
