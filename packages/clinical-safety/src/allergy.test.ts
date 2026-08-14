import { describe, expect, it } from 'vitest';

import { screenAgainstAllergies, screenForDuplicates } from './allergy.js';
import type { RecordedAllergy } from './allergy.js';
import { createBuiltInSafetyPort, missingCapabilities } from './port.js';

/**
 * The cases here are the ones that matter clinically, not the ones that are easy
 * to write. Each is a way a prescriber gets hurt: the allergy that is recorded
 * but not coded, the drug that is the same substance under a longer name, the
 * class relationship nobody remembers at 5pm, and the prompt that appears so
 * often it stops being read.
 */

const penicillinAnaphylaxis: RecordedAllergy = {
  id: 'a-1',
  substanceCode: '7980',
  substanceDisplay: 'Penicillin',
  criticality: 'HIGH',
  reactionText: 'Anaphylaxis, 2019',
};

const sulfaRash: RecordedAllergy = {
  id: 'a-2',
  substanceDisplay: 'Sulfamethoxazole',
  criticality: 'LOW',
  reactionText: 'Rash',
};

describe('screenAgainstAllergies', () => {
  it('catches the exact substance by code', () => {
    const result = screenAgainstAllergies({ rxnormCode: '7980', display: 'Penicillin G' }, [
      penicillinAnaphylaxis,
    ]);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.kind).toBe('code');
    expect(result.requiresAcknowledgement).toBe(true);
  });

  /**
   * The chart says "Penicillin"; the order says "Penicillin V Potassium 500mg".
   * A comparison that demanded equality would find nothing, and the patient with
   * anaphylaxis would get the drug.
   */
  it('catches the same substance recorded under a shorter name', () => {
    const result = screenAgainstAllergies({ display: 'Penicillin V Potassium 500 mg' }, [
      penicillinAnaphylaxis,
    ]);

    expect(result.findings[0]?.kind).toBe('name');
    expect(result.findings[0]?.message).toContain('Anaphylaxis, 2019');
  });

  it('catches an uncoded allergy, because most charts have them', () => {
    const result = screenAgainstAllergies({ rxnormCode: '10180', display: 'Sulfamethoxazole' }, [
      sulfaRash,
    ]);

    expect(result.findings).toHaveLength(1);
    // LOW criticality informs rather than interrupts.
    expect(result.findings[0]?.action).toBe('inform');
    expect(result.requiresAcknowledgement).toBe(false);
  });

  it('raises cross-sensitivity between penicillins and cephalosporins', () => {
    const result = screenAgainstAllergies({ display: 'Cefalexin 500mg' }, [penicillinAnaphylaxis]);

    expect(result.findings[0]?.kind).toBe('cross-sensitivity');
    expect(result.findings[0]?.message).toContain('penicillins and cephalosporins');
    expect(result.requiresAcknowledgement).toBe(true);
  });

  it('says nothing about an unrelated drug', () => {
    const result = screenAgainstAllergies({ display: 'Metformin 500mg' }, [
      penicillinAnaphylaxis,
      sulfaRash,
    ]);

    expect(result.findings).toEqual([]);
    expect(result.requiresAcknowledgement).toBe(false);
  });

  /**
   * One finding per allergy, taking the strongest match. Penicillin matches this
   * order by name AND by class; listing it twice teaches the prescriber that the
   * list is padded, and a padded list is a skimmed list.
   */
  it('reports each allergy once, at its strongest match', () => {
    const result = screenAgainstAllergies({ rxnormCode: '7980', display: 'Penicillin G' }, [
      penicillinAnaphylaxis,
    ]);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.kind).toBe('code');
  });

  /**
   * Unassessed is not severe. Treating it as severe would make the
   * acknowledgement routine, and a prompt that always appears is a prompt that
   * is always dismissed.
   */
  it('does not demand an acknowledgement for an unassessed allergy', () => {
    const result = screenAgainstAllergies({ display: 'Penicillin G' }, [
      { ...penicillinAnaphylaxis, criticality: 'UNABLE_TO_ASSESS' },
    ]);

    expect(result.findings).toHaveLength(1);
    expect(result.requiresAcknowledgement).toBe(false);
  });

  it('screens against every recorded allergy, not just the first', () => {
    const result = screenAgainstAllergies({ display: 'Amoxicillin/Sulfamethoxazole' }, [
      penicillinAnaphylaxis,
      sulfaRash,
    ]);

    expect(result.findings.map((finding) => finding.allergyId).sort()).toEqual(['a-1', 'a-2']);
  });

  it('is not confused by casing or surrounding whitespace', () => {
    const result = screenAgainstAllergies({ display: '  PENICILLIN g  ' }, [penicillinAnaphylaxis]);

    expect(result.findings).toHaveLength(1);
  });
});

describe('the built-in port', () => {
  /**
   * The honesty test. This build screens allergies and nothing else, and it has
   * to say so: a prescriber who sees a safety panel assumes it covers what
   * safety panels usually cover, so an unstated gap is worse than a stated one.
   */
  it('claims only what it checks', () => {
    const port = createBuiltInSafetyPort();

    expect(port.capabilities).toEqual(['allergy', 'duplicate-therapy']);
    expect(missingCapabilities(port)).toEqual(['drug-drug', 'dose-range', 'pregnancy']);
  });

  it('finds a duplicate the patient is already taking', async () => {
    const port = createBuiltInSafetyPort();

    const result = await port.screen({
      medication: { rxnormCode: '860975', display: 'Metformin 500mg' },
      allergies: [],
      currentMedications: [{ rxnormCode: '860975', display: 'Metformin 1000mg' }],
    });

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.message).toContain('duplicates');
    expect(result.requiresAcknowledgement).toBe(true);
  });

  it('reports a shared class as information rather than an interruption', async () => {
    const port = createBuiltInSafetyPort();

    const result = await port.screen({
      medication: { display: 'Azithromycin 250mg' },
      allergies: [],
      currentMedications: [{ display: 'Erythromycin 500mg' }],
    });

    expect(result.findings[0]?.action).toBe('inform');
    expect(result.requiresAcknowledgement).toBe(false);
  });

  it('screens through the port exactly as the function does', async () => {
    const port = createBuiltInSafetyPort();

    const result = await port.screen({
      medication: { display: 'Penicillin G' },
      allergies: [penicillinAnaphylaxis],
    });

    expect(result.requiresAcknowledgement).toBe(true);
  });

  /**
   * A licensed implementation is expected to arrive later and check more. The
   * port has to accept one without this package changing, which is the whole
   * reason it exists rather than the screener being called directly.
   */
  it('accepts an implementation that checks more than this one', async () => {
    const richer = {
      capabilities: ['allergy', 'drug-drug'] as const,
      screen: () => ({ findings: [], requiresAcknowledgement: false }),
    };

    expect(missingCapabilities(richer)).toEqual(['duplicate-therapy', 'dose-range', 'pregnancy']);
    await expect(Promise.resolve(richer.screen())).resolves.toMatchObject({
      requiresAcknowledgement: false,
    });
  });
});

describe('the edges that a real chart actually contains', () => {
  it('handles an allergy recorded with no reaction text', () => {
    const result = screenAgainstAllergies({ display: 'Penicillin G' }, [
      { id: 'a-3', substanceDisplay: 'Penicillin', criticality: 'HIGH' },
    ]);

    expect(result.findings[0]?.message).toBe(
      'Penicillin G matches a recorded allergy to Penicillin.'
    );
  });

  /**
   * Two drugs in the same class where neither name contains the other, and the
   * chart records the allergy with an empty reaction. This is the path that
   * falls through to the class comparison with no group label to print.
   */
  it('names the class even when only one side is in a known group', () => {
    const result = screenAgainstAllergies({ display: 'Cefalexin' }, [
      { id: 'a-4', substanceDisplay: 'Amoxicillin', criticality: 'LOW', reactionText: '' },
    ]);

    expect(result.findings[0]?.kind).toBe('cross-sensitivity');
    expect(result.findings[0]?.message).toContain('penicillins and cephalosporins');
  });

  it('ignores a current medication with an empty display', () => {
    expect(screenForDuplicates({ display: 'Metformin' }, [{ display: '' }])).toEqual([]);
  });

  it('does not treat two blank rxnorm codes as the same drug', () => {
    const findings = screenForDuplicates({ rxnormCode: '', display: 'Metformin' }, [
      { rxnormCode: '', display: 'Lisinopril' },
    ]);

    expect(findings).toEqual([]);
  });

  it('screens against nothing when the patient has no allergies recorded', () => {
    const result = screenAgainstAllergies({ display: 'Penicillin G' }, []);

    expect(result.findings).toEqual([]);
    expect(result.requiresAcknowledgement).toBe(false);
  });
});
