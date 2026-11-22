import fs from 'fs';
import path from 'path';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { GoogleGenAI } from '@google/genai';
import { parseCommentsFromText } from './src/services/commentParser';
import { buildQueries } from './src/services/bm25';
import {
  cleanContextForLLM,
  selectContext,
  verifyEvidenceQuotes,
  applyGroundingGuardrail,
  toVerdict,
  NO_ADOPTING_PROVISION,
} from './src/services/analysis';
import type { ParsedComment } from './src/types';

/**
 * CERC Regulatory Comment-to-Final Regulation Verifier (CLI mode)
 *
 * Usage:
 *   npx tsx verify.ts --comments=comments.pdf --final=final.pdf [--draft=draft.pdf] [--output=results.json]
 *
 * Same pipeline as the web app: clean text -> (BM25 retrieval if the document is long)
 * -> Gemini classification -> check the cited quote exists in the final text -> downgrade ungrounded verdicts.
 */

// API Key rotation support (primary + fallback keys)
function getApiKeys(): string[] {
  const keys: string[] = [];
  if (process.env.GEMINI_API_KEY) keys.push(process.env.GEMINI_API_KEY);
  if (process.env.API_KEY && !keys.includes(process.env.API_KEY)) keys.push(process.env.API_KEY);

  // Numbered alternate keys: GEMINI_API_KEY_2, GEMINI_API_KEY_3, ...
  for (let i = 2; i <= 10; i++) {
    const k = process.env[`GEMINI_API_KEY_${i}`] || process.env[`API_KEY_${i}`];
    if (k && !keys.includes(k)) keys.push(k);
  }

  return keys;
}

const apiKeys = getApiKeys();
if (apiKeys.length === 0) {
  console.error('\x1b[31m[ERROR] No Gemini API key found in environment.\x1b[0m');
  console.error('Please set GEMINI_API_KEY (or GEMINI_API_KEY_2, ...) in your .env or environment.');
  process.exit(1);
}

console.log(`[API Config] Loaded ${apiKeys.length} Gemini API key(s) for automatic rotation.`);
let currentKeyIndex = 0;

function getAiClient(): GoogleGenAI {
  return new GoogleGenAI({ apiKey: apiKeys[currentKeyIndex] });
}

function rotateApiKey(): boolean {
  if (apiKeys.length <= 1) return false;
  currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;
  console.log(`\x1b[33m[Rate Limit / Quota] Rotated to fallback API key #${currentKeyIndex + 1}\x1b[0m`);
  return true;
}

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const params: Record<string, string> = {
    comments: 'comments.pdf',
    final: 'final.pdf',
    draft: 'draft.pdf',
    output: 'results.json',
  };

  for (const arg of args) {
    if (arg.startsWith('--comments=')) params.comments = arg.split('=')[1];
    else if (arg.startsWith('--final=')) params.final = arg.split('=')[1];
    else if (arg.startsWith('--draft=')) params.draft = arg.split('=')[1];
    else if (arg.startsWith('--output=')) params.output = arg.split('=')[1];
  }

  return params;
}

// Read text from PDF or fallback text file
async function extractText(filePath: string): Promise<string> {
  if (!fs.existsSync(filePath)) {
    return '';
  }
  const ext = path.extname(filePath).toLowerCase();
  const dataBuffer = fs.readFileSync(filePath);
  if (ext === '.pdf') {
    const parsed = await pdfParse(dataBuffer);
    if (!parsed.text?.trim()) throw new Error(`No selectable text in ${filePath}; scanned PDFs need OCR.`);
    return parsed.text;
  }
  if (ext === '.docx') return (await mammoth.extractRawText({ buffer: dataBuffer })).value;
  if (ext === '.xlsx' || ext === '.xls') {
    const workbook = XLSX.read(dataBuffer, { type: 'buffer' });
    return workbook.SheetNames.map((name) => 'Sheet: ' + name + '\\n' + XLSX.utils.sheet_to_csv(workbook.Sheets[name])).join('\\n\\n');
  }
  if (['.txt', '.md', '.csv', '.json', '.xml', '.html', '.htm'].includes(ext)) return dataBuffer.toString('utf-8');
  throw new Error('Unsupported file type: ' + ext);
}

const SYSTEM_PROMPT = `You are an impartial regulatory-policy and document-analysis assistant. The uploaded documents may concern any regulatory domain, industry, or jurisdiction. Do not assume electricity, energy, CERC, or any specific regulator unless the documents themselves establish it.

The DRAFT is context only. The COMMENTS contain stakeholder requests. The FINAL document is the sole evidence of implementation. Evaluate each distinct request against the final document:
- ACCEPTED: all material requested elements and conditions are implemented.
- PARTIALLY ACCEPTED: some but not all material elements are implemented, or materially different conditions/limits apply.
- REJECTED: no adopting provision is found or the final document retains an incompatible position.

Use verbatim quotes from the final document only. Never invent evidence. Explain adopted and omitted parts. If a comment contains multiple requests, assess each separately. Return valid JSON with keys clause_id, issue_flagged, exact_quote_from_comment, exact_quote_from_final_gazette, classification_status, justification. Use "${NO_ADOPTING_PROVISION}" if no adopting provision exists.`;

type Evaluation = Record<string, any>;

async function verifyComment(
  comment: ParsedComment,
  cleanedDraft: string,
  cleanedFinal: string
): Promise<Evaluation> {
  // Short documents go in full; long ones are narrowed to the most relevant clauses with BM25.
  const queries = buildQueries(comment.suggestion || comment.body, comment.draft_quote || '', comment.body);
  const finalCtx = selectContext(cleanedFinal, queries);
  const draftCtx = selectContext(cleanedDraft, queries, { maxChars: 20000 });
  if (finalCtx.mode !== 'full') {
    console.log(`   (final regulation is long: using ${finalCtx.mode} context, ${finalCtx.text.length} chars)`);
  }

  const prompt = `
=== DRAFT DOCUMENT CONTEXT (baseline reference only) ===
${draftCtx.text || 'N/A'}

=== STAKEHOLDER COMMENT #${comment.number} ===
"${comment.body}"

=== TEXT FROM FINAL DOCUMENT ===
${finalCtx.text || 'No final text provided'}

TASK:
Compare the request with the final document, using the draft only as background, and evaluate every material part of Comment #${comment.number}.
Output strictly the JSON object.`;

  let attempts = 0;
  const maxAttempts = Math.max(1, apiKeys.length * 2);

  while (attempts < maxAttempts) {
    attempts++;
    try {
      const client = getAiClient();
      const response = await client.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          temperature: 0.0,
          responseMimeType: 'application/json',
        },
      });

      const parsed = JSON.parse(response.text?.trim() || '{}');
      if (!parsed || typeof parsed !== 'object' || !parsed.classification_status) {
        throw new Error('Model response had no classification_status');
      }

      // Grounding check: the quote must exist in the full cleaned final text.
      const verification = verifyEvidenceQuotes([parsed.exact_quote_from_final_gazette || ''], cleanedFinal);
      const modelVerdict = toVerdict(parsed.classification_status);
      const guard = applyGroundingGuardrail(modelVerdict, verification);

      return {
        ...parsed,
        classification_status: guard.verdict.replace('_', ' '),
        ...(guard.downgraded ? { model_classification_status: modelVerdict.replace('_', ' '), grounding_warning: guard.warning } : {}),
        evidence_verified: verification.evidence_verified,
        evidence_match_confidence: verification.evidence_match_confidence,
        evidence_paragraph_index: verification.evidence_paragraph_index,
        context_mode: finalCtx.mode,
      };
    } catch (err: any) {
      const isQuotaOrRateLimit =
        err.status === 429 || (err.message && /quota|rate limit|429|resource exhausted/i.test(err.message));
      if (isQuotaOrRateLimit && rotateApiKey()) {
        console.log(`[Retry] Retrying Comment #${comment.number} with rotated key...`);
        continue;
      }
      console.error(`Error processing Comment #${comment.number}:`, err.message);
      // A processing error is NOT a verdict: it is reported as ERROR and kept out of the counts.
      return {
        clause_id: 'Error',
        issue_flagged: 'Processing error',
        exact_quote_from_comment: comment.body.slice(0, 100),
        exact_quote_from_final_gazette: NO_ADOPTING_PROVISION,
        classification_status: 'ERROR',
        justification: err.message,
      };
    }
  }

  return {
    clause_id: 'Error',
    issue_flagged: 'Processing error',
    exact_quote_from_comment: comment.body.slice(0, 100),
    exact_quote_from_final_gazette: NO_ADOPTING_PROVISION,
    classification_status: 'ERROR',
    justification: 'All API keys exhausted after retries.',
  };
}

async function main() {
  const { comments: commentsPath, final: finalPath, draft: draftPath, output: outputPath } = parseArgs();

  console.log('\x1b[36m================================================================');
  console.log(' Regulatory Comment-to-Final Document Verifier (CLI)');
  console.log('================================================================\x1b[0m');
  console.log(`• Comments File : ${commentsPath}`);
  console.log(`• Final File    : ${finalPath}`);
  console.log(`• Draft File    : ${draftPath || '(None)'}`);
  console.log(`• Output File   : ${outputPath}\n`);

  // 1. Read files
  console.log('Reading and parsing input documents...');
  const commentsText = await extractText(commentsPath);
  const finalText = await extractText(finalPath);
  const draftText = draftPath ? await extractText(draftPath) : '';

  if (!commentsText) {
    console.error(`\x1b[31m[ERROR] Could not read comments from: ${commentsPath}\x1b[0m`);
    console.log('Please ensure the file exists and contains stakeholder comments.');
    process.exit(1);
  }
  if (!finalText) {
    console.error(`\x1b[31m[ERROR] Could not read final regulation from: ${finalPath}\x1b[0m`);
    console.log('Please ensure the file exists.');
    process.exit(1);
  }

  // 2. Split comments (same parser as the web app) and clean the regulation text once
  const commentsList = parseCommentsFromText(commentsText);
  const cleanedFinal = cleanContextForLLM(finalText);
  const cleanedDraft = cleanContextForLLM(draftText);
  console.log(`\x1b[32m[OK]\x1b[0m Found ${commentsList.length} stakeholder comment(s) to verify.\n`);

  const results: Evaluation[] = [];
  let acceptedCount = 0;
  let partialCount = 0;
  let rejectedCount = 0;
  let errorCount = 0;

  // 3. Process each comment against the final regulation
  for (let i = 0; i < commentsList.length; i++) {
    const item = commentsList[i];
    process.stdout.write(`Evaluating Comment ${item.number}/${commentsList.length}... `);

    const result = await verifyComment(item, cleanedDraft, cleanedFinal);
    results.push({ comment_number: item.number, ...result });

    const status = String(result.classification_status || '').toUpperCase();
    if (status === 'ERROR') {
      errorCount++;
      console.log('\x1b[35m[ERROR]\x1b[0m');
    } else if (status.includes('PARTIAL')) {
      partialCount++;
      console.log('\x1b[33m[PARTIALLY ACCEPTED]\x1b[0m');
    } else if (status.includes('ACCEPT')) {
      acceptedCount++;
      console.log('\x1b[32m[ACCEPTED]\x1b[0m');
    } else {
      rejectedCount++;
      console.log('\x1b[31m[REJECTED]\x1b[0m');
    }

    console.log(`   └─ Issue: ${result.issue_flagged || 'N/A'}`);
    console.log(`   └─ Evidence from final.pdf: "${(result.exact_quote_from_final_gazette || '').slice(0, 120)}..."`);
    if (result.grounding_warning) console.log(`   └─ ${result.grounding_warning}`);
    console.log('');
  }

  // 4. Save results. Errors are excluded from the acceptance rate (partial counts as half).
  const evaluated = commentsList.length - errorCount;
  const summary = {
    total_comments: commentsList.length,
    accepted: acceptedCount,
    partially_accepted: partialCount,
    rejected: rejectedCount,
    errors: errorCount,
    acceptance_rate:
      evaluated > 0 ? `${Math.round(((acceptedCount + partialCount * 0.5) / evaluated) * 100)}%` : 'n/a',
    evaluations: results,
  };

  fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2), 'utf-8');

  console.log('\x1b[36m================================================================');
  console.log(' VERIFICATION COMPLETE — SUMMARY');
  console.log('================================================================\x1b[0m');
  console.log(`• Total Comments            : ${commentsList.length}`);
  console.log(`• \x1b[32mACCEPTED\x1b[0m                   : ${acceptedCount}`);
  console.log(`• \x1b[33mPARTIALLY ACCEPTED\x1b[0m         : ${partialCount}`);
  console.log(`• \x1b[31mREJECTED\x1b[0m                   : ${rejectedCount}`);
  console.log(`• \x1b[35mERRORS (not counted)\x1b[0m       : ${errorCount}`);
  console.log(`\x1b[32m✔ Results successfully saved to: ${outputPath}\x1b[0m\n`);
}

main().catch((err) => {
  console.error('Execution failed:', err);
  process.exit(1);
});
