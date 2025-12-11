/**
 * Workspace and Directive Handler
 *
 * Manages workspace directory and jiva-directive.md file
 */

import { readFile, access } from 'fs/promises';
import { resolve, join } from 'path';
import { WorkspaceError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export interface WorkspaceConfig {
  workspaceDir: string;
  directivePath?: string;
}

export interface DirectiveContent {
  raw: string;
  parsed: {
    purpose?: string;
    tasks?: string[];
    constraints?: string[];
    context?: string;
  };
}

export class WorkspaceManager {
  private workspaceDir: string;
  private directivePath?: string;
  private directive?: DirectiveContent;

  constructor(config: WorkspaceConfig) {
    this.workspaceDir = resolve(config.workspaceDir);
    this.directivePath = config.directivePath
      ? resolve(config.directivePath)
      : undefined;
  }

  /**
   * Initialize workspace and load directive if available
   */
  async initialize(): Promise<void> {
    logger.info(`Initializing workspace: ${this.workspaceDir}`);

    // Verify workspace directory exists
    try {
      await access(this.workspaceDir);
    } catch (error) {
      throw new WorkspaceError(
        `Workspace directory does not exist: ${this.workspaceDir}`
      );
    }

    // Try to load directive
    await this.loadDirective();
  }

  /**
   * Load and parse jiva-directive.md
   */
  async loadDirective(): Promise<DirectiveContent | undefined> {
    // Look for directive in order of precedence:
    // 1. Explicitly provided path
    // 2. jiva-directive.md in workspace root
    // 3. .jiva/directive.md in workspace root

    const possiblePaths = [
      this.directivePath,
      join(this.workspaceDir, 'jiva-directive.md'),
      join(this.workspaceDir, '.jiva', 'directive.md'),
    ].filter(Boolean) as string[];

    for (const path of possiblePaths) {
      try {
        await access(path);
        const content = await readFile(path, 'utf-8');

        this.directive = {
          raw: content,
          parsed: this.parseDirective(content),
        };

        logger.success(`Loaded directive from: ${path}`);
        return this.directive;
      } catch (error) {
        // Continue to next path
      }
    }

    logger.info('No directive file found. Agent will operate in general mode.');
    return undefined;
  }

  /**
   * Parse directive markdown content
   */
  private parseDirective(content: string): DirectiveContent['parsed'] {
    const parsed: DirectiveContent['parsed'] = {};

    // Extract purpose (first paragraph or # Purpose section)
    const purposeMatch = content.match(/^#\s*Purpose\s*\n\n([\s\S]*?)(?=\n#|$)/i);
    if (purposeMatch) {
      parsed.purpose = purposeMatch[1].trim();
    } else {
      // Use first paragraph as purpose
      const firstParagraph = content.split('\n\n')[0];
      if (firstParagraph && !firstParagraph.startsWith('#')) {
        parsed.purpose = firstParagraph.trim();
      }
    }

    // Extract tasks
    const tasksMatch = content.match(/^#\s*Tasks?\s*\n\n([\s\S]*?)(?=\n#|$)/im);
    if (tasksMatch) {
      parsed.tasks = tasksMatch[1]
        .split('\n')
        .filter(line => line.trim().match(/^[-*]\s+/))
        .map(line => line.replace(/^[-*]\s+/, '').trim());
    }

    // Extract constraints
    const constraintsMatch = content.match(/^#\s*Constraints?\s*\n\n([\s\S]*?)(?=\n#|$)/im);
    if (constraintsMatch) {
      parsed.constraints = constraintsMatch[1]
        .split('\n')
        .filter(line => line.trim().match(/^[-*]\s+/))
        .map(line => line.replace(/^[-*]\s+/, '').trim());
    }

    // Extract context (everything else or # Context section)
    const contextMatch = content.match(/^#\s*Context\s*\n\n([\s\S]*?)(?=\n#|$)/im);
    if (contextMatch) {
      parsed.context = contextMatch[1].trim();
    }

    return parsed;
  }

  /**
   * Get directive content formatted for system prompt
   * Returns the raw directive content as-is to preserve user's formatting
   */
  getDirectivePrompt(): string | undefined {
    if (!this.directive) {
      return undefined;
    }

    // Return the raw content verbatim - users should control their directive format
    return `# Jiva Directive

You are operating with the following directive:

${this.directive.raw}`;
  }

  /**
   * Get workspace directory
   */
  getWorkspaceDir(): string {
    return this.workspaceDir;
  }

  /**
   * Get directive if loaded
   */
  getDirective(): DirectiveContent | undefined {
    return this.directive;
  }

  /**
   * Check if directive is loaded
   */
  hasDirective(): boolean {
    return !!this.directive;
  }
}
