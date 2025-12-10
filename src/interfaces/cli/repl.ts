/**
 * REPL (Read-Eval-Print Loop) for interactive chat with Jiva agent
 */

import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import { JivaAgent } from '../../core/agent.js';
import { logger } from '../../utils/logger.js';
import { formatForCLI } from '../../utils/markdown.js';

export interface REPLOptions {
  agent: JivaAgent;
}

export async function startREPL(options: REPLOptions): Promise<void> {
  const { agent } = options;

  console.log(chalk.bold.cyan('\n∞ Jiva Agent - Interactive Mode\n'));
  console.log(chalk.gray('Type your message and press Enter. Type /help for commands or /exit to quit.\n'));

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

    // Handle commands with / prefix
    if (trimmedMessage.startsWith('/')) {
      const command = trimmedMessage.substring(1).toLowerCase();

      if (command === 'exit' || command === 'quit') {
        console.log(chalk.gray('\nGoodbye!\n'));
        break;
      }

      if (command === 'help') {
        showHelp();
        continue;
      }

      if (command === 'reset') {
        agent.resetConversation();
        console.log(chalk.yellow('\n✓ Conversation reset\n'));
        continue;
      }

      if (command === 'history') {
        showHistory(agent);
        continue;
      }

      if (command === 'tools') {
        showTools(agent);
        continue;
      }

      if (command === 'servers') {
        showServers(agent);
        continue;
      }

      if (command === 'save') {
        await handleSaveConversation(agent);
        continue;
      }

      if (command === 'load') {
        await handleLoadConversation(agent);
        continue;
      }

      if (command === 'list') {
        await handleListConversations(agent);
        continue;
      }

      // Unknown command
      console.log(chalk.red(`\n✗ Unknown command: /${command}`));
      console.log(chalk.gray('Type /help for available commands\n'));
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

      // Render markdown for prettier output
      const formattedContent = formatForCLI(response.content);
      console.log(formattedContent);

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
  console.log('  /exit, /quit   - Exit the REPL');
  console.log('  /help          - Show this help message');
  console.log('  /reset         - Reset conversation history');
  console.log('  /history       - Show conversation history');
  console.log('  /tools         - Show available tools');
  console.log('  /servers       - Show MCP server status');
  console.log('  /save          - Save current conversation');
  console.log('  /load          - Load a saved conversation');
  console.log('  /list          - List all saved conversations');
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

async function handleSaveConversation(agent: JivaAgent) {
  const conversationManager = agent.getConversationManager();

  if (!conversationManager) {
    console.log(chalk.red('\n✗ Conversation manager not initialized'));
    console.log('');
    return;
  }

  try {
    const id = await agent.saveConversation();
    console.log(chalk.green(`\n✓ Conversation saved: ${id}`));
    console.log('');
  } catch (error) {
    console.log(chalk.red('\n✗ Failed to save conversation:'), error instanceof Error ? error.message : String(error));
    console.log('');
  }
}

async function handleLoadConversation(agent: JivaAgent) {
  const conversationManager = agent.getConversationManager();

  if (!conversationManager) {
    console.log(chalk.red('\n✗ Conversation manager not initialized'));
    console.log('');
    return;
  }

  try {
    const conversations = await agent.listConversations();

    if (conversations.length === 0) {
      console.log(chalk.yellow('\nNo saved conversations found'));
      console.log('');
      return;
    }

    // Show list of conversations
    console.log(chalk.bold('\nSaved Conversations:'));
    conversations.forEach((conv, index) => {
      const date = new Date(conv.updated).toLocaleString();
      const title = conv.title || 'Untitled Conversation';
      console.log(`  ${index + 1}. ${chalk.cyan(title)}`);
      console.log(`     ${chalk.gray(date)} • ${chalk.gray(`${conv.messageCount} messages`)}`);
    });
    console.log('');

    // Ask which one to load
    const { selection } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selection',
        message: 'Select conversation to load:',
        choices: [
          ...conversations.map((conv, index) => ({
            name: `${index + 1}. ${conv.title || 'Untitled'} (${new Date(conv.updated).toLocaleString()})`,
            value: conv.id,
          })),
          { name: 'Cancel', value: null },
        ],
      },
    ]);

    if (selection) {
      await agent.loadConversation(selection);
      console.log(chalk.green(`\n✓ Conversation loaded: ${selection}`));
      console.log('');
    }
  } catch (error) {
    console.log(chalk.red('\n✗ Failed to load conversation:'), error instanceof Error ? error.message : String(error));
    console.log('');
  }
}

async function handleListConversations(agent: JivaAgent) {
  const conversationManager = agent.getConversationManager();

  if (!conversationManager) {
    console.log(chalk.red('\n✗ Conversation manager not initialized'));
    console.log('');
    return;
  }

  try {
    const conversations = await agent.listConversations();

    if (conversations.length === 0) {
      console.log(chalk.yellow('\nNo saved conversations found'));
      console.log('');
      return;
    }

    console.log(chalk.bold(`\nSaved Conversations (${conversations.length}):`));

    conversations.forEach((conv, index) => {
      const date = new Date(conv.updated).toLocaleString();
      const title = conv.title || 'Untitled Conversation';
      console.log(`\n${index + 1}. ${chalk.cyan.bold(title)}`);
      console.log(`   ${chalk.gray(conv.id)}`);
      console.log(`   Updated: ${chalk.gray(date)}`);
      console.log(`   Messages: ${chalk.gray(conv.messageCount.toString())}`);
      if (conv.workspace) {
        console.log(`   Workspace: ${chalk.gray(conv.workspace)}`);
      }
    });

    console.log('');
  } catch (error) {
    console.log(chalk.red('\n✗ Failed to list conversations:'), error instanceof Error ? error.message : String(error));
    console.log('');
  }
}
