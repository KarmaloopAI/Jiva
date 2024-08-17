# core/agent.py

from typing import Any, Dict
import time
from datetime import datetime, timedelta
import logging
import json

from .memory import Memory
from .time_experience import TimeExperience
from .task_manager import TaskManager
from .ethical_framework import EthicalFramework
from .llm_interface import LLMInterface
from .sensor_manager import SensorManager
from .action_manager import ActionManager
from actions.action_registry import get_file_actions

class Agent:
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.setup_logging()
        self.logger.info("Initializing Jiva Agent")
        
        self.llm_interface = LLMInterface(config['llm'])
        self.memory = Memory(config['memory'], self.llm_interface)
        self.time_experience = TimeExperience()
        self.ethical_framework = EthicalFramework(self.llm_interface)
        self.task_manager = TaskManager(self.llm_interface, self.ethical_framework)
        self.sensor_manager = SensorManager(config['sensors'])
        self.action_manager = ActionManager(self.ethical_framework)
        
        self.is_awake = True
        self.last_sleep_time = self.time_experience.get_current_time()
        self.current_goal = None
        
        # Register file operations
        file_actions = get_file_actions()
        for action_name, action_func in file_actions.items():
            self.action_manager.register_action(action_name, action_func)
            self.logger.debug(f"Registered action: {action_name}")
        
        self.logger.info("Jiva Agent initialized successfully")

    def setup_logging(self):
        self.logger = logging.getLogger("Jiva.Agent")
        self.logger.setLevel(logging.DEBUG)
        formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
        
        # Console Handler
        ch = logging.StreamHandler()
        ch.setLevel(logging.INFO)
        ch.setFormatter(formatter)
        self.logger.addHandler(ch)
        
        # File Handler
        fh = logging.FileHandler('jiva_agent.log')
        fh.setLevel(logging.DEBUG)
        fh.setFormatter(formatter)
        self.logger.addHandler(fh)

    def run(self):
        self.logger.info("Starting Jiva Agent main loop")
        while True:
            try:
                self.check_and_handle_sleep()
                if not self.is_awake:
                    self.logger.debug("Agent is asleep, skipping main loop")
                    continue
                
                self.time_experience.update()
                self.logger.debug(f"Current time: {self.time_experience.get_current_time()}")
                
                sensory_input = self.sensor_manager.get_input()
                
                if sensory_input:
                    self.logger.info(f"Received sensory input: {sensory_input}")
                    self.process_input(sensory_input)
                
                self.execute_next_task()
                
                time.sleep(self.config['agent_loop_delay'])
            except Exception as e:
                self.logger.error(f"Error in main loop: {str(e)}", exc_info=True)
                time.sleep(5)  # Wait a bit before retrying

    def process_input(self, input_data: Any):
        try:
            self.logger.info(f"Processing input: {input_data}")
            processed_data = self.llm_interface.process(input_data)
            self.logger.debug(f"Processed data: {processed_data}")
            
            self.memory.add_to_short_term(processed_data)
            self.logger.debug("Added processed data to short-term memory")
            
            if self.is_goal_setting(processed_data):
                self.logger.info("Input identified as goal-setting")
                self.set_new_goal(processed_data)
            else:
                self.logger.info("Generating tasks based on input")
                context = self.get_context()
                new_tasks = self.task_manager.generate_tasks(self.current_goal, context)
                
                for task_id in new_tasks:
                    task_info = self.task_manager.get_task_status(task_id)
                    self.memory.add_to_short_term({"type": "new_task", "task": task_info})
                    self.logger.info(f"New task added: {task_info}")
        except Exception as e:
            self.logger.error(f"Error processing input: {str(e)}", exc_info=True)

    def is_goal_setting(self, processed_data: Dict[str, Any]) -> bool:
        self.logger.debug("Checking if input is goal-setting")
        prompt = f"Processed input: {processed_data}\n\nIs this input setting a new goal for the agent? Respond with 'Yes' or 'No'."
        response = self.llm_interface.generate(prompt)
        is_goal = response.strip().lower() == 'yes'
        self.logger.debug(f"Is goal-setting: {is_goal}")
        return is_goal

    def set_new_goal(self, processed_data: Dict[str, Any]):
        self.logger.info("Setting new goal")
        prompt = f"Processed input: {processed_data}\n\nExtract the main goal from this input. Respond with a clear, concise goal statement."
        self.current_goal = self.llm_interface.generate(prompt).strip()
        self.logger.info(f"New goal set: {self.current_goal}")
        
        context = self.get_context()
        new_tasks = self.task_manager.generate_tasks(self.current_goal, context)
        
        self.memory.add_to_short_term({"type": "new_goal", "goal": self.current_goal})
        self.logger.debug("Added new goal to short-term memory")
        
        for task_id in new_tasks:
            task_info = self.task_manager.get_task_status(task_id)
            self.memory.add_to_short_term({"type": "new_task", "task": task_info})
            self.logger.info(f"New task added for goal: {json.dumps(task_info, indent=2)}")

    def get_context(self) -> Dict[str, Any]:
        self.logger.debug("Retrieving context")
        recent_memories = self.memory.get_short_term_memory()
        context = {
            "recent_memories": recent_memories,
            "current_time": self.time_experience.get_current_time().isoformat(),
            "current_goal": self.current_goal,
        }
        self.logger.debug(f"Context retrieved: {json.dumps(context, indent=2, default=self._json_serial)}")
        return context

    def _json_serial(self, obj):
        """JSON serializer for objects not serializable by default json code"""
        if isinstance(obj, datetime):
            return obj.isoformat()
        raise TypeError(f"Type {type(obj)} not serializable")

    def execute_next_task(self):
        task = self.task_manager.get_next_task()
        if task:
            self.logger.info(f"Executing next task: {task.description}")
            prompt = f"Task: {task.description}\n\nDetermine the best action to take to complete this task. Consider the available actions:\n{self.action_manager.get_available_actions()}\n\nRespond with the name of the action to take and any necessary parameters."
            action_plan = self.llm_interface.generate(prompt)
            self.logger.debug(f"Generated action plan: {action_plan}")
            
            action, params = self.parse_action_plan(action_plan)
            self.logger.info(f"Parsed action: {action}, params: {params}")
            
            result = self.action_manager.execute_action(action, params)
            self.logger.info(f"Action result: {result}")
            
            self.process_task_result(task, result)
        else:
            self.logger.debug("No tasks to execute")

    def parse_action_plan(self, action_plan: str) -> tuple[str, Dict[str, Any]]:
        self.logger.debug(f"Parsing action plan: {action_plan}")
        prompt = f"Action plan: {action_plan}\n\nParse this action plan into an action name and a dictionary of parameters. Respond with a JSON object containing 'action' and 'params' keys."
        parsed = self.llm_interface.parse_json(self.llm_interface.generate(prompt))
        self.logger.debug(f"Parsed action plan: {json.dumps(parsed, indent=2)}")
        return parsed['action'], parsed['params']

    def process_task_result(self, task: Any, result: Any):
        self.logger.info(f"Processing task result for task: {task.id}")
        self.task_manager.complete_task(task.id, result)
        self.logger.debug(f"Task {task.id} marked as complete")
        
        self.memory.add_to_short_term({"type": "task_result", "task_id": task.id, "result": result})
        self.logger.debug("Added task result to short-term memory")
        
        prompt = f"Task: {task.description}\nResult: {result}\n\nBased on this task result, should we generate new tasks? Respond with 'Yes' or 'No'."
        should_generate = self.llm_interface.generate(prompt).strip().lower() == 'yes'
        self.logger.debug(f"Should generate new tasks: {should_generate}")
        
        if should_generate:
            context = self.get_context()
            new_tasks = self.task_manager.generate_tasks(self.current_goal, context)
            for task_id in new_tasks:
                task_info = self.task_manager.get_task_status(task_id)
                self.memory.add_to_short_term({"type": "new_task", "task": task_info})
                self.logger.info(f"New follow-up task added: {json.dumps(task_info, indent=2)}")

    def check_and_handle_sleep(self):
        current_time = self.time_experience.get_current_time()
        time_since_last_sleep = current_time - self.last_sleep_time
        
        awake_duration = timedelta(seconds=self.config['awake_duration'])
        sleep_duration = timedelta(seconds=self.config['sleep_duration'])
        
        self.logger.debug(f"Time since last sleep: {time_since_last_sleep}, Awake duration: {awake_duration}, Sleep duration: {sleep_duration}")
        
        if time_since_last_sleep >= awake_duration:
            self.logger.info("Agent is tired, going to sleep")
            self.sleep()
        elif not self.is_awake and time_since_last_sleep >= sleep_duration:
            self.logger.info("Agent has slept enough, waking up")
            self.wake_up()

    def sleep(self):
        self.logger.info("Agent entering sleep state")
        self.is_awake = False
        self.last_sleep_time = self.time_experience.get_current_time()
        
        self.logger.debug("Consolidating memory")
        self.memory.consolidate()
        
        self.logger.debug("Preparing fine-tuning dataset")
        dataset = self.memory.prepare_fine_tuning_dataset()
        
        self.logger.info("Fine-tuning the model")
        self.llm_interface.fine_tune(dataset)

    def wake_up(self):
        self.logger.info("Agent waking up")
        self.is_awake = True
        # Perform any wake-up procedures here

if __name__ == "__main__":
    # This allows us to run the agent directly for testing
    config = {
        'memory': {},
        'llm': {},
        'sensors': {},
        'actions': {},
        'agent_loop_delay': 0.1,
        'awake_duration': 4800,  # 80 minutes in seconds
        'sleep_duration': 1200,  # 20 minutes in seconds
    }
    agent = Agent(config)
    agent.run()
