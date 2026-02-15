/**
 * Persona (Plugin) loader - discovers and loads complete personas
 * Handles skills, commands, agents, hooks, and MCP server configurations
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { Persona, PersonaManifest, PersonaCommand, PersonaAgent, PersonaHook } from './types.js';
import { discoverSkills } from './skill-loader.js';
import { logger } from '../utils/logger.js';

/**
 * Default persona search paths (user-level and project-level)
 */
export function getDefaultPersonaPaths(): string[] {
  const home = os.homedir();
  return [
    path.join(home, '.jiva', 'personas'), // User-level
    path.join(process.cwd(), '.jiva', 'personas'), // Project-level
  ];
}

/**
 * Find the plugin manifest file (checks both .jiva-plugin and .claude-plugin)
 */
async function findPluginManifest(personaPath: string): Promise<string> {
  // Prefer .jiva-plugin but fall back to .claude-plugin for compatibility
  const jivaManifest = path.join(personaPath, '.jiva-plugin', 'plugin.json');
  const claudeManifest = path.join(personaPath, '.claude-plugin', 'plugin.json');

  try {
    await fs.access(jivaManifest);
    return jivaManifest;
  } catch {
    // Fall back to .claude-plugin
    await fs.access(claudeManifest);
    return claudeManifest;
  }
}

/**
 * Load persona manifest from .jiva-plugin/plugin.json or .claude-plugin/plugin.json
 */
export async function loadPersonaManifest(manifestPath: string): Promise<PersonaManifest> {
  try {
    const content = await fs.readFile(manifestPath, 'utf-8');
    const manifest = JSON.parse(content);

    // Validate required fields
    if (!manifest.name) {
      throw new Error('Persona manifest missing required field: name');
    }
    if (!manifest.description) {
      throw new Error('Persona manifest missing required field: description');
    }
    if (!manifest.version) {
      throw new Error('Persona manifest missing required field: version');
    }

    return manifest as PersonaManifest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Persona manifest not found at ${manifestPath}`);
    }
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in persona manifest ${manifestPath}: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Discover commands in a persona's commands/ directory
 */
async function discoverCommands(personaPath: string): Promise<PersonaCommand[]> {
  const commandsDir = path.join(personaPath, 'commands');
  const commands: PersonaCommand[] = [];

  try {
    const entries = await fs.readdir(commandsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.md')) {
        const commandName = entry.name.replace('.md', '');
        commands.push({
          name: commandName,
          path: path.join(commandsDir, entry.name),
        });
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  return commands;
}

/**
 * Discover agents in a persona's agents/ directory
 */
async function discoverAgents(personaPath: string): Promise<PersonaAgent[]> {
  const agentsDir = path.join(personaPath, 'agents');
  const agents: PersonaAgent[] = [];

  try {
    const entries = await fs.readdir(agentsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.md')) {
        const agentName = entry.name.replace('.md', '');
        agents.push({
          name: agentName,
          path: path.join(agentsDir, entry.name),
        });
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  return agents;
}

/**
 * Load hooks from a persona's hooks/hooks.json
 */
async function loadHooks(personaPath: string): Promise<PersonaHook[]> {
  const hooksFile = path.join(personaPath, 'hooks', 'hooks.json');

  try {
    const content = await fs.readFile(hooksFile, 'utf-8');
    const hooksData = JSON.parse(content);

    if (!Array.isArray(hooksData)) {
      throw new Error('hooks.json must contain an array of hook definitions');
    }

    return hooksData as PersonaHook[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return []; // No hooks file - that's ok
    }
    throw error;
  }
}

/**
 * Load MCP server configurations from a persona's .mcp.json
 */
async function loadMCPServers(personaPath: string): Promise<Record<string, any>> {
  const mcpFile = path.join(personaPath, '.mcp.json');

  try {
    const content = await fs.readFile(mcpFile, 'utf-8');
    const mcpData = JSON.parse(content);

    // Support both { "mcpServers": {...} } and direct {...} formats
    if (mcpData.mcpServers) {
      logger.debug(`Loaded ${Object.keys(mcpData.mcpServers).length} MCP servers from ${mcpFile}`);
      return mcpData.mcpServers;
    }
    
    logger.debug(`Loaded ${Object.keys(mcpData).length} MCP servers from ${mcpFile}`);
    return mcpData;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      logger.debug(`No MCP config file at ${mcpFile}`);
      return {}; // No MCP config - that's ok
    }
    logger.error(`Error loading MCP servers from ${mcpFile}: ${error}`);
    throw error;
  }
}

/**
 * Load a single persona from its directory
 */
export async function loadPersona(personaPath: string): Promise<Persona> {
  const manifestPath = await findPluginManifest(personaPath);
  const manifest = await loadPersonaManifest(manifestPath);

  // Discover all components
  const [skills, commands, agents, hooks, mcpServers] = await Promise.all([
    discoverSkills(path.join(personaPath, 'skills'), manifest.name),
    discoverCommands(personaPath),
    discoverAgents(personaPath),
    loadHooks(personaPath),
    loadMCPServers(personaPath),
  ]);

  const mcpServerCount = Object.keys(mcpServers).length;
  logger.info(
    `Loaded persona: ${manifest.name} v${manifest.version} ` +
      `(${skills.length} skills, ${commands.length} commands, ${agents.length} agents, ` +
      `${hooks.length} hooks, ${mcpServerCount} MCP servers)`
  );

  return {
    manifest,
    path: personaPath,
    skills,
    commands,
    agents,
    hooks,
    mcpServers,
    active: false,
  };
}

/**
 * Discover all personas in a directory
 */
export async function discoverPersonasInPath(basePath: string): Promise<Persona[]> {
  const personas: Persona[] = [];

  try {
    const entries = await fs.readdir(basePath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const personaPath = path.join(basePath, entry.name);

      try {
        // Check if this is a valid persona directory (has plugin manifest)
        await findPluginManifest(personaPath);

        const persona = await loadPersona(personaPath);
        personas.push(persona);
      } catch (error) {
        // Skip invalid persona directories
        logger.debug(`Skipping ${personaPath}: ${error instanceof Error ? error.message : error}`);
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // Directory doesn't exist - that's ok
      return [];
    }
    throw error;
  }

  return personas;
}

/**
 * Discover all personas from default search paths
 */
export async function discoverAllPersonas(additionalPaths: string[] = []): Promise<Persona[]> {
  const searchPaths = [...getDefaultPersonaPaths(), ...additionalPaths];
  const allPersonas: Persona[] = [];
  const personaMap = new Map<string, Persona>();

  // Scan all paths, later sources override earlier ones
  for (const searchPath of searchPaths) {
    const personas = await discoverPersonasInPath(searchPath);

    for (const persona of personas) {
      personaMap.set(persona.manifest.name, persona);
    }
  }

  allPersonas.push(...personaMap.values());

  logger.info(`Discovered ${allPersonas.length} personas from ${searchPaths.length} search paths`);

  return allPersonas;
}

/**
 * Find a persona by name from discovered personas
 */
export function findPersona(personas: Persona[], name: string): Persona | undefined {
  return personas.find((p) => p.manifest.name === name);
}
