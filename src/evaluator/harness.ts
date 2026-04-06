/**
 * EvaluatorHarness — coordinates the main Jiva agent and the evaluator.
 *
 * Flow per user message:
 *   1. Run the main agent (mainAgent.chat(userMessage))
 *   2. Run the evaluator (evaluatorAgent.evaluate({ userMessage }))
 *      — the evaluator reads workspace files, identifies gaps, and nudges the
 *        main agent as needed via its interact_with_agent tool
 *   3. Return a HarnessResult containing both the main response and the
 *      evaluation outcome
 */

import { logger } from '../utils/logger.js';
import { EvaluatorAgent } from './evaluator-agent.js';
import type { IAgent } from '../core/agent-interface.js';
import type { EvaluationContext, HarnessOptions, HarnessResult } from './types.js';

export class EvaluatorHarness {
  private mainAgent: IAgent;
  private evaluatorAgent: EvaluatorAgent;
  private verbose: boolean;

  constructor(
    mainAgent: IAgent,
    evaluatorAgent: EvaluatorAgent,
    options: HarnessOptions = {},
  ) {
    this.mainAgent = mainAgent;
    this.evaluatorAgent = evaluatorAgent;
    this.verbose = options.verbose ?? true;
  }

  /**
   * Process a user message through the harness:
   *   1. Main agent processes the request.
   *   2. Evaluator validates and guides completion.
   */
  async run(userMessage: string, evalCtx?: Partial<EvaluationContext>): Promise<HarnessResult> {
    // ── Step 1: Main agent ─────────────────────────────────────────────────
    if (this.verbose) {
      logger.info('[Harness] Main agent processing user request');
    }

    const mainResponse = await this.mainAgent.chat(userMessage);

    if (this.verbose) {
      logger.info(
        `[Harness] Main agent done — ${mainResponse.iterations} iterations, ` +
        `${mainResponse.toolsUsed.length} tools used`,
      );
    }

    // ── Step 2: Evaluator ──────────────────────────────────────────────────
    if (this.verbose) {
      logger.info('[Harness] Evaluator starting validation');
    }

    const evaluationContext: EvaluationContext = {
      userMessage,
      targetConversationId: evalCtx?.targetConversationId,
    };

    const evaluation = await this.evaluatorAgent.evaluate(evaluationContext);

    if (this.verbose) {
      const outcome = evaluation.passed
        ? `✓ Passed (${evaluation.cyclesRan} cycles, ${evaluation.nudgesSent} nudges)`
        : `✗ Failed — ${evaluation.gaps.length} gap(s) remain after ${evaluation.cyclesRan} cycles`;
      logger.info(`[Harness] Evaluation complete — ${outcome}`);
    }

    return {
      mainAgentResponse: mainResponse.content,
      mainAgentIterations: mainResponse.iterations,
      evaluation,
      mainAgentTokenUsage: this.mainAgent.getTokenUsage(),
      evaluatorTokenUsage: this.evaluatorAgent.getOrchestratorTokenUsage(),
    };
  }

  /** Stop both agents cooperatively. */
  stop(): void {
    this.mainAgent.stop();
  }

  /** Cleanup both agents' resources. */
  async cleanup(): Promise<void> {
    await this.mainAgent.cleanup();
    await this.evaluatorAgent['mcpManager'].cleanup();
  }
}
