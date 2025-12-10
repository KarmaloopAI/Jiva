/**
 * Example: Programmatic Usage of Jiva
 *
 * This example shows how to use Jiva programmatically in your own TypeScript/Node.js projects.
 */

import {
  JivaAgent,
  createKrutrimModel,
  ModelOrchestrator,
  MCPServerManager,
  WorkspaceManager,
  logger,
  LogLevel,
} from '../src/index.js';

async function main() {
  // Enable debug logging
  logger.setLogLevel(LogLevel.DEBUG);

  try {
    // 1. Create the reasoning model (gpt-oss-120b)
    const reasoningModel = createKrutrimModel({
      endpoint: 'https://cloud.olakrutrim.com/v1/chat/completions',
      apiKey: process.env.KRUTRIM_API_KEY || 'your-api-key-here',
      model: 'gpt-oss-120b',
      type: 'reasoning',
    });

    // 2. Optional: Create multimodal model for image understanding
    const multimodalModel = createKrutrimModel({
      endpoint: 'https://cloud.olakrutrim.com/v1/chat/completions',
      apiKey: process.env.KRUTRIM_API_KEY || 'your-api-key-here',
      model: 'Llama-4-Maverick-17B-128E-Instruct',
      type: 'multimodal',
    });

    // 3. Create model orchestrator
    const orchestrator = new ModelOrchestrator({
      reasoningModel,
      multimodalModel,
    });

    // 4. Initialize MCP servers
    const mcpManager = new MCPServerManager();
    await mcpManager.initialize({
      // Filesystem server for file operations
      filesystem: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', process.cwd()],
        enabled: true,
      },
      // You can add more MCP servers here
      // For example: @playwright/mcp for browser automation
      // See: https://github.com/modelcontextprotocol/servers
    });

    // 5. Initialize workspace
    const workspace = new WorkspaceManager({
      workspaceDir: process.cwd(),
      // Optional: specify directive file
      // directivePath: './my-directive.md',
    });
    await workspace.initialize();

    // 6. Create Jiva agent
    const agent = new JivaAgent({
      orchestrator,
      mcpManager,
      workspace,
      maxIterations: 10,
      temperature: 0.7,
    });

    // 7. Use the agent
    console.log('Starting Jiva agent...\n');

    // Example 1: Simple chat
    const response1 = await agent.chat('What files are in the current directory?');
    console.log('Response:', response1.content);
    console.log('Tools used:', response1.toolsUsed);
    console.log('Iterations:', response1.iterations);
    console.log('\n---\n');

    // Example 2: Multi-step task
    const response2 = await agent.chat(
      'Find all TypeScript files and count the total lines of code'
    );
    console.log('Response:', response2.content);
    console.log('Tools used:', response2.toolsUsed);
    console.log('Iterations:', response2.iterations);
    console.log('\n---\n');

    // Example 3: With image (if multimodal model configured)
    if (orchestrator.hasMultimodalSupport()) {
      const response3 = await agent.chat(
        'Describe the image at https://example.com/image.jpg'
      );
      console.log('Response:', response3.content);
      console.log('\n---\n');
    }

    // 8. Reset conversation to start fresh
    agent.resetConversation();

    // 9. Cleanup
    await agent.cleanup();

    console.log('Done!');
  } catch (error) {
    logger.error('Error in main', error);
    process.exit(1);
  }
}

// Run the example
main();
