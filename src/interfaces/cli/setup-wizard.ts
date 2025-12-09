/**
 * Setup Wizard for first-time configuration
 */

import inquirer from 'inquirer';
import { configManager } from '../../core/config.js';
import { logger } from '../../utils/logger.js';
import chalk from 'chalk';

export async function runSetupWizard(): Promise<void> {
  console.log(chalk.bold.cyan('\n🤖 Welcome to Jiva Setup Wizard\n'));
  console.log('This wizard will help you configure Jiva for the first time.\n');

  // Reasoning Model Configuration
  console.log(chalk.bold('Reasoning Model Configuration (gpt-oss-120b)'));
  console.log(chalk.gray('This model will be used for reasoning and tool calling.\n'));

  const reasoningAnswers = await inquirer.prompt([
    {
      type: 'input',
      name: 'endpoint',
      message: 'API Endpoint URL:',
      default: 'https://cloud.olakrutrim.com/v1/chat/completions',
      validate: (input: string) => {
        try {
          new URL(input);
          return true;
        } catch {
          return 'Please enter a valid URL';
        }
      },
    },
    {
      type: 'password',
      name: 'apiKey',
      message: 'API Key:',
      validate: (input: string) => input.length > 0 || 'API key is required',
    },
    {
      type: 'input',
      name: 'model',
      message: 'Model name:',
      default: 'gpt-oss-120b',
    },
  ]);

  configManager.setReasoningModel({
    name: 'reasoning',
    endpoint: reasoningAnswers.endpoint,
    apiKey: reasoningAnswers.apiKey,
    type: 'reasoning',
    defaultModel: reasoningAnswers.model,
  });

  logger.success('Reasoning model configured');

  // Multimodal Model Configuration (Optional)
  console.log(chalk.bold('\nMultimodal Model Configuration (Optional)'));
  console.log(chalk.gray('This model will be used for understanding images.\n'));

  const { configureMultimodal } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'configureMultimodal',
      message: 'Would you like to configure a multimodal model?',
      default: true,
    },
  ]);

  if (configureMultimodal) {
    const multimodalAnswers = await inquirer.prompt([
      {
        type: 'input',
        name: 'endpoint',
        message: 'Multimodal API Endpoint URL:',
        default: 'https://cloud.olakrutrim.com/v1/chat/completions',
        validate: (input: string) => {
          try {
            new URL(input);
            return true;
          } catch {
            return 'Please enter a valid URL';
          }
        },
      },
      {
        type: 'password',
        name: 'apiKey',
        message: 'Multimodal API Key:',
        default: reasoningAnswers.apiKey,
        validate: (input: string) => input.length > 0 || 'API key is required',
      },
      {
        type: 'input',
        name: 'model',
        message: 'Multimodal model name:',
        default: 'Llama-4-Maverick-17B-128E-Instruct',
      },
    ]);

    configManager.setMultimodalModel({
      name: 'multimodal',
      endpoint: multimodalAnswers.endpoint,
      apiKey: multimodalAnswers.apiKey,
      type: 'multimodal',
      defaultModel: multimodalAnswers.model,
    });

    logger.success('Multimodal model configured');
  }

  // MCP Servers Configuration
  console.log(chalk.bold('\nMCP Servers Configuration'));
  console.log(chalk.gray('Setting up default MCP servers (filesystem, commands)...\n'));

  configManager.initializeDefaultServers();
  logger.success('Default MCP servers configured');

  // Debug Mode
  const { enableDebug } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'enableDebug',
      message: 'Enable debug mode?',
      default: false,
    },
  ]);

  configManager.setDebug(enableDebug);

  console.log(chalk.bold.green('\n✓ Setup complete!\n'));
  console.log(`Configuration saved to: ${chalk.cyan(configManager.getConfigPath())}`);
  console.log('\nYou can now run:', chalk.cyan('jiva'));
  console.log('');
}

/**
 * Update existing configuration interactively
 */
export async function updateConfiguration(): Promise<void> {
  console.log(chalk.bold.cyan('\n🔧 Update Jiva Configuration\n'));

  const { choice } = await inquirer.prompt([
    {
      type: 'list',
      name: 'choice',
      message: 'What would you like to update?',
      choices: [
        { name: 'Reasoning Model', value: 'reasoning' },
        { name: 'Multimodal Model', value: 'multimodal' },
        { name: 'MCP Servers', value: 'mcp' },
        { name: 'Debug Mode', value: 'debug' },
        { name: 'View Configuration', value: 'view' },
        { name: 'Reset All', value: 'reset' },
        { name: 'Cancel', value: 'cancel' },
      ],
    },
  ]);

  switch (choice) {
    case 'reasoning':
      await updateReasoningModel();
      break;
    case 'multimodal':
      await updateMultimodalModel();
      break;
    case 'mcp':
      await manageMCPServers();
      break;
    case 'debug':
      await toggleDebugMode();
      break;
    case 'view':
      viewConfiguration();
      break;
    case 'reset':
      await resetConfiguration();
      break;
    case 'cancel':
      console.log('Cancelled');
      break;
  }
}

async function updateReasoningModel() {
  const current = configManager.getReasoningModel();

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'endpoint',
      message: 'API Endpoint URL:',
      default: current?.endpoint,
    },
    {
      type: 'password',
      name: 'apiKey',
      message: 'API Key:',
      default: current?.apiKey,
    },
    {
      type: 'input',
      name: 'model',
      message: 'Model name:',
      default: current?.defaultModel,
    },
  ]);

  configManager.setReasoningModel({
    name: 'reasoning',
    endpoint: answers.endpoint,
    apiKey: answers.apiKey,
    type: 'reasoning',
    defaultModel: answers.model,
  });

  logger.success('Reasoning model updated');
}

async function updateMultimodalModel() {
  const current = configManager.getMultimodalModel();

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'endpoint',
      message: 'Multimodal API Endpoint URL:',
      default: current?.endpoint || 'https://cloud.olakrutrim.com/v1/chat/completions',
    },
    {
      type: 'password',
      name: 'apiKey',
      message: 'Multimodal API Key:',
      default: current?.apiKey,
    },
    {
      type: 'input',
      name: 'model',
      message: 'Multimodal model name:',
      default: current?.defaultModel || 'Llama-4-Maverick-17B-128E-Instruct',
    },
  ]);

  configManager.setMultimodalModel({
    name: 'multimodal',
    endpoint: answers.endpoint,
    apiKey: answers.apiKey,
    type: 'multimodal',
    defaultModel: answers.model,
  });

  logger.success('Multimodal model updated');
}

async function manageMCPServers() {
  const servers = configManager.getMCPServers();
  const serverNames = Object.keys(servers);

  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'MCP Server Action:',
      choices: [
        { name: 'List Servers', value: 'list' },
        { name: 'Add Server', value: 'add' },
        { name: 'Remove Server', value: 'remove' },
        { name: 'Back', value: 'back' },
      ],
    },
  ]);

  if (action === 'list') {
    console.log('\nConfigured MCP Servers:');
    Object.entries(servers).forEach(([name, config]) => {
      console.log(`  ${config.enabled ? '✓' : '✗'} ${name}: ${config.command} ${config.args?.join(' ') || ''}`);
    });
  } else if (action === 'add') {
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'name',
        message: 'Server name:',
      },
      {
        type: 'input',
        name: 'command',
        message: 'Command:',
      },
      {
        type: 'input',
        name: 'args',
        message: 'Arguments (space-separated):',
      },
    ]);

    configManager.addMCPServer(answers.name, {
      command: answers.command,
      args: answers.args ? answers.args.split(' ') : [],
      enabled: true,
    });

    logger.success(`MCP server '${answers.name}' added`);
  } else if (action === 'remove' && serverNames.length > 0) {
    const { serverName } = await inquirer.prompt([
      {
        type: 'list',
        name: 'serverName',
        message: 'Select server to remove:',
        choices: serverNames,
      },
    ]);

    configManager.removeMCPServer(serverName);
    logger.success(`MCP server '${serverName}' removed`);
  }
}

async function toggleDebugMode() {
  const current = configManager.isDebug();

  const { enabled } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'enabled',
      message: 'Enable debug mode?',
      default: current,
    },
  ]);

  configManager.setDebug(enabled);
  logger.success(`Debug mode ${enabled ? 'enabled' : 'disabled'}`);
}

function viewConfiguration() {
  const config = configManager.getConfig();
  console.log('\nCurrent Configuration:');
  console.log(JSON.stringify(config, null, 2));
}

async function resetConfiguration() {
  const { confirm } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: chalk.red('Are you sure you want to reset all configuration?'),
      default: false,
    },
  ]);

  if (confirm) {
    configManager.reset();
    logger.success('Configuration reset');
  }
}
