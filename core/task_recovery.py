import logging
import json
import re
from typing import Dict, List, Any, Optional, Tuple
from datetime import datetime
import uuid

from core.llm_interface import LLMInterface
from core.prompt_manager import PromptManager

class TaskAttempt:
    """Represents a single attempt at executing a task."""
    
    def __init__(self, parameters: Dict[str, Any], attempt_number: int):
        self.attempt_number = attempt_number
        self.parameters = parameters.copy() if parameters else {}
        self.start_time = datetime.now()
        self.end_time = None
        self.result = None
        self.success = None
        self.error = None
        self.recovery_strategy = None
        self.recovery_details = None
    
    def complete(self, result: Any, success: bool):
        """Mark this attempt as complete with the given result."""
        self.end_time = datetime.now()
        self.result = result
        self.success = success
        
        if not success and isinstance(result, dict):
            self.error = result.get('error', str(result))
    
    def add_recovery_info(self, strategy: str, details: Dict[str, Any]):
        """Add information about the recovery strategy applied after this attempt."""
        self.recovery_strategy = strategy
        self.recovery_details = details
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to a dictionary representation."""
        return {
            "attempt_number": self.attempt_number,
            "parameters": self.parameters,
            "start_time": self.start_time.isoformat() if self.start_time else None,
            "end_time": self.end_time.isoformat() if self.end_time else None,
            "result": self.result,
            "success": self.success,
            "error": self.error,
            "recovery_strategy": self.recovery_strategy,
            "recovery_details": self.recovery_details
        }


class TaskRecoveryManager:
    """
    Manages the recovery process for failed tasks.
    
    This class analyzes task failures, determines appropriate recovery strategies,
    and applies those strategies to help tasks succeed.
    """
    
    def __init__(self, llm_interface: LLMInterface, prompt_manager: Optional[PromptManager] = None):
        self.llm_interface = llm_interface
        self.prompt_manager = prompt_manager
        self.logger = logging.getLogger("Jiva.TaskRecoveryManager")
    
    async def analyze_failure(self, task: Any, error: str) -> Dict[str, Any]:
        """
        Analyze a task failure and recommend a recovery strategy.
        
        Args:
            task: The failed task object
            error: The error message or description
            
        Returns:
            Dict containing the recommended recovery strategy and details
        """
        # Get previous attempts as context
        attempts_context = self._format_attempts_for_prompt(task.attempts)
        
        # Prepare the recovery prompt
        prompt = self._get_recovery_prompt(task, error, attempts_context)
        
        try:
            # Ask the LLM for a recovery strategy
            self.logger.info(f"Requesting recovery analysis for task: {task.id}")
            recovery_response = await self.llm_interface.generate(prompt)
            
            # Parse the response
            recovery_plan = self._parse_recovery_response(recovery_response)
            
            if not recovery_plan or "strategy" not in recovery_plan:
                self.logger.warning(f"Failed to get valid recovery plan for task: {task.id}")
                return {
                    "strategy": "ABANDON",
                    "reason": "Failed to generate a valid recovery plan",
                    "original_response": recovery_response
                }
            
            self.logger.info(f"Recovery plan for task {task.id}: {recovery_plan['strategy']}")
            return recovery_plan
            
        except Exception as e:
            self.logger.error(f"Error analyzing task failure: {str(e)}")
            return {
                "strategy": "RETRY",
                "reason": f"Error in recovery analysis: {str(e)}",
                "parameters": task.parameters
            }
    
    def _format_attempts_for_prompt(self, attempts: List[TaskAttempt]) -> str:
        """Format previous attempts for inclusion in the prompt."""
        if not attempts:
            return "No previous attempts."
        
        formatted_attempts = []
        for attempt in attempts:
            # Format the result to be more concise for the prompt
            result_str = str(attempt.result)
            if len(result_str) > 500:
                result_str = result_str[:500] + "... (truncated)"
            
            formatted_attempts.append(
                f"Attempt {attempt.attempt_number}:\n"
                f"- Parameters: {json.dumps(attempt.parameters, indent=2)}\n"
                f"- Error: {attempt.error if attempt.error else 'None'}\n"
                f"- Success: {attempt.success}\n"
            )
        
        return "\n".join(formatted_attempts)
    
    def _get_recovery_prompt(self, task: Any, error: str, attempts_context: str) -> str:
        """Generate a prompt for the LLM to analyze the failure and suggest recovery."""
        if self.prompt_manager:
            # Use prompt template if available
            return self.prompt_manager.get_prompt(
                "tasks.recovery_analysis",
                task=task.to_dict() if hasattr(task, "to_dict") else {
                    "id": task.id,
                    "description": task.description,
                    "action": task.action,
                    "parameters": task.parameters
                },
                error=error,
                attempts_context=attempts_context
            )
        else:
            # Fallback to hardcoded prompt
            return f"""
# Task Recovery Analysis

## Original Task
Action: {task.action}
Description: {task.description}
Parameters: {json.dumps(task.parameters, indent=2)}

## Error Information
Error: {error}

## Previous Attempts
{attempts_context}

## Your Task
1. Analyze why this task failed
2. Recommend ONE of these recovery strategies:
   a) RETRY - Use same approach with modified parameters
   b) ALTERNATIVE - Use a different action to achieve the same goal
   c) DECOMPOSE - Break this into multiple smaller tasks
   d) ABANDON - Task cannot be completed, explain why

3. Based on your recommended strategy, provide:
   - For RETRY: Updated parameters (full parameter object, not just changes)
   - For ALTERNATIVE: New action and parameters
   - For DECOMPOSE: List of subtasks with actions and parameters
   - For ABANDON: Clear explanation why task is impossible

Format your response as a JSON object with the following structure:
{
    "strategy": "RETRY|ALTERNATIVE|DECOMPOSE|ABANDON",
    "reason": "Explanation of your analysis and recommendation",
    "parameters": {{}}, // For RETRY: Updated parameters
    "action": "", // For ALTERNATIVE: New action
    "subtasks": [] // For DECOMPOSE: Array of subtask objects
}
"""
    
    def _parse_recovery_response(self, response: str) -> Dict[str, Any]:
        """Parse the LLM's response into a structured recovery plan."""
        try:
            # Try to extract JSON from the response
            recovery_plan = self.llm_interface.parse_json(response)
            
            # Normalize the strategy to uppercase for consistency
            if 'strategy' in recovery_plan:
                recovery_plan['strategy'] = recovery_plan['strategy'].upper()
            
            return recovery_plan
            
        except Exception as e:
            self.logger.error(f"Error parsing recovery response: {str(e)}")
            self.logger.debug(f"Raw response: {response}")
            
            # Attempt to extract the strategy manually
            strategy_match = re.search(r"strategy[\"']?\s*:\s*[\"'](\w+)[\"']", response, re.IGNORECASE)
            if strategy_match:
                strategy = strategy_match.group(1).upper()
                return {
                    "strategy": strategy,
                    "reason": "Extracted from malformed response",
                    "original_response": response
                }
            
            return None
    
    async def apply_recovery_strategy(self, task: Any, recovery_plan: Dict[str, Any], task_manager: Any) -> Tuple[bool, List[Any]]:
        """
        Apply a recovery strategy to a failed task.
        
        Args:
            task: The failed task object
            recovery_plan: The recovery plan from analyze_failure
            task_manager: The task manager instance for creating new tasks
            
        Returns:
            Tuple containing:
                - Boolean indicating if recovery was successfully applied
                - List of new tasks created (if any)
        """
        strategy = recovery_plan.get('strategy', '').upper()
        self.logger.info(f"Applying recovery strategy {strategy} to task {task.id}")
        
        if not strategy or strategy not in ['RETRY', 'ALTERNATIVE', 'DECOMPOSE', 'ABANDON']:
            self.logger.warning(f"Unknown recovery strategy: {strategy}")
            return False, []
        
        # Record the recovery strategy in the latest attempt
        if task.attempts:
            latest_attempt = task.attempts[-1]
            latest_attempt.add_recovery_info(strategy, recovery_plan)
        
        # Apply the strategy
        if strategy == 'RETRY':
            # Update the task parameters
            if 'parameters' in recovery_plan:
                task.parameters = recovery_plan['parameters']
                task.current_attempt += 1
                return True, []
                
        elif strategy == 'ALTERNATIVE':
            # Create a new task with an alternative action
            if 'action' in recovery_plan and 'parameters' in recovery_plan:
                try:
                    # Use the add_task method correctly with await
                    new_task_id = await task_manager.add_task(
                        description=f"ALTERNATIVE: {task.description}",
                        action=recovery_plan['action'],
                        parameters=recovery_plan['parameters'],
                        priority=task.priority,
                        parent_id=task.id
                    )
                    if new_task_id and new_task_id in task_manager.all_tasks:
                        new_task = task_manager.all_tasks[new_task_id]
                        task.status = "redirected"
                        return True, [new_task]
                except Exception as e:
                    self.logger.error(f"Error creating alternative task: {str(e)}")
                    return False, []
        
        elif strategy == 'DECOMPOSE':
            # Create multiple subtasks
            new_tasks = []
            if 'subtasks' in recovery_plan and isinstance(recovery_plan['subtasks'], list):
                for subtask_data in recovery_plan['subtasks']:
                    if 'description' in subtask_data and 'action' in subtask_data:
                        try:
                            new_task_id = await task_manager.add_task(
                                description=subtask_data['description'],
                                action=subtask_data['action'],
                                parameters=subtask_data.get('parameters', {}),
                                priority=task.priority,
                                parent_id=task.id,
                                required_inputs=subtask_data.get('required_inputs', {})
                            )
                            if new_task_id and new_task_id in task_manager.all_tasks:
                                new_tasks.append(task_manager.all_tasks[new_task_id])
                        except Exception as e:
                            self.logger.error(f"Error creating subtask: {str(e)}")
                
                if new_tasks:
                    task.status = "decomposed"
                    return True, new_tasks
        
        elif strategy == 'ABANDON':
            # Mark the task as failed with the reason
            reason = recovery_plan.get('reason', 'Task determined to be uncompletable')
            task.status = "failed"
            task.result = {"error": reason, "recovery_attempted": True}
            return True, []
        
        # If we reach here, the recovery strategy couldn't be applied
        self.logger.warning(f"Failed to apply recovery strategy {strategy} to task {task.id}")
        return False, []


# Helper function to create a default recovery prompt for the prompt manager
def create_default_recovery_prompt() -> str:
    """Create a default recovery analysis prompt for use in the prompt manager."""
    return """
# Task Recovery Analysis

## Original Task
Action: {{ task.action }}
Description: {{ task.description }}
Parameters: {{ task.parameters | tojson(indent=2) }}

## Error Information
Error: {{ error }}

## Previous Attempts
{{ attempts_context }}

## Your Task
1. Analyze why this task failed
2. Recommend ONE of these recovery strategies:
   a) RETRY - Use same approach with modified parameters
   b) ALTERNATIVE - Use a different action to achieve the same goal
   c) DECOMPOSE - Break this into multiple smaller tasks
   d) ABANDON - Task cannot be completed, explain why

3. Based on your recommended strategy, provide:
   - For RETRY: Updated parameters (full parameter object, not just changes)
   - For ALTERNATIVE: New action and parameters
   - For DECOMPOSE: List of subtasks with actions and parameters
   - For ABANDON: Clear explanation why task is impossible

Format your response as a JSON object with the following structure:
{
    "strategy": "RETRY|ALTERNATIVE|DECOMPOSE|ABANDON",
    "reason": "Explanation of your analysis and recommendation",
    "parameters": {}, // For RETRY: Updated parameters
    "action": "", // For ALTERNATIVE: New action
    "subtasks": [] // For DECOMPOSE: Array of subtask objects
}
"""
