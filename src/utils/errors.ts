export class JivaError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = 'JivaError';
  }
}

export class ConfigurationError extends JivaError {
  constructor(message: string) {
    super(message, 'CONFIG_ERROR');
    this.name = 'ConfigurationError';
  }
}

export class ModelError extends JivaError {
  constructor(message: string, public modelName?: string) {
    super(message, 'MODEL_ERROR');
    this.name = 'ModelError';
  }
}

export class MCPError extends JivaError {
  constructor(message: string, public serverName?: string) {
    super(message, 'MCP_ERROR');
    this.name = 'MCPError';
  }
}

export class WorkspaceError extends JivaError {
  constructor(message: string) {
    super(message, 'WORKSPACE_ERROR');
    this.name = 'WorkspaceError';
  }
}

export class ToolCallError extends JivaError {
  constructor(message: string, public toolName?: string) {
    super(message, 'TOOL_CALL_ERROR');
    this.name = 'ToolCallError';
  }
}
