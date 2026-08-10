/**
 * Orchestration Logger - Tracks Manager/Worker/Client coordination
 *
 * Writes detailed logs to understand how tasks flow through the three-agent system.
 * Supports both local filesystem (CLI) and cloud storage (HTTP) modes.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { StorageProvider } from '../storage/provider.js';

interface OrchestrationEvent {
  timestamp: string;
  phase: 'DUAL_AGENT' | 'MANAGER' | 'WORKER' | 'CLIENT';
  event: string;
  details: Record<string, any>;
}

export class OrchestrationLogger {
  private static instance: OrchestrationLogger;
  private logFilePath: string | null = null;
  private logStream: fs.WriteStream | null = null;
  private sessionStart: Date;

  // Cloud-aware: buffer logs and flush to storage provider
  private storageProvider: StorageProvider | null = null;
  private sessionId: string | null = null;
  private logBuffer: string[] = [];
  private maxBufferSize: number = 100;

  /**
   * Latest live status string derived from the most recent orchestration event.
   * Updated in `writeEvent()` — the single funnel every `logXxx()` call passes
   * through — so it always reflects what the agent is doing *right now*.
   * Exposed over `GET /api/session/:sessionId/status` for polling while a
   * `POST /api/chat` turn is in flight.
   */
  private currentStatus: string = 'Idle';

  /**
   * Create an OrchestrationLogger.
   *
   * Called with no arguments → CLI mode: writes to a timestamped file in
   * ~/.jiva/logs/ (backward-compatible singleton behaviour).
   *
   * Called with (storageProvider, sessionId) → HTTP/cloud mode: buffers events
   * in memory and flushes them to the session-scoped storage provider.  No
   * filesystem log file is created.  Each HTTP session should own its own
   * instance so events never cross-contaminate between tenants.
   */
  constructor(storageProvider?: StorageProvider, sessionId?: string) {
    this.sessionStart = new Date();
    if (storageProvider && sessionId) {
      this.storageProvider = storageProvider;
      this.sessionId = sessionId;
      // Cloud mode: skip filesystem logging
    } else {
      this.initializeLogFile();
    }
  }

  /** @deprecated Use per-session constructor instead — see class jsdoc. */
  static getInstance(): OrchestrationLogger {
    if (!OrchestrationLogger.instance) {
      OrchestrationLogger.instance = new OrchestrationLogger();
    }
    return OrchestrationLogger.instance;
  }

  /**
   * @deprecated Pass storageProvider + sessionId to the constructor instead.
   * Kept for backward compatibility; will be removed in a future version.
   */
  setStorageProvider(storageProvider: StorageProvider, sessionId: string) {
    this.storageProvider = storageProvider;
    this.sessionId = sessionId;
    // In cloud mode, don't use filesystem
    if (this.logStream) {
      this.logStream.end();
      this.logStream = null;
    }
  }

  /**
   * Reset to filesystem mode (CLI)
   */
  resetToFilesystemMode() {
    if (this.storageProvider) {
      // Flush any remaining logs
      this.flushToStorage();
    }
    this.storageProvider = null;
    this.sessionId = null;
    this.logBuffer = [];
    // Reinitialize filesystem logging
    if (!this.logStream) {
      this.initializeLogFile();
    }
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
    // Derive a human-readable live status from this event BEFORE writing it.
    // Every logXxx() call funnels through here, so this is the single place to
    // keep currentStatus in sync with what the agent is doing right now.
    this.currentStatus = this.deriveStatus(event);

    const line = [
      `[${event.timestamp}]`,
      `[${event.phase}]`,
      event.event,
      Object.keys(event.details).length > 0 ? JSON.stringify(event.details, null, 2) : '',
    ].filter(Boolean).join(' ');

    const logLine = line + '\n';

    // Cloud mode: buffer and periodically flush to storage
    if (this.storageProvider && this.sessionId) {
      this.logBuffer.push(logLine);
      
      // Auto-flush when buffer reaches threshold
      if (this.logBuffer.length >= this.maxBufferSize) {
        this.flushToStorage();
      }
    } 
    // Local mode: write to filesystem
    else if (this.logStream) {
      this.logStream.write(logLine);
    }
  }

  /**
   * Derive a short, human-readable status string from an orchestration event.
   * Used to populate `currentStatus` for the live-status polling endpoint.
   * Unknown events fall back to the event name itself so new event types are
   * never silently dropped.
   */
  private deriveStatus(event: OrchestrationEvent): string {
    const { phase, event: evt, details } = event;
    const toolName = typeof details?.toolName === 'string' ? details.toolName : '';

    // DualAgent phase transitions
    if (phase === 'DUAL_AGENT') {
      switch (evt) {
        case 'USER_MESSAGE': return 'Received message…';
        case 'PHASE_START_PLANNING': return 'Planning execution…';
        case 'PHASE_END_PLANNING': return 'Planning complete';
        case 'PHASE_START_EXECUTION': return 'Executing subtasks…';
        case 'PHASE_END_EXECUTION': return 'Execution complete';
        case 'PHASE_START_SYNTHESIS': return 'Synthesizing results…';
        case 'PHASE_END_SYNTHESIS': return 'Synthesis complete';
        case 'FINAL_RESPONSE': return 'Done';
        default: return evt;
      }
    }

    // Manager activity
    if (phase === 'MANAGER') {
      switch (evt) {
        case 'CREATE_PLAN': return 'Planning execution…';
        case 'PLAN_CREATED': return 'Plan created';
        case 'REVIEW_SUBTASK': return 'Reviewing subtask result…';
        case 'DECISION': return 'Evaluating progress…';
        case 'SYNTHESIZE': return 'Synthesizing results…';
        default: return evt;
      }
    }

    // Worker activity — the most useful "what is it doing right now" signal
    if (phase === 'WORKER') {
      switch (evt) {
        case 'START_SUBTASK': return 'Starting subtask…';
        case 'ITERATION': return `Working (step ${details?.iteration ?? '?'}/${details?.maxIterations ?? '?'})`;
        case 'TOOL_CALL':
          return toolName ? `Running ${toolName}…` : 'Running tool…';
        case 'TOOL_RESULT':
          return toolName ? `Finished ${toolName}` : 'Finished tool call';
        case 'COMPLETE': return 'Subtask complete';
        default: return evt;
      }
    }

    // Client (validation) activity
    if (phase === 'CLIENT') {
      switch (evt) {
        case 'TASK_ANALYSIS': return 'Analyzing task…';
        case 'COHERENCE_CHECK': return 'Checking coherence…';
        case 'VALIDATION_RESULT': return 'Validation complete';
        default: return evt;
      }
    }

    return evt;
  }

  /**
   * Get the latest live status string for this session.
   * Polled via `GET /api/session/:sessionId/status` while a `POST /api/chat`
   * turn is in flight. Returns 'Idle' before any event has been logged.
   */
  getCurrentStatus(): string {
    return this.currentStatus;
  }

  /**
   * Flush buffered logs to cloud storage
   */
  private flushToStorage() {
    if (!this.storageProvider || !this.sessionId || this.logBuffer.length === 0) {
      return;
    }

    try {
      // Append to orchestration log in storage
      const logContent = this.logBuffer.join('');
      const logKey = `sessions/${this.sessionId}/orchestration.log`;
      
      // Note: This is async but we don't await to avoid blocking
      // The storage provider should handle the write asynchronously
      this.storageProvider.appendToLog(logKey, logContent).catch(err => {
        console.error('[OrchestrationLogger] Failed to flush to storage:', err);
      });
      
      this.logBuffer = [];
    } catch (error) {
      console.error('[OrchestrationLogger] Error flushing to storage:', error);
    }
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

  // Client events
  logClientAnalysis(level: string, requirementCount: number, reasoning: string): void {
    this.writeEvent({
      timestamp: new Date().toISOString(),
      phase: 'CLIENT',
      event: 'TASK_ANALYSIS',
      details: { level, requirementCount, reasoning },
    });
  }

  logClientCoherenceCheck(isCoherent: boolean, unsupportedClaims: string[], reasoning: string): void {
    this.writeEvent({
      timestamp: new Date().toISOString(),
      phase: 'CLIENT',
      event: 'COHERENCE_CHECK',
      details: { isCoherent, unsupportedClaimCount: unsupportedClaims.length, unsupportedClaims, reasoning },
    });
  }

  logClientValidation(approved: boolean, issues: string[], nextAction?: string): void {
    this.writeEvent({
      timestamp: new Date().toISOString(),
      phase: 'CLIENT',
      event: 'VALIDATION_RESULT',
      details: { approved, issueCount: issues.length, issues, nextAction },
    });
  }

  // Utility
  getLogFilePath(): string | null {
    return this.logFilePath;
  }

  /**
   * Manually flush logs (call before session ends)
   */
  async flush(): Promise<void> {
    if (this.storageProvider && this.sessionId) {
      this.flushToStorage();
      // Wait a bit for async writes to complete
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  close(): void {
    // Flush any remaining logs
    if (this.storageProvider && this.sessionId) {
      this.flushToStorage();
    }
    
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
