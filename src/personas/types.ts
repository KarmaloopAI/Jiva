/**
 * Type definitions for Jiva Skills and Personas (Plugins)
 * 
 * 100% compatible with Claude's Skills/Plugins system
 */

/**
 * Skill metadata from YAML frontmatter (L1 - always loaded)
 */
export interface SkillMetadata {
  /** Skill name: kebab-case, max 64 chars, no leading/trailing/consecutive hyphens */
  name: string;
  /** Description: max 1024 chars, no angle brackets. This is the TRIGGER for routing. */
  description: string;
  /** Optional license identifier (e.g., MIT, Apache-2.0) */
  license?: string;
  /** Optional compatibility notes (max 500 chars) */
  compatibility?: string;
  /** Optional list of allowed tools this skill can use */
  allowedTools?: string[];
  /** Optional arbitrary metadata */
  metadata?: Record<string, any>;
}

/**
 * Full skill with path and loading state
 */
export interface Skill {
  /** Skill metadata from frontmatter */
  metadata: SkillMetadata;
  /** Absolute path to the skill directory */
  path: string;
  /** Whether L2 (SKILL.md body) has been loaded */
  loaded: boolean;
  /** Full SKILL.md content (undefined until L2 load) */
  content?: string;
  /** Parent persona name (for namespacing) */
  personaName: string;
}

/**
 * Plugin/Persona manifest (.claude-plugin/plugin.json)
 */
export interface PersonaManifest {
  /** Persona name: kebab-case identifier */
  name: string;
  /** Short description of persona capabilities */
  description: string;
  /** Semantic version (e.g., "1.0.0") */
  version: string;
  /** Author information */
  author?: {
    name: string;
    email?: string;
    url?: string;
  };
  /** License identifier */
  license?: string;
  /** Homepage or repository URL */
  homepage?: string;
  /** Minimum required Jiva version */
  jivaVersion?: string;
}

/**
 * Command definition (user-invoked via slash commands)
 */
export interface PersonaCommand {
  /** Command name */
  name: string;
  /** Full path to command definition markdown */
  path: string;
  /** Command description */
  description?: string;
}

/**
 * Agent definition (spawned as subagents)
 */
export interface PersonaAgent {
  /** Agent name */
  name: string;
  /** Full path to agent definition markdown */
  path: string;
  /** Agent description */
  description?: string;
}

/**
 * Hook definition (event handlers)
 */
export interface PersonaHook {
  /** Event name (e.g., "beforeMessage", "afterResponse") */
  event: string;
  /** Hook handler script path */
  handler: string;
  /** Hook priority (higher = runs first) */
  priority?: number;
}

/**
 * Full persona with all components loaded
 */
export interface Persona {
  /** Persona manifest */
  manifest: PersonaManifest;
  /** Root directory path */
  path: string;
  /** All discovered skills (L1 metadata only initially) */
  skills: Skill[];
  /** All discovered commands */
  commands: PersonaCommand[];
  /** All discovered agents */
  agents: PersonaAgent[];
  /** All discovered hooks */
  hooks: PersonaHook[];
  /** MCP server configurations from .mcp.json */
  mcpServers?: Record<string, any>;
  /** Whether persona is currently active */
  active: boolean;
}

/**
 * Skill validation error
 */
export interface SkillValidationError {
  field: string;
  message: string;
  value?: any;
}

/**
 * Skill package metadata (.skill file)
 */
export interface SkillPackageMetadata {
  name: string;
  version: string;
  description: string;
  author?: string;
  license?: string;
  dependencies?: Record<string, string>;
}
