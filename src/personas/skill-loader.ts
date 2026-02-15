/**
 * Skill loader - parses SKILL.md files with YAML frontmatter
 * Implements progressive disclosure: L1 (metadata) → L2 (body) → L3 (references)
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'yaml';
import { Skill, SkillMetadata } from './types.js';
import {
  validateSkillMetadata,
  validateFrontmatterKeys,
  validateSkillBodyLength,
  normalizeFrontmatter,
} from './validator.js';
import { logger } from '../utils/logger.js';

const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;

/**
 * Parse SKILL.md file and extract frontmatter + body
 */
export async function parseSkillFile(
  filePath: string
): Promise<{ metadata: SkillMetadata; body: string; fullContent: string }> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const match = content.match(FRONTMATTER_REGEX);

    if (!match) {
      throw new Error(`No YAML frontmatter found in ${filePath}. Skills must have --- delimited frontmatter.`);
    }

    const [, frontmatterStr, body] = match;

    // Parse YAML frontmatter
    let rawFrontmatter: Record<string, any>;
    try {
      rawFrontmatter = yaml.parse(frontmatterStr);
    } catch (error) {
      throw new Error(`Invalid YAML in ${filePath}: ${error instanceof Error ? error.message : error}`);
    }

    // Validate frontmatter keys
    const keyErrors = validateFrontmatterKeys(rawFrontmatter);
    if (keyErrors.length > 0) {
      logger.warn(`Skill ${filePath} has validation warnings:`, keyErrors);
    }

    // Normalize and validate metadata
    const metadata = normalizeFrontmatter(rawFrontmatter);
    const metadataErrors = validateSkillMetadata(metadata);

    if (metadataErrors.length > 0) {
      throw new Error(
        `Skill metadata validation failed for ${filePath}:\n` +
          metadataErrors.map((e) => `  - ${e.field}: ${e.message}`).join('\n')
      );
    }

    // Validate body length (warning only)
    const bodyErrors = validateSkillBodyLength(body);
    if (bodyErrors.length > 0) {
      logger.warn(`Skill ${metadata.name}:`, bodyErrors[0].message);
    }

    return { metadata, body: body.trim(), fullContent: content };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`SKILL.md not found at ${filePath}`);
    }
    throw error;
  }
}

/**
 * Discover all skills in a directory (L1 only - metadata)
 * Each subdirectory with a SKILL.md is a skill
 */
export async function discoverSkills(
  skillsDir: string,
  personaName: string
): Promise<Skill[]> {
  const skills: Skill[] = [];

  try {
    const entries = await fs.readdir(skillsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillPath = path.join(skillsDir, entry.name);
      const skillFilePath = path.join(skillPath, 'SKILL.md');

      try {
        // Check if SKILL.md exists
        await fs.access(skillFilePath);

        // Parse L1 only (metadata)
        const { metadata } = await parseSkillFile(skillFilePath);

        skills.push({
          metadata,
          path: skillPath,
          loaded: false, // L2 not yet loaded
          personaName,
        });

        logger.debug(`Discovered skill: ${personaName}:${metadata.name}`);
      } catch (error) {
        // Skip directories without valid SKILL.md
        logger.debug(`Skipping ${skillPath}: ${error instanceof Error ? error.message : error}`);
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // Skills directory doesn't exist - that's ok
      return [];
    }
    throw error;
  }

  return skills;
}

/**
 * Load L2 (full SKILL.md body) for a skill
 */
export async function loadSkillContent(skill: Skill): Promise<void> {
  if (skill.loaded) return;

  const skillFilePath = path.join(skill.path, 'SKILL.md');
  const { fullContent } = await parseSkillFile(skillFilePath);

  skill.content = fullContent;
  skill.loaded = true;

  logger.debug(`Loaded L2 content for skill: ${skill.personaName}:${skill.metadata.name}`);
}

/**
 * Get path to a skill resource (L3 - references, scripts, assets)
 */
export function getSkillResourcePath(skill: Skill, resourceType: 'scripts' | 'references' | 'assets', filename: string): string {
  return path.join(skill.path, resourceType, filename);
}

/**
 * Check if a skill has a specific resource
 */
export async function hasSkillResource(
  skill: Skill,
  resourceType: 'scripts' | 'references' | 'assets',
  filename: string
): Promise<boolean> {
  const resourcePath = getSkillResourcePath(skill, resourceType, filename);
  try {
    await fs.access(resourcePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * List all resources of a type in a skill
 */
export async function listSkillResources(
  skill: Skill,
  resourceType: 'scripts' | 'references' | 'assets'
): Promise<string[]> {
  const resourceDir = path.join(skill.path, resourceType);
  try {
    const entries = await fs.readdir(resourceDir, { withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => e.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}
