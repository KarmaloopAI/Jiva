/**
 * REPL (Read-Eval-Print Loop) for interactive chat with Jiva agent
 */

import inquirer from 'inquirer';
import * as readline from 'readline';
import chalk from 'chalk';
import ora from 'ora';
import { DualAgent } from '../../core/dual-agent.js';
import { logger } from '../../utils/logger.js';
import { orchestrationLogger } from '../../utils/orchestration-logger.js';
import { formatForCLI } from '../../utils/markdown.js';
import type { IAgent } from '../../core/agent-interface.js';
import type { EvaluatorHarness } from '../../evaluator/harness.js';

export type { IAgent };

export interface REPLOptions {
  agent: IAgent;
  /**
   * When true (code mode + --plan flag), each user message triggers a plan-then-approve
   * flow before the agent executes. Only effective when the agent implements `plan()`.
   */
  planMode?: boolean;
  /**
   * When provided, each user message is processed through the harness instead of
   * calling agent.chat() directly. The harness runs the main agent then the evaluator.
   */
  harness?: EvaluatorHarness;
}

function exitRepl(rl: readline.Interface): void {
  process.stdout.write('\n');
  console.log(chalk.gray('Goodbye!\n'));
  // Close readline — fires 'close' → closeHandler → resolve(null) → loop breaks
  // → startREPL returns → index.ts runs agent.cleanup() → process.exit(0).
  rl.close();
  // Safety net: if the graceful cleanup chain doesn't reach process.exit(0) within
  // 500 ms (e.g. LSP shutdown stalls in code mode), force exit.
  // .unref() means the timer won't keep the process alive on its own.
  setTimeout(() => process.exit(0), 500).unref();
}

export async function startREPL(options: REPLOptions): Promise<void> {
  const { agent, planMode = false, harness } = options;

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

  // Use readline WITHOUT terminal mode so it never calls setRawMode.
  // With terminal: false, Ctrl+C is delivered as a normal process SIGINT
  // (the OS handles it in cooked mode) instead of being intercepted by
  // readline's raw-mode key scanner.  This eliminates the "extra keypress
  // after exit" caused by readline leaving the TTY in a dirty state.
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  // Track whether the agent is currently running so the SIGINT handler
  // knows whether to exit (idle) or stop the agent (busy).
  let agentRunning = false;
  // When an agent turn is in progress this is set to a function that gracefully
  // stops the running agent.  Cleared to null in the finally block.
  let stopCurrentAgent: (() => void) | null = null;

  // With terminal: false, Ctrl+C sends process-level SIGINT (not rl 'SIGINT').
  const sigintHandler = () => {
    if (stopCurrentAgent) {
      // Agent is mid-turn — ask it to stop gracefully.
      stopCurrentAgent();
    } else {
      // Idle at the prompt — exit cleanly.
      exitRepl(rl);
    }
  };
  process.on('SIGINT', sigintHandler);

  // Promisified readline input.
  // Each listener removes the other when it fires to avoid stale registrations
  // accumulating across iterations.
  function askForInput(): Promise<string | null> {
    return new Promise(resolve => {
      process.stdout.write(chalk.bold.blue('You: '));
      const lineHandler = (line: string) => {
        rl.removeListener('close', closeHandler);
        resolve(line);
      };
      const closeHandler = () => {
        rl.removeListener('line', lineHandler);
        resolve(null);
      };
      rl.once('line', lineHandler);
      rl.once('close', closeHandler);
    });
  }

  // REPL loop
  while (true) {
    const message = await askForInput();

    // stdin closed (EOF / pipe ended) — exit cleanly
    if (message === null) break;

    const trimmedMessage = message.trim();

    // Handle commands with / prefix
    if (trimmedMessage.startsWith('/')) {
      const command = trimmedMessage.substring(1).toLowerCase();

      if (command === 'exit' || command === 'quit') {
        console.log(chalk.gray('\nGoodbye!\n'));
        const logPath = orchestrationLogger.getLogFilePath();
        if (logPath) {
          console.log(chalk.gray(`Orchestration log saved to: ${logPath}\n`));
        }
        orchestrationLogger.close();
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
        await handleLoadConversation(agent, rl);
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

    // ── Plan-then-approve flow (code mode + --plan flag) ───────────────────
    let messageToSend = trimmedMessage;

    if (planMode && typeof (agent as any).plan === 'function') {
      const planSpinner = ora({ text: 'Exploring codebase and generating plan...', discardStdin: false }).start();
      let planText = '';
      try {
        planText = await (agent as any).plan(trimmedMessage);
        planSpinner.stop();
      } catch (e) {
        planSpinner.stop();
        console.log(chalk.red('\n✗ Planning failed:'), e instanceof Error ? e.message : String(e));
        console.log('');
        continue;
      }

      console.log(chalk.bold.cyan('\n── Implementation Plan ──────────────────────────────────────────\n'));
      console.log(formatForCLI(planText));
      console.log(chalk.bold.cyan('─────────────────────────────────────────────────────────────────\n'));

      rl.pause();
      const { approved } = await inquirer.prompt([{
        type: 'confirm',
        name: 'approved',
        message: chalk.bold('Implement this plan?'),
        default: true,
        prefix: '',
      }]);
      rl.resume();

      if (!approved) {
        console.log(chalk.gray('\nCancelled. Refine your request and try again.\n'));
        continue;
      }

      // Inject the approved plan so the agent knows what to implement
      messageToSend =
        `${trimmedMessage}\n\n` +
        `[The following implementation plan was reviewed and approved by the user. ` +
        `Implement it exactly as described.]\n\n${planText}`;
      console.log('');
    }

    // ── Execute ─────────────────────────────────────────────────────────────
    const spinner = ora({ text: 'Thinking...', discardStdin: false }).start();

    // readline intercepts Ctrl+C (raw mode), so process-level SIGINT won't
    // fire — use stopCurrentAgent instead, dispatched from rl.on('SIGINT').
    agentRunning = true;
    stopCurrentAgent = () => {
      spinner.text = chalk.yellow('Stopping after current step…');
      if (harness) {
        harness.stop();
      } else {
        agent.stop();
      }
    };

    try {
      if (harness) {
        // ── Harness mode: main agent + evaluator ─────────────────────────
        spinner.text = 'Main agent processing…';
        const harnessResult = await harness.run(messageToSend);

        spinner.stop();

        // Main agent response
        console.log(chalk.bold.green('\nJiva:'));
        console.log(formatForCLI(harnessResult.mainAgentResponse));
        console.log(chalk.gray(`[Iterations: ${harnessResult.mainAgentIterations}]`));

        // Evaluation result
        const ev = harnessResult.evaluation;
        console.log('');
        const inconclusive = !ev.passed && ev.gaps.length === 0;
        if (ev.passed) {
          console.log(
            chalk.bold.green('⚡ Evaluation: ') +
            chalk.green(`✓ Passed`) +
            chalk.gray(` — ${ev.nudgesSent} nudge(s), ${ev.cyclesRan} cycle(s)`),
          );
        } else if (inconclusive) {
          console.log(
            chalk.bold.yellow('⚡ Evaluation: ') +
            chalk.yellow(`~ Inconclusive`) +
            chalk.gray(` after ${ev.cyclesRan} cycle(s), ${ev.nudgesSent} nudge(s)`),
          );
        } else {
          console.log(
            chalk.bold.magenta('⚡ Evaluation: ') +
            chalk.red(`✗ ${ev.gaps.length} gap(s) remain`) +
            chalk.gray(` after ${ev.cyclesRan} cycle(s), ${ev.nudgesSent} nudge(s)`),
          );
          for (const gap of ev.gaps) {
            console.log(chalk.red(`  • ${gap}`));
          }
        }
        if (ev.summary) {
          console.log(chalk.gray(`  ${ev.summary}`));
        }

        const k = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
        if (harnessResult.mainAgentTokenUsage) {
          const mtu = harnessResult.mainAgentTokenUsage;
          console.log(chalk.gray(`  Main tokens: ${k(mtu.promptTokens)}p / ${k(mtu.completionTokens)}c = ${k(mtu.totalTokens)} total`));
        }
        if (harnessResult.evaluatorTokenUsage) {
          const etu = harnessResult.evaluatorTokenUsage;
          console.log(chalk.gray(`  Eval tokens: ${k(etu.promptTokens)}p / ${k(etu.completionTokens)}c = ${k(etu.totalTokens)} total`));
        }
        console.log('');
      } else {
        // ── Standard mode ────────────────────────────────────────────────
        const response = await agent.chat(messageToSend);

        spinner.stop();

        console.log(chalk.bold.green('\nJiva:'));

        // Render markdown for prettier output
        const formattedContent = formatForCLI(response.content);
        console.log(formattedContent);

        if (response.toolsUsed.length > 0) {
          console.log(chalk.gray(`\n[Used tools: ${response.toolsUsed.join(', ')}]`));
        }

        console.log(chalk.gray(`[Iterations: ${response.iterations}]`));

        if (response.tokenUsage) {
          const k = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
          const tu = response.tokenUsage;
          console.log(chalk.gray(`[Tokens: ${k(tu.promptTokens)}p + ${k(tu.completionTokens)}c = ${k(tu.totalTokens)} total (this turn: ${k(tu.lastPromptTokens)}p prompt)]`));
        }

        console.log('');
      }
    } catch (error) {
      spinner.stop();
      console.log(chalk.red('\n✗ Error:'), error instanceof Error ? error.message : String(error));
      console.log('');
    } finally {
      agentRunning = false;
      stopCurrentAgent = null;
    }
  }

  // Remove the SIGINT handler so it doesn't leak into caller code.
  process.removeListener('SIGINT', sigintHandler);
  rl.close();
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
  console.log(chalk.bold('Harness Modes (CLI flag):'));
  console.log('  --harness evaluator  Pair a supervisor agent that validates completion');
  console.log('');
}

function showHistory(agent: IAgent) {
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

function showTools(agent: IAgent) {
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

function showServers(agent: IAgent) {
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

async function handleSaveConversation(agent: IAgent) {
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

async function handleLoadConversation(agent: IAgent, rl: readline.Interface) {
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
      const wsHint = conv.workspace ? ` • ${chalk.gray(conv.workspace)}` : '';
      console.log(`     ${chalk.gray(date)} • ${chalk.gray(`${conv.messageCount} messages`)}${wsHint}`);
    });
    console.log('');

    // Ask which one to load — pause the main readline so inquirer can take stdin
    rl.pause();
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
    rl.resume();

    if (selection) {
      const selectedConv = conversations.find(c => c.id === selection);
      await agent.loadConversation(selection);
      console.log(chalk.green(`\n✓ Conversation loaded`));
      if (selectedConv?.workspace) {
        const currentWorkspace = agent.getWorkspace().getWorkspaceDir();
        if (selectedConv.workspace !== currentWorkspace) {
          console.log(chalk.cyan(`  ↳ Workspace restored: ${selectedConv.workspace}`));
        }
      }
      console.log('');
    }
  } catch (error) {
    console.log(chalk.red('\n✗ Failed to load conversation:'), error instanceof Error ? error.message : String(error));
    console.log('');
  }
}

async function handleListConversations(agent: IAgent) {
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
      const typeBadge = conv.type === 'code' ? chalk.magenta(' [code]') : chalk.gray(' [chat]');
      console.log(`\n${index + 1}. ${chalk.cyan.bold(title)}${typeBadge}`);
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
