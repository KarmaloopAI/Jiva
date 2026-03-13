import type { ICodeTool, CodeToolContext } from './index.js';

export const SpawnCodeAgentTool: ICodeTool = {
  name: 'spawn_code_agent',
  description: `Spawn a child code agent to handle a focused sub-task.

Use when you need to delegate a specific, well-scoped coding task to a focused sub-agent.
The child agent has access to the same tools (read, edit, write, glob, grep, bash).

Examples:
- "Write unit tests for the authentication module in src/auth/"
- "Refactor the UserService class to use dependency injection"
- "Fix all TypeScript errors in the src/models/ directory"

The child agent completes its task and returns a summary of what it did.
Depth is limited to prevent infinite nesting.`,

  parameters: {
    type: 'object',
    properties: {
      task: {
        type: 'string',
        description: 'The specific coding task for the child agent to complete',
      },
      context: {
        type: 'string',
        description: 'Additional context or constraints for the child agent',
      },
    },
    required: ['task'],
  },

  async execute(args, ctx: CodeToolContext): Promise<string> {
    const task = args.task as string;
    const context = args.context as string | undefined;

    if (!ctx.spawnChildAgent) {
      return 'Error: Sub-agent spawning is not available in this context.';
    }

    const currentDepth = ctx.depth ?? 0;
    const maxDepth = ctx.maxDepth ?? 2;

    if (currentDepth >= maxDepth) {
      return `Error: Maximum agent depth (${maxDepth}) reached. Cannot spawn further sub-agents.`;
    }

    try {
      const result = await ctx.spawnChildAgent(task, context);
      return `Sub-agent completed task.\n\nResult:\n${result}`;
    } catch (e) {
      return `Sub-agent failed: ${e instanceof Error ? e.message : String(e)}`;
    }
  },
};
