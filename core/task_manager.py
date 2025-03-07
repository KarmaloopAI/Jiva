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
from core.prompt_manager import PromptManager

def parse_int_or_default(value, default=1):
    """
    Parse a string as an integer, or return a default value if parsing fails.
    """
    try:
        return int(value)
    except (ValueError, TypeError):
        return default

class Task:
    def __init__(self, description: str, action: str, parameters: Dict[str, Any], 
                 priority: int = 1, deadline: Optional[datetime] = None, 
                 parent_id: Optional[str] = None, required_inputs: Dict[str, Any] = None, goal: str = None):
        self.id = str(uuid.uuid4())
        self.description = description
        self.action = action
        self.parameters = parameters
        self.original_parameters = parameters.copy()    # Retain a copy of the original parameters
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
    def __init__(self, llm_interface: LLMInterface, ethical_framework: EthicalFramework, 
                 action_manager: ActionManager, memory: Memory, prompt_manager: PromptManager):
        self.task_queue = PriorityQueue()
        self.completed_tasks: List[Task] = []
        self.all_tasks: Dict[str, Task] = {}
        self.llm_interface = llm_interface
        self.ethical_framework = ethical_framework
        self.action_manager = action_manager
        self.memory = memory
        self.prompt_manager = prompt_manager
        self.logger = logging.getLogger("Jiva.TaskManager")

    async def get_relevant_actions(self, goal: str, context: Dict[str, Any]) -> List[str]:
        # Get available actions with their descriptions and parameters
        available_actions = self.action_manager.get_available_actions()
        
        # Format the actions and their parameters for the prompt
        action_descriptions = []
        for action_name, action_info in available_actions.items():
            # param_desc = action_info['description']
            action_descriptions.append(f"""- {action_name}\n
            """)
        
        actions_str = "\n\n".join(action_descriptions)

        prompt = self.prompt_manager.get_prompt(
            "tasks.get_relevant_actions",
            goal=goal,
            context=context,
            actions_str=actions_str
        )

        response = await self.llm_interface.generate(prompt)
        action_names = []
        split_result = response.split(',')
        for action in split_result:
            action_names.append(action.strip())
        
        return action_names

    async def generate_tasks(self, goal: str, context: Dict[str, Any]) -> List[Dict[str, Any]]:
        # Get available actions with their descriptions and parameters
        available_actions = self.action_manager.get_available_actions()

        # Get actions relevant to this run.
        relevant_actions = await self.get_relevant_actions(goal=goal, context=context)
        # Mandatory actions fo context
        mandatory_actions = ['think', 'replan_tasks', 'sleep', 'rerun_tasks']
        
        # Format the actions and their parameters for the prompt
        action_descriptions = []
        for action_name, action_info in available_actions.items():
            if action_name in relevant_actions or action_name in mandatory_actions:
                param_desc = action_info['description']
                action_descriptions.append(f"""## {action_name}\n
                ### Description (docstring)
                {param_desc}
                """)
        
        actions_str = "\n\n".join(action_descriptions)

        prompt = prompt = self.prompt_manager.get_prompt(
            "tasks.generate_tasks",
            goal=goal,
            context=context,
            actions_str=actions_str
        )
        
        self.logger.debug(f"Generating tasks with prompt: {prompt}")
        response = await self.llm_interface.generate(prompt)
        self.logger.debug(f"LLM response: {response}")
        
        try:
            tasks = self.llm_interface.parse_json(response)
            self.logger.debug(f"Parsed tasks: {tasks}")
            if not isinstance(tasks, list):
                raise ValueError("Expected a list of tasks")
            
            for task in tasks:
                if not isinstance(task.get('parameters', {}), dict):
                    task['parameters'] = {"prompt": str(task.get('parameters', ''))}
            
            processed_tasks = self.add_raw_tasks(tasks, goal)
            return processed_tasks
        except Exception as e:
            self.logger.error(f"Error parsing LLM response: {e}")
            return [{"description": f"Analyze goal: {goal}", "action": "think", "parameters": {"prompt": goal}, "required_inputs": []}]

    def add_raw_tasks(self, raw_tasks: List[Dict[str, Any]], goal: str) -> List[Task]:
        """Add tasks from raw task dictionaries."""
        tasks: List[Task] = []
        last_task_id = None
        for raw_task in raw_tasks:
            task = Task(**raw_task)
            task.goal = goal

            if task.action.strip().lower() == 'think':
                last_task_id = None

            task.parent_id = last_task_id if last_task_id else None
            tasks.append(task)
            
            # Add task to both dictionaries and queue
            self.all_tasks[task.id] = task
            self.task_queue.put(task)  # Make sure tasks get into the queue
            
            if last_task_id and last_task_id in self.all_tasks:
                self.all_tasks[last_task_id].subtasks.append(task.id)

            if task.action.strip().lower() == 'think':
                last_task_id = task.id

        return tasks

    def requeue_pending_tasks(self):
        """Re-queue any tasks that are pending but not in the queue."""
        requeued_count = 0
        pending_tasks = [
            task for task in self.all_tasks.values()
            if task.status == "pending"
        ]
        
        # Clear the queue and rebuild it with pending tasks
        self.task_queue = PriorityQueue()
        for task in pending_tasks:
            self.task_queue.put(task)
            requeued_count += 1
            self.logger.debug(f"Re-queued pending task: {task.id}")
            
        self.logger.info(f"Requeued {requeued_count} pending tasks")
        return pending_tasks

    def add_task(self, description: str, action: str, parameters: Dict[str, Any], 
                 priority: int = 1, deadline: Optional[datetime] = None, 
                 parent_id: Optional[str] = None, required_inputs: Dict[str, Any] = None) -> Optional[str]:
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

    async def execute_task(self, task: Task) -> Any:
        self.logger.info(f"Executing task: {task.description}")
        try:
            # Ensure parameters is always a dict
            if isinstance(task.parameters, str):
                task.parameters = {"prompt": task.parameters}
            elif task.parameters is None:
                task.parameters = {}

            # Resolve parameters based on required inputs
            for param, required_task_desc in (task.required_inputs or {}).items():
                input_task_result = self.get_input_task_result(required_task_desc)
                if input_task_result is not None:
                    # Replace the placeholder in all parameters
                    for key, value in task.parameters.items():
                        if isinstance(value, str) and f'{{{{{param}}}}}' in str(value):
                            task.parameters[key] = str(value).replace(f'{{{{{param}}}}}', str(input_task_result))
                else:
                    self.logger.warning(f"Could not find result for required input: {required_task_desc}")

            # Check if any parameters still contain unresolved placeholders
            for key, value in task.parameters.items():
                if isinstance(value, str) and '{{' in value and '}}' in value:
                    self.logger.warning(f"Parameter '{key}' contains unresolved placeholder: {value}")

            # Execute the task
            if task.action == 'replan_tasks':
                new_tasks = await self.replan_tasks(task)
                result = str(new_tasks)
            elif task.action == 'rerun_tasks':
                new_tasks = await self.handle_rerun_tasks(task)
                result = str(new_tasks)
            else:
                result = await self.action_manager.execute_action(task.action, task.parameters)
            
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
            self.logger.error(f"Error executing task: {str(e)}", exc_info=True)
            await self.handle_task_error(task, str(e))
            return f"Error executing task: {str(e)}"

    async def handle_task_error(self, task: Task, error_message: str) -> None:
        """Handle task execution errors by generating new tasks or providing solutions."""
        self.logger.info(f"Handling error for task: {task.id}")
        prompt = self.prompt_manager.get_prompt(
            "tasks.handle_task_error",
            task_description=task.description,
            action=task.action,
            parameters=task.parameters,
            error_message=error_message
        )
        try:
            solution = await self.llm_interface.generate(prompt)
            parsed_solution = self.llm_interface.parse_json(solution)
            
            if isinstance(parsed_solution, dict) and "new_tasks" in parsed_solution:
                new_tasks = parsed_solution["new_tasks"]
                tasks_added = self.add_raw_tasks(new_tasks, task.goal)
                self.logger.info(f"Added {len(tasks_added)} new tasks to handle error")
            else:
                self.logger.warning("Could not generate new tasks from solution")
            
            # Mark the original task as failed
            task.status = "failed"
            task.result = {
                "error": error_message,
                "solution_attempted": True
            }
            
        except Exception as e:
            self.logger.error(f"Error handling task failure: {str(e)}")
            # Mark the original task as failed
            task.status = "failed"
            task.result = {
                "error": error_message,
                "solution_attempted": False
            }

    async def replan_tasks(self, task: Task):
        """
        Replans all tasks to achieve goal state.
        """
        current_tasks = []
        for task_id in self.all_tasks:
            t = self.all_tasks[task_id]
            if t.goal == task.goal:
                current_tasks.append({
                    "description": t.description,
                    "action": t.action,
                    "parameters": t.parameters,
                    "required_inputs": t.required_inputs,
                    "result": str(t.result)[:100]
                })
        
        context = {
            "previous_tasks": current_tasks
        }

        prompt = self.prompt_manager.get_prompt(
            "tasks.replan_tasks",
            goal=task.goal
        )

        new_tasks = await self.generate_tasks(prompt, context)
        return new_tasks

    async def handle_rerun_tasks(self, task: Task) -> List[Task]:
        """
        Handle rerun_tasks action by evaluating if iteration is needed and recreating all tasks
        from the specified start point up to the current task.
        """
        # Find the starting task (point A) by matching description from parameters
        start_task_name = task.parameters.get("task_name")
        if not start_task_name:
            self.logger.error("No task name provided for rerun_tasks")
            return []

        # Get all tasks with the same goal, ordered by creation time
        goal_tasks = sorted(
            [t for t in self.all_tasks.values() if t.goal == task.goal],
            key=lambda x: x.created_at
        )

        # Find the starting task and current task indices
        start_idx = None
        current_idx = None
        for idx, t in enumerate(goal_tasks):
            if t.description == start_task_name:
                start_idx = idx
            if t.id == task.id:  # This is our current rerun_tasks task (point B)
                current_idx = idx
                break

        if start_idx is None or current_idx is None:
            self.logger.error(f"Could not find task sequence for rerun_tasks: start={start_task_name}")
            return []

        # Get the execution history of the starting task
        previous_runs = [t for t in goal_tasks[:current_idx] 
                        if t.description == start_task_name]
        
        timestamps = [t.created_at.isoformat() for t in previous_runs]
        current_time = datetime.now().isoformat()
        
        prompt = f"""Goal: {task.goal}
    Previous executions of '{start_task_name}': {timestamps}
    Current time: {current_time}

    Should another iteration of these tasks be executed? Consider the time elapsed between runs.
    Respond with only 'yes' or 'no'."""

        should_rerun = await self.llm_interface.generate(prompt)
        
        if should_rerun.strip().lower() == 'yes':
            # Create new tasks for all tasks from start_idx to current_idx (exclusive)
            new_tasks = []
            for original_task in goal_tasks[start_idx:current_idx+1]:
                new_task = Task(
                    description=original_task.description,
                    action=original_task.action,
                    parameters=original_task.original_parameters.copy(),
                    required_inputs=original_task.required_inputs.copy(),
                    goal=task.goal,
                    priority=original_task.priority
                )
                self.all_tasks[new_task.id] = new_task
                self.task_queue.put(new_task)
                new_tasks.append(new_task)
                
            self.logger.info(f"Rerunning {len(new_tasks)} tasks from '{start_task_name}'")
            return new_tasks
                
        self.logger.info(f"No rerun needed for tasks starting with '{start_task_name}'")
        return []

    def get_input_task_result(self, task_description: str) -> Any:
        """
        Find the result of a task based on its exact description.
        """
        for task in reversed(self.all_tasks.values()):  # Start from the most recent task
            if task.description.strip() == task_description.strip():
                return task.result
        
        for task in reversed(self.all_tasks.values()):  # Start from the most recent task
            if task_description.strip() in task.description.strip():
                return task.result
        
        return None

    def has_pending_tasks(self) -> bool:
        """Check for any pending tasks and ensure they're in the queue."""
        pending_tasks = self.get_pending_tasks()
        if pending_tasks:
            # Requeue if we have pending tasks
            self.requeue_pending_tasks()
        return bool(pending_tasks)
    
    def get_pending_tasks(self) -> List[Task]:
        """Get all pending tasks from all_tasks."""
        return [
            task for task in self.all_tasks.values()
            if task.status == "pending"
        ]

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
