/**
 * Example: Programmatic Usage of Jiva
 *
 * Shows how to embed Jiva in your own TypeScript/Node.js project using the
 * same agents the CLI uses:
 *   - DualAgent — general mode (`jiva chat`): Manager plans, Worker executes MCP tools
 *   - CodeAgent — code mode (`jiva chat --code`): single loop, in-process tools, LSP
 *
 * Both implement the IAgent interface (chat, cleanup, resetConversation, …).
 */

import {
  DualAgent,
  CodeAgent,
  createModelClient,
  ModelOrchestrator,
  MCPServerManager,
  WorkspaceManager,
  logger,
  LogLevel,
} from '../src/index.js';

async function main() {
  logger.setLogLevel(LogLevel.INFO);

  // 1. Models — any OpenAI-compatible endpoint (OpenRouter shown here)
  const reasoningModel = createModelClient({
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    apiKey: process.env.OPENROUTER_API_KEY || 'your-api-key-here',
    model: 'openai/gpt-oss-120b',
    type: 'reasoning',
    reasoningEffortStrategy: 'api_param',
    // Optional: rank OpenRouter's upstream providers (see docs/user-guides/OPENROUTER.md)
    openrouter: { providerOrder: ['cerebras', 'groq'], allowFallbacks: true },
  });

  const orchestrator = new ModelOrchestrator({ reasoningModel });

  // 2. Workspace — the directory the agent works in
  const workspace = new WorkspaceManager({ workspaceDir: process.cwd() });
  await workspace.initialize();

  // 3a. Code mode: no MCP servers needed — tools run in-process
  const coder = new CodeAgent({
    orchestrator,
    workspace,
    maxIterations: 30,
    lspEnabled: false, // set true if language servers are installed
  });

  try {
    const res = await coder.chat('List the TypeScript files in src/ and describe the project layout in 3 lines.');
    console.log('CodeAgent:', res.content);
    console.log('Tools used:', res.toolsUsed.join(', '));
    console.log('Timing:', res.timing);
  } finally {
    await coder.cleanup();
  }

  // 3b. General mode: tools come from MCP servers
  const mcpManager = new MCPServerManager();
  await mcpManager.initialize({
    filesystem: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', process.cwd()],
      enabled: true,
    },
  });

  const agent = new DualAgent({
    orchestrator,
    mcpManager,
    workspace,
    maxIterations: 20,
    autoSave: false, // no ConversationManager in this example
  });

  try {
    const res = await agent.chat('What files are in the current directory?');
    console.log('DualAgent:', res.content);
    console.log('Tools used:', res.toolsUsed.join(', '));

    // Start a fresh conversation
    agent.resetConversation();
  } finally {
    await agent.cleanup();
  }
}

main().catch((error) => {
  logger.error('Error in main', error);
  process.exit(1);
});
