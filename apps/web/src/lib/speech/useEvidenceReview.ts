'use client';

import { useCallback } from 'react';

import { useAssistant } from '@/components/assistant/AssistantProvider';
import type { SpeechAdapter } from './types';
import { useSpeech } from './useSpeech';

/**
 * Hook for spoken evidence-gap review of authorisation cases.
 *
 * This integrates the `authorisation.reviewEvidence` tool with TTS
 * for the biller/authorisation specialist persona. The spoken output
 * is source-checked and follows ADR-0005 rule 8.
 */
interface EvidenceReviewCase {
  caseId: string;
  caseType: 'prior-authorisation' | 'denied-claim';
  payerProfile: { system: string; code: string; display?: string };
}

interface UseEvidenceReviewOptions {
  /** Whether the current user has the biller role */
  isBiller: boolean;
  /** Speech session ID */
  sessionId: string;
  /** Chart/patient ID */
  chartId: string;
  /** Surface */
  surface: 'staff' | 'patient';
  /**
   * Speech adapter. Omitted, `useSpeech` falls back to its no-op adapter and
   * `canReviewEvidence` is false, which is the shipped default: a clinic that
   * has configured no provider gets the typed workflow and no voice at all.
   */
  adapter?: SpeechAdapter;
}

export function useEvidenceReview(options: UseEvidenceReviewOptions) {
  const { isBiller, sessionId, chartId, surface, adapter } = options;
  const { capabilities, runTurn } = useAssistant();
  const speech = useSpeech({
    sessionId,
    chartId,
    surface,
    adapter,
  });

  // Check if the authorisation.reviewEvidence tool is available
  const hasReviewEvidenceTool =
    capabilities?.tools.some((tool) => tool.id === 'authorisation.reviewEvidence') ?? false;

  const canReviewEvidence = isBiller && hasReviewEvidenceTool && speech.available;

  /**
   * Triggers a spoken evidence review for the given cases.
   * Uses the authorisation.reviewEvidence tool and speaks the results.
   */
  const reviewEvidence = useCallback(
    async (cases: EvidenceReviewCase[]) => {
      if (!canReviewEvidence) {
        speech.speak('Evidence review is not available. Check your role and speech configuration.');
        return;
      }

      // Ask the assistant to review evidence
      // caseId is an internal identifier, not patient PHI; spoken only locally via TTS
      const caseDescriptions = cases
        .map((c) => `${c.caseType} ${c.caseId} with payer ${c.payerProfile.code}`)
        .join(', ');

      const question = `Review evidence for ${caseDescriptions}`;

      speech.speak(`Reviewing evidence for ${cases.length} case${cases.length > 1 ? 's' : ''}.`);

      // `runTurn` is an async generator: calling it starts nothing, so this
      // has to iterate. The tool output itself renders in the assistant
      // transcript, which is the source-checked surface; the only thing worth
      // speaking from here is a failure, because a spoken start followed by
      // silence is the one outcome the biller cannot see.
      for await (const event of runTurn({
        message: question,
        turnIndex: Date.now(),
        chartPatientId: chartId,
      })) {
        if (event.type === 'failed') {
          speech.speak('The evidence review could not be completed.');
          return;
        }
      }
    },
    [canReviewEvidence, runTurn, speech, chartId]
  );

  return {
    canReviewEvidence,
    reviewEvidence,
    speech,
  };
}

/**
 * Parses the assistant's tool result for authorisation.reviewEvidence
 * and formats it for speech.
 */
export function parseEvidenceReviewResult(result: unknown): {
  caseType: string;
  status: string;
  missingRequirements: Array<{ label: string; satisfied: boolean; reason?: string }>;
  evidence: Array<{ label: string; resourceType: string }>;
} | null {
  if (!result || typeof result !== 'object') return null;

  const reviews = (result as { reviews?: unknown[] }).reviews;
  if (!Array.isArray(reviews) || reviews.length === 0) return null;

  const review = reviews[0] as {
    caseType?: string;
    status?: string;
    missingRequirements?: Array<{ label: string; satisfied: boolean; reason?: string }>;
    evidence?: Array<{ label: string; resourceType: string }>;
  };

  if (!review.caseType || !review.status) return null;

  return {
    caseType: review.caseType,
    status: review.status,
    missingRequirements: review.missingRequirements ?? [],
    evidence: review.evidence ?? [],
  };
}
