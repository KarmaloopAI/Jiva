/**
 * REPL (Read-Eval-Print Loop) for interactive chat with Jiva agent
 */

import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import { JivaAgent } from '../../core/agent.js';
import { logger } from '../../utils/logger.js';

export interface REPLOptions {
  agent: JivaAgent;
}

export async function startREPL(options: REPLOptions): Promise<void> {
  const { agent } = options;

  console.log(chalk.bold.cyan('\n🤖 Jiva Agent - Interactive Mode\n'));
  console.log(chalk.gray('Type your message and press Enter. Type "exit" to quit.\n'));

  // Show workspace info
  const workspace = agent.getWorkspace();
  console.log(chalk.gray(`Workspace: ${workspace.getWorkspaceDir()}`));

  if (workspace.hasDirective()) {
    console.log(chalk.gray('✓ Directive loaded'));
  }

  // Show MCP servers
  const mcpManager = agent.getMCPManager();
  const serverStatus = mcpManager.getServerStatus();
  const connectedServers = serverStatus.filter(s => s.connected);

  if (connectedServers.length > 0) {
    console.log(chalk.gray(`MCP Servers: ${connectedServers.map(s => s.name).join(', ')}`));

    const totalTools = connectedServers.reduce((sum, s) => sum + s.toolCount, 0);
    console.log(chalk.gray(`Available tools: ${totalTools}`));
  }

  console.log('');

  // REPL loop
  while (true) {
    const { message } = await inquirer.prompt([
      {
        type: 'input',
        name: 'message',
        message: chalk.bold.blue('You:'),
        prefix: '',
      },
    ]);

    const trimmedMessage = message.trim();

    // Handle special commands
    if (trimmedMessage.toLowerCase() === 'exit' || trimmedMessage.toLowerCase() === 'quit') {
      console.log(chalk.gray('\nGoodbye!\n'));
      break;
    }

    if (trimmedMessage.toLowerCase() === 'help') {
      showHelp();
      continue;
    }

    if (trimmedMessage.toLowerCase() === 'reset') {
      agent.resetConversation();
      console.log(chalk.yellow('\n✓ Conversation reset\n'));
      continue;
    }

    if (trimmedMessage.toLowerCase() === 'history') {
      showHistory(agent);
      continue;
    }

    if (trimmedMessage.toLowerCase() === 'tools') {
      showTools(agent);
      continue;
    }

    if (trimmedMessage.toLowerCase() === 'servers') {
      showServers(agent);
      continue;
    }

    if (!trimmedMessage) {
      continue;
    }

    // Process message with agent
    const spinner = ora('Thinking...').start();

    try {
      const response = await agent.chat(trimmedMessage);

      spinner.stop();

      console.log(chalk.bold.green('\nJiva:'));
      console.log(response.content);

      if (response.toolsUsed.length > 0) {
        console.log(chalk.gray(`\n[Used tools: ${response.toolsUsed.join(', ')}]`));
      }

      console.log(chalk.gray(`[Iterations: ${response.iterations}]\n`));
    } catch (error) {
      spinner.stop();
      console.log(chalk.red('\n✗ Error:'), error instanceof Error ? error.message : String(error));
      console.log('');
    }
  }
}

function showHelp() {
  console.log(chalk.bold('\nAvailable Commands:'));
  console.log('  exit, quit   - Exit the REPL');
  console.log('  help         - Show this help message');
  console.log('  reset        - Reset conversation history');
  console.log('  history      - Show conversation history');
  console.log('  tools        - Show available tools');
  console.log('  servers      - Show MCP server status');
  console.log('');
}

function showHistory(agent: JivaAgent) {
  const history = agent.getConversationHistory();

  console.log(chalk.bold('\nConversation History:'));

  history.forEach((msg, index) => {
    const roleColor =
      msg.role === 'user' ? chalk.blue :
      msg.role === 'assistant' ? chalk.green :
      msg.role === 'system' ? chalk.gray :
      chalk.yellow;

    const content = typeof msg.content === 'string'
      ? msg.content.substring(0, 100) + (msg.content.length > 100 ? '...' : '')
      : '[complex content]';

    console.log(`${index + 1}. ${roleColor(msg.role)}: ${content}`);
  });

  console.log('');
}

function showTools(agent: JivaAgent) {
  const tools = agent.getMCPManager().getClient().getAllTools();

  console.log(chalk.bold(`\nAvailable Tools (${tools.length}):`));

  if (tools.length === 0) {
    console.log(chalk.gray('  No tools available'));
  } else {
    tools.forEach(tool => {
      console.log(`  ${chalk.cyan(tool.name)}: ${tool.description}`);
    });
  }

  console.log('');
}

function showServers(agent: JivaAgent) {
  const serverStatus = agent.getMCPManager().getServerStatus();

  console.log(chalk.bold('\nMCP Servers:'));

  if (serverStatus.length === 0) {
    console.log(chalk.gray('  No servers configured'));
  } else {
    serverStatus.forEach(server => {
      const status = server.connected ? chalk.green('✓') : chalk.red('✗');
      const enabled = server.enabled ? '' : chalk.gray(' (disabled)');

      console.log(`  ${status} ${server.name}: ${server.toolCount} tools${enabled}`);
    });
  }

  console.log('');
}
