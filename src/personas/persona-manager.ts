/**
 * Persona Manager - Central controller for persona lifecycle and skill routing
 * Handles discovery, activation, and integration with the agent system
 */

import { Persona, Skill } from './types.js';
import {
  discoverAllPersonas,
  findPersona,
  getDefaultPersonaPaths,
} from './persona-loader.js';
import { loadSkillContent } from './skill-loader.js';
import { logger } from '../utils/logger.js';
import { ConfigManager } from '../core/config.js';

export class PersonaManager {
  private personas: Persona[] = [];
  private activePersona: Persona | null = null;
  private additionalSearchPaths: string[] = [];
  private configManager: ConfigManager;

  constructor(additionalPaths: string[] = []) {
    this.additionalSearchPaths = additionalPaths;
    this.configManager = ConfigManager.getInstance();
  }

  /**
   * Initialize the persona manager by discovering all available personas
   */
  async initialize(): Promise<void> {
    logger.info('Initializing Persona Manager...');
    this.personas = await discoverAllPersonas(this.additionalSearchPaths);

    if (this.personas.length === 0) {
      logger.info('No personas found in search paths:', getDefaultPersonaPaths());
    } else {
      logger.info(
        `Initialized with ${this.personas.length} personas:`,
        this.personas.map((p) => p.manifest.name).join(', ')
      );
      
      // Restore active persona from config
      const savedPersonaName = this.configManager.getActivePersona();
      if (savedPersonaName) {
        const success = this.activatePersona(savedPersonaName);
        if (success) {
          logger.info(`Restored active persona: ${savedPersonaName}`);
        } else {
          logger.warn(`Saved persona '${savedPersonaName}' not found, clearing config`);
          this.configManager.setActivePersona(null);
        }
      }
    }
  }

  /**
   * Refresh persona list (re-scan directories)
   */
  async refresh(): Promise<void> {
    await this.initialize();
  }

  /**
   * Get all discovered personas
   */
  getPersonas(): Persona[] {
    return this.personas;
  }

  /**
   * Get the currently active persona
   */
  getActivePersona(): Persona | null {
    return this.activePersona;
  }

  /**
   * Activate a persona by name
   */
  activatePersona(name: string): boolean {
    const persona = findPersona(this.personas, name);

    if (!persona) {
      logger.warn(`Persona not found: ${name}`);
      return false;
    }

    // Deactivate current persona if any
    if (this.activePersona) {
      this.activePersona.active = false;
    }

    this.activePersona = persona;
    persona.active = true;

    // Persist to config
    this.configManager.setActivePersona(persona.manifest.name);

    const mcpServerCount = persona.mcpServers ? Object.keys(persona.mcpServers).length : 0;
    logger.info(
      `Activated persona: ${persona.manifest.name} ` +
        `(${persona.skills.length} skills, ${mcpServerCount} MCP servers)`
    );

    return true;
  }

  /**
   * Deactivate the current persona
   */
  deactivatePersona(): void {
    if (this.activePersona) {
      this.activePersona.active = false;
      logger.info(`Deactivated persona: ${this.activePersona.manifest.name}`);
      this.activePersona = null;
      this.configManager.setActivePersona(null);
    }
  }

  /**
   * Get all skills from the active persona (L1 metadata only)
   */
  getActiveSkills(): Skill[] {
    return this.activePersona?.skills || [];
  }

  /**
   * Get all skills from all personas (for global skill search)
   */
  getAllSkills(): Skill[] {
    return this.personas.flatMap((p) => p.skills);
  }

  /**
   * Find a skill by name in the active persona
   */
  findSkill(skillName: string): Skill | undefined {
    return this.activePersona?.skills.find((s) => s.metadata.name === skillName);
  }

  /**
   * Load L2 content for a skill (called by agent when skill is selected)
   */
  async loadSkill(skillName: string): Promise<Skill | null> {
    const skill = this.findSkill(skillName);

    if (!skill) {
      logger.warn(`Skill not found: ${skillName}`);
      return null;
    }

    if (!skill.loaded) {
      await loadSkillContent(skill);
      logger.info(`Loaded skill content: ${skill.personaName}:${skill.metadata.name}`);
    }

    return skill;
  }

  /**
   * Generate the <available_skills> XML block for agent system prompt
   * This is L1 - just metadata for routing
   */
  generateSkillsPromptBlock(): string {
    const skills = this.getActiveSkills();

    if (skills.length === 0) {
      return '';
    }

    const skillsXml = skills
      .map(
        (skill) => `<skill>
  <name>${this.escapeXml(skill.metadata.name)}</name>
  <description>${this.escapeXml(skill.metadata.description)}</description>
  <location>${this.escapeXml(skill.path)}/SKILL.md</location>
</skill>`
      )
      .join('\n');

    return `<available_skills>
${skillsXml}
</available_skills>`;
  }

  /**
   * Generate persona context for system prompt
   */
  generatePersonaPromptBlock(): string {
    if (!this.activePersona) {
      return '';
    }

    const persona = this.activePersona;

    return `<active_persona>
  <name>${this.escapeXml(persona.manifest.name)}</name>
  <description>${this.escapeXml(persona.manifest.description)}</description>
  <version>${persona.manifest.version}</version>
  <skills_count>${persona.skills.length}</skills_count>
  <commands_count>${persona.commands.length}</commands_count>
</active_persona>`;
  }

  /**
   * Get full system prompt addition (persona + skills)
   */
  getSystemPromptAddition(): string {
    if (!this.activePersona) {
      return '';
    }

    const personaBlock = this.generatePersonaPromptBlock();
    const skillsBlock = this.generateSkillsPromptBlock();

    if (!skillsBlock) {
      return personaBlock;
    }

    return `${personaBlock}

${skillsBlock}

When a user's request matches a skill description, read that skill's SKILL.md file using the view tool to get detailed instructions. Skills use progressive disclosure - only load what you need when you need it.`;
  }

  /**
   * Check if a persona is installed
   */
  hasPersona(name: string): boolean {
    return this.personas.some((p) => p.manifest.name === name);
  }

  /**
   * Get persona info by name
   */
  getPersona(name: string): Persona | undefined {
    return findPersona(this.personas, name);
  }

  /**
   * Get MCP servers from active persona
   */
  getPersonaMCPServers(): Record<string, any> {
    return this.activePersona?.mcpServers || {};
  }

  /**
   * Escape XML special characters
   */
  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
