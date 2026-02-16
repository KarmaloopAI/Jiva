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

class OrchestrationLogger {
  private static instance: OrchestrationLogger;
  private logFilePath: string | null = null;
  private logStream: fs.WriteStream | null = null;
  private sessionStart: Date;
  
  // Cloud-aware: buffer logs and flush to storage provider
  private storageProvider: StorageProvider | null = null;
  private sessionId: string | null = null;
  private logBuffer: string[] = [];
  private maxBufferSize: number = 100;

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

  /**
   * Configure for cloud/HTTP mode with storage provider
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
