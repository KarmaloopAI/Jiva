/**
 * Skill packaging and installation utilities
 * Handles .skill files (ZIP archives) and directory structures
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { createReadStream, createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import archiver from 'archiver';
import unzipper from 'unzipper';
import { parseSkillFile } from './skill-loader.js';
import { logger } from '../utils/logger.js';

/**
 * Package a skill directory into a .skill file (ZIP archive)
 */
export async function packageSkill(
  skillDir: string,
  outputPath?: string
): Promise<string> {
  // Validate that this is a skill directory
  const skillMdPath = path.join(skillDir, 'SKILL.md');
  try {
    await fs.access(skillMdPath);
  } catch {
    throw new Error(`Not a valid skill directory: ${skillDir} (missing SKILL.md)`);
  }

  // Parse skill to get name
  const { metadata } = await parseSkillFile(skillMdPath);
  const skillName = metadata.name;

  // Determine output path
  const finalOutputPath = outputPath || path.join(process.cwd(), `${skillName}.skill`);

  // Create archive
  const output = createWriteStream(finalOutputPath);
  const archive = archiver('zip', { zlib: { level: 9 } });

  archive.on('warning', (err: Error) => {
    if ((err as any).code === 'ENOENT') {
      logger.warn('Archive warning:', err);
    } else {
      throw err;
    }
  });

  archive.on('error', (err: Error) => {
    throw err;
  });

  archive.pipe(output);

  // Add skill directory to archive
  // Exclude common development files
  archive.glob(
    '**/*',
    {
      cwd: skillDir,
      ignore: [
        '**/node_modules/**',
        '**/__pycache__/**',
        '**/evals/**',
        '**/.git/**',
        '**/.DS_Store',
        '**/Thumbs.db',
        '**/*.pyc',
        '**/.env',
        '**/.venv/**',
      ],
    },
    { prefix: path.basename(skillDir) }
  );

  await archive.finalize();

  return new Promise((resolve, reject) => {
    output.on('close', () => {
      logger.info(`Packaged skill: ${finalOutputPath} (${archive.pointer()} bytes)`);
      resolve(finalOutputPath);
    });
    output.on('error', reject);
  });
}

/**
 * Install a .skill file into a persona's skills directory
 */
export async function installSkillFile(
  skillFile: string,
  personaName: string,
  personaPath?: string
): Promise<string> {
  // Verify file exists
  try {
    await fs.access(skillFile);
  } catch {
    throw new Error(`Skill file not found: ${skillFile}`);
  }

  // Determine target persona path
  let targetPersonaPath: string;
  if (personaPath) {
    targetPersonaPath = personaPath;
  } else {
    // Install to user-level persona
    const home = os.homedir();
    targetPersonaPath = path.join(home, '.jiva', 'personas', personaName);
  }

  const skillsDir = path.join(targetPersonaPath, 'skills');

  // Ensure skills directory exists
  await fs.mkdir(skillsDir, { recursive: true });

  // Create temporary extraction directory
  const tempDir = path.join(os.tmpdir(), `jiva-skill-${Date.now()}`);
  await fs.mkdir(tempDir, { recursive: true });

  try {
    // Extract to temp directory
    await pipeline(
      createReadStream(skillFile),
      unzipper.Extract({ path: tempDir })
    );

    // Find the skill directory (should be the only top-level directory)
    const entries = await fs.readdir(tempDir, { withFileTypes: true });
    const skillDirs = entries.filter((e) => e.isDirectory());

    if (skillDirs.length === 0) {
      throw new Error('Invalid .skill file: no skill directory found');
    }

    if (skillDirs.length > 1) {
      throw new Error('Invalid .skill file: multiple top-level directories found');
    }

    const extractedSkillDir = path.join(tempDir, skillDirs[0].name);

    // Validate it's a proper skill
    const skillMdPath = path.join(extractedSkillDir, 'SKILL.md');
    const { metadata } = await parseSkillFile(skillMdPath);

    // Move to final location
    const finalSkillPath = path.join(skillsDir, metadata.name);

    // Check if skill already exists
    try {
      await fs.access(finalSkillPath);
      throw new Error(
        `Skill ${metadata.name} already exists in ${personaName}. Remove it first or use --force.`
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    // Move skill to final location
    await fs.rename(extractedSkillDir, finalSkillPath);

    logger.info(
      `Installed skill: ${metadata.name} → ${personaName} (${finalSkillPath})`
    );

    return finalSkillPath;
  } finally {
    // Cleanup temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      logger.warn(`Failed to cleanup temp directory: ${tempDir}`);
    }
  }
}

/**
 * Uninstall a skill from a persona
 */
export async function uninstallSkill(
  skillName: string,
  personaName: string,
  personaPath?: string
): Promise<void> {
  // Determine persona path
  let targetPersonaPath: string;
  if (personaPath) {
    targetPersonaPath = personaPath;
  } else {
    const home = os.homedir();
    targetPersonaPath = path.join(home, '.jiva', 'personas', personaName);
  }

  const skillPath = path.join(targetPersonaPath, 'skills', skillName);

  // Verify skill exists
  try {
    await fs.access(skillPath);
  } catch {
    throw new Error(`Skill not found: ${skillName} in persona ${personaName}`);
  }

  // Remove skill directory
  await fs.rm(skillPath, { recursive: true, force: true });

  logger.info(`Uninstalled skill: ${skillName} from ${personaName}`);
}

/**
 * Create a new empty skill directory structure
 */
export async function createSkill(
  skillName: string,
  outputDir: string,
  options: {
    description?: string;
    license?: string;
    author?: string;
  } = {}
): Promise<string> {
  const skillPath = path.join(outputDir, skillName);

  // Check if directory already exists
  try {
    await fs.access(skillPath);
    throw new Error(`Skill directory already exists: ${skillPath}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  // Create directory structure
  await fs.mkdir(skillPath, { recursive: true });
  await fs.mkdir(path.join(skillPath, 'scripts'), { recursive: true });
  await fs.mkdir(path.join(skillPath, 'references'), { recursive: true });
  await fs.mkdir(path.join(skillPath, 'assets'), { recursive: true });

  // Create SKILL.md template
  const skillMdContent = `---
name: ${skillName}
description: >
  ${options.description || 'Add a detailed description here that explains when this skill should be used.'}
  List all trigger phrases and keywords that would indicate this skill is relevant.
${options.license ? `license: ${options.license}\n` : ''}${
    options.author
      ? `metadata:\n  author: ${options.author}\n  version: 1.0.0\n`
      : ''
  }---

# ${skillName.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}

## Overview
One-liner of what this skill does.

## Workflow
Step-by-step instructions the agent follows:

1. First, do this
2. Then do that
3. Finally, output in this format

## Resources
- Use \`scripts/example.sh\` for basic operations
- Read \`references/api.md\` when integrating with external services
- Refer to \`assets/template.txt\` for output formatting
`;

  await fs.writeFile(path.join(skillPath, 'SKILL.md'), skillMdContent);

  // Create example script
  const exampleScript = `#!/bin/bash
# Example script for ${skillName}
# Add your script logic here
echo "Hello from ${skillName}"
`;

  await fs.writeFile(path.join(skillPath, 'scripts', 'example.sh'), exampleScript);
  await fs.chmod(path.join(skillPath, 'scripts', 'example.sh'), 0o755);

  // Create example reference
  const exampleReference = `# ${skillName} Reference

Add detailed documentation, API references, or other reference material here.

This content is loaded on-demand (L3) when the agent needs it during execution.
`;

  await fs.writeFile(
    path.join(skillPath, 'references', 'api.md'),
    exampleReference
  );

  logger.info(`Created skill: ${skillPath}`);

  return skillPath;
}
