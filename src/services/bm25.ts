/**
 * BM25Okapi semantic token retrieval and scoring engine.
 * Mirrors the Python rank_bm25 implementation used in CERC Comment Comparator.
 */

export class BM25Okapi {
  private k1: number;
  private b: number;
  private epsilon: number;
  private corpus: string[][];
  private docLengths: number[];
  private avgDocLength: number;
  private docFrequencies: Map<string, number>;
  private idf: Map<string, number>;
  private totalDocs: number;

  constructor(corpusTokens: string[][], k1 = 1.5, b = 0.75, epsilon = 0.25) {
    this.k1 = k1;
    this.b = b;
    this.epsilon = epsilon;
    this.corpus = corpusTokens;
    this.totalDocs = corpusTokens.length;
    this.docLengths = corpusTokens.map((doc) => doc.length);
    this.avgDocLength =
      this.docLengths.reduce((acc, len) => acc + len, 0) / (this.totalDocs || 1);

    this.docFrequencies = new Map();
    this.idf = new Map();

    this.calcDocFrequencies();
    this.calcIdf();
  }

  private calcDocFrequencies() {
    for (const doc of this.corpus) {
      const uniqueWords = new Set(doc);
      for (const word of uniqueWords) {
        this.docFrequencies.set(word, (this.docFrequencies.get(word) || 0) + 1);
      }
    }
  }

  private calcIdf() {
    let idfSum = 0;
    const negativeIdfTerms: string[] = [];

    for (const [word, freq] of this.docFrequencies.entries()) {
      const idfVal = Math.log(
        (this.totalDocs - freq + 0.5) / (freq + 0.5) + 1.0
      );
      this.idf.set(word, idfVal);
      idfSum += idfVal;
      if (idfVal < 0) {
        negativeIdfTerms.push(word);
      }
    }

    const avgIdf = idfSum / (this.docFrequencies.size || 1);
    const epsVal = this.epsilon * avgIdf;

    for (const term of negativeIdfTerms) {
      this.idf.set(term, epsVal);
    }
  }

  public getScores(queryTokens: string[]): number[] {
    const scores = new Array(this.totalDocs).fill(0);

    for (const token of queryTokens) {
      const tokenLower = token.toLowerCase();
      if (!this.idf.has(tokenLower)) continue;

      const idfScore = this.idf.get(tokenLower)!;

      for (let i = 0; i < this.totalDocs; i++) {
        const doc = this.corpus[i];
        let freq = 0;
        for (const word of doc) {
          if (word === tokenLower) freq++;
        }

        if (freq === 0) continue;

        const docLen = this.docLengths[i];
        const numerator = freq * (this.k1 + 1);
        const denominator =
          freq + this.k1 * (1 - this.b + this.b * (docLen / this.avgDocLength));

        scores[i] += idfScore * (numerator / denominator);
      }
    }

    return scores;
  }
}

/**
 * Tokenizes text into normalized words, stripping punctuation and filtering noise.
 */
export function tokenizeText(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

/**
 * Extracts referenced clause numbers (e.g., Clause 5.2, Regulation 14(a), etc.)
 */
export function extractClauseNumbers(text: string): string[] {
  const patterns = [
    /(?:Draft\s+)?[Cc]lause\s+(?:No\.?\s*)?(\d+\.\d+(?:\.\d+)?)/gi,
    /(?:Draft\s+)?[Cc]lause\s+(?:No\.?\s*)?(\d+)/gi,
    /[Ss]ection\s+(\d+(?:\.\d+)?)/gi,
    /[Rr]egulation\s+(\d+(?:\.\d+)?)/gi,
    /\bClause\s+(\d+[a-z]?)\b/gi,
  ];

  const found: string[] = [];
  for (const pattern of patterns) {
    const matches = text.matchAll(pattern);
    for (const m of matches) {
      if (m[1]) found.push(m[1]);
    }
  }

  return Array.from(new Set(found));
}

/**
 * Extracts key noun phrases and numerical parameters from comment text
 */
export function extractNounPhrases(text: string): string {
  const phrases: string[] = [];

  // Quoted phrases
  const quotes = text.match(/"([^"]{5,60})"/g) || [];
  for (const q of quotes) phrases.push(q.replace(/"/g, ''));

  // Curly quotes
  const curlyQuotes = text.match(/“([^”]{5,60})”/g) || [];
  for (const q of curlyQuotes) phrases.push(q.replace(/[“”]/g, ''));

  // Capitalized multi-word terms (e.g. "Deviation Settlement Mechanism")
  const caps = text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,4})\b/g) || [];
  phrases.push(...caps);

  // Regulatory patterns
  const regTerms =
    text.match(
      /(?:clause|regulation|section|sub-clause|article)\s+[\d.]+[a-z]?/gi
    ) || [];
  phrases.push(...regTerms);

  // Specific parameters (percentages, units, MW, days, thresholds)
  const numbers =
    text.match(/\b\d+(?:\.\d+)?\s*(?:%|percent|MW|kW|kV|units?|days?|months?|years?|Hz|INR|Rs\.?)\b/gi) || [];
  phrases.push(...numbers);

  const seen = new Set<string>();
  const unique = phrases
    .map((p) => p.trim())
    .filter((p) => p.length > 2 && !seen.has(p) && seen.add(p));

  return unique.slice(0, 12).join(' ');
}

/**
 * Builds prioritized queries for semantic BM25 retrieval
 */
export function buildQueries(suggestion: string, draftQuote = '', commentBody = ''): string[] {
  const queries: string[] = [];
  if (suggestion) queries.push(suggestion.slice(0, 400));
  if (draftQuote) queries.push(draftQuote.slice(0, 300));
  if (suggestion) {
    const firstSent = suggestion.split(/[.!?]/)[0]?.trim();
    if (firstSent && firstSent.length > 20) queries.push(firstSent);
  }
  if (commentBody) queries.push(commentBody.slice(0, 300));

  const nounQ = extractNounPhrases(`${suggestion} ${draftQuote}`);
  if (nounQ) queries.push(nounQ);

  return queries.filter((q) => q.trim().length > 0);
}

/**
 * Splits document text into distinct numbered clauses / paragraphs
 */
export function splitIntoClauses(text: string): string[] {
  // Normalize whitespace
  let cleanText = text.replace(/ {2,}/g, ' ').replace(/\n{3,}/g, '\n\n');

  // Insert double newline before clause patterns
  cleanText = cleanText.replace(/\n(\d+\.\d+\.)/g, '\n\n$1');
  cleanText = cleanText.replace(/\n(\d+\.\s+[A-Z])/g, '\n\n$1');
  cleanText = cleanText.replace(/\n([a-o]\)\s)/g, '\n\n$1');

  const raw = cleanText.split('\n\n').map((p) => p.trim());
  const merged: string[] = [];
  let buffer = '';

  for (const p of raw) {
    if (!p) continue;
    const isStub = p.length < 40 && /^[\d.]+\s*$|^[a-o]\)\s*$/.test(p);
    if (isStub) {
      buffer = buffer ? `${buffer} ${p}` : p;
    } else {
      merged.push(buffer ? `${buffer} ${p}` : p);
      buffer = '';
    }
  }
  if (buffer) merged.push(buffer);

  return merged.filter((p) => p.length > 50);
}

/**
 * Performs semantic search over paragraphs given queries
 */
export function searchParagraphs(
  queries: string[],
  paragraphs: string[],
  topK = 5
): { paragraph: string; score: number }[] {
  if (paragraphs.length === 0) return [];

  const corpusTokens = paragraphs.map((p) => tokenizeText(p));
  const bm25 = new BM25Okapi(corpusTokens);

  const combinedScores = new Array(paragraphs.length).fill(0);
  for (const query of queries) {
    const tokens = tokenizeText(query);
    if (tokens.length === 0) continue;
    const scores = bm25.getScores(tokens);
    for (let i = 0; i < scores.length; i++) {
      combinedScores[i] += scores[i];
    }
  }

  const results = paragraphs.map((p, i) => ({
    paragraph: p,
    score: combinedScores[i],
  }));

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topK).filter((r) => r.score > 0 || paragraphs.length <= 5);
}
