# api/main.py

import asyncio
import os
import re
from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from typing import Dict, Any, List, Optional
import logging
from datetime import datetime

# Initialize FastAPI app
app = FastAPI(
    title="Jiva Agent API",
    description="REST API for interacting with Jiva agents",
    version="1.0.0"
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins
    allow_credentials=True,
    allow_methods=["*"],  # Allow all methods
    allow_headers=["*"],  # Allow all headers
)

# Mount static files for web interface
app.mount("/ui", StaticFiles(directory="web/static", html=True), name="ui")

logger = logging.getLogger("Jiva.API")

def get_agent():
    """Dependency to get the agent instance from app state."""
    if not hasattr(app.state, 'agent'):
        raise HTTPException(status_code=503, detail="Agent not initialized")
    return app.state.agent

@app.get("/status", response_model=Dict[str, Any])
async def get_status(agent = Depends(get_agent)) -> Dict[str, Any]:
    """Get the current status of the Jiva agent."""
    try:
        return {
            "status": "Working" if agent.task_manager.has_pending_tasks() else "Idle",
            "current_goal": agent.current_goal,
            "pending_tasks": [
                {
                    "id": task.id,
                    "description": task.description,
                    "status": task.status,
                    "created_at": task.created_at.isoformat()
                } for task in agent.task_manager.task_queue.queue
            ] if agent.task_manager.has_pending_tasks() else []
        }
    except Exception as e:
        logger.error(f"Error getting agent status: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/goals", response_model=List[Dict[str, Any]])
async def get_goals(agent = Depends(get_agent)) -> List[Dict[str, Any]]:
    """Get list of all goals, ordered by latest first."""
    try:
        # Get tasks from memory that have goal information
        goal_tasks = []
        for task_id, task in agent.task_manager.all_tasks.items():
            if task.goal and not any(g["goal"] == task.goal for g in goal_tasks):
                goal_tasks.append({
                    "goal": task.goal,
                    "created_at": task.created_at.isoformat(),
                    "status": "completed" if all(t.status == "completed" 
                             for t in agent.task_manager.all_tasks.values() 
                             if t.goal == task.goal) else "in_progress",
                    "first_task_id": task_id
                })
        
        # Sort by creation time, latest first
        return sorted(goal_tasks, key=lambda x: x["created_at"], reverse=True)
    except Exception as e:
        logger.error(f"Error getting goals: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/tasks", response_model=List[Dict[str, Any]])
async def get_tasks(goal: Optional[str] = None, agent = Depends(get_agent)) -> List[Dict[str, Any]]:
    """Get list of tasks, optionally filtered by goal."""
    try:
        tasks = []
        for task_id, task in agent.task_manager.all_tasks.items():
            if goal is None or task.goal == goal:
                tasks.append({
                    "id": task_id,
                    "description": task.description,
                    "status": task.status,
                    "created_at": task.created_at.isoformat(),
                    "completed_at": task.completed_at.isoformat() if task.completed_at else None,
                    "goal": task.goal,
                    "action": task.action,
                    "result": str(task.result) if task.result else None
                })
        
        # Sort by creation time, latest first
        return sorted(tasks, key=lambda x: x["created_at"], reverse=True)
    except Exception as e:
        logger.error(f"Error getting tasks: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/goal", response_model=Dict[str, Any])
async def create_goal(goal: Dict[str, str], agent = Depends(get_agent)) -> Dict[str, Any]:
    """Create a new goal for the agent."""
    try:
        if 'description' not in goal:
            raise HTTPException(status_code=400, detail="Goal description is required")
        
        # Process the goal like a regular input
        input_data = [{
            "type": "goal",
            "content": goal['description'],
            "timestamp": datetime.now().isoformat()
        }]
        
        await agent.process_input(input_data)
        
        # Wait a short time to allow initial task generation
        await asyncio.sleep(0.5)
        
        # Get the initial set of tasks
        initial_tasks = [
            {
                "id": task.id,
                "description": task.description,
                "status": task.status
            }
            for task in agent.task_manager.task_queue.queue
        ] if agent.task_manager.has_pending_tasks() else []
        
        return {
            "status": "success",
            "message": "Goal created successfully",
            "goal": goal['description'],
            "initial_tasks": initial_tasks
        }
    except Exception as e:
        logger.error(f"Error creating goal: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/about", response_model=Dict[str, Any])
async def get_about(agent = Depends(get_agent)) -> Dict[str, Any]:
    """Get information about the agent and its configuration."""
    try:
        # Get config without sensitive information
        config = agent.config.copy()
        # Remove sensitive fields
        for provider in ['llm', 'mistral-llm']:
            if provider in config:
                if 'api_key' in config[provider]:
                    config[provider]['api_key'] = '***'
        
        # Get available actions
        actions = agent.action_manager.get_available_actions()
        # Clean up action info for API response
        clean_actions = {}
        for action_name, action_info in actions.items():
            clean_actions[action_name] = {
                "description": action_info["description"],
                "parameters": action_info["parameters"]
            }
        
        return {
            "config": config,
            "available_actions": clean_actions,
            "total_tasks": len(agent.task_manager.all_tasks),
            "completed_tasks": len(agent.task_manager.completed_tasks),
            "pending_tasks": agent.task_manager.get_pending_task_count(),
            "memory_size": len(agent.memory.get_short_term_memory()),
            "sensors": list(agent.sensor_manager.get_available_sensors())
        }
    except Exception as e:
        logger.error(f"Error getting agent information: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

# Error handling
@app.exception_handler(Exception)
async def generic_exception_handler(request, exc):
    logger.error(f"Unhandled exception: {str(exc)}")
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"}
    )

@app.post("/trigger", response_model=Dict[str, Any])
async def trigger_agent(agent = Depends(get_agent)) -> Dict[str, Any]:
    """Trigger the agent to check and execute pending tasks if it's idle."""
    try:
        if not agent.is_awake:
            raise HTTPException(
                status_code=400, 
                detail="Agent is sleeping and cannot be triggered"
            )

        # First get all pending tasks
        pending_tasks = agent.task_manager.get_pending_tasks()
        
        if not pending_tasks:
            return {
                "status": "no_action",
                "message": "No pending tasks to execute",
                "debug": {
                    "queue_size": 0,
                    "queue_tasks": [],
                    "all_pending_count": 0,
                    "all_pending": [],
                    "has_pending_tasks": False
                }
            }
        
        # Requeue the pending tasks
        agent.task_manager.requeue_pending_tasks()
        
        # Signal the agent to check for tasks
        agent._task_trigger.set()
        
        return {
            "status": "triggered",
            "message": f"Agent triggered to execute {len(pending_tasks)} pending tasks",
            "debug": {
                "queue_size": len(pending_tasks),
                "queue_tasks": [
                    {
                        "id": task.id,
                        "description": task.description,
                        "status": task.status,
                        "created_at": task.created_at.isoformat()
                    } for task in pending_tasks
                ],
                "all_pending_count": len(pending_tasks),
                "all_pending": [
                    {
                        "id": task.id,
                        "description": task.description
                    } for task in pending_tasks
                ],
                "has_pending_tasks": True
            }
        }
            
    except Exception as e:
        logger.error(f"Error triggering agent: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/logs", response_model=Dict[str, Any])
async def get_logs(
    category: Optional[str] = None,
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0)
) -> Dict[str, Any]:
    """
    Get agent logs with optional filtering by category.
    
    Categories:
    - llm: LLM operations
    - memory: Memory operations
    - task: Task operations
    - action: Action operations
    - all: All logs (default)
    """
    try:
        log_file_path = "logs/jiva.log"
        if not os.path.exists(log_file_path):
            return {"logs": [], "total": 0}
        
        # Define category filters
        category_filters = {
            "llm": r"Jiva\.LLM",
            "memory": r"Jiva\.Memory|Jiva\.QdrantHandler",
            "task": r"Jiva\.TaskManager|Jiva\.TaskRecoveryManager",
            "action": r"Jiva\.ActionManager",
            "ethical": r"Jiva\.EthicalFramework",
            "api": r"Jiva\.API",
            "sensor": r"Jiva\.SensorManager"
        }
        
        # Read the log file
        with open(log_file_path, "r") as f:
            log_lines = f.readlines()
        
        # Parse and filter logs
        parsed_logs = []
        for line in log_lines:
            # Basic log line parsing
            match = re.match(r"(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d{3}) - ([\w\.]+) - (\w+) - (.*)", line)
            if match:
                timestamp, logger_name, level, message = match.groups()
                
                # Apply category filter if specified
                if category and category != "all" and category in category_filters:
                    if not re.search(category_filters[category], logger_name):
                        continue
                
                parsed_logs.append({
                    "timestamp": timestamp,
                    "logger": logger_name,
                    "level": level,
                    "message": message
                })
        
        # Apply pagination
        total_logs = len(parsed_logs)
        paginated_logs = parsed_logs[offset:offset + limit]
        
        return {
            "logs": paginated_logs,
            "total": total_logs,
            "offset": offset,
            "limit": limit,
            "category": category or "all"
        }
    except Exception as e:
        logger.error(f"Error getting logs: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/about", response_model=Dict[str, Any])
async def get_about(agent = Depends(get_agent)) -> Dict[str, Any]:
    """Get information about the agent and its configuration."""
    try:
        # Get config without sensitive information
        config = agent.config.copy()
        # Remove sensitive fields
        for provider in ['llm', 'mistral-llm']:
            if provider in config:
                if 'api_key' in config[provider]:
                    config[provider]['api_key'] = '***'
        
        # Get available actions
        actions = agent.action_manager.get_available_actions()
        clean_actions = {}
        for action_name, action_info in actions.items():
            clean_actions[action_name] = {
                "description": action_info["description"],
                "parameters": action_info["parameters"]
            }

        # Add sleep cycle status
        status = {
            "sleep_cycle": {
                "enabled": agent.sleep_config.get('enabled', False),
                "is_awake": agent.is_awake,
                "last_sleep_time": agent.last_sleep_time.isoformat() if agent.last_sleep_time else None
            }
        }
        
        # Get agent statistics
        stats = {
            "total_tasks": len(agent.task_manager.all_tasks),
            "completed_tasks": len(agent.task_manager.completed_tasks),
            "pending_tasks": len(agent.task_manager.get_pending_tasks()),
            "memory_size": len(agent.memory.get_short_term_memory())
        }
        
        return {
            "config": config,
            "available_actions": clean_actions,
            "sensors": list(agent.sensor_manager.get_available_sensors()),
            "status": status,
            "stats": stats
        }
    except Exception as e:
        logger.error(f"Error getting agent information: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
