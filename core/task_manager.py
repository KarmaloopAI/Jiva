# task_manager.py

import os
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
from core.task_recovery import TaskAttempt, TaskRecoveryManager

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
                 parent_id: Optional[str] = None, required_inputs: Dict[str, Any] = None, goal: str = None,
                 max_attempts: int = 3):
        self.id = str(uuid.uuid4())
        self.description = description
        self.action = action
        self.parameters = parameters
        self.original_parameters = parameters.copy()    # Retain a copy of the original parameters
        self.priority = parse_int_or_default(priority)
        self.deadline = deadline
        self.created_at = datetime.now()
        self.completed_at = None
        self.status = "pending"  # pending, completed, failed, redirected, decomposed
        self.result = None
        self.parent_id = parent_id
        self.subtasks: List[str] = []
        self.ethical_evaluation: Optional[Dict[str, Any]] = None
        self.required_inputs = required_inputs or {}
        self.output = None
        self.goal = goal
        
        # Recovery-related fields
        self.max_attempts = max_attempts
        self.current_attempt = 0
        self.attempts: List[TaskAttempt] = []
        self.recovery_attempted = False

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
        
    def create_attempt(self) -> TaskAttempt:
        """Create a new attempt for this task."""
        self.current_attempt += 1
        attempt = TaskAttempt(self.parameters, self.current_attempt)
        self.attempts.append(attempt)
        return attempt
        
    def get_latest_attempt(self) -> Optional[TaskAttempt]:
        """Get the most recent attempt, if any."""
        if self.attempts:
            return self.attempts[-1]
        return None
        
    def can_retry(self) -> bool:
        """Check if the task can be retried."""
        return self.current_attempt < self.max_attempts
        
    def get_attempt_history(self) -> List[Dict[str, Any]]:
        """Get the history of attempts for this task."""
        return [attempt.to_dict() for attempt in self.attempts]
        
    def to_dict(self) -> Dict[str, Any]:
        """Convert task to a dictionary representation."""
        return {
            "id": self.id,
            "description": self.description,
            "action": self.action,
            "parameters": self.parameters,
            "priority": self.priority,
            "status": self.status,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "parent_id": self.parent_id,
            "subtasks": self.subtasks,
            "goal": self.goal,
            "current_attempt": self.current_attempt,
            "max_attempts": self.max_attempts,
            "attempts": self.get_attempt_history(),
            "recovery_attempted": self.recovery_attempted
        }

    def __repr__(self):
        return f"Task(id={self.id}, description='{self.description}', action='{self.action}', status='{self.status}', attempts={self.current_attempt}/{self.max_attempts})"

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

        # Initialize the recovery manager
        self.recovery_manager = TaskRecoveryManager(llm_interface, prompt_manager)

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

    async def add_task(self, description: str, action: str, parameters: Dict[str, Any], 
                priority: int = 1, deadline: Optional[datetime] = None, 
                parent_id: Optional[str] = None, required_inputs: Dict[str, Any] = None) -> Optional[str]:
        """
        Add a new task to the task queue.
        
        Args:
            description: Description of the task
            action: Name of the action to execute
            parameters: Parameters for the action
            priority: Task priority (higher number = higher priority)
            deadline: Optional deadline for task completion
            parent_id: Optional ID of parent task
            required_inputs: Dictionary mapping parameter names to task descriptions for inputs
            
        Returns:
            str: The ID of the created task, or None if creation failed
        """
        # Check if the action is ethical
        is_ethical = await self.ethical_framework.evaluate_task(description)
        if not is_ethical:
            self.logger.warning(f"Task rejected as unethical: {description}")
            return None
            
        # Create a new task
        task = Task(description, action, parameters, priority, deadline, parent_id, required_inputs)
        self.task_queue.put(task)
        self.all_tasks[task.id] = task
        
        # Add as subtask to parent if applicable
        if parent_id and parent_id in self.all_tasks:
            self.all_tasks[parent_id].subtasks.append(task.id)
        
        # Store ethical evaluation
        ethical_explanation = await self.ethical_framework.get_ethical_explanation(description)
        task.ethical_evaluation = {
            "explanation": ethical_explanation,
            "is_ethical": True
        }
        
        self.logger.info(f"Added task: {task.id} - {description}")
        return task.id

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
        self.logger.info(f"Executing task: {task.description} (attempt {task.current_attempt + 1}/{task.max_attempts})")
        
        try:
            # Create a new attempt
            attempt = task.create_attempt()
            
            # Ensure parameters is always a dict
            if isinstance(task.parameters, str):
                task.parameters = {"prompt": task.parameters}
            elif task.parameters is None:
                task.parameters = {}

            # Resolve parameters based on required inputs
            for param, required_task_desc in (task.required_inputs or {}).items():
                input_task_result = self.get_input_task_result(required_task_desc)
                if input_task_result is not None:
                    # Handle special cases for different action types
                    if isinstance(input_task_result, dict):
                        # For generate_python_code action, extract code
                        if 'code' in input_task_result:
                            input_task_result = input_task_result['code']
                        # For execute_python_code action, extract stdout
                        elif 'stdout' in input_task_result:
                            input_task_result = input_task_result.get('stdout', '')
                    
                    # Replace the placeholder in all parameters
                    for key, value in task.parameters.items():
                        if isinstance(value, str) and f'{{{{{param}}}}}' in str(value):
                            task.parameters[key] = str(value).replace(f'{{{{{param}}}}}', str(input_task_result))
                else:
                    self.logger.warning(f"Could not find result for required input: {required_task_desc}")
            
            # Store the resolved parameters in the attempt
            attempt.parameters = task.parameters.copy()

            # Special handling for code execution
            if task.action == "execute_python_code" and "file_path" in task.parameters:
                # Check if the file exists and has correct Python code
                await self._prepare_python_file_for_execution(task.parameters["file_path"])
            
            # Execute the task
            if task.action == 'replan_tasks':
                new_tasks = await self.replan_tasks(task)
                result = {"success": True, "message": f"Replanned with {len(new_tasks)} new tasks", "new_tasks": [t.id for t in new_tasks]}
            elif task.action == 'rerun_tasks':
                new_tasks = await self.handle_rerun_tasks(task)
                result = {"success": True, "message": f"Rerunning {len(new_tasks)} tasks", "new_tasks": [t.id for t in new_tasks]}
            else:
                result = await self.action_manager.execute_action(task.action, task.parameters)
            
            # Record the result in the attempt
            success = isinstance(result, dict) and result.get('success', False)
            if not isinstance(result, dict):
                # Convert string results to a standard format
                if isinstance(result, str):
                    if result.startswith("Error"):
                        success = False
                        result = {"success": False, "error": result}
                    else:
                        success = True
                        result = {"success": True, "result": result}
                else:
                    # For other types, wrap in a standard format
                    success = True
                    result = {"success": True, "result": result}
            
            attempt.complete(result, success)
            
            if success:
                self.logger.info(f"Task executed successfully: {task.id}")
                
                # Store the result
                task.result = result
                task.output = result
                self.complete_task(task.id, result)

                # Store in memory
                self.memory.add_to_short_term({
                    "task_id": task.id,
                    "description": task.description,
                    "result": result,
                    "attempts": task.current_attempt
                })

                return result
            else:
                # Task failed - attempt recovery
                error_message = result.get('error', str(result))
                self.logger.warning(f"Task execution failed: {error_message}")
                
                if task.can_retry():
                    # Analyze the failure and get a recovery plan
                    recovery_plan = await self.recovery_manager.analyze_failure(task, error_message)
                    
                    # Apply the recovery strategy
                    recovery_applied, new_tasks = await self.recovery_manager.apply_recovery_strategy(
                        task, recovery_plan, self
                    )
                    
                    task.recovery_attempted = True
                    
                    if recovery_applied:
                        if recovery_plan.get('strategy') == 'RETRY':
                            # The task will be retried with updated parameters
                            self.logger.info(f"Task {task.id} will be retried with updated parameters")
                            
                            # Put the task back in the queue for retry
                            self.task_queue.put(task)
                            
                            # Return info about the retry
                            return {
                                "success": False, 
                                "error": error_message,
                                "recovery": {
                                    "strategy": "RETRY",
                                    "attempt": task.current_attempt,
                                    "max_attempts": task.max_attempts
                                }
                            }
                        else:
                            # For other strategies, the original task won't be retried
                            self.logger.info(f"Task {task.id} recovery applied: {recovery_plan.get('strategy')} with {len(new_tasks)} new tasks")
                            
                            # Store the result with recovery info
                            task.result = {
                                "success": False,
                                "error": error_message,
                                "recovery": {
                                    "strategy": recovery_plan.get('strategy'),
                                    "reason": recovery_plan.get('reason'),
                                    "new_tasks": [t.id for t in new_tasks] if new_tasks else []
                                }
                            }
                            
                            return task.result
                    else:
                        # Recovery couldn't be applied, mark as failed
                        self.logger.warning(f"Recovery could not be applied for task {task.id}")
                        
                        task.status = "failed"
                        task.result = {
                            "success": False,
                            "error": error_message,
                            "recovery_failed": True
                        }
                        
                        return task.result
                else:
                    # No more retry attempts, mark as failed
                    self.logger.warning(f"Task {task.id} failed after {task.current_attempt} attempts")
                    
                    task.status = "failed"
                    task.result = {
                        "success": False,
                        "error": error_message,
                        "max_attempts_reached": True
                    }
                    
                    return task.result
                
        except Exception as e:
            self.logger.error(f"Error executing task: {str(e)}", exc_info=True)
            
            # If an attempt was created, record the failure
            if task.attempts and task.attempts[-1].end_time is None:
                task.attempts[-1].complete(
                    {"success": False, "error": f"Exception: {str(e)}"}, 
                    False
                )
            
            # Always return a structured error result
            return {
                "success": False,
                "error": f"Exception executing task: {str(e)}"
            }
            
    async def _prepare_python_file_for_execution(self, file_path: str) -> bool:
        """
        Prepare a Python file for execution by checking its format and fixing if necessary.
        
        Args:
            file_path: Path to the Python file
            
        Returns:
            bool: True if file is ready for execution, False otherwise
        """
        if not os.path.exists(file_path):
            self.logger.warning(f"Python file does not exist: {file_path}")
            return False
        
        try:
            # Read the file content
            with open(file_path, 'r') as f:
                content = f.read()
            
            # Check if the content is a serialized dictionary (which would indicate an error)
            if content.strip().startswith('{') and ('code' in content or 'success' in content):
                # Try to extract the actual Python code
                code = None
                
                # If it looks like a JSON object with a 'code' field
                import re
                import json
                
                # First try direct JSON parsing
                try:
                    data = json.loads(content)
                    if isinstance(data, dict) and 'code' in data:
                        code = data['code']
                except json.JSONDecodeError:
                    # If that fails, try regex
                    code_match = re.search(r"'code':\s*'([^']+)'", content)
                    if code_match:
                        code = code_match.group(1).replace('\\n', '\n').replace('\\t', '\t')
                
                if code:
                    # Write the extracted code back to the file
                    with open(file_path, 'w') as f:
                        f.write(code)
                    self.logger.info(f"Fixed malformed Python file: {file_path}")
                    return True
                else:
                    self.logger.error(f"Could not extract Python code from: {file_path}")
                    return False
            
            # Check if it's valid Python syntax
            try:
                import ast
                ast.parse(content)
                return True
            except SyntaxError:
                self.logger.warning(f"Python file contains syntax errors: {file_path}")
                return False
                
        except Exception as e:
            self.logger.error(f"Error preparing Python file: {str(e)}")
            return False
    
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
        
        Args:
            task_description (str): The description of the task to find
            
        Returns:
            Any: The result of the task, or None if not found
        """
        # First, try to find an exact match
        for task in reversed(list(self.all_tasks.values())):  # Start from the most recent task
            if task.description.strip() == task_description.strip():
                return self._extract_useful_result(task.result)
        
        # If no exact match, try to find a partial match
        for task in reversed(list(self.all_tasks.values())):
            if task_description.strip() in task.description.strip():
                return self._extract_useful_result(task.result)
        
        self.logger.warning(f"Could not find task result for: {task_description}")
        return None

    def _extract_useful_result(self, result: Any) -> Any:
        """
        Extract the most useful part of a task result.
        
        Args:
            result: The raw task result
            
        Returns:
            Any: The extracted useful part of the result
        """
        if result is None:
            return None
            
        # If the result is a dictionary, try to extract useful parts
        if isinstance(result, dict):
            # For code generation
            if 'code' in result:
                return result['code']
            
            # For successful execution
            if result.get('success', False) and 'stdout' in result:
                return result['stdout']
                
            # For result value
            if 'result' in result:
                return result['result']
                
            # For error messages
            if 'error' in result:
                return f"Error: {result['error']}"
        
        # Return the raw result if no special handling needed
        return result

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
