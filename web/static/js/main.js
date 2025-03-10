// Global variables
let currentLogPage = 1;
let logsPerPage = 100;
let totalLogs = 0;
let currentLogCategory = 'all';
let selectedTaskId = null;
let refreshInterval = null;
let apiBaseUrl = ''; // Will be set based on the current URL

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    // Set API base URL
    apiBaseUrl = window.location.protocol + '//' + window.location.host;
    
    // Set up navigation
    setupNavigation();
    
    // Set up event listeners
    setupEventListeners();
    
    // Initialize the current view
    initializeCurrentView();
    
    // Update the current time in the footer
    updateCurrentTime();
    setInterval(updateCurrentTime, 1000);
    
    // Start auto-refresh for agent status
    startAutoRefresh();
});

// Set up navigation between views
function setupNavigation() {
    const navLinks = document.querySelectorAll('.nav-link');
    
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            
            // Remove active class from all links and views
            navLinks.forEach(l => l.classList.remove('active'));
            document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
            
            // Add active class to clicked link
            link.classList.add('active');
            
            // Show the corresponding view
            const viewId = link.getAttribute('data-view') + '-view';
            document.getElementById(viewId).classList.add('active');
            
            // Initialize the view
            initializeView(link.getAttribute('data-view'));
        });
    });
}

// Set up event listeners for interactive elements
function setupEventListeners() {
    // Goal submission
    const submitGoalButton = document.getElementById('submit-goal');
    submitGoalButton.addEventListener('click', submitNewGoal);
    
    // Log category filter
    const logCategorySelect = document.getElementById('log-category');
    logCategorySelect.addEventListener('change', () => {
        currentLogCategory = logCategorySelect.value;
        currentLogPage = 1;
        fetchLogs();
    });
    
    // Log pagination
    document.getElementById('prev-page').addEventListener('click', () => {
        if (currentLogPage > 1) {
            currentLogPage--;
            fetchLogs();
        }
    });
    
    document.getElementById('next-page').addEventListener('click', () => {
        if (currentLogPage * logsPerPage < totalLogs) {
            currentLogPage++;
            fetchLogs();
        }
    });
    
    // Refresh logs button
    document.getElementById('refresh-logs').addEventListener('click', fetchLogs);
    
    // Goal filter for tasks
    const goalFilterSelect = document.getElementById('goal-filter');
    goalFilterSelect.addEventListener('change', () => {
        fetchTasks(goalFilterSelect.value);
    });
}

// Initialize the current view based on the active nav link
function initializeCurrentView() {
    const activeLink = document.querySelector('.nav-link.active');
    if (activeLink) {
        initializeView(activeLink.getAttribute('data-view'));
    }
}

// Initialize a specific view
function initializeView(viewName) {
    switch (viewName) {
        case 'agent':
            fetchAgentStatus();
            fetchLastTaskResult();
            break;
        case 'tasks':
            fetchGoalsForFilter();
            fetchTasks();
            break;
        case 'logs':
            fetchLogs();
            break;
    }
}

// Start auto-refresh for agent status and other data
function startAutoRefresh() {
    // Clear any existing interval
    if (refreshInterval) {
        clearInterval(refreshInterval);
    }
    
    // Refresh data every 5 seconds
    refreshInterval = setInterval(() => {
        fetchAgentStatus();
        
        // Refresh the active view
        const activeView = document.querySelector('.view.active');
        if (activeView) {
            const viewName = activeView.id.replace('-view', '');
            
            if (viewName === 'tasks') {
                fetchTasks(document.getElementById('goal-filter').value);
            } else if (viewName === 'logs') {
                fetchLogs();
            } else if (viewName === 'agent') {
                fetchLastTaskResult();
            }
        }
    }, 5000);
}

// Update the current time in the footer
function updateCurrentTime() {
    const currentTimeElement = document.getElementById('current-time');
    const now = new Date();
    currentTimeElement.textContent = now.toLocaleString();
}

// Fetch agent status
async function fetchAgentStatus() {
    try {
        const response = await fetch(`${apiBaseUrl}/status`);
        const data = await response.json();
        
        // Update status indicator
        const statusDot = document.getElementById('status-dot');
        const statusText = document.getElementById('status-text');
        
        if (data.status === 'Working') {
            statusDot.className = 'working';
            statusText.textContent = 'Working';
        } else {
            statusDot.className = 'active';
            statusText.textContent = 'Idle';
        }
        
        // Update current goal
        const currentGoalElement = document.getElementById('current-goal');
        if (data.current_goal) {
            currentGoalElement.textContent = data.current_goal;
        } else {
            currentGoalElement.textContent = 'No active goal';
        }
        
        // Fetch agent statistics
        fetchAgentStats();
        
    } catch (error) {
        console.error('Error fetching agent status:', error);
    }
}

// Fetch agent statistics
async function fetchAgentStats() {
    try {
        const response = await fetch(`${apiBaseUrl}/about`);
        const data = await response.json();
        
        // Update statistics
        if (data) {
            document.getElementById('total-tasks').textContent = data.total_tasks;
            document.getElementById('completed-tasks').textContent = data.completed_tasks;
            document.getElementById('pending-tasks').textContent = data.pending_tasks;
            document.getElementById('memory-size').textContent = data.memory_size;
        }
    } catch (error) {
        console.error('Error fetching agent statistics:', error);
    }
}

// Fetch the last task result
async function fetchLastTaskResult() {
    try {
        const response = await fetch(`${apiBaseUrl}/tasks?limit=1`);
        const tasks = await response.json();
        
        const lastResultElement = document.getElementById('last-result');
        
        if (tasks && tasks.length > 0) {
            const lastTask = tasks[0];
            
            if (lastTask.status === 'completed' && lastTask.result) {
                // Try to parse the result if it's a JSON string
                let resultDisplay;
                try {
                    const resultObj = JSON.parse(lastTask.result);
                    resultDisplay = JSON.stringify(resultObj, null, 2);
                } catch (e) {
                    resultDisplay = lastTask.result;
                }
                
                lastResultElement.textContent = `Task: ${lastTask.description}\n\nResult: ${resultDisplay}`;
            } else {
                lastResultElement.textContent = `Task: ${lastTask.description}\n\nStatus: ${lastTask.status}`;
            }
        } else {
            lastResultElement.textContent = 'No tasks completed yet';
        }
    } catch (error) {
        console.error('Error fetching last task result:', error);
    }
}

// Submit a new goal
async function submitNewGoal() {
    const goalInput = document.getElementById('goal-input');
    const goalText = goalInput.value.trim();
    
    if (!goalText) {
        alert('Please enter a goal');
        return;
    }
    
    try {
        const response = await fetch(`${apiBaseUrl}/goal`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                description: goalText
            })
        });
        
        const data = await response.json();
        
        if (data.status === 'success') {
            // Clear the input
            goalInput.value = '';
            
            // Update the current goal
            document.getElementById('current-goal').textContent = data.goal;
            
            // Refresh the agent status
            fetchAgentStatus();
            
            // Show a success message
            alert('Goal submitted successfully');
        } else {
            alert('Error submitting goal: ' + data.message);
        }
    } catch (error) {
        console.error('Error submitting goal:', error);
        alert('Error submitting goal. Please try again.');
    }
}

// Fetch goals for the task filter
async function fetchGoalsForFilter() {
    try {
        const response = await fetch(`${apiBaseUrl}/goals`);
        const goals = await response.json();
        
        const goalFilterSelect = document.getElementById('goal-filter');
        
        // Clear existing options except "All Goals"
        while (goalFilterSelect.options.length > 1) {
            goalFilterSelect.remove(1);
        }
        
        // Add goals to the filter
        goals.forEach(goal => {
            const option = document.createElement('option');
            option.value = goal.goal;
            option.textContent = goal.goal.substring(0, 50) + (goal.goal.length > 50 ? '...' : '');
            goalFilterSelect.appendChild(option);
        });
    } catch (error) {
        console.error('Error fetching goals for filter:', error);
    }
}

// Fetch tasks
async function fetchTasks(goalFilter = 'all') {
    try {
        let url = `${apiBaseUrl}/tasks`;
        if (goalFilter && goalFilter !== 'all') {
            url += `?goal=${encodeURIComponent(goalFilter)}`;
        }
        
        const response = await fetch(url);
        const tasks = await response.json();
        
        const tasksListElement = document.getElementById('tasks-list');
        
        // Clear existing tasks
        tasksListElement.innerHTML = '';
        
        if (tasks && tasks.length > 0) {
            tasks.forEach(task => {
                const taskElement = document.createElement('div');
                taskElement.className = 'task-item';
                taskElement.setAttribute('data-task-id', task.id);
                
                // Format the created date
                const createdDate = new Date(task.created_at);
                const formattedDate = createdDate.toLocaleString();
                
                taskElement.innerHTML = `
                    <h3>${task.description}</h3>
                    <div class="task-meta">
                        <span>${formattedDate}</span>
                        <span class="task-status ${task.status}">${task.status}</span>
                    </div>
                `;
                
                // Add click event to show task details
                taskElement.addEventListener('click', () => {
                    // Remove selected class from all tasks
                    document.querySelectorAll('.task-item').forEach(t => t.classList.remove('selected'));
                    
                    // Add selected class to clicked task
                    taskElement.classList.add('selected');
                    
                    // Show task details
                    showTaskDetails(task);
                });
                
                tasksListElement.appendChild(taskElement);
            });
            
            // If a task was previously selected, try to select it again
            if (selectedTaskId) {
                const selectedTask = document.querySelector(`.task-item[data-task-id="${selectedTaskId}"]`);
                if (selectedTask) {
                    selectedTask.click();
                } else {
                    // If the previously selected task is not in the current list, select the first task
                    document.querySelector('.task-item').click();
                }
            } else {
                // Select the first task by default
                document.querySelector('.task-item').click();
            }
        } else {
            tasksListElement.innerHTML = '<p class="empty-state">No tasks available</p>';
            document.getElementById('task-details').innerHTML = '<h3>Task Details</h3><p class="empty-state">No tasks available</p>';
        }
    } catch (error) {
        console.error('Error fetching tasks:', error);
    }
}

// Show task details
function showTaskDetails(task) {
    selectedTaskId = task.id;
    
    const taskDetailsElement = document.getElementById('task-details');
    
    // Format dates
    const createdDate = new Date(task.created_at).toLocaleString();
    const completedDate = task.completed_at ? new Date(task.completed_at).toLocaleString() : 'N/A';
    
    // Format result
    let resultDisplay = 'N/A';
    if (task.result) {
        try {
            const resultObj = JSON.parse(task.result);
            resultDisplay = JSON.stringify(resultObj, null, 2);
        } catch (e) {
            resultDisplay = task.result;
        }
    }
    
    taskDetailsElement.innerHTML = `
        <h3>Task Details</h3>
        
        <div class="detail-item">
            <div class="detail-label">ID</div>
            <div class="detail-value">${task.id}</div>
        </div>
        
        <div class="detail-item">
            <div class="detail-label">Description</div>
            <div class="detail-value">${task.description}</div>
        </div>
        
        <div class="detail-item">
            <div class="detail-label">Status</div>
            <div class="detail-value"><span class="task-status ${task.status}">${task.status}</span></div>
        </div>
        
        <div class="detail-item">
            <div class="detail-label">Created</div>
            <div class="detail-value">${createdDate}</div>
        </div>
        
        <div class="detail-item">
            <div class="detail-label">Completed</div>
            <div class="detail-value">${completedDate}</div>
        </div>
        
        <div class="detail-item">
            <div class="detail-label">Action</div>
            <div class="detail-value">${task.action || 'N/A'}</div>
        </div>
        
        <div class="detail-item">
            <div class="detail-label">Goal</div>
            <div class="detail-value">${task.goal || 'N/A'}</div>
        </div>
        
        <div class="detail-item">
            <div class="detail-label">Result</div>
            <div class="detail-value">${resultDisplay}</div>
        </div>
    `;
}

// Fetch logs
async function fetchLogs() {
    try {
        const offset = (currentLogPage - 1) * logsPerPage;
        let url = `${apiBaseUrl}/logs?limit=${logsPerPage}&offset=${offset}`;
        
        if (currentLogCategory !== 'all') {
            url += `&category=${currentLogCategory}`;
        }
        
        const response = await fetch(url);
        const data = await response.json();
        
        const logsListElement = document.getElementById('logs-list');
        
        // Clear existing logs
        logsListElement.innerHTML = '';
        
        if (data.logs && data.logs.length > 0) {
            // Update total logs count
            totalLogs = data.total;
            
            // Update pagination
            updateLogPagination();
            
            // Add logs to the list
            data.logs.forEach(log => {
                const logElement = document.createElement('div');
                logElement.className = 'log-entry';
                
                logElement.innerHTML = `
                    <span class="log-timestamp">${log.timestamp}</span>
                    <span class="log-level ${log.level}">${log.level}</span>
                    <span class="log-logger">${log.logger}</span>
                    <div class="log-message">${log.message}</div>
                `;
                
                logsListElement.appendChild(logElement);
            });
        } else {
            logsListElement.innerHTML = '<p class="empty-state">No logs available</p>';
            totalLogs = 0;
            updateLogPagination();
        }
    } catch (error) {
        console.error('Error fetching logs:', error);
    }
}

// Update log pagination controls
function updateLogPagination() {
    const prevButton = document.getElementById('prev-page');
    const nextButton = document.getElementById('next-page');
    const pageInfo = document.getElementById('page-info');
    
    // Update page info
    const totalPages = Math.ceil(totalLogs / logsPerPage);
    pageInfo.textContent = `Page ${currentLogPage} of ${totalPages || 1}`;
    
    // Update button states
    prevButton.disabled = currentLogPage <= 1;
    nextButton.disabled = currentLogPage >= totalPages;
}
