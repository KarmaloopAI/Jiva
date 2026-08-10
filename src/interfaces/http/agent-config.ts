/**
 * Agent Config - Per-session agent configuration supplied via the HTTP API
 *
 * When supplied in a session-creation or chat request body, these values
 * override the server-level environment-variable defaults (JIVA_MODEL_*,
 * JIVA_TOOL_CALLING_MODEL_*, ENABLE_MCP_SERVERS, MCP_FILESYSTEM_*,
 * JIVA_CODE_LSP, JIVA_CODE_MODE) for that session's lifetime only.
 *
 * Per-session config is NEVER persisted to storage — it lives in memory for
 * the session and is discarded when the session is destroyed. Secrets (API
 * keys, endpoints) are NOT part of this object; they remain server-side.
 */

/** MCP server descriptor supplied via agentConfig. */
export interface AgentConfigMCPServer {
  name: string;
  url?: string;
  transport?: 'stdio' | 'sse' | 'http';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

/**
 * Per-session agent configuration.
 *
 * All fields are optional — an absent field means "use the server-level
 * default" (env var / stored config), preserving backward compatibility.
 */
export interface AgentConfig {
  /** Reasoning / main model name. */
  model?: string;
  /** Tool-calling model name. */
  toolCallingModel?: string;
  /** MCP server list — replaces filesystem default + stored config for this session. */
  mcpServers?: AgentConfigMCPServer[];
  /** Whether code mode is enabled (overrides JIVA_CODE_MODE). */
  codeModeEnabled?: boolean;
  /** Whether LSP is enabled in code mode (overrides JIVA_CODE_LSP). */
  codeLsp?: boolean;
  /** Max iterations for the agent. */
  maxIterations?: number;
  /** Absolute path to a session-scoped workspace directory. */
  workspaceDir?: string;
  /** Reserved for future use — accepted but not wired into agent constructors. */
  systemPrompt?: string;
}

/**
 * Pure structural validator for an AgentConfig.
 *
 * Returns `{ valid: true, errors: [] }` for undefined/null (no agentConfig =
 * backward compat) and for a valid config. Returns `{ valid: false, errors }`
 * with descriptive messages for invalid configs. Does NOT check filesystem
 * existence of workspaceDir — that is deferred to WorkspaceManager at
 * session-creation time.
 */
export function validateAgentConfig(config: unknown): { valid: boolean; errors: string[] } {
  // No agentConfig supplied → backward-compatible default behavior.
  if (config === undefined || config === null) {
    return { valid: true, errors: [] };
  }

  const errors: string[] = [];

  if (typeof config !== 'object' || Array.isArray(config)) {
    return { valid: false, errors: ['agentConfig must be an object'] };
  }

  const c = config as Record<string, unknown>;

  // model: optional non-empty string
  if ('model' in c && c.model !== undefined) {
    if (typeof c.model !== 'string' || c.model.trim() === '') {
      errors.push('agentConfig.model must be a non-empty string');
    }
  }

  // toolCallingModel: optional non-empty string
  if ('toolCallingModel' in c && c.toolCallingModel !== undefined) {
    if (typeof c.toolCallingModel !== 'string' || c.toolCallingModel.trim() === '') {
      errors.push('agentConfig.toolCallingModel must be a non-empty string');
    }
  }

  // mcpServers: optional array of { name, url }
  if ('mcpServers' in c && c.mcpServers !== undefined) {
    if (!Array.isArray(c.mcpServers)) {
      errors.push('agentConfig.mcpServers must be an array');
    } else {
      c.mcpServers.forEach((srv: unknown, i: number) => {
        if (typeof srv !== 'object' || srv === null || Array.isArray(srv)) {
          errors.push(`agentConfig.mcpServers[${i}] must be an object`);
          return;
        }
        const s = srv as Record<string, unknown>;
        if (typeof s.name !== 'string' || s.name.trim() === '') {
          errors.push(`agentConfig.mcpServers[${i}].name must be a non-empty string`);
        }
        if (typeof s.url !== 'string' || s.url.trim() === '') {
          errors.push(`agentConfig.mcpServers[${i}].url must be a non-empty string`);
        }
      });
    }
  }

  // codeModeEnabled: optional boolean
  if ('codeModeEnabled' in c && c.codeModeEnabled !== undefined && typeof c.codeModeEnabled !== 'boolean') {
    errors.push('agentConfig.codeModeEnabled must be a boolean');
  }

  // codeLsp: optional boolean
  if ('codeLsp' in c && c.codeLsp !== undefined && typeof c.codeLsp !== 'boolean') {
    errors.push('agentConfig.codeLsp must be a boolean');
  }

  // maxIterations: optional positive integer
  if ('maxIterations' in c && c.maxIterations !== undefined) {
    if (
      typeof c.maxIterations !== 'number' ||
      !Number.isInteger(c.maxIterations) ||
      c.maxIterations <= 0
    ) {
      errors.push('agentConfig.maxIterations must be a positive integer');
    }
  }

  // workspaceDir: optional non-empty string (existence NOT checked here)
  if ('workspaceDir' in c && c.workspaceDir !== undefined) {
    if (typeof c.workspaceDir !== 'string' || c.workspaceDir.trim() === '') {
      errors.push('agentConfig.workspaceDir must be a non-empty string');
    }
  }

  // systemPrompt: optional string
  if ('systemPrompt' in c && c.systemPrompt !== undefined && typeof c.systemPrompt !== 'string') {
    errors.push('agentConfig.systemPrompt must be a string');
  }

  return { valid: errors.length === 0, errors };
}