# core/scheduler.py

import asyncio
import json
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional
import logging
from croniter import croniter

class Scheduler:
    def __init__(self, agent):
        self.agent = agent
        self.scheduled_goals: Dict[str, Dict[str, Any]] = {}
        self.logger = logging.getLogger("Jiva.Scheduler")
        self.running = False
        
    async def start(self):
        """Start scheduler as a background task"""
        self.running = True
        asyncio.create_task(self._run_scheduler())
        
    async def stop(self):
        self.running = False
        
    def add_scheduled_goal(self, goal: str, schedule: str, validation: Optional[Dict[str, Any]] = None):
        """Add or update a scheduled goal with cron-style scheduling."""
        self.scheduled_goals[goal] = {
            "schedule": schedule,
            "last_run": None,
            "validation": validation,
            "task_plan": None  # Store successful task plans for reuse
        }
        self._save_to_config()
        
    async def _run_scheduler(self):
        while self.running:
            now = datetime.now()
            for goal, config in self.scheduled_goals.items():
                if self._should_run_goal(goal, config, now):
                    await self._execute_scheduled_goal(goal, config)
            await asyncio.sleep(60)  # Check every minute
                    
    def _should_run_goal(self, goal: str, config: Dict[str, Any], now: datetime) -> bool:
        if not config["last_run"]:
            return True
            
        cron = croniter(config["schedule"], config["last_run"])
        next_run = cron.get_next(datetime)
        return now >= next_run
        
    async def _execute_scheduled_goal(self, goal: str, config: Dict[str, Any]):
        try:
            self.logger.info(f"Executing scheduled goal: {goal}")
            config["last_run"] = datetime.now()
            
            # Try to reuse existing task plan if available
            if config["task_plan"]:
                await self.agent.task_manager.restore_task_plan(goal, config["task_plan"])
            else:
                # Generate new task plan
                context = self.agent.get_context()
                await self.agent.task_manager.generate_tasks(goal, context)
            
            # Execute tasks
            while self.agent.task_manager.has_pending_tasks():
                await self.agent.execute_next_task()
                
            # Validate results if configured
            if config["validation"]:
                validation_result = await self._validate_goal_execution(goal, config["validation"])
                if not validation_result["success"]:
                    self.logger.warning(f"Validation failed for goal {goal}: {validation_result['reason']}")
                    config["task_plan"] = None  # Clear failed task plan
                    # Retry with new task plan
                    await self._execute_scheduled_goal(goal, config)
                else:
                    # Store successful task plan
                    config["task_plan"] = self.agent.task_manager.get_task_plan(goal)
                    
            self._save_to_config()
            
        except Exception as e:
            self.logger.error(f"Error executing scheduled goal {goal}: {str(e)}")
            config["last_run"] = None  # Allow retry on next check
            
    async def _validate_goal_execution(self, goal: str, validation_config: Dict[str, Any]) -> Dict[str, Any]:
        """Validate goal execution using configured validation method."""
        validation_type = validation_config.get("type", "llm")
        
        if validation_type == "llm":
            prompt = validation_config.get("prompt", f"Validate if the goal '{goal}' was successfully achieved. Check recent task results and determine success.")
            response = await self.agent.llm_interface.generate(prompt)
            success = "success" in response.lower() or "achieved" in response.lower()
            return {
                "success": success,
                "reason": response
            }
        
        return {"success": True}  # Default to success for unknown validation types
        
    def _load_from_config(self):
        """Load scheduler configuration from config.json."""
        try:
            with open("config.json", "r") as f:
                config = json.load(f)
                if "scheduler" in config and "goals" in config["scheduler"]:
                    self.scheduled_goals = config["scheduler"]["goals"]
                    self.logger.info(f"Loaded {len(self.scheduled_goals)} scheduled goals from config")
        except Exception as e:
            self.logger.error(f"Error loading scheduler config: {str(e)}")
            
    def _save_to_config(self):
        """Save scheduler configuration to config.json."""
        config_path = "config.yml"
        try:
            with open("config.json", "r") as f:
                config = json.load(f)
                
            config["scheduler"] = {
                "goals": self.scheduled_goals
            }
            
            with open("config.json", "w") as f:
                json.dump(config, f, indent=2)
                
        except Exception as e:
            self.logger.error(f"Error saving scheduler config: {str(e)}")

# Add to task_manager.py

def get_task_plan(self, goal: str) -> List[Dict[str, Any]]:
    """Export task plan for a goal for future reuse."""
    tasks = []
    for task in self.all_tasks.values():
        if task.goal == goal:
            tasks.append({
                "description": task.description,
                "action": task.action,
                "parameters": task.parameters,
                "required_inputs": task.required_inputs
            })
    return tasks

async def restore_task_plan(self, goal: str, task_plan: List[Dict[str, Any]]):
    """Restore and execute a previously successful task plan."""
    for task_config in task_plan:
        task_config["goal"] = goal
        task = asyncio.Task(**task_config)
        self.all_tasks[task.id] = task
        self.task_queue.put(task)
