/**
 * Client Agent - Adaptive validation and quality control
 *
 * Acts as user advocate, validating that Manager/Worker actually deliver
 * what the user requested. Uses tiered involvement levels to minimize cost:
 *
 * - MINIMAL: Info requests, simple queries → metadata validation only
 *   BUT: Detects unjustified failures and escalates to STANDARD
 * - STANDARD: Creation requests → file existence + basic validation
 * - THOROUGH: Complex/testing requests OR failures → full E2E validation with tools
 */

import { ModelOrchestrator } from '../models/orchestrator.js';
import { MCPServerManager } from '../mcp/server-manager.js';
import { logger } from '../utils/logger.js';
import { orchestrationLogger } from '../utils/orchestration-logger.js';
import { MCPClient } from '../mcp/client.js';
import { WorkerResult } from './worker-agent.js';

interface FailureAnalysis {
  claimsFailure: boolean;
  hasEvidence: boolean;
  reasoning: string;
  suggestedAction?: string;
}

interface CoherenceAnalysis {
  isCoherent: boolean;
  reasoning: string;
  unsupportedClaims: string[];
  suggestedAction?: string;
}

export enum InvolvementLevel {
  MINIMAL = 'minimal',     // Metadata only, no tools
  STANDARD = 'standard',   // Basic validation with read tools
  THOROUGH = 'thorough',   // Full E2E validation with all tools
}

export interface Requirement {
  type: 'file_creation' | 'file_modification' | 'testing' | 'verification' | 'information' | 'other';
  description: string;
  filePath?: string;
  mustUseTools?: string[]; // Tools that must be used for this requirement
}

export interface ValidationResult {
  approved: boolean;
  requirementsMet: boolean;
  issues: string[];
  nextAction?: string;
  involvementLevel: InvolvementLevel;
}

export class ClientAgent {
  private orchestrator: ModelOrchestrator;
  private mcpManager: MCPServerManager;
  private mcpClient: MCPClient;
  private failureCount: number = 0;

  // Read-only tools Client can use for validation
  private readonly ALLOWED_TOOLS = [
    'filesystem__read_text_file',
    'filesystem__list_directory',
    'filesystem__directory_tree',
    'filesystem__search_files',
    'playwright__browser_navigate',
    'playwright__browser_console_messages',
    'playwright__browser_take_screenshot',
    'playwright__browser_evaluate',
  ];

  constructor(orchestrator: ModelOrchestrator, mcpManager: MCPServerManager) {
    this.orchestrator = orchestrator;
    this.mcpManager = mcpManager;
    this.mcpClient = mcpManager.getClient();
  }

  /**
   * Use LLM to analyze the task and determine involvement level + requirements.
   * Replaces keyword-based determineInvolvementLevel() and parseRequirements()
   * with semantic understanding that avoids false positives.
   */
  private async analyzeTaskRequirements(
    userMessage: string,
    subtasks: string[],
    workerResult?: WorkerResult
  ): Promise<{ level: InvolvementLevel; requirements: Requirement[] }> {
    const workerContext = workerResult
      ? `\nWorker Result (first 500 chars): ${workerResult.result.substring(0, 500)}\nWorker Success: ${workerResult.success}\nTools Used: ${workerResult.toolsUsed.join(', ') || 'none'} (${workerResult.toolsUsed.length} total)`
      : '';

    const analysisPrompt = `You are a task analyst for a software agent system. Analyze the user's request to determine:
1. How deeply to validate the Worker's output (involvement level)
2. What specific requirements the task implies

USER MESSAGE: ${userMessage}

SUBTASKS: ${JSON.stringify(subtasks)}
${workerContext}

PREVIOUS FAILURE COUNT: ${this.failureCount}

Respond ONLY with valid JSON in this exact format (no other text):
{
  "involvementLevel": "<MINIMAL | STANDARD | THOROUGH>",
  "involvementReasoning": "<brief explanation of why this level>",
  "requirements": [
    {
      "type": "<file_creation | file_modification | testing | verification | information | other>",
      "description": "<what this requirement entails>",
      "filePath": null,
      "mustUseTools": null
    }
  ]
}

CRITICAL RULES for involvementLevel:
- THOROUGH: ONLY when the user EXPLICITLY asks to test or verify something in a browser/test environment, OR after previous failures (failureCount > 0), OR for complex multi-file operations (>3 subtasks)
- MINIMAL: Information-only requests (listing files, explaining code, describing something, answering questions) where no files are created or modified
- STANDARD: Default for creation, modification, or action tasks

CRITICAL RULES for requirements:
- "testing" type with mustUseTools ["playwright__"] should ONLY be set when the user wants browser-based testing or verification of a web page/HTML/UI
- Words like "check", "find", "verify" in the context of system administration (disk space, processes, configurations) are NOT browser testing — they are "information" type WITHOUT playwright tools
- Examples:
  - "check how much space my caches use" = type "information", mustUseTools null
  - "find the biggest files in Downloads" = type "information", mustUseTools null
  - "test the login page in the browser" = type "testing", mustUseTools ["playwright__"]
  - "create index.html and verify it works" = type "file_creation" + type "testing" with playwright
  - "make sure the server is running" = type "verification", mustUseTools null
- If no specific tools are required, set mustUseTools to null
- Always include at least one requirement entry`;

    try {
      const response = await this.orchestrator.chat({
        messages: [
          { role: 'system', content: 'You are a strict task analyst. Respond only with valid JSON.' },
          { role: 'user', content: analysisPrompt },
        ],
        temperature: 0.1,
      });

      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const analysis = JSON.parse(jsonMatch[0]);

        // Map string to enum
        let level: InvolvementLevel;
        switch (analysis.involvementLevel?.toUpperCase()) {
          case 'THOROUGH':
            level = InvolvementLevel.THOROUGH;
            break;
          case 'MINIMAL':
            level = InvolvementLevel.MINIMAL;
            break;
          default:
            level = InvolvementLevel.STANDARD;
        }

        // Hard override: escalate to THOROUGH after failures
        if (this.failureCount > 0 && level !== InvolvementLevel.THOROUGH) {
          logger.debug(`[Client] Escalating to THOROUGH due to ${this.failureCount} previous failures`);
          level = InvolvementLevel.THOROUGH;
        }

        const requirements: Requirement[] = (analysis.requirements || []).map((req: any) => ({
          type: req.type || 'other',
          description: req.description || 'General task completion',
          filePath: req.filePath || undefined,
          mustUseTools: req.mustUseTools || undefined,
        }));

        // Ensure at least one requirement
        if (requirements.length === 0) {
          requirements.push({ type: 'other', description: 'General task completion' });
        }

        logger.info(`[Client] LLM task analysis: ${level.toUpperCase()} involvement — ${analysis.involvementReasoning || 'no reasoning provided'}`);
        logger.debug(`[Client] Requirements: ${JSON.stringify(requirements.map(r => ({ type: r.type, desc: r.description })))}`);

        return { level, requirements };
      }
    } catch (error) {
      logger.warn(`[Client] LLM task analysis failed: ${error}, falling back to STANDARD`);
    }

    // Fallback: STANDARD with generic requirement
    return {
      level: this.failureCount > 0 ? InvolvementLevel.THOROUGH : InvolvementLevel.STANDARD,
      requirements: [{ type: 'other', description: 'General task completion' }],
    };
  }

  /**
   * @deprecated Use analyzeTaskRequirements() instead. Kept for reference.
   * Determine involvement level based on user request complexity
   */
  determineInvolvementLevel(userMessage: string, subtasks: string[]): InvolvementLevel {
    const messageLower = userMessage.toLowerCase();
    const subtasksLower = subtasks.join(' ').toLowerCase();

    // THOROUGH: User explicitly requests testing/verification
    const testKeywords = ['test', 'verify', 'check', 'make sure', 'ensure', 'validate'];
    if (testKeywords.some(kw => messageLower.includes(kw))) {
      logger.debug('[Client] THOROUGH mode: Testing/verification requested');
      return InvolvementLevel.THOROUGH;
    }

    // THOROUGH: After failures (user frustrated)
    if (this.failureCount > 0) {
      logger.debug(`[Client] THOROUGH mode: ${this.failureCount} previous failures detected`);
      return InvolvementLevel.THOROUGH;
    }

    // THOROUGH: Complex multi-file operations
    if (subtasks.length > 3 || (messageLower.includes('component') && messageLower.includes('index.html'))) {
      logger.debug('[Client] THOROUGH mode: Complex multi-file operation');
      return InvolvementLevel.THOROUGH;
    }

    // MINIMAL: Information-only requests
    const infoKeywords = ['what', 'list', 'show', 'explain', 'describe', 'how', 'tell me'];
    const creationKeywords = ['create', 'build', 'write', 'generate', 'make', 'add'];
    const hasInfoKeyword = infoKeywords.some(kw => messageLower.includes(kw));
    const hasCreationKeyword = creationKeywords.some(kw => messageLower.includes(kw));

    if (hasInfoKeyword && !hasCreationKeyword) {
      logger.debug('[Client] MINIMAL mode: Information request');
      return InvolvementLevel.MINIMAL;
    }

    // STANDARD: Default for creation/modification tasks
    logger.debug('[Client] STANDARD mode: Regular creation task');
    return InvolvementLevel.STANDARD;
  }

  /**
   * @deprecated Use analyzeTaskRequirements() instead. Kept for reference.
   * Parse requirements from user message
   */
  parseRequirements(userMessage: string, subtasks: string[]): Requirement[] {
    const requirements: Requirement[] = [];
    const messageLower = userMessage.toLowerCase();
    const combined = (messageLower + ' ' + subtasks.join(' ').toLowerCase());

    // Detect file creation requirements
    const fileMatches = userMessage.match(/(?:create|build|generate|write|save as)\s+([a-zA-Z0-9._/-]+\.(html|js|css|md|json|txt|py|ts|tsx|jsx))/gi);
    if (fileMatches) {
      fileMatches.forEach(match => {
        const filename = match.split(/\s+/).pop();
        if (filename) {
          requirements.push({
            type: 'file_creation',
            description: `Create file: ${filename}`,
            filePath: filename,
          });
        }
      });
    }

    // Detect testing requirements (explicit verification requests)
    const testKeywords = ['test', 'verify', 'check', 'make sure', 'ensure'];
    if (testKeywords.some(kw => combined.includes(kw))) {
      requirements.push({
        type: 'testing',
        description: 'Verify functionality through testing',
        mustUseTools: ['playwright__'],
      });
    }

    // Detect browser verification requirements - ONLY for file verification, not general browsing
    // This should trigger for "open index.html in browser" but NOT for "open linkedin.com"
    const isLocalFileOpen = (combined.includes('open') && combined.includes('.html')) ||
                            (combined.includes('browser') && combined.includes('.html'));
    const isExternalUrl = combined.match(/open\s+(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+\.[a-z]{2,}/i);
    
    if (isLocalFileOpen && !isExternalUrl) {
      requirements.push({
        type: 'verification',
        description: 'Browser testing required for local HTML file',
        mustUseTools: ['playwright__browser_navigate', 'playwright__browser_console_messages'],
      });
    }
    
    // For external URLs, don't require specific tools - just opening the page is enough
    if (isExternalUrl) {
      requirements.push({
        type: 'verification',
        description: 'Open external URL',
        // No mustUseTools - Worker just needs to navigate, Client shouldn't demand specific validation tools
      });
    }

    // Default: at least verify Worker did some work
    if (requirements.length === 0) {
      requirements.push({
        type: 'other',
        description: 'General task completion',
      });
    }

    return requirements;
  }

  /**
   * Validate Worker's work at appropriate involvement level
   */
  async validate(
    userMessage: string,
    subtasks: string[],
    workerResult: WorkerResult,
    involvementLevel?: InvolvementLevel
  ): Promise<ValidationResult> {
    // Use LLM-based analysis instead of keyword matching
    const { level: analyzedLevel, requirements } = await this.analyzeTaskRequirements(
      userMessage, subtasks, workerResult
    );
    let level = involvementLevel || analyzedLevel;

    // CRITICAL: Use LLM to check for unjustified failure claims BEFORE other validation
    // Even in MINIMAL mode, we must catch agents giving up without trying
    const failureAnalysis = await this.analyzeForUnjustifiedFailure(userMessage, workerResult);

    if (failureAnalysis.claimsFailure && !failureAnalysis.hasEvidence) {
      logger.info(`[Client] Detected unjustified failure claim - escalating from ${level} to STANDARD`);
      logger.info(`[Client] LLM reasoning: ${failureAnalysis.reasoning}`);
      logger.info(`[Client] Tools attempted: ${workerResult.toolsUsed.length}`);

      // Escalate to at least STANDARD to properly validate
      if (level === InvolvementLevel.MINIMAL) {
        level = InvolvementLevel.STANDARD;
      }
    }

    logger.info(`[Client] Validating with ${level.toUpperCase()} involvement`);

    // Log the analysis for orchestration tracing
    orchestrationLogger.logClientAnalysis(
      level, requirements.length,
      `Requirements: ${requirements.map(r => r.type).join(', ')}`
    );

    const result: ValidationResult = {
      approved: false,
      requirementsMet: false,
      issues: [],
      involvementLevel: level,
    };

    // Layer 0: Unjustified Failure Detection (always done first)
    if (failureAnalysis.claimsFailure && !failureAnalysis.hasEvidence) {
      const failureIssue = failureAnalysis.suggestedAction ||
        `REJECTED: Worker claims failure without sufficient evidence. ${failureAnalysis.reasoning}`;
      result.issues.push(failureIssue);
    }

    // Layer 0.5: Result-vs-Evidence Coherence Check (always done, catches hallucinated accomplishments)
    // This detects when the Worker claims to have done things its tool usage doesn't support
    const coherenceAnalysis = await this.analyzeResultCoherence(userMessage, workerResult);
    orchestrationLogger.logClientCoherenceCheck(
      coherenceAnalysis.isCoherent,
      coherenceAnalysis.unsupportedClaims,
      coherenceAnalysis.reasoning
    );
    if (!coherenceAnalysis.isCoherent) {
      logger.info(`[Client] Detected incoherent result — Worker claims not supported by tool usage`);
      logger.info(`[Client] Unsupported claims: ${coherenceAnalysis.unsupportedClaims.join('; ')}`);
      logger.info(`[Client] Coherence reasoning: ${coherenceAnalysis.reasoning}`);

      const coherenceIssue = coherenceAnalysis.suggestedAction ||
        `REJECTED: Worker's result contains claims not supported by its actual tool usage. ${coherenceAnalysis.reasoning}`;
      result.issues.push(coherenceIssue);

      // Escalate involvement level — the Worker is hallucinating, we need stricter validation
      if (level === InvolvementLevel.MINIMAL) {
        level = InvolvementLevel.STANDARD;
        result.involvementLevel = level;
        logger.info(`[Client] Escalating to STANDARD due to incoherent result`);
      }
    }

    // Layer 1: Process Validation (always done, no tools needed)
    const processValidation = this.validateProcess(requirements, workerResult, level);
    if (processValidation.issues.length > 0) {
      result.issues.push(...processValidation.issues);
    }

    // Layer 2: Outcome Validation (only for STANDARD and THOROUGH)
    if (level === InvolvementLevel.STANDARD || level === InvolvementLevel.THOROUGH) {
      const outcomeValidation = await this.validateOutcome(requirements, workerResult, level);
      if (outcomeValidation.issues.length > 0) {
        result.issues.push(...outcomeValidation.issues);
      }
    }

    // Determine approval
    result.requirementsMet = result.issues.length === 0;
    result.approved = result.requirementsMet;

    if (!result.approved && result.issues.length > 0) {
      // Generate an actionable correction instruction via LLM instead of echoing raw validation issues
      result.nextAction = await this.generateCorrectionInstruction(
        userMessage, subtasks.join('; '), result.issues, workerResult
      );
      this.failureCount++;
    } else {
      this.failureCount = 0; // Reset on success
    }

    // Log the validation outcome
    orchestrationLogger.logClientValidation(
      result.approved, result.issues, result.nextAction
    );

    return result;
  }

  /**
   * Use LLM to analyze worker result for unjustified failure claims
   * This is language-agnostic and captures semantic meaning
   */
  private async analyzeForUnjustifiedFailure(
    userMessage: string,
    workerResult: WorkerResult
  ): Promise<FailureAnalysis> {
    const toolCount = workerResult.toolsUsed.length;
    const toolList = workerResult.toolsUsed.join(', ') || 'none';

    const analysisPrompt = `You are a quality control agent. Analyze the following Worker response to determine if it's claiming failure and whether that failure is justified.

USER REQUEST: ${userMessage}

WORKER RESPONSE:
${workerResult.result}

WORKER REASONING: ${workerResult.reasoning}

TOOLS USED: ${toolList} (${toolCount} total)
WORKER SUCCESS FLAG: ${workerResult.success}

Analyze and respond in this EXACT JSON format:
{
  "claimsFailure": <true if the response indicates the task cannot/could not be done, or refuses to do it>,
  "hasEvidence": <true if there is concrete evidence justifying the failure (actual error messages, specific technical blockers, permission issues, etc.)>,
  "reasoning": "<brief explanation of your analysis>",
  "suggestedAction": "<if claimsFailure is true and hasEvidence is false, provide a specific instruction for the Worker to actually attempt the task>"
}

IMPORTANT CRITERIA:
- If the Worker used 0 tools and claims failure, hasEvidence should be false (they didn't even try)
- If the Worker claims something is "impossible" or "cannot be done" without showing actual error messages, hasEvidence should be false
- Legitimate evidence includes: actual error output, specific file/permission errors, concrete technical limitations
- Vague reasons like "I don't have the ability" or "this is outside my scope" are NOT evidence

Respond ONLY with the JSON, no other text.`;

    try {
      const response = await this.orchestrator.chat({
        messages: [
          { role: 'system', content: 'You are a strict quality control validator. Respond only with valid JSON.' },
          { role: 'user', content: analysisPrompt },
        ],
        temperature: 0.1, // Low temperature for consistent analysis
      });

      // Parse the JSON response
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const analysis = JSON.parse(jsonMatch[0]) as FailureAnalysis;
        return analysis;
      }
    } catch (error) {
      logger.debug(`[Client] Failed to analyze failure claim: ${error}`);
    }

    // Default: assume no failure claim if analysis fails
    return {
      claimsFailure: false,
      hasEvidence: true,
      reasoning: 'Analysis could not be performed',
    };
  }

  /**
   * Use LLM to cross-check the Worker's result claims against its actual tool usage.
   * Catches hallucinated accomplishments — e.g., Worker claims "I inspected all source files
   * and found no bugs" but only used list_directory and never read a single file.
   * This runs at ALL involvement levels including MINIMAL.
   */
  private async analyzeResultCoherence(
    userMessage: string,
    workerResult: WorkerResult
  ): Promise<CoherenceAnalysis> {
    // Skip coherence check if Worker used no tools (caught by zero-tools guard)
    // or if Worker explicitly failed (caught by failure analysis)
    if (workerResult.toolsUsed.length === 0 || !workerResult.success) {
      return { isCoherent: true, reasoning: 'Skipped — handled by other checks', unsupportedClaims: [] };
    }

    const toolList = workerResult.toolsUsed.join(', ');
    const uniqueTools = [...new Set(workerResult.toolsUsed)].join(', ');

    const coherencePrompt = `You are a strict quality auditor. Your job is to determine whether a Worker agent's result is SUPPORTED by the tools it actually used, or whether it fabricated/hallucinated claims.

USER REQUEST: ${userMessage}

WORKER RESULT:
${workerResult.result.substring(0, 1000)}

TOOLS ACTUALLY USED (in order): ${toolList}
UNIQUE TOOLS USED: ${uniqueTools}
TOTAL TOOL CALLS: ${workerResult.toolsUsed.length}

CRITICAL: Analyze whether the claims in the Worker's result are supported by the tools it used.

Key tool semantics:
- filesystem__list_directory / filesystem__directory_tree / filesystem__search_files = only shows file/folder NAMES and structure, does NOT read file contents
- filesystem__read_text_file / filesystem__read_file = actually reads file content
- mcp-shell-server__shell_exec = runs a shell command (check what command was likely run based on context)
- playwright__* = browser automation tools

Common hallucination patterns to detect:
1. Worker claims to have "inspected", "reviewed", "analyzed", or "scanned" source code but never used read_text_file — it only listed directories
2. Worker claims "no bugs found" or "code is correct" without reading any source files
3. Worker claims to have run tests or builds but no shell_exec tool was used (or the result doesn't reference actual test output)
4. Worker provides specific code details (line numbers, variable names, function logic) without having read the files containing them
5. Worker makes definitive statements about code quality, correctness, or behavior without having read the relevant code

Respond ONLY with valid JSON:
{
  "isCoherent": <true if ALL claims in the result are supported by actual tool usage, false if any claims are fabricated>,
  "reasoning": "<brief explanation of what's supported vs what's fabricated>",
  "unsupportedClaims": ["<list each specific claim that is NOT supported by tool usage>"],
  "suggestedAction": "<if not coherent, what the Worker should actually do — e.g., 'Read the source files using filesystem__read_text_file before claiming to have analyzed them'>"
}`;

    try {
      const response = await this.orchestrator.chat({
        messages: [
          { role: 'system', content: 'You are a strict quality auditor. Respond only with valid JSON.' },
          { role: 'user', content: coherencePrompt },
        ],
        temperature: 0.1,
      });

      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const analysis = JSON.parse(jsonMatch[0]) as CoherenceAnalysis;
        return analysis;
      }
    } catch (error) {
      logger.debug(`[Client] Failed to analyze result coherence: ${error}`);
    }

    // Default: assume coherent if analysis fails
    return {
      isCoherent: true,
      reasoning: 'Coherence analysis could not be performed',
      unsupportedClaims: [],
    };
  }

  /**
   * Layer 1: Process Validation (metadata only, no tools)
   */
  private validateProcess(
    requirements: Requirement[],
    workerResult: WorkerResult,
    involvementLevel: InvolvementLevel
  ): { issues: string[] } {
    const issues: string[] = [];

    // Zero-tools guard: if Worker used no tools at all and this is not a purely
    // informational/conversational task, reject immediately
    if (workerResult.toolsUsed.length === 0 && involvementLevel !== InvolvementLevel.MINIMAL) {
      const isConversational = requirements.every(r => r.type === 'information' || r.type === 'other');
      if (!isConversational) {
        issues.push(
          'Worker completed the task without using any tools. ' +
          'The task requires actual tool usage (file operations, shell commands, browser actions, etc.) — ' +
          'not just generating a text response. Use the available tools to actually perform the task.'
        );
      }
    }

    // Check if Worker used appropriate tools for requirements
    for (const req of requirements) {
      if (req.mustUseTools && req.mustUseTools.length > 0) {
        const usedRequiredTool = req.mustUseTools.some(requiredTool => {
          return workerResult.toolsUsed.some(actualTool =>
            actualTool === requiredTool || actualTool.startsWith(requiredTool) || requiredTool.startsWith(actualTool.split('__')[0] + '__')
          );
        });

        if (!usedRequiredTool) {
          issues.push(
            `${req.description} requires using ${req.mustUseTools.join(' or ')} but Worker did not use these tools.`
          );
        }
      }
    }

    // Check if Worker succeeded
    if (!workerResult.success) {
      issues.push(
        'Worker did not complete the task successfully. The task needs to be retried with appropriate tool usage.'
      );
    }

    return { issues };
  }

  /**
   * Layer 2: Outcome Validation (uses read-only tools)
   */
  private async validateOutcome(
    requirements: Requirement[],
    workerResult: WorkerResult,
    level: InvolvementLevel
  ): Promise<{ issues: string[] }> {
    const issues: string[] = [];

    // File existence validation
    for (const req of requirements) {
      if (req.type === 'file_creation' && req.filePath) {
        try {
          const exists = await this.fileExists(req.filePath);
          if (!exists) {
            issues.push(`Required file not created: ${req.filePath}`);
          } else if (level === InvolvementLevel.THOROUGH) {
            // For THOROUGH, also validate file contents
            const validation = await this.validateFileContents(req.filePath);
            if (!validation.valid) {
              issues.push(`File ${req.filePath} created but has issues: ${validation.issue}`);
            }
          }
        } catch (error) {
          logger.debug(`[Client] Error validating file ${req.filePath}: ${error}`);
        }
      }
    }

    // Browser testing validation (only for THOROUGH)
    if (level === InvolvementLevel.THOROUGH) {
      for (const req of requirements) {
        if ((req.type === 'testing' || req.type === 'verification') &&
            workerResult.result.includes('.html')) {
          // Extract HTML filename from result
          const htmlMatch = workerResult.result.match(/([a-zA-Z0-9._-]+\.html)/);
          if (htmlMatch) {
            const htmlFile = htmlMatch[1];
            const browserValidation = await this.validateInBrowser(htmlFile);
            if (!browserValidation.valid) {
              issues.push(browserValidation.issue!);
            }
          }
        }
      }
    }

    return { issues };
  }

  /**
   * Check if file exists using read tool
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await this.mcpClient.executeTool('filesystem__read_text_file', {
        path: filePath,
        head: 1,
      });
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Use LLM to generate an actionable correction instruction from raw validation issues.
   * Instead of echoing "requires using playwright__ but Worker did not use these tools",
   * produces something like "Use the filesystem tools to list ~/Library/Caches and report sizes".
   */
  private async generateCorrectionInstruction(
    userMessage: string,
    subtask: string,
    issues: string[],
    workerResult: WorkerResult
  ): Promise<string> {
    const correctionPrompt = `You are generating a correction instruction for a Worker agent that failed to complete a task properly.

ORIGINAL USER REQUEST: ${userMessage}

SUBTASK THAT WAS ATTEMPTED: ${subtask}

VALIDATION ISSUES FOUND:
${issues.map((issue, i) => `${i + 1}. ${issue}`).join('\n')}

WORKER'S RESULT (first 300 chars): ${workerResult.result.substring(0, 300)}
TOOLS WORKER USED: ${workerResult.toolsUsed.join(', ') || 'none'}

Generate a CLEAR, ACTIONABLE instruction that tells the Worker exactly what to do to fix the issues.
The instruction should:
- Be a direct command (e.g., "Use the run_process tool to execute 'du -sh ~/Library/Caches' and report the output")
- Reference specific tools or actions the Worker should take
- Be concise (1-2 sentences)
- NOT include validation jargon like "mustUseTools", "requirements", or "involvement level"
- NOT be a generic statement like "retry the task" — be specific about WHAT to do

Respond ONLY with the correction instruction text, nothing else.`;

    try {
      const response = await this.orchestrator.chat({
        messages: [
          { role: 'system', content: 'You generate concise, actionable correction instructions for a Worker agent. Respond with only the instruction text.' },
          { role: 'user', content: correctionPrompt },
        ],
        temperature: 0.1,
      });

      const instruction = response.content.trim();
      if (instruction.length > 10 && instruction.length < 500) {
        return instruction;
      }
    } catch (error) {
      logger.warn(`[Client] Failed to generate correction instruction: ${error}`);
    }

    // Fallback: use first issue with a prefix
    return `Fix the following issue and retry: ${issues[0]}`;
  }

  /**
   * Validate file contents for common issues
   */
  private async validateFileContents(filePath: string): Promise<{ valid: boolean; issue?: string }> {
    try {
      const content = await this.mcpClient.executeTool('filesystem__read_text_file', {
        path: filePath,
        head: 200,
      });

      const contentStr = typeof content === 'string' ? content : JSON.stringify(content);

      // Check for HTML path mismatches
      if (filePath.endsWith('.html')) {
        const hrefMatches = contentStr.match(/href="([^"]+)"/g) || [];
        const srcMatches = contentStr.match(/src="([^"]+)"/g) || [];

        for (const match of [...hrefMatches, ...srcMatches]) {
          const pathMatch = match.match(/(?:href|src)="([^"]+)"/);
          if (pathMatch) {
            const referencedPath = pathMatch[1];
            if (!referencedPath.startsWith('http') && !referencedPath.startsWith('data:')) {
              const exists = await this.fileExists(referencedPath);
              if (!exists) {
                return {
                  valid: false,
                  issue: `HTML references non-existent file: ${referencedPath}. Fix file paths or create missing files.`
                };
              }
            }
          }
        }
      }

      return { valid: true };
    } catch (error) {
      return { valid: false, issue: `Could not read file: ${error}` };
    }
  }

  /**
   * Validate HTML file in browser
   */
  private async validateInBrowser(htmlFile: string): Promise<{ valid: boolean; issue?: string }> {
    try {
      // Navigate to file
      const workspaceDir = process.cwd();
      const fileUrl = `file://${workspaceDir}/${htmlFile}`;

      await this.mcpClient.executeTool('playwright__browser_navigate', {
        url: fileUrl,
      });

      // Check for console errors
      const errors = await this.mcpClient.executeTool('playwright__browser_console_messages', {
        level: 'error',
      });

      const errorStr = typeof errors === 'string' ? errors : JSON.stringify(errors);
      if (errorStr && errorStr.length > 0 && !errorStr.includes('[]')) {
        return {
          valid: false,
          issue: `Browser errors detected in ${htmlFile}: ${errorStr}. Fix these errors before delivery.`
        };
      }

      return { valid: true };
    } catch (error) {
      logger.debug(`[Client] Browser validation error: ${error}`);
      // Don't fail validation if browser test fails - might not have browser available
      return { valid: true };
    }
  }

  /**
   * Reset failure tracking (for new conversation/session)
   */
  resetFailureTracking(): void {
    this.failureCount = 0;
  }
}
