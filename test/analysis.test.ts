import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanContextForLLM,
  verifyAndLocateEvidence,
  verifyEvidenceQuotes,
  applyGroundingGuardrail,
  normalizeMappingResult,
  selectContext,
  heuristicClassify,
  toVerdict,
  NO_ADOPTING_PROVISION,
} from '../src/services/analysis';
import { searchParagraphs, splitIntoClauses, buildQueries } from '../src/services/bm25';

const FINAL = [
  '4. Amendment of Regulation 7.- The deviation charge for a general seller shall be computed on the basis of the weighted average of the contract rates of all such contracts or transactions.',
  '5. The Commission may, by order, relax any provision of these regulations for reasons to be recorded in writing.',
].join('\n\n');

// ── cleaning ────────────────────────────────────────────────
test('cleanContextForLLM preserves multilingual text and only normalizes whitespace/transport artefacts', () => {
  const raw = [
    'The rule applies to all applicants.',
    'विद्युत विनियामक आयोग अधिसूचना',
    'Regla aplicable a todos los solicitantes.',
    '  Section 5 applies.  ',
  ].join('\\n') + '\\u0000';
  const out = cleanContextForLLM(raw);
  assert.match(out, /The rule applies/);
  assert.match(out, /विद्युत/);
  assert.match(out, /Regla aplicable/);
  assert.match(out, /Section 5 applies/);
  assert.doesNotMatch(out, /\\u0000/);
});

// ── evidence verification ───────────────────────────────────
test('exact quote is verified at 100 with its paragraph index', () => {
  const v = verifyAndLocateEvidence(
    'the weighted average of the contract rates of all such contracts or transactions',
    FINAL
  );
  assert.equal(v.evidence_verified, true);
  assert.equal(v.evidence_match_confidence, 100);
  assert.equal(v.evidence_paragraph_index, 1);
  assert.equal(v.provenance?.exact_match, true);
});

test('"No adopting provision" is never verified and scores 0', () => {
  const v = verifyAndLocateEvidence(NO_ADOPTING_PROVISION, FINAL);
  assert.equal(v.evidence_verified, false);
  assert.equal(v.evidence_match_confidence, 0);
  assert.equal(v.quotes_checked, 0);
});

test('a fabricated quote is not verified', () => {
  const v = verifyAndLocateEvidence(
    'Storage operators shall maintain a reserve margin of twelve percent during peak hours',
    FINAL
  );
  assert.equal(v.evidence_verified, false);
  assert.ok(v.hallucination_warning);
});

test('a quote that starts like real text but diverges is NOT an exact match (old 50-char shortcut bug)', () => {
  const real = 'The deviation charge for a general seller shall be computed on the basis of';
  const quote = real + ' an entirely different formula involving storage reserve margins and peak windows';
  const v = verifyAndLocateEvidence(quote, FINAL);
  assert.notEqual(v.provenance?.exact_match, true);
  assert.ok(v.evidence_match_confidence < 100);
});

test('verifyEvidenceQuotes needs ALL cited quotes to be found', () => {
  const ok = 'the weighted average of the contract rates of all such contracts or transactions';
  const fake = 'Storage operators shall maintain a reserve margin of twelve percent during peak hours';
  assert.equal(verifyEvidenceQuotes([ok], FINAL).evidence_verified, true);
  const mixed = verifyEvidenceQuotes([ok, fake], FINAL);
  assert.equal(mixed.evidence_verified, false);
  assert.equal(mixed.quotes_checked, 2);
});

// ── guardrail ───────────────────────────────────────────────
test('guardrail downgrades an ungrounded ACCEPTED, keeps grounded and REJECTED verdicts', () => {
  const none = { evidence_verified: false, evidence_match_confidence: 0, quotes_checked: 1, quotes_verified: 0 };
  assert.equal(applyGroundingGuardrail('ACCEPTED', none).verdict, 'REJECTED');
  assert.equal(applyGroundingGuardrail('PARTIALLY_ACCEPTED', none).downgraded, true);
  assert.equal(applyGroundingGuardrail('REJECTED', none).downgraded, false);
  assert.equal(
    applyGroundingGuardrail('ACCEPTED', { evidence_verified: true, evidence_match_confidence: 100, quotes_checked: 1, quotes_verified: 1 }).verdict,
    'ACCEPTED'
  );
});

test('guardrail leaves a weak-but-not-absent match (30-59) flagged by the verifier, not downgraded', () => {
  const weak = { evidence_verified: false, evidence_match_confidence: 45, quotes_checked: 1, quotes_verified: 0 };
  assert.equal(applyGroundingGuardrail('ACCEPTED', weak).verdict, 'ACCEPTED');
});

test('an accepting verdict with no cited evidence at all is downgraded', () => {
  const r = applyGroundingGuardrail('ACCEPTED', { evidence_verified: false, evidence_match_confidence: 0, quotes_checked: 0, quotes_verified: 0 });
  assert.equal(r.verdict, 'REJECTED');
  assert.match(r.warning || '', /without citing any evidence/);
});

test('one real quote + one fabricated quote steps ACCEPTED down to PARTIALLY_ACCEPTED, not all the way to REJECTED', () => {
  const ok = 'the weighted average of the contract rates of all such contracts or transactions';
  const fake = 'Storage operators shall maintain a reserve margin of twelve percent during peak hours';
  const ver = verifyEvidenceQuotes([ok, fake], FINAL);
  assert.equal(ver.quotes_verified, 1);
  const g = applyGroundingGuardrail('ACCEPTED', ver);
  assert.equal(g.verdict, 'PARTIALLY_ACCEPTED');
  assert.equal(g.downgraded, true);
  assert.match(g.warning || '', /1 of 2/);
  // A verdict that is already Partial is kept, but the warning is still raised.
  const p = applyGroundingGuardrail('PARTIALLY_ACCEPTED', ver);
  assert.equal(p.verdict, 'PARTIALLY_ACCEPTED');
  assert.ok(p.warning);
});

// ── normalization ───────────────────────────────────────────
const entry = (status: string, extra: Record<string, string> = {}) => ({
  classification_status: status,
  exact_quote_from_comment: 'req ' + status,
  exact_quote_from_final_gazette: 'quote',
  justification: 'why',
  ...extra,
});

test('overall verdict is aggregated across ALL mapping entries, not just the first', () => {
  const n = (...s: string[]) => normalizeMappingResult({ mapping_analysis: s.map((x) => entry(x)) }).classification;
  assert.equal(n('ACCEPTED', 'ACCEPTED'), 'ACCEPTED');
  assert.equal(n('REJECTED', 'REJECTED'), 'REJECTED');
  assert.equal(n('REJECTED', 'ACCEPTED'), 'PARTIALLY_ACCEPTED'); // old code returned REJECTED here
  assert.equal(n('PARTIALLY ACCEPTED'), 'PARTIALLY_ACCEPTED');
});

test('normalizeMappingResult throws when the model returns no entries (caller falls back explicitly)', () => {
  assert.throws(() => normalizeMappingResult({}), /no mapping_analysis/);
  assert.throws(() => normalizeMappingResult({ mapping_analysis: [] }), /no mapping_analysis/);
});

test('reads both the new `justification` field and the legacy `determinism_proof` field', () => {
  const a = normalizeMappingResult({ mapping_analysis: [entry('ACCEPTED')] });
  assert.equal(a.reasoning, 'why');
  const legacy = normalizeMappingResult({
    mapping_analysis: [{ classification_status: 'ACCEPTED', determinism_proof: 'old field' }],
  });
  assert.equal(legacy.reasoning, 'old field');
});

test('toVerdict maps unknown values to REJECTED', () => {
  assert.equal(toVerdict('PARTIALLY ACCEPTED'), 'PARTIALLY_ACCEPTED');
  assert.equal(toVerdict('maybe'), 'REJECTED');
  assert.equal(toVerdict(undefined), 'REJECTED');
});

// ── BM25 retrieval / long documents ─────────────────────────
function longRegulation() {
  const filler = Array.from(
    { length: 200 },
    (_, i) => `${i + 1}.1. Provision ${i} concerning unrelated administrative matters alpha${i} beta${i} gamma${i} of general application.`
  );
  filler[150] = '151.1. The reserve margin for storage operators shall not exceed 12 percent of declared capacity during peak windows.';
  return filler.join('\n');
}

test('BM25 ranks the clause that shares the comment\'s rare words first', () => {
  const clauses = splitIntoClauses(longRegulation());
  const hits = searchParagraphs(['storage operators reserve margin percent'], clauses, 3);
  assert.match(hits[0].paragraph, /reserve margin for storage operators/);
});

test('selectContext sends short documents in full', () => {
  const s = selectContext(FINAL, ['deviation charge'], { maxChars: 10000 });
  assert.equal(s.mode, 'full');
  assert.equal(s.text, FINAL);
});

test('selectContext retrieves the relevant clause from a long document instead of cutting it off', () => {
  const doc = longRegulation();
  const queries = buildQueries('Storage operators reserve margin should be capped at 12 percent');
  const s = selectContext(doc, queries, { maxChars: 2000, topK: 5 });
  assert.equal(s.mode, 'retrieved');
  assert.ok(s.text.length <= 2000);
  assert.match(s.text, /reserve margin for storage operators/);
  // Plain truncation (the old CLI behaviour) would have lost it: the clause is far past the first 2000 characters.
  assert.ok(!doc.slice(0, 2000).includes('reserve margin'));
});

test('selectContext flags truncation when retrieval finds nothing', () => {
  const doc = longRegulation();
  const s = selectContext(doc, ['zzzzqqqq'], { maxChars: 500 });
  assert.equal(s.mode, 'truncated');
  assert.equal(s.text.length, 500);
});

// ── heuristic fallback ──────────────────────────────────────
test('heuristicClassify thresholds: >60% accepted, >30% partial, else rejected', () => {
  const finalText = 'weighted average contract rates transactions captive consumption';
  assert.equal(heuristicClassify('weighted average contract rates', finalText).classification, 'ACCEPTED');
  assert.equal(heuristicClassify('weighted average storage reserve margin', finalText).classification, 'PARTIALLY_ACCEPTED');
  assert.equal(heuristicClassify('storage reserve margin peak windows', finalText).classification, 'REJECTED');
});
