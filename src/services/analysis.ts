/**
 * Shared analysis logic used by both the web server (server.ts) and the CLI (verify.ts).
 * Everything here is a pure function (no Express, no network), so it can be unit tested.
 */
import { searchParagraphs, splitIntoClauses } from './bm25';

export type Verdict = 'ACCEPTED' | 'PARTIALLY_ACCEPTED' | 'REJECTED';
export type ContextMode = 'full' | 'retrieved' | 'truncated';

export const NO_ADOPTING_PROVISION = 'No adopting provision found in final regulation';

// ─────────────────────────────────────────────
// TEXT CLEANING
// Keep document language and wording intact. Only normalize transport artefacts;
// language-specific filtering can silently remove legally material provisions.
// ─────────────────────────────────────────────

export function cleanContextForLLM(text: string): string {
  return (text || '')
    .replace(/\\u0000/g, '')
    .replace(/\\r\\n?/g, '\\n')
    .replace(/[ \\t]+\\n/g, '\\n')
    .replace(/\\n{3,}/g, '\\n\\n')
    .trim();
}

// ─────────────────────────────────────────────
// CONTEXT SELECTION (full text for short documents, BM25 retrieval for long ones)
// ─────────────────────────────────────────────

/** Documents up to this many characters are sent to the model in full. */
export function maxFullContextChars(): number {
  const n = Number(process.env.MAX_FULL_CONTEXT_CHARS);
  return Number.isFinite(n) && n > 0 ? n : 60000;
}

export interface SelectedContext {
  text: string;
  mode: ContextMode;
}

/**
 * Short document  -> returned in full.
 * Long document   -> split into clauses, ranked against the queries with BM25, top-K kept
 *                    (in original document order).
 * No BM25 hits    -> first maxChars characters, flagged as 'truncated' so callers can warn.
 */
export function selectContext(
  text: string,
  queries: string[],
  opts: { maxChars?: number; topK?: number } = {}
): SelectedContext {
  const maxChars = opts.maxChars ?? maxFullContextChars();
  if (text.length <= maxChars) return { text, mode: 'full' };

  const clauses = splitIntoClauses(text);
  const hits = searchParagraphs(queries, clauses, opts.topK ?? 8);
  if (hits.length > 0) {
    const indexes = Array.from(new Set(hits.map((h) => clauses.indexOf(h.paragraph)))).sort((a, b) => a - b);
    const joined = indexes.map((i) => clauses[i]).join('\n\n---\n\n');
    return { text: joined.slice(0, maxChars), mode: 'retrieved' };
  }
  return { text: text.slice(0, maxChars), mode: 'truncated' };
}

// ─────────────────────────────────────────────
// EVIDENCE VERIFICATION
// Checks that the quote the model cited really exists in the final regulation.
// It does NOT check that the verdict itself is correct.
// ─────────────────────────────────────────────

export interface Provenance {
  source_doc: 'final' | 'draft';
  paragraph_index: number;
  clause_heading?: string;
  exact_match: boolean;
  match_score: number;
  text_snippet: string;
}

export interface EvidenceVerification {
  evidence_verified: boolean;
  evidence_match_confidence: number;
  evidence_paragraph_index?: number;
  evidence_source_clause?: string;
  evidence_matched_excerpt: string;
  provenance?: Provenance;
  hallucination_warning?: string;
  /** How many distinct quotes were checked (0 = the model cited nothing). */
  quotes_checked: number;
  /** How many of those quotes were found in the final regulation. */
  quotes_verified: number;
}

/** Minimum word-overlap (%) for a non-exact quote to still count as verified. */
export const VERIFIED_OVERLAP_PERCENT = 60;
/** Accepted/Partial verdicts whose evidence scores below this (and is unverified) are downgraded. */
export const GROUNDING_DOWNGRADE_BELOW = 30;

function isRealQuote(quote: string): boolean {
  const q = (quote || '').replace(/^["'“”]+|["'“”]+$/g, '').trim();
  if (!q) return false;
  return !/^(no adopting provision|not found)/i.test(q);
}

const normalizeForMatch = (s: string) =>
  s.toLowerCase().replace(/[\s\r\n\t]+/g, ' ').replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();

const CLAUSE_HEADING_RE = /^(?:Regulation|Clause|Section|Annexure|Schedule|\d+\.|\(\d+\))[^:\n.]+/i;

function locate(
  para: string,
  index: number,
  exact: boolean,
  score: number
): Pick<EvidenceVerification, 'evidence_verified' | 'evidence_match_confidence' | 'evidence_paragraph_index' | 'evidence_source_clause' | 'evidence_matched_excerpt' | 'provenance'> {
  const clauseMatch = para.match(CLAUSE_HEADING_RE);
  const heading = clauseMatch ? clauseMatch[0].trim() : `Clause / Section ${index + 1}`;
  return {
    evidence_verified: true,
    evidence_match_confidence: score,
    evidence_paragraph_index: index + 1,
    evidence_source_clause: heading,
    evidence_matched_excerpt: para.slice(0, 300),
    provenance: {
      source_doc: 'final',
      paragraph_index: index + 1,
      clause_heading: heading,
      exact_match: exact,
      match_score: score,
      text_snippet: para.slice(0, 250),
    },
  };
}

/** Verifies ONE quote against the final regulation paragraphs. */
export function verifyAndLocateEvidence(
  evidenceQuote: string,
  rawFinalContext: string,
  providedParas: string[] = []
): EvidenceVerification {
  if (!isRealQuote(evidenceQuote)) {
    return {
      evidence_verified: false,
      evidence_match_confidence: 0,
      evidence_matched_excerpt: NO_ADOPTING_PROVISION,
      quotes_checked: 0,
      quotes_verified: 0,
    };
  }

  const cleanQuote = evidenceQuote.replace(/^["'“”]+|["'“”]+$/g, '').trim();
  const paras =
    providedParas && providedParas.length > 0
      ? providedParas
      : rawFinalContext.split(/\n\n+|---/).map((p) => p.trim()).filter((p) => p.length > 25);

  const normQuote = normalizeForMatch(cleanQuote);

  // 1. The whole normalized quote appears inside one paragraph -> exact match.
  for (let i = 0; i < paras.length; i++) {
    if (normalizeForMatch(paras[i]).includes(normQuote)) {
      return { ...locate(paras[i], i, true, 100), quotes_checked: 1, quotes_verified: 1 };
    }
  }

  // 2. Otherwise: best word-overlap paragraph (bag of words, order ignored).
  let bestIdx = -1;
  let bestScore = 0;
  const quoteWords = normQuote.split(' ').filter((w) => w.length > 3);
  if (quoteWords.length > 0) {
    for (let i = 0; i < paras.length; i++) {
      const words = new Set(normalizeForMatch(paras[i]).split(' '));
      let hit = 0;
      for (const w of quoteWords) if (words.has(w)) hit++;
      const score = Math.round((hit / quoteWords.length) * 100);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
  }

  if (bestScore >= VERIFIED_OVERLAP_PERCENT && bestIdx >= 0) {
    return { ...locate(paras[bestIdx], bestIdx, false, bestScore), quotes_checked: 1, quotes_verified: 1 };
  }

  return {
    evidence_verified: false,
    evidence_match_confidence: bestScore,
    evidence_matched_excerpt: cleanQuote,
    hallucination_warning:
      'Caution: The cited text was not verified as an exact or substantial match in the Final Gazette document.',
    quotes_checked: 1,
    quotes_verified: 0,
  };
}

/**
 * Verifies every quote the model cited (one per mapped request). The comment counts as
 * verified only if ALL quotes are found; confidence is the weakest quote's score.
 */
export function verifyEvidenceQuotes(
  quotes: string[],
  rawFinalContext: string,
  providedParas: string[] = []
): EvidenceVerification {
  const real = Array.from(new Set(quotes.filter(isRealQuote)));
  if (real.length === 0) {
    return {
      evidence_verified: false,
      evidence_match_confidence: 0,
      evidence_matched_excerpt: NO_ADOPTING_PROVISION,
      quotes_checked: 0,
      quotes_verified: 0,
    };
  }
  const results = real.map((q) => verifyAndLocateEvidence(q, rawFinalContext, providedParas));
  const allVerified = results.every((r) => r.evidence_verified);
  const lead = results.find((r) => r.evidence_verified) ?? results[0];
  return {
    ...lead,
    evidence_verified: allVerified,
    evidence_match_confidence: Math.min(...results.map((r) => r.evidence_match_confidence)),
    hallucination_warning: allVerified ? undefined : results.find((r) => r.hallucination_warning)?.hallucination_warning,
    quotes_checked: results.length,
    quotes_verified: results.filter((r) => r.evidence_verified).length,
  };
}

/**
 * Grounding guardrail: an accepting verdict must be backed by quotes that exist in the final regulation.
 *   - every quote found                       -> verdict unchanged
 *   - some quotes found, some not             -> ACCEPTED steps down to PARTIALLY_ACCEPTED (warning added)
 *   - no quotes found and best score < 30     -> downgraded to REJECTED
 *   - no quotes found but best score 30-59    -> unchanged, flagged by the verifier only
 * REJECTED verdicts are never changed.
 */
export function applyGroundingGuardrail(
  verdict: Verdict,
  v: Pick<EvidenceVerification, 'evidence_verified' | 'evidence_match_confidence' | 'quotes_checked' | 'quotes_verified'>
): { verdict: Verdict; downgraded: boolean; warning?: string } {
  if (verdict === 'REJECTED' || v.evidence_verified) return { verdict, downgraded: false };

  if (v.quotes_verified > 0) {
    const warning = `[GROUNDING WARNING] Only ${v.quotes_verified} of ${v.quotes_checked} cited quotes were found in the final regulation.`;
    return verdict === 'ACCEPTED'
      ? { verdict: 'PARTIALLY_ACCEPTED', downgraded: true, warning: warning + ' Status changed to Partially Accepted.' }
      : { verdict, downgraded: false, warning };
  }

  if (v.evidence_match_confidence >= GROUNDING_DOWNGRADE_BELOW) return { verdict, downgraded: false };

  const warning =
    v.quotes_checked === 0
      ? '[GROUNDING WARNING] The model gave an accepting verdict without citing any evidence. Status downgraded to Rejected.'
      : '[GROUNDING WARNING] Cited evidence was not found in the final regulation. Status downgraded to Rejected.';
  return { verdict: 'REJECTED', downgraded: true, warning };
}

// ─────────────────────────────────────────────
// MODEL OUTPUT NORMALIZATION
// ─────────────────────────────────────────────

export function toVerdict(raw: unknown): Verdict {
  const s = String(raw ?? '').toUpperCase().replace(/[\s-]+/g, '_').trim();
  if (s === 'ACCEPTED') return 'ACCEPTED';
  if (s === 'PARTIALLY_ACCEPTED' || s === 'PARTIAL' || s === 'PARTIALLY') return 'PARTIALLY_ACCEPTED';
  return 'REJECTED';
}

export interface NormalizedMapping {
  classification: Verdict;
  draft_position: string;
  requested_change: string;
  final_position: string;
  implemented_requests: string[];
  not_implemented_requests: string[];
  reasoning: string;
  evidence_in_final: string;
  evidence_quotes: string[];
  referenced_clause?: string;
}

/**
 * Turns the model's `mapping_analysis` array (one entry per distinct request in the comment)
 * into one flat result. Overall verdict:
 *   all entries ACCEPTED  -> ACCEPTED
 *   all entries REJECTED  -> REJECTED
 *   anything mixed        -> PARTIALLY_ACCEPTED
 * Throws if the model returned no usable entries, so the caller can fall back explicitly.
 */
export function normalizeMappingResult(parsed: any, defaultSuggestion = ''): NormalizedMapping {
  const mappings: any[] = Array.isArray(parsed?.mapping_analysis)
    ? parsed.mapping_analysis.filter((m: any) => m && typeof m === 'object')
    : [];
  if (mappings.length === 0) {
    throw new Error('Model response contained no mapping_analysis entries');
  }

  const verdicts = mappings.map((m) => toVerdict(m.classification_status));
  let classification: Verdict;
  if (verdicts.every((v) => v === 'ACCEPTED')) classification = 'ACCEPTED';
  else if (verdicts.every((v) => v === 'REJECTED')) classification = 'REJECTED';
  else classification = 'PARTIALLY_ACCEPTED';

  const implemented: string[] = [];
  const notImplemented: string[] = [];
  const clauses: string[] = [];
  const reasons: string[] = [];
  const quotes: string[] = [];

  mappings.forEach((item, i) => {
    const req = String(item.exact_quote_from_comment || '').trim();
    if (req) (verdicts[i] === 'ACCEPTED' ? implemented : notImplemented).push(req);
    if (item.clause_id) clauses.push(String(item.clause_id));
    // `justification` is the current field name; `determinism_proof` is kept so older saved results still load.
    const why = item.justification || item.determinism_proof;
    if (why) reasons.push(String(why));
    if (item.exact_quote_from_final_gazette) quotes.push(String(item.exact_quote_from_final_gazette));
  });

  const evidence = quotes.join(' ');
  return {
    classification,
    draft_position: clauses.join('; ') || 'Identified in baseline draft context',
    requested_change:
      mappings.map((m) => m.exact_quote_from_comment).filter(Boolean).join(' ') || defaultSuggestion,
    final_position: evidence || 'Not explicitly modified in final text',
    implemented_requests: implemented,
    not_implemented_requests: notImplemented,
    reasoning: reasons.join(' ') || 'The model returned no justification.',
    evidence_in_final: evidence || 'Not found in final regulation',
    evidence_quotes: quotes,
    referenced_clause: clauses.join(', ') || undefined,
  };
}

// ─────────────────────────────────────────────
// HEURISTIC FALLBACK (used only when no API key is set or the model call fails)
// ─────────────────────────────────────────────

export function heuristicClassify(commentText: string, finalText: string): { classification: Verdict; matchRatio: number } {
  const finalLower = (finalText || '').toLowerCase();
  const keywords = (commentText || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 4);

  let hits = 0;
  for (const kw of keywords) if (finalLower.includes(kw)) hits++;
  const matchRatio = keywords.length > 0 ? hits / keywords.length : 0;

  let classification: Verdict = 'REJECTED';
  if (matchRatio > 0.6) classification = 'ACCEPTED';
  else if (matchRatio > 0.3) classification = 'PARTIALLY_ACCEPTED';
  return { classification, matchRatio };
}
