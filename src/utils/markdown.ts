/**
 * Markdown Rendering Utilities
 *
 * Provides pretty markdown rendering for CLI output
 */

import { Marked } from 'marked';
import { markedTerminal } from 'marked-terminal';

// Create marked instance with terminal renderer
const marked = new Marked(
  markedTerminal({
    // Width for text wrapping
    width: 100,

    // Show links
    showSectionPrefix: false,
    unescape: true,
    emoji: true,

    // Code block styling
    tab: 2,
  }) as any
);

/**
 * Render markdown text for terminal display
 */
export function renderMarkdown(text: string): string {
  try {
    return marked.parse(text) as string;
  } catch (error) {
    // If markdown parsing fails, return plain text
    return text;
  }
}

/**
 * Check if a string contains markdown formatting
 */
export function containsMarkdown(text: string): boolean {
  // Simple heuristic to detect markdown
  const markdownPatterns = [
    /^#{1,6}\s/m, // Headers
    /\*\*.*\*\*/m, // Bold
    /\*.*\*/m, // Italic
    /`.*`/m, // Code
    /^```/m, // Code blocks
    /^\s*[-*+]\s/m, // Lists
    /^\s*\d+\.\s/m, // Numbered lists
    /\[.*\]\(.*\)/m, // Links
  ];

  return markdownPatterns.some(pattern => pattern.test(text));
}

/**
 * Format text for CLI output - render markdown if detected
 */
export function formatForCLI(text: string): string {
  if (containsMarkdown(text)) {
    return renderMarkdown(text);
  }
  return text;
}

/**
 * Strip markdown formatting (useful for plain text output)
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s/gm, '') // Headers
    .replace(/\*\*(.*?)\*\*/g, '$1') // Bold
    .replace(/\*(.*?)\*/g, '$1') // Italic
    .replace(/`(.*?)`/g, '$1') // Code
    .replace(/```[\s\S]*?```/g, '') // Code blocks
    .replace(/^\s*[-*+]\s/gm, '• ') // Lists
    .replace(/\[(.*?)\]\(.*?\)/g, '$1'); // Links
}
