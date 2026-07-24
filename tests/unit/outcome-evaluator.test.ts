import { describe, expect, it } from 'vitest';
import { createModelAssistedOutcomeEvaluator, evaluateDeterministicOutcome } from '@/core/operations/outcome-evaluator.js';

describe('outcome evaluators', () => {
  it('evaluates deterministic transcript criteria with pass thresholds', () => {
    const result = evaluateDeterministicOutcome({
      transcript: 'the session discussed tests and risks',
      criteria: ['tests', 'risks', 'deploys'],
      objective: 'release readiness',
      passThreshold: 0.7,
      evaluator: 'deterministic_transcript_matcher',
    });
    expect(result.status).toBe('inconclusive');
    expect(result.score).toBeCloseTo(2 / 3, 5);
    expect(result.details.evaluator).toBe('deterministic_transcript_matcher');
  });

  it('returns an honest unsupported result when no model provider exists', async () => {
    const evaluator = createModelAssistedOutcomeEvaluator({
      getDefaultName: () => undefined,
    } as any);

    const result = await evaluator({
      transcript: 'hello',
      criteria: ['hello'],
      objective: 'say hello',
      passThreshold: 0.5,
      evaluator: 'model_assisted',
    });

    expect(result).toMatchObject({
      status: 'inconclusive',
      score: 0,
      details: {
        evaluator: 'model_assisted',
        unsupported: true,
      },
    });
  });
});
