/**
 * Orchestration Logger - Tracks Manager/Worker coordination
 *
 * Writes detailed logs to understand how tasks flow through the dual-agent system.
 * Logs are written to: ~/.jiva/logs/orchestration-{timestamp}.log
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface OrchestrationEvent {
  timestamp: string;
  phase: 'DUAL_AGENT' | 'MANAGER' | 'WORKER';
  event: string;
  details: Record<string, any>;
}

class OrchestrationLogger {
  private static instance: OrchestrationLogger;
  private logFilePath: string | null = null;
  private logStream: fs.WriteStream | null = null;
  private sessionStart: Date;

  private constructor() {
    this.sessionStart = new Date();
    this.initializeLogFile();
  }

  static getInstance(): OrchestrationLogger {
    if (!OrchestrationLogger.instance) {
      OrchestrationLogger.instance = new OrchestrationLogger();
    }
    return OrchestrationLogger.instance;
  }

  private initializeLogFile(): void {
    try {
      // Create logs directory in ~/.jiva/logs/
      const jivaDir = path.join(os.homedir(), '.jiva', 'logs');
      fs.mkdirSync(jivaDir, { recursive: true });

      // Create timestamped log file
      const timestamp = this.sessionStart.toISOString().replace(/[:.]/g, '-');
      this.logFilePath = path.join(jivaDir, `orchestration-${timestamp}.log`);

      // Create write stream
      this.logStream = fs.createWriteStream(this.logFilePath, { flags: 'a' });

      // Write header
      this.writeHeader();
    } catch (error) {
      console.error('Failed to initialize orchestration log file:', error);
      this.logFilePath = null;
      this.logStream = null;
    }
  }

  private writeHeader(): void {
    if (!this.logStream) return;

    const header = [
      '='.repeat(80),
      'JIVA ORCHESTRATION LOG',
      `Session started: ${this.sessionStart.toISOString()}`,
      '='.repeat(80),
      '',
    ].join('\n');

    this.logStream.write(header);
  }

  private writeEvent(event: OrchestrationEvent): void {
    if (!this.logStream) return;

    const line = [
      `[${event.timestamp}]`,
      `[${event.phase}]`,
      event.event,
      Object.keys(event.details).length > 0 ? JSON.stringify(event.details, null, 2) : '',
    ].filter(Boolean).join(' ');

    this.logStream.write(line + '\n');
  }

  // DualAgent events
  logUserMessage(message: string): void {
    this.writeEvent({
      timestamp: new Date().toISOString(),
      phase: 'DUAL_AGENT',
      event: 'USER_MESSAGE',
      details: { message },
    });
  }

  logPhaseStart(phase: 'PLANNING' | 'EXECUTION' | 'SYNTHESIS'): void {
    this.writeEvent({
      timestamp: new Date().toISOString(),
      phase: 'DUAL_AGENT',
      event: `PHASE_START_${phase}`,
      details: {},
    });
  }

  logPhaseEnd(phase: 'PLANNING' | 'EXECUTION' | 'SYNTHESIS', durationMs: number): void {
    this.writeEvent({
      timestamp: new Date().toISOString(),
      phase: 'DUAL_AGENT',
      event: `PHASE_END_${phase}`,
      details: { durationMs },
    });
  }

  logFinalResponse(response: string, totalIterations: number, toolsUsed: string[]): void {
    this.writeEvent({
      timestamp: new Date().toISOString(),
      phase: 'DUAL_AGENT',
      event: 'FINAL_RESPONSE',
      details: {
        responseLength: response.length,
        totalIterations,
        toolsUsed,
        uniqueTools: [...new Set(toolsUsed)],
      },
    });
  }

  // Manager events
  logManagerCreatePlan(task: string, context: string): void {
    this.writeEvent({
      timestamp: new Date().toISOString(),
      phase: 'MANAGER',
      event: 'CREATE_PLAN',
      details: { task, context },
    });
  }

  logManagerPlanCreated(subtasks: string[], reasoning: string): void {
    this.writeEvent({
      timestamp: new Date().toISOString(),
      phase: 'MANAGER',
      event: 'PLAN_CREATED',
      details: {
        subtaskCount: subtasks.length,
        subtasks,
        reasoning,
      },
    });
  }

  logManagerReview(subtask: string, workerResult: string): void {
    this.writeEvent({
      timestamp: new Date().toISOString(),
      phase: 'MANAGER',
      event: 'REVIEW_SUBTASK',
      details: {
        subtask,
        workerResultLength: workerResult.length,
        workerResultPreview: workerResult.substring(0, 200),
      },
    });
  }

  logManagerDecision(isComplete: boolean, reasoning: string, nextAction?: string): void {
    this.writeEvent({
      timestamp: new Date().toISOString(),
      phase: 'MANAGER',
      event: 'DECISION',
      details: {
        isComplete,
        reasoning,
        nextAction,
      },
    });
  }

  logManagerSynthesize(resultsCount: number): void {
    this.writeEvent({
      timestamp: new Date().toISOString(),
      phase: 'MANAGER',
      event: 'SYNTHESIZE',
      details: { resultsCount },
    });
  }

  // Worker events
  logWorkerStart(subtask: string, context: string): void {
    this.writeEvent({
      timestamp: new Date().toISOString(),
      phase: 'WORKER',
      event: 'START_SUBTASK',
      details: { subtask, context },
    });
  }

  logWorkerIteration(iteration: number, maxIterations: number): void {
    this.writeEvent({
      timestamp: new Date().toISOString(),
      phase: 'WORKER',
      event: 'ITERATION',
      details: { iteration, maxIterations },
    });
  }

  logWorkerToolCall(toolName: string, args: Record<string, any>): void {
    this.writeEvent({
      timestamp: new Date().toISOString(),
      phase: 'WORKER',
      event: 'TOOL_CALL',
      details: { toolName, args },
    });
  }

  logWorkerToolResult(toolName: string, success: boolean, hasImages: boolean): void {
    this.writeEvent({
      timestamp: new Date().toISOString(),
      phase: 'WORKER',
      event: 'TOOL_RESULT',
      details: { toolName, success, hasImages },
    });
  }

  logWorkerComplete(success: boolean, toolsUsed: string[], iterations: number): void {
    this.writeEvent({
      timestamp: new Date().toISOString(),
      phase: 'WORKER',
      event: 'COMPLETE',
      details: {
        success,
        toolsUsed,
        iterations,
        uniqueTools: [...new Set(toolsUsed)],
      },
    });
  }

  // Utility
  getLogFilePath(): string | null {
    return this.logFilePath;
  }

  close(): void {
    if (this.logStream) {
      const footer = [
        '',
        '='.repeat(80),
        `Session ended: ${new Date().toISOString()}`,
        `Duration: ${Date.now() - this.sessionStart.getTime()}ms`,
        '='.repeat(80),
      ].join('\n');

      this.logStream.write(footer);
      this.logStream.end();
      this.logStream = null;
    }
  }
}

export const orchestrationLogger = OrchestrationLogger.getInstance();
