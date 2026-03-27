export interface ValidationResult {
  traceId: string;
  success: boolean;
  feedback?: string;
}

export interface LifecycleStats {
  captured: number;
  validated: number;
  synthesized: number;
  antiPatterns: number;
  pruned: number;
  total: number;
}

export interface SynthesizeOptions {
  minSuccessCount?: number;
}

export interface PruneOptions {
  minFailureCount?: number;
}

export const DEFAULT_MIN_SUCCESS_COUNT = 3;
export const DEFAULT_MIN_FAILURE_COUNT = 2;
