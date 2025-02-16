from typing import Dict, Any, Optional
import yaml
import os
import logging
from pathlib import Path
from jinja2 import Environment, FileSystemLoader, select_autoescape

class PromptManager:
    """
    Centralized prompt management system for the Jiva Framework.
    Uses YAML for prompt storage and Jinja2 for templating.
    """

    def __init__(self, prompts_config: dict[str, Any]):
        self.logger = logging.getLogger("Jiva.PromptManager")
        prompts_dir = prompts_config.get('prompts_dir', 'prompts')
        self.prompts_dir = Path(prompts_dir)
        self.prompts: Dict[str, Any] = {}
        
        # Set up Jinja environment
        self.jinja_env = Environment(
            loader=FileSystemLoader(self.prompts_dir),
            autoescape=select_autoescape(['html', 'xml']),
            trim_blocks=True,
            lstrip_blocks=True
        )
        
        self._ensure_prompt_directory()
        self._load_prompts()

    def _ensure_prompt_directory(self) -> None:
        """Ensure the prompts directory exists with default prompts."""
        try:
            self.prompts_dir.mkdir(parents=True, exist_ok=True)
            
            # Create default prompts if they don't exist
            self._create_default_prompts()
            
        except Exception as e:
            self.logger.error(f"Error creating prompts directory: {e}")
            raise

    def _create_default_prompts(self) -> None:
        """Create default prompt files if they don't exist."""
        default_prompts = {
            "base.yml": """
# Base prompt templates that can be extended
base_task: |
    # Goal
    {{ goal }}

    # Context
    {{ context }}
""",
            "task_generation.yml": """
# Task generation prompts
extends: base.yml

generate_tasks: |
    {% extends "base_task" %}
    
    ## Your approach
    You strive to achieve a given task in as few steps as possible

    # Your Task
    Generate a list of tasks to achieve the goal. Each task should have:
    1. A description
    2. An action name (from the available actions)
    3. Parameters for the action (matching the required parameters)
    4. A list of required inputs (task descriptions that this task depends on)

    # Available actions and their parameters
    {{ actions_str }}

    Respond only with a JSON array of tasks and nothing else.
""",
            "ethical.yml": """
# Ethical evaluation prompts
ethical_evaluation: |
    Task: {{ task_description }}

    Ethical Principles:
    {% for principle in principles %}
    - {{ principle }}
    {% endfor %}

    Evaluate the given task against these ethical principles. 
    Provide an overall ethical assessment.

    Respond with a JSON object containing:
    1. An 'overall_assessment' which is either 'ethical' or 'unethical'
    2. A 'reasoning' field explaining the overall assessment
""",
            "memory.yml": """
# Memory processing prompts
process_input: |
    Input: {{ input_data }}

    Analyze the above input, break it down into action_items to fulfil 
    the overall goal of the input.
    
    Carefully analyse the input to ensure you have factored it in its entirety.
    
    Format your response as a JSON object with the following structure:
    {
        "summary": "A brief summary of the input",
        "key_points": ["List of key points"],
        "entities": ["List of important entities mentioned"],
        "sentiment": "Overall sentiment (positive, negative, or neutral)",
        "action_items": ["List of suggested actions based on the input"]
    }
"""
        }

        for filename, content in default_prompts.items():
            file_path = self.prompts_dir / filename
            if not file_path.exists():
                with file_path.open('w') as f:
                    f.write(content.lstrip())
                self.logger.info(f"Created default prompt file: {filename}")

    def _load_prompts(self) -> None:
        """Load all prompt files from the prompts directory."""
        try:
            self.prompts.clear()
            for file_path in self.prompts_dir.glob('*.yml'):
                with file_path.open('r') as f:
                    prompts = yaml.safe_load(f)
                    if prompts:
                        # Handle template inheritance
                        if 'extends' in prompts:
                            base_file = prompts.pop('extends')
                            with (self.prompts_dir / base_file).open('r') as base_f:
                                base_prompts = yaml.safe_load(base_f)
                                prompts = {**base_prompts, **prompts}
                        
                        self.prompts[file_path.stem] = prompts
            
            self.logger.info(f"Loaded prompts from {self.prompts_dir}")
        except Exception as e:
            self.logger.error(f"Error loading prompts: {e}")
            raise

    def get_prompt(self, prompt_id: str, **kwargs) -> Optional[str]:
        """
        Retrieve and render a prompt with the given parameters.
        
        Args:
            prompt_id (str): The identifier for the prompt template (e.g., "task_generation.generate_tasks")
            **kwargs: The parameters to render the prompt with
        
        Returns:
            Optional[str]: The rendered prompt, or None if the prompt_id is not found
        """
        try:
            category, name = prompt_id.split('.', 1)
            if category in self.prompts and name in self.prompts[category]:
                template = self.jinja_env.from_string(self.prompts[category][name])
                return template.render(**kwargs)
            else:
                self.logger.error(f"Prompt not found: {prompt_id}")
                return None
        except Exception as e:
            self.logger.error(f"Error rendering prompt {prompt_id}: {e}")
            return None

    def add_prompt(self, category: str, name: str, template: str) -> bool:
        """
        Add a new prompt template to a category.
        
        Args:
            category (str): The category for the prompt (e.g., "task_generation")
            name (str): The name of the prompt
            template (str): The prompt template string
        
        Returns:
            bool: True if the prompt was added successfully, False otherwise
        """
        try:
            file_path = self.prompts_dir / f"{category}.yml"
            
            # Load existing prompts or create new dict
            if file_path.exists():
                with file_path.open('r') as f:
                    prompts = yaml.safe_load(f) or {}
            else:
                prompts = {}
            
            # Add new prompt
            prompts[name] = template
            
            # Save updated prompts
            with file_path.open('w') as f:
                yaml.dump(prompts, f, sort_keys=False, indent=2)
            
            # Reload prompts
            self._load_prompts()
            return True
        except Exception as e:
            self.logger.error(f"Error adding prompt {category}.{name}: {e}")
            return False

    def update_prompt(self, prompt_id: str, template: str) -> bool:
        """
        Update an existing prompt template.
        
        Args:
            prompt_id (str): The identifier for the prompt template (e.g., "task_generation.generate_tasks")
            template (str): The new prompt template string
        
        Returns:
            bool: True if the prompt was updated successfully, False otherwise
        """
        try:
            category, name = prompt_id.split('.', 1)
            return self.add_prompt(category, name, template)
        except Exception as e:
            self.logger.error(f"Error updating prompt {prompt_id}: {e}")
            return False

    def list_prompts(self) -> Dict[str, Dict[str, str]]:
        """Return a dictionary of all available prompts."""
        return {
            f"{category}.{name}": template
            for category, prompts in self.prompts.items()
            for name, template in prompts.items()
        }

    def get_categories(self) -> Dict[str, Any]:
        """Return the hierarchical structure of prompt categories."""
        return self.prompts

if __name__ == "__main__":
    # Example usage
    logging.basicConfig(level=logging.INFO)
    
    prompt_manager = PromptManager()
    
    # Test adding a new prompt
    prompt_manager.add_prompt(
        "custom",
        "test",
        "This is a test prompt with {{ parameter }}"
    )
    
    # Test retrieving and rendering a prompt
    rendered_prompt = prompt_manager.get_prompt(
        "custom.test",
        parameter="example value"
    )
    print(f"Rendered prompt:\n{rendered_prompt}")
    
    # Test task generation prompt
    task_prompt = prompt_manager.get_prompt(
        "task_generation.generate_tasks",
        goal="Write a blog post",
        context={"recent_tasks": []},
        actions_str="Available actions..."
    )
    print(f"\nTask generation prompt:\n{task_prompt}")
    
    # List all prompts
    print("\nAvailable prompts:")
    for prompt_id, template in prompt_manager.list_prompts().items():
        print(f"- {prompt_id}")
