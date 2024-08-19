# core/task_manager.py

from typing import List, Dict, Any, Optional
from queue import PriorityQueue
from datetime import datetime
import uuid
import logging

from core.llm_interface import LLMInterface
from core.ethical_framework import EthicalFramework
from core.action_manager import ActionManager

class Task:
    def __init__(self, description: str, priority: int = 1, deadline: Optional[datetime] = None, parent_id: Optional[str] = None, action: str = None, parameters: Dict[str, Any] = None):
        self.id = str(uuid.uuid4())
        self.description = description
        self.priority = priority
        self.deadline = deadline
        self.created_at = datetime.now()
        self.completed_at = None
        self.status = "pending"
        self.result = None
        self.parent_id = parent_id
        self.subtasks: List[str] = []
        self.ethical_evaluation: Optional[Dict[str, Any]] = None
        self.action = action
        self.parameters = parameters or {}

    def __lt__(self, other):
        if self.priority == other.priority:
            return self.created_at < other.created_at
        return self.priority > other.priority

class TaskManager:
    def __init__(self, llm_interface: LLMInterface, ethical_framework: EthicalFramework, action_manager: ActionManager):
        self.task_queue = PriorityQueue()
        self.completed_tasks: List[Task] = []
        self.all_tasks: Dict[str, Task] = {}
        self.llm_interface = llm_interface
        self.ethical_framework = ethical_framework
        self.action_manager = action_manager
        self.logger = logging.getLogger("Jiva.TaskManager")

    def add_task(self, description: str, priority: int = 1, action: str = None, parameters: Dict[str, Any] = None, deadline: Optional[datetime] = None, parent_id: Optional[str] = None) -> Optional[str]:
        if self.ethical_framework.evaluate_task(description):
            task = Task(description, priority, deadline, parent_id, action, parameters)
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

    def generate_tasks(self, goal: str, context: Dict[str, Any]) -> List[str]:
        self.logger.info(f"Generating tasks for goal: {goal}")
        prompt = f"""
        Goal: {goal}
        Context: {context}
        
        Given the above goal and context, generate a list of tasks that need to be completed to achieve the goal. 
        For each task, provide:
        1. A clear, concise description
        2. A priority level (1-5, where 5 is highest priority)
        3. The specific action to be taken (e.g., 'write_file', 'read_file', etc.)
        4. The parameters for the action in the correct format

        Available actions and their parameter formats:
        - write_file(file_path: str, content: str)
        - read_file(file_path: str)
        - append_file(file_path: str, content: str)
        - delete_file(file_path: str)
        - list_directory(directory_path: str)
        - create_directory(directory_path: str)

        Format your response as a JSON list of tasks, where each task is an object with 'description', 'priority', 'action', and 'parameters' fields.
        """
        
        response = self.llm_interface.generate(prompt)
        self.logger.debug(f"LLM response: {response}")
        
        try:
            tasks = self.llm_interface.parse_json(response)
            self.logger.debug(f"Parsed tasks: {tasks}")
            if not isinstance(tasks, list):
                raise ValueError("Expected a list of tasks")
        except Exception as e:
            self.logger.error(f"Error parsing LLM response: {e}")
            tasks = [{"description": f"Analyze goal: {goal}", "priority": 3, "action": "analyze_text", "parameters": {"text": goal}}]
        
        task_ids = []
        for task in tasks:
            if isinstance(task, dict) and 'description' in task and 'action' in task and 'parameters' in task:
                task_id = self.add_task(
                    description=task['description'],
                    priority=task.get('priority', 3),
                    action=task['action'],
                    parameters=task['parameters']
                )
                if task_id:
                    task_ids.append(task_id)
                    self.logger.info(f"Added task: {task}")
            else:
                self.logger.warning(f"Skipping invalid task: {task}")
        
        return task_ids

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
            self.completed_tasks.append(task)
            
            # Remove from queue if it's still there
            self.task_queue = PriorityQueue([t for t in list(self.task_queue.queue) if t.id != task_id])
            
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
                "parameters": task.parameters
            }
        return None

    def execute_task(self, task: Task) -> Any:
        self.logger.info(f"Executing task: {task.description}")
        try:
            action = getattr(self.action_manager, task.action)
            result = action(**task.parameters)
            self.logger.info(f"Task executed successfully: {result}")
            return result
        except AttributeError:
            self.logger.error(f"Action {task.action} not found")
            return f"Error: Action {task.action} not found"
        except TypeError as e:
            self.logger.error(f"Error executing task: {str(e)}")
            return f"Error executing task: {str(e)}"
        except Exception as e:
            self.logger.error(f"Unexpected error executing task: {str(e)}")
            return f"Unexpected error: {str(e)}"
