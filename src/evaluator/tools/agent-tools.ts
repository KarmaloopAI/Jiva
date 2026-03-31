/**
 * Evaluator virtual tools — in-process tools that bridge the evaluator to the
 * supervised (main) Jiva agent.
 *
 * These implement the same shape as ICodeTool so they can be mixed into the
 * evaluator's tool dispatch loop alongside MCP tools.
 */

import type { EvaluatorToolContext } from '../types.js';

// We define our own interface here (not importing ICodeTool) because CodeToolContext
// requires an LspManager which the evaluator does not use. EvaluatorToolContext is
// purpose-built for the evaluator.
export interface IEvaluatorTool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  execute(args: Record<string, unknown>, ctx: EvaluatorToolContext): Promise<string>;
}

// ─── interact_with_agent ──────────────────────────────────────────────────────

export const InteractWithAgentTool: IEvaluatorTool = {
  name: 'interact_with_agent',
  description: `Send a message to the supervised Jiva agent as if you were the user.
The agent will process the message and return its response.
Optionally load a specific conversation before sending the message.
Use this tool when you need to guide the main agent to fix a gap or continue work.
After calling this tool, re-read the relevant workspace files to verify the correction was made.`,

  parameters: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: 'The instruction or message to send to the main agent.',
      },
      conversationId: {
        type: 'string',
        description:
          'Optional. Load this conversation ID into the main agent before sending the message. ' +
          'Use list_agent_conversations to find conversation IDs.',
      },
    },
    required: ['message'],
  },

  async execute(args, ctx: EvaluatorToolContext): Promise<string> {
    const message = args.message as string;
    const conversationId = args.conversationId as string | undefined;

    if (conversationId) {
      await ctx.targetAgent.loadConversation(conversationId);
    }

    const response = await ctx.targetAgent.chat(message);
    ctx.onNudgeSent();

    const toolsSummary =
      response.toolsUsed.length > 0
        ? `\nTools used by agent: ${response.toolsUsed.join(', ')}`
        : '';
    const iterSummary = `\nIterations: ${response.iterations}`;

    return `Agent response:\n${response.content}${toolsSummary}${iterSummary}`;
  },
};

// ─── list_agent_conversations ─────────────────────────────────────────────────

export const ListAgentConversationsTool: IEvaluatorTool = {
  name: 'list_agent_conversations',
  description: `List saved conversations from the main Jiva agent.
Returns a JSON array of conversations with their IDs, titles, and last-updated timestamps.
Use this to find a specific conversation to load before inspecting history or sending instructions.`,

  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },

  async execute(_args, ctx: EvaluatorToolContext): Promise<string> {
    const conversations = await ctx.targetAgent.listConversations();
    if (conversations.length === 0) {
      return 'No saved conversations found.';
    }

    const formatted = conversations.map((c) => ({
      id: c.id,
      title: c.title ?? '(untitled)',
      updated: c.updated,
      messageCount: c.messageCount,
      type: c.type ?? 'chat',
    }));

    return JSON.stringify(formatted, null, 2);
  },
};

// ─── get_conversation_history ─────────────────────────────────────────────────

export const GetConversationHistoryTool: IEvaluatorTool = {
  name: 'get_conversation_history',
  description: `Get the message history of the currently loaded conversation in the main agent.
Returns the last 20 messages formatted as [role]: content.
Use this to understand what the main agent has already done before deciding whether to nudge it.`,

  parameters: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Maximum number of recent messages to return. Default: 20.',
      },
    },
    required: [],
  },

  async execute(args, ctx: EvaluatorToolContext): Promise<string> {
    const limit = typeof args.limit === 'number' ? args.limit : 20;
    const history = ctx.targetAgent.getConversationHistory();

    if (history.length === 0) {
      return 'No conversation history available. The main agent has not started a conversation yet.';
    }

    const recent = history.slice(-limit);
    const lines = recent.map((m) => {
      const roleLabel = m.role.toUpperCase();
      const content =
        typeof m.content === 'string'
          ? m.content.substring(0, 500) + (m.content.length > 500 ? '…' : '')
          : '[structured content]';
      return `[${roleLabel}]: ${content}`;
    });

    return lines.join('\n\n---\n\n');
  },
};

// ─── Exports ─────────────────────────────────────────────────────────────────

export const EVALUATOR_VIRTUAL_TOOLS: IEvaluatorTool[] = [
  InteractWithAgentTool,
  ListAgentConversationsTool,
  GetConversationHistoryTool,
];
