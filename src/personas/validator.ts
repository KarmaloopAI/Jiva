/**
 * Skill and Persona validation logic
 * Enforces frontmatter rules as specified in the implementation guide
 */

import { SkillMetadata, SkillValidationError } from './types.js';

const SKILL_NAME_REGEX = /^[a-z0-9-]+$/;
const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1024;
const MAX_COMPATIBILITY_LENGTH = 500;

const ALLOWED_FRONTMATTER_KEYS = [
  'name',
  'description',
  'license',
  'allowedTools',
  'allowed-tools', // Accept kebab-case variant
  'metadata',
  'compatibility',
];

/**
 * Validate skill metadata from frontmatter
 */
export function validateSkillMetadata(
  metadata: Partial<SkillMetadata>
): SkillValidationError[] {
  const errors: SkillValidationError[] = [];

  // Required: name
  if (!metadata.name) {
    errors.push({
      field: 'name',
      message: 'Skill name is required',
    });
  } else {
    // Name format: kebab-case, no leading/trailing/consecutive hyphens
    if (!SKILL_NAME_REGEX.test(metadata.name)) {
      errors.push({
        field: 'name',
        message: 'Skill name must be lowercase alphanumeric with hyphens only',
        value: metadata.name,
      });
    }

    // No leading/trailing hyphens
    if (metadata.name.startsWith('-') || metadata.name.endsWith('-')) {
      errors.push({
        field: 'name',
        message: 'Skill name cannot start or end with a hyphen',
        value: metadata.name,
      });
    }

    // No consecutive hyphens
    if (metadata.name.includes('--')) {
      errors.push({
        field: 'name',
        message: 'Skill name cannot contain consecutive hyphens',
        value: metadata.name,
      });
    }

    // Max length
    if (metadata.name.length > MAX_NAME_LENGTH) {
      errors.push({
        field: 'name',
        message: `Skill name must be ${MAX_NAME_LENGTH} characters or less`,
        value: metadata.name,
      });
    }
  }

  // Required: description
  if (!metadata.description) {
    errors.push({
      field: 'description',
      message: 'Skill description is required',
    });
  } else {
    // No angle brackets
    if (/<|>/.test(metadata.description)) {
      errors.push({
        field: 'description',
        message: 'Skill description cannot contain angle brackets (< >)',
        value: metadata.description,
      });
    }

    // Max length
    if (metadata.description.length > MAX_DESCRIPTION_LENGTH) {
      errors.push({
        field: 'description',
        message: `Skill description must be ${MAX_DESCRIPTION_LENGTH} characters or less (got ${metadata.description.length})`,
        value: metadata.description.substring(0, 100) + '...',
      });
    }
  }

  // Optional: compatibility (max 500 chars)
  if (metadata.compatibility && metadata.compatibility.length > MAX_COMPATIBILITY_LENGTH) {
    errors.push({
      field: 'compatibility',
      message: `Compatibility note must be ${MAX_COMPATIBILITY_LENGTH} characters or less`,
      value: metadata.compatibility,
    });
  }

  return errors;
}

/**
 * Validate that only allowed frontmatter keys are present
 */
export function validateFrontmatterKeys(frontmatter: Record<string, any>): SkillValidationError[] {
  const errors: SkillValidationError[] = [];
  const keys = Object.keys(frontmatter);

  for (const key of keys) {
    if (!ALLOWED_FRONTMATTER_KEYS.includes(key)) {
      errors.push({
        field: key,
        message: `Unknown frontmatter key "${key}". Allowed keys: ${ALLOWED_FRONTMATTER_KEYS.join(', ')}`,
        value: frontmatter[key],
      });
    }
  }

  return errors;
}

/**
 * Validate SKILL.md body length (L2 should be < 500 lines)
 */
export function validateSkillBodyLength(content: string): SkillValidationError[] {
  const errors: SkillValidationError[] = [];
  const lines = content.split('\n');

  if (lines.length > 500) {
    errors.push({
      field: 'content',
      message: `SKILL.md body should be under 500 lines (got ${lines.length}). Consider moving detailed content to references/`,
      value: lines.length,
    });
  }

  return errors;
}

/**
 * Normalize frontmatter keys (handle kebab-case variants)
 */
export function normalizeFrontmatter(frontmatter: Record<string, any>): SkillMetadata {
  return {
    name: frontmatter.name,
    description: frontmatter.description,
    license: frontmatter.license,
    compatibility: frontmatter.compatibility,
    allowedTools: frontmatter.allowedTools || frontmatter['allowed-tools'],
    metadata: frontmatter.metadata,
  };
}
