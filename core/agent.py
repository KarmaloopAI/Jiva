# core/agent.py

from datetime import datetime, timedelta
import os
import time
import json
import logging
from logging.handlers import RotatingFileHandler
from typing import Any, Dict, List

from core.memory import Memory
from core.time_experience import TimeExperience
from core.task_manager import TaskManager
from core.ethical_framework import EthicalFramework
from core.llm_interface import LLMInterface
from core.sensor_manager import SensorManager
from core.action_manager import ActionManager


class DateTimeEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, (datetime, timedelta)):
            return obj.isoformat()
        return super().default(obj)


class Agent:
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.setup_logging()
        self.logger.info("Initializing Jiva Agent")

        self.llm_interface = LLMInterface(config["llm"])
        self.memory = Memory(config["memory"], self.llm_interface)
        self.time_experience = TimeExperience()
        self.ethical_framework = EthicalFramework(
            self.llm_interface, config=config["ethical_framework"]
        )
        self.action_manager = ActionManager(
            self.ethical_framework, memory=self.memory, llm_interface=self.llm_interface
        )
        self.task_manager = TaskManager(
            self.llm_interface,
            self.ethical_framework,
            self.action_manager,
            memory=self.memory,
        )
        self.sensor_manager = SensorManager(config["sensors"])

        self.is_awake = True
        self.last_sleep_time = self.time_experience.get_current_time()
        self.current_goal = None

        self.json_encoder = DateTimeEncoder()

        self.logger.info("Jiva Agent initialized successfully")

    def run(self):
        self.logger.info("Starting Jiva Agent main loop")
        while True:
            try:
                self.check_and_handle_sleep()
                if not self.is_awake:
                    self.logger.debug("Agent is asleep, skipping main loop")
                    continue

                self.time_experience.update()
                current_time = self.time_experience.get_current_time()
                self.logger.debug(f"Current time: {current_time}")

                self.create_time_memory(current_time)

                sensory_input = self.sensor_manager.get_input()

                if sensory_input:
                    self.logger.info(f"Received sensory input: {sensory_input}")
                    self.process_input(sensory_input)

                # Execute all pending tasks
                while self.task_manager.has_pending_tasks():
                    self.execute_next_task()
                    self.logger.debug(
                        f"Remaining tasks: {self.task_manager.get_pending_task_count()}"
                    )

                # Check for memory consolidation after task execution
                if self.should_consolidate_memories():
                    self.logger.info("Consolidating memories")
                    self.memory.consolidate()
                    self.logger.info("Memory consolidation completed")

                time.sleep(self.config["agent_loop_delay"])
            except Exception as e:
                self.logger.error(f"Error in main loop: {str(e)}", exc_info=True)
                time.sleep(5)  # Wait a bit before retrying

    def create_time_memory(self, current_time: datetime):
        time_memory = {
            "type": "time_experience",
            "timestamp": current_time.isoformat(),
            "description": f"Experienced time at {current_time.strftime('%Y-%m-%d %H:%M:%S')}",
        }
        self.memory.add_to_short_term(time_memory)
        self.logger.debug(f"Created time memory: {time_memory}")

    def should_consolidate_memories(self) -> bool:
        return (
            len(self.memory.get_short_term_memory())
            >= self.config.get("memory_consolidation_threshold", 100)
            and not self.task_manager.has_pending_tasks()
        )

    def process_input(self, input_data: List[Dict[str, Any]]):
        try:
            self.logger.info(f"Processing input: {input_data}")
            for item in input_data:
                processed_data = self.llm_interface.process(item["content"])
                self.logger.debug(f"Processed data: {processed_data}")

                self.memory.add_to_short_term(processed_data)
                self.logger.debug("Added processed data to short-term memory")

                if self.is_goal_setting(processed_data):
                    self.logger.info("Input identified as goal-setting")
                    self.set_new_goal(processed_data)
                else:
                    self.logger.info("Generating tasks based on input")
                    context = self.get_context()
                    new_tasks = self.task_manager.generate_tasks(
                        self.current_goal, context
                    )

                    for task in new_tasks:
                        task_info = self.task_manager.get_task_status(task.id)
                        self.memory.add_to_short_term(
                            {"type": "new_task", "task": task_info}
                        )
                        self.logger.info(f"New task added: {task_info}")
        except Exception as e:
            self.logger.error(f"Error processing input: {str(e)}", exc_info=True)

    def is_goal_setting(self, processed_data: Dict[str, Any]) -> bool:
        self.logger.debug("Checking if input is goal-setting")
        prompt = f"Current Goal: {str(self.current_goal)}\n Processed input: {processed_data}\n\nIs this input setting a new goal for the agent? Respond with 'Yes' or 'No'.\n\n If the current goal is not set, then safely assume it is a new goal."
        response = self.llm_interface.generate(prompt)
        is_goal = response.strip().lower() == "yes"
        self.logger.debug(f"Is goal-setting: {is_goal}")
        return is_goal

    def set_new_goal(self, processed_data: Dict[str, Any]):
        self.logger.info("Setting new goal")
        prompt = f"Processed input: {self.json_encoder.encode(processed_data)}\n\nExtract the main goal from this input. Respond with a clear, concise goal statement."
        self.current_goal = self.llm_interface.generate(prompt).strip()
        self.logger.info(f"New goal set: {self.current_goal}")

        context = self.get_context()
        new_tasks = self.task_manager.generate_tasks(self.current_goal, context)

        self.memory.add_to_short_term({"type": "new_goal", "goal": self.current_goal})
        self.logger.debug("Added new goal to short-term memory")

        for task in new_tasks:
            task_info = self.task_manager.get_task_status(task.id)
            self.memory.add_to_short_term({"type": "new_task", "task": task_info})
            self.logger.info(
                f"New task added for goal: {self.json_encoder.encode(task_info)}"
            )

    def get_context(self) -> Dict[str, Any]:
        self.logger.debug("Retrieving context")
        recent_memories = self.memory.get_short_term_memory()[-2:]
        context = {
            "recent_memories": recent_memories,
            "current_time": self.time_experience.get_current_time().isoformat(),
            "current_goal": self.current_goal,
        }
        self.logger.debug(f"Context retrieved: {self.json_encoder.encode(context)}")
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
            result = self.task_manager.execute_task(task)

            if isinstance(result, str) and result.startswith("Error"):
                self.logger.warning(f"Task encountered an error: {result}")
                self.handle_task_error(task, result)
            else:
                self.process_task_result(task, result)
        else:
            self.logger.debug("No more tasks to execute")

    def handle_task_error(self, task: Any, error_message: str):
        self.logger.info(f"Handling error for task: {task.id}")
        prompt = f"""
        Task: {task.description}
        Error: {error_message}

        The task encountered an error. Suggest a solution or alternative approach to complete the task.
        If the task needs to be broken down into smaller steps, provide those steps.
        
        Format your response as a JSON object with the following fields:
        1. 'solution': A brief description of the proposed solution
        2. 'new_tasks': A list of new tasks, each with 'description', 'priority', 'action', and 'parameters' fields
        """
        solution = self.llm_interface.generate(prompt)
        self.logger.debug(f"Generated solution: {solution}")

        try:
            parsed_solution = self.llm_interface.parse_json(solution)
            new_tasks = parsed_solution.get("new_tasks", [])
            for new_task in new_tasks:
                task_id = self.task_manager.add_task(
                    new_task["description"],
                    new_task["priority"],
                    new_task["action"],
                    new_task["parameters"],
                )
                self.logger.info(f"New task added to handle error: {new_task}")
        except Exception as e:
            self.logger.error(f"Error parsing solution: {e}")

        self.task_manager.complete_task(
            task.id, {"status": "failed", "error": error_message, "solution": solution}
        )

    def parse_action_plan(self, action_plan: str) -> tuple[str, Dict[str, Any]]:
        self.logger.debug(f"Parsing action plan: {action_plan}")
        prompt = f"Action plan: {action_plan}\n\nParse this action plan into an action name and a dictionary of parameters. Respond with a JSON object containing 'action' and 'params' keys."
        parsed = self.llm_interface.parse_json(self.llm_interface.generate(prompt))
        self.logger.debug(f"Parsed action plan: {json.dumps(parsed, indent=2)}")
        return parsed["action"], parsed["params"]

    def process_task_result(self, task: Any, result: Any):
        self.logger.info(f"Processing task result for task: {task.id}")
        self.task_manager.complete_task(task.id, result)
        self.logger.debug(f"Task {task.id} marked as complete")

        self.memory.add_to_short_term(
            {
                "type": "task_result",
                "task_id": task.id,
                "task_description": task.description,
                "result": result,
            }
        )
        self.logger.debug("Added task result to short-term memory")

        prompt = f"Task: {task.description}\nResult: {result}\n\nBased on this task result, should we generate new tasks? Respond with 'Yes' or 'No'. Be frugal in responding with 'Yes' and only do that when you spot problems or errors in the result."
        should_generate = self.llm_interface.generate(prompt).strip().lower() == "yes"
        self.logger.debug(f"Should generate new tasks: {should_generate}")

        if should_generate:
            context = self.get_context()
            new_tasks = self.task_manager.generate_tasks(self.current_goal, context)
            for task in new_tasks:
                task_info = self.task_manager.get_task_status(task.id)
                self.memory.add_to_short_term({"type": "new_task", "task": task_info})
                self.logger.info(
                    f"New follow-up task added: {self.json_encoder.encode(task_info)}"
                )

    def check_and_handle_sleep(self):
        current_time = self.time_experience.get_current_time()
        time_since_last_sleep = current_time - self.last_sleep_time

        awake_duration = timedelta(seconds=self.config["awake_duration"])
        sleep_duration = timedelta(seconds=self.config["sleep_duration"])

        self.logger.debug(
            f"Time since last sleep: {time_since_last_sleep}, Awake duration: {awake_duration}, Sleep duration: {sleep_duration}"
        )

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

    def setup_logging(self):
        self.logger = logging.getLogger("Jiva")
        self.logger.setLevel(logging.DEBUG)
        formatter = logging.Formatter(
            "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
        )

        # Console Handler
        ch = logging.StreamHandler()
        ch.setLevel(logging.INFO)
        ch.setFormatter(formatter)
        self.logger.addHandler(ch)

        # File Handler
        log_dir = "logs"
        os.makedirs(log_dir, exist_ok=True)
        fh = RotatingFileHandler(
            os.path.join(log_dir, "jiva.log"), maxBytes=10 * 1024 * 1024, backupCount=5
        )
        fh.setLevel(logging.DEBUG)
        fh.setFormatter(formatter)
        self.logger.addHandler(fh)

        self.logger.info("Logging setup complete")


if __name__ == "__main__":
    # This allows us to run the agent directly for testing
    config = {
        "memory": {},
        "llm": {},
        "sensors": {},
        "actions": {},
        "agent_loop_delay": 0.1,
        "awake_duration": 4800,  # 80 minutes in seconds
        "sleep_duration": 1200,  # 20 minutes in seconds
    }
    agent = Agent(config)
    agent.run()
