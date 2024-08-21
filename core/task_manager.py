# task_manager.py

from typing import List, Dict, Any, Optional
from queue import PriorityQueue
from datetime import datetime
import uuid
import logging

from core.llm_interface import LLMInterface
from core.ethical_framework import EthicalFramework
from core.action_manager import ActionManager
from core.memory import Memory

class Task:
    def __init__(self, description: str, action: str, parameters: Dict[str, Any], 
                 priority: int = 1, deadline: Optional[datetime] = None, 
                 parent_id: Optional[str] = None, required_inputs: List[str] = None):
        self.id = str(uuid.uuid4())
        self.description = description
        self.action = action
        self.parameters = parameters
        self.priority = priority
        self.deadline = deadline
        self.created_at = datetime.now()
        self.completed_at = None
        self.status = "pending"
        self.result = None
        self.parent_id = parent_id
        self.subtasks: List[str] = []
        self.ethical_evaluation: Optional[Dict[str, Any]] = None
        self.required_inputs = required_inputs or []
        self.output = None

    def __lt__(self, other):
        if self.priority == other.priority:
            return self.created_at < other.created_at
        return self.priority > other.priority

class TaskManager:
    def __init__(self, llm_interface: LLMInterface, ethical_framework: EthicalFramework, 
                 action_manager: ActionManager, memory: Memory):
        self.task_queue = PriorityQueue()
        self.completed_tasks: List[Task] = []
        self.all_tasks: Dict[str, Task] = {}
        self.llm_interface = llm_interface
        self.ethical_framework = ethical_framework
        self.action_manager = action_manager
        self.memory = memory
        self.logger = logging.getLogger("Jiva.TaskManager")

    def generate_tasks(self, goal: str, context: Dict[str, Any]) -> List[Dict[str, Any]]:
        # Get available actions with their descriptions and parameters
        available_actions = self.action_manager.get_available_actions()
        
        # Format the actions and their parameters for the prompt
        action_descriptions = []
        for action_name, action_info in available_actions.items():
            params = action_info.get('parameters', {})
            param_desc = ", ".join([f"{k}: {v}" for k, v in params.items()])
            action_descriptions.append(f"{action_name} - Parameters: {param_desc}")
        
        actions_str = "\n".join(action_descriptions)

        prompt = f"""
        Goal: {goal}
        Context: {context}
        
        Available actions and their parameters:
        {actions_str}

        Generate a list of tasks to achieve the goal. Each task should have:
        1. A description
        2. An action name (from the available actions)
        3. Parameters for the action (matching the required parameters)
        4. A list of required inputs (task descriptions that this task depends on)

        Include 'think' actions to process information or make decisions, and other actions to perform specific operations.
        Ensure that tasks are properly sequenced and that information flows correctly between tasks.

        Respond with a JSON array of tasks. Each task should be an object with the following structure:
        {{
            "description": "Task description",
            "action": "action_name",
            "parameters": {{
                "param1": "value1",
                "param2": "value2"
            }},
            "required_inputs": ["Description of prerequisite task 1", "Description of prerequisite task 2"]
        }}
        """
        
        self.logger.debug(f"Generating tasks with prompt: {prompt}")
        response = self.llm_interface.generate(prompt)
        self.logger.debug(f"LLM response: {response}")
        
        try:
            tasks = self.llm_interface.parse_json(response)
            self.logger.debug(f"Parsed tasks: {tasks}")
            if not isinstance(tasks, list):
                raise ValueError("Expected a list of tasks")
            return tasks
        except Exception as e:
            self.logger.error(f"Error parsing LLM response: {e}")
            return [{"description": f"Analyze goal: {goal}", "action": "think", "parameters": {"prompt": goal}, "required_inputs": []}]

    def add_task(self, description: str, action: str, parameters: Dict[str, Any], 
                 priority: int = 1, deadline: Optional[datetime] = None, 
                 parent_id: Optional[str] = None, required_inputs: List[str] = None) -> Optional[str]:
        if self.ethical_framework.evaluate_task(description):
            task = Task(description, action, parameters, priority, deadline, parent_id, required_inputs)
            self.task_queue.put(task)
            self.all_tasks[task.id] = task
            if parent_id and parent_id in self.all_tasks:
                self.all_tasks[parent_id].subtasks.append(task.id)
            
            task.ethical_evaluation = {
                "explanation": self.ethical_framework.get_ethical_explanation(description),
                "is_ethical": True
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
            
            self.logger.info(f"Task {task_id} completed. Remaining tasks: {self.task_queue.qsize()}")
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
                "output": task.output
            }
        return None

    def execute_task(self, task: Task) -> Any:
        self.logger.info(f"Executing task: {task.description}")
        try:
            # Gather inputs from required tasks
            inputs = {}
            for input_task_description in task.required_inputs:
                input_task = next((t for t in self.all_tasks.values() if t.description == input_task_description), None)
                if not input_task:
                    raise Exception(f"Required input task '{input_task_description}' not found")
                if input_task.status != "completed":
                    raise Exception(f"Required input task '{input_task_description}' not completed")
                inputs[input_task.id] = input_task.output

            # Add inputs to task parameters
            task.parameters['inputs'] = inputs

            result = self.action_manager.execute_action(task.action, task.parameters)
            self.logger.info(f"Task executed successfully: {result}")
            
            # Store the result
            task.result = result
            task.output = result
            self.complete_task(task.id, result)

            # Store in memory
            self.memory.add_to_short_term({
                "task_id": task.id,
                "description": task.description,
                "result": result
            })

            return result
        except Exception as e:
            self.logger.error(f"Error executing task: {str(e)}")
            return f"Error executing task: {str(e)}"

    def has_pending_tasks(self) -> bool:
        return not self.task_queue.empty()

    def get_pending_task_count(self) -> int:
        return self.task_queue.qsize()

    def log_task_queue_state(self):
        tasks = list(self.task_queue.queue)
        self.logger.info(f"Current task queue state:")
        for i, task in enumerate(tasks):
            self.logger.info(f"  {i+1}. ID: {task.id}, Description: {task.description}, Priority: {task.priority}")

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
    llm_interface.parse_json.return_value = [{"description": "Test task", "priority": 3, "action": "think", "parameters": {"prompt": "Test prompt"}, "required_inputs": []}]
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
