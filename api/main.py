# api/main.py

import asyncio
from fastapi import FastAPI, Depends, HTTPException
from fastapi.responses import JSONResponse
from typing import Dict, Any, List, Optional
import logging
from datetime import datetime

# Initialize FastAPI app
app = FastAPI(
    title="Jiva Agent API",
    description="REST API for interacting with Jiva agents",
    version="1.0.0"
)

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
