# core/task_manager.py

from typing import List, Dict, Any, Optional
from queue import PriorityQueue
from datetime import datetime
import uuid
import logging

from core.llm_interface import LLMInterface
from core.ethical_framework import EthicalFramework

class Task:
    def __init__(self, description: str, priority: int = 1, deadline: Optional[datetime] = None, parent_id: Optional[str] = None):
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

    def __lt__(self, other):
        if self.priority == other.priority:
            return self.created_at < other.created_at
        return self.priority > other.priority

class TaskManager:
    def __init__(self, llm_interface: LLMInterface, ethical_framework: EthicalFramework):
        self.task_queue = PriorityQueue()
        self.completed_tasks: List[Task] = []
        self.all_tasks: Dict[str, Task] = {}
        self.llm_interface = llm_interface
        self.ethical_framework = ethical_framework
        self.logger = logging.getLogger("Jiva.TaskManager")

    def add_task(self, description: str, priority: int = 1, deadline: Optional[datetime] = None, parent_id: Optional[str] = None) -> Optional[str]:
        # Evaluate the task ethically before adding
        if self.ethical_framework.evaluate_task(description):
            task = Task(description, priority, deadline, parent_id)
            self.task_queue.put(task)
            self.all_tasks[task.id] = task
            if parent_id and parent_id in self.all_tasks:
                self.all_tasks[parent_id].subtasks.append(task.id)
            
            # Get and store the ethical explanation
            task.ethical_evaluation = {
                "explanation": self.ethical_framework.get_ethical_explanation(description),
                "is_ethical": True
            }
            return task.id
        else:
            # If the task is deemed unethical, don't add it and return None
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
                "ethical_evaluation": task.ethical_evaluation
            }
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
        3. Any dependencies on other tasks
        
        Format your response as a JSON list of tasks, where each task is an object with 'description' and 'priority' fields.
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
            tasks = [{"description": f"Analyze goal: {goal}", "priority": 3}]
        
        task_ids = []
        for task in tasks:
            if isinstance(task, dict) and 'description' in task:
                description = task['description']
                priority = task.get('priority', 1)
                if self.ethical_framework.evaluate_task(description):
                    task_id = self.add_task(description, priority)
                    task_ids.append(task_id)
                    self.logger.info(f"Added task: {description}")
                else:
                    self.logger.warning(f"Task not added due to ethical concerns: {description}")
            elif isinstance(task, str):
                # If the task is a string, treat it as the description with default priority
                if self.ethical_framework.evaluate_task(task):
                    task_id = self.add_task(task, 1)
                    task_ids.append(task_id)
                    self.logger.info(f"Added task: {task}")
                else:
                    self.logger.warning(f"Task not added due to ethical concerns: {task}")
            else:
                self.logger.warning(f"Skipping invalid task: {task}")
        
        return task_ids

    def decompose_task(self, task_id: str) -> List[str]:
        if task_id not in self.all_tasks:
            return []
        
        task = self.all_tasks[task_id]
        prompt = f"""
        Task: {task.description}
        
        Decompose this task into smaller, more manageable subtasks. For each subtask, provide:
        1. A clear, concise description
        2. A priority level (1-5, where 5 is highest priority)
        
        Format your response as a JSON list of subtasks.
        """
        
        response = self.llm_interface.generate(prompt)
        
        try:
            subtasks = self.llm_interface.parse_json(response)
        except:
            # If JSON parsing fails, don't decompose the task
            return []
        
        subtask_ids = []
        for subtask in subtasks:
            subtask_id = self.add_task(subtask['description'], subtask.get('priority', 1), parent_id=task_id)
            if subtask_id:  # Only add if the subtask was deemed ethical
                subtask_ids.append(subtask_id)
        
        return subtask_ids

    def get_all_pending_tasks(self) -> List[Dict[str, Any]]:
        return [self.get_task_status(task.id) for task in list(self.task_queue.queue)]

    def get_ethical_task_summary(self, task_id: str) -> str:
        if task_id in self.all_tasks:
            task = self.all_tasks[task_id]
            return f"Task: {task.description}\nEthical Evaluation: {task.ethical_evaluation['explanation']}"
        return "Task not found."

if __name__ == "__main__":
    # This is a mock implementation for testing purposes
    class MockLLMInterface:
        def generate(self, prompt):
            return '[{"description": "Mock task 1", "priority": 3}, {"description": "Mock task 2", "priority": 2}]'
        def parse_json(self, json_str):
            import json
            return json.loads(json_str)

    class MockEthicalFramework:
        def evaluate_task(self, description):
            return True
        def get_ethical_explanation(self, description):
            return "This task aligns with our ethical principles."

    tm = TaskManager(MockLLMInterface(), MockEthicalFramework())
    
    # Generate tasks for a goal
    goal = "Organize a team-building event"
    context = {"team_size": 10, "budget": 1000, "location": "office"}
    task_ids = tm.generate_tasks(goal, context)
    
    print("Generated tasks:")
    for task_id in task_ids:
        print(tm.get_ethical_task_summary(task_id))
    
    # Decompose a task
    if task_ids:
        subtask_ids = tm.decompose_task(task_ids[0])
        print("\nDecomposed tasks:")
        for subtask_id in subtask_ids:
            print(tm.get_ethical_task_summary(subtask_id))
    
    # Complete a task
    if task_ids:
        tm.complete_task(task_ids[0], "Task completed successfully")
        print("\nCompleted task status:")
        print(tm.get_task_status(task_ids[0]))
    
    # Get all pending tasks
    pending_tasks = tm.get_all_pending_tasks()
    print("\nPending tasks:")
    for task in pending_tasks:
        print(task)
