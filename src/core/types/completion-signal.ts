/**
 * CompletionSignal - Per-subtask assessment emitted by Client alongside ValidationResult
 *
 * Replaces the blunt failureCount escalation with a richer signal that DualAgent
 * uses to decide corrective strategy per subtask.
 */

export interface CompletionSignal {
  /** How confident the Client is that the subtask was completed correctly */
  confidence: 'high' | 'medium' | 'low' | 'none';

  /** Did Worker make any measurable forward progress? */
  progressMade: boolean;

  /** Classification of the blocker (if confidence is not 'high') */
  blockerType?: 'tool_failure'      // Worker tried but tool errored
              | 'hallucination'     // Worker claimed work it didn't do
              | 'scope_drift'       // Worker did something unrelated
              | 'partial'           // Worker made progress but didn't finish
              | 'loop'             // Worker is repeating the same action
              | 'capability_gap';  // Task requires tools/capabilities not available

  /** Suggested corrective strategy for DualAgent */
  suggestedStrategy?: 'retry'       // retry same subtask
                    | 'rephrase'    // retry with clearer instruction
                    | 'decompose'   // break subtask into smaller steps
                    | 'skip'        // skip this subtask, continue plan
                    | 'escalate';   // flag to user, cannot auto-correct
}
