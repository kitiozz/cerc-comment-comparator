import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyGroundingGuardrail,
  normalizeMappingResult,
  verifyAndLocateEvidence,
  verifyEvidenceQuotes,
} from '../src/services/analysis';
import { parseCommentsFromText } from '../src/services/commentParser';

/**
 * Synthetic cross-domain regression fixtures.
 * These examples validate domain-neutral text handling and evidence grounding;
 * they are not real regulations and do not measure legal/model accuracy.
 */
const CASES = [
  {
    domain: 'finance',
    heading: 'Section 3. Capital adequacy',
    final: 'Section 3. Capital adequacy. A regulated lender shall maintain a minimum capital ratio of 12 percent at the end of each reporting quarter.',
    requested: 'The minimum capital ratio should be at least 12 percent at the end of each reporting quarter.',
    quote: 'A regulated lender shall maintain a minimum capital ratio of 12 percent at the end of each reporting quarter.',
  },
  {
    domain: 'healthcare',
    heading: 'Rule 8. Cold-chain records',
    final: 'Rule 8. Cold-chain records. A licensed vaccine facility shall record storage temperature at intervals not exceeding four hours and retain the records for five years.',
    requested: 'Vaccine facilities should record storage temperature at least every four hours and retain those records for five years.',
    quote: 'A licensed vaccine facility shall record storage temperature at intervals not exceeding four hours and retain the records for five years.',
  },
  {
    domain: 'environment',
    heading: 'Article 12. Industrial discharge',
    final: 'Article 12. Industrial discharge. Every permitted facility shall submit a quarterly effluent monitoring report to the environmental authority within thirty days after the end of each quarter.',
    requested: 'Permitted facilities should submit effluent monitoring reports every quarter within thirty days.',
    quote: 'Every permitted facility shall submit a quarterly effluent monitoring report to the environmental authority within thirty days after the end of each quarter.',
  },
] as const;

for (const sample of CASES) {
  test(`${sample.domain}: final-document evidence is verified without domain-specific assumptions`, () => {
    const result = verifyAndLocateEvidence(sample.quote, sample.final, [sample.final]);
    assert.equal(result.evidence_verified, true);
    assert.equal(result.evidence_match_confidence, 100);
    assert.equal(result.provenance?.source_doc, 'final');
    assert.match(result.evidence_source_clause || '', new RegExp(sample.heading.split('.')[0]));
  });

  test(`${sample.domain}: an invented provision cannot support an accepted verdict`, () => {
    const verification = verifyEvidenceQuotes(
      ['A lunar observatory shall transmit asteroid spectra through a deep-space optical array.'],
      sample.final,
      [sample.final],
    );
    assert.equal(verification.evidence_verified, false);
    assert.equal(applyGroundingGuardrail('ACCEPTED', verification).verdict, 'REJECTED');
  });
}

test('mixed implementation outcomes aggregate to PARTIALLY_ACCEPTED across domains', () => {
  const result = normalizeMappingResult({
    mapping_analysis: [
      {
        classification_status: 'ACCEPTED',
        exact_quote_from_comment: 'Keep quarterly reporting.',
        exact_quote_from_final_gazette: CASES[2].quote,
        justification: 'The final text includes quarterly reporting.',
      },
      {
        classification_status: 'REJECTED',
        exact_quote_from_comment: 'Create a monthly public dashboard.',
        exact_quote_from_final_gazette: 'No adopting provision found in final regulation',
        justification: 'No matching provision appears in the final text.',
      },
    ],
  });
  assert.equal(result.classification, 'PARTIALLY_ACCEPTED');
  assert.equal(result.implemented_requests.length, 1);
  assert.equal(result.not_implemented_requests.length, 1);
});

test('comment parser accepts non-electricity regulatory terminology', () => {
  const comments = [
    'Comment 1: Capital adequacy',
    'The financial regulator should require lenders to maintain a higher capital ratio. We recommend quarterly disclosure.',
    'Comment 2: Vaccine storage',
    'The health authority should require temperature logs every four hours. We recommend retaining records for five years.',
    'Comment 3: Effluent monitoring',
    'The environmental authority should require quarterly discharge reports. We recommend publication within thirty days.',
  ].join('\n');

  const parsed = parseCommentsFromText(comments);
  assert.ok(parsed.length >= 3);
  assert.match(parsed.map((item) => item.body).join('\n'), /capital ratio/i);
  assert.match(parsed.map((item) => item.body).join('\n'), /temperature logs/i);
  assert.match(parsed.map((item) => item.body).join('\n'), /discharge reports/i);
});
