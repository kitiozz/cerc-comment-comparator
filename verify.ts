import fs from 'fs';
import path from 'path';
import pdfParse from 'pdf-parse';
import { GoogleGenAI } from '@google/genai';

/**
 * CERC Regulatory Comment-to-Final Gazette Verifier (Pure CLI / Script Mode)
 * 
 * Usage:
 *   npx tsx verify.ts --comments=comments.pdf --final=final.pdf [--draft=draft.pdf] [--output=results.json]
 */

// API Key rotation support (primary + fallback keys)
function getApiKeys(): string[] {
  const keys: string[] = [];
  if (process.env.GEMINI_API_KEY) keys.push(process.env.GEMINI_API_KEY);
  if (process.env.API_KEY && !keys.includes(process.env.API_KEY)) keys.push(process.env.API_KEY);

  // Check for numbered alternate keys: GEMINI_API_KEY_2, GEMINI_API_KEY_3, etc.
  for (let i = 2; i <= 10; i++) {
    const k = process.env[`GEMINI_API_KEY_${i}`] || process.env[`API_KEY_${i}`];
    if (k && !keys.includes(k)) keys.push(k);
  }

  return keys;
}

const apiKeys = getApiKeys();
if (apiKeys.length === 0) {
  console.error('\x1b[31m[ERROR] No Gemini API key found in environment.\x1b[0m');
  console.error('Please set GEMINI_API_KEY or GEMINI_API_KEY_2 in your .env or environment.');
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
  if (ext === '.pdf') {
    const dataBuffer = fs.readFileSync(filePath);
    const parsed = await pdfParse(dataBuffer);
    return parsed.text || '';
  }
  return fs.readFileSync(filePath, 'utf-8');
}

// Split stakeholder comments into individual items
function splitComments(text: string): Array<{ number: number; text: string }> {
  const lines = text.split('\n');
  const items: Array<{ number: number; text: string }> = [];
  let current = '';
  let count = 1;

  for (const line of lines) {
    const isCommentStart =
      /^(?:comment\s*#?\s*\d+|issue\s*#?\s*\d+|\d+\.\s+|suggestion\s*#?\s*\d+|stakeholder\s*comment)/i.test(line.trim());

    if (isCommentStart && current.trim().length > 30) {
      items.push({ number: count++, text: current.trim() });
      current = line + '\n';
    } else {
      current += line + '\n';
    }
  }

  if (current.trim().length > 10) {
    items.push({ number: count++, text: current.trim() });
  }

  // If no clear boundaries found, chunk reasonably
  if (items.length <= 1 && text.length > 1000) {
    const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 30);
    return paragraphs.map((p, idx) => ({ number: idx + 1, text: p.trim() }));
  }

  return items;
}

const SYSTEM_PROMPT = `[SYSTEM MANDATE: REGULATORY COMMENT-TO-FINAL-STATEMENT SEMANTIC MATCHING ENGINE]
You are a specialized power-sector regulatory compliance analyst (e.g. CERC / State Electricity Regulatory Commissions).
Your task is to take a stakeholder comment from "comments.pdf" and search "final.pdf" (Final Gazette Regulation) to determine whether the statement/mechanism requested by the stakeholder was implemented in the final text.

[CORE RULES]
1. The decision is based strictly on matching the SEMANTIC MEANING of the comment (from comments.pdf) against the STATEMENTS in final.pdf.
2. The draft regulation (draft.pdf) serves ONLY as contextual background to clarify the baseline clause.
3. THE ONLY VALID EVIDENCE IS THE MATCHING STATEMENT FOUND IN FINAL.PDF.

[ALGORITHM FOR 3-WAY CLASSIFICATION]
- ACCEPTED: Full semantic meaning and all specific parameters (thresholds, percentages, timelines, scope) are implemented by statements in final.pdf.
- PARTIALLY ACCEPTED: Only part of the statement/request is implemented, or the mechanism was adopted with narrower parameters or lower thresholds.
- REJECTED: No statement in final.pdf adopts the suggestion, or the topic is omitted entirely.

[PROVENANCE MANDATES]
1. "exact_quote_from_final_gazette" MUST be copied verbatim as an exact substring from the final regulation text.
2. If no match exists in final text, output "No adopting provision found in final regulation".

[OUTPUT JSON FORMAT]
Output STRICTLY a valid JSON object matching this schema with no markdown surrounding it:
{
  "clause_id": "Clause/Regulation reference in final text",
  "issue_flagged": "Short summary of what the stakeholder requested",
  "exact_quote_from_comment": "Exact quotation from comments.pdf",
  "exact_quote_from_final_gazette": "Verbatim quote from final.pdf or 'No adopting provision found in final regulation'",
  "classification_status": "ACCEPTED | PARTIALLY ACCEPTED | REJECTED",
  "determinism_proof": "Comment in comments.pdf requested: '...'. Statement in final.pdf provides: '...'. Therefore, classified as ACCEPTED/PARTIALLY ACCEPTED/REJECTED."
}`;

async function verifyComment(commentText: string, commentNum: number, draftText: string, finalText: string) {
  const prompt = `
=== DRAFT REGULATION CONTEXT (Baseline reference only) ===
${draftText ? draftText.slice(0, 3000) : 'N/A'}

=== STAKEHOLDER COMMENT #${commentNum} (from comments.pdf) ===
"${commentText}"

=== STATEMENTS IN FINAL REGULATION (from final.pdf) ===
${finalText ? finalText.slice(0, 20000) : 'No final text provided'}

TASK:
Search the statements in final.pdf to evaluate if the semantic meaning of Comment #${commentNum} was implemented.
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

      const text = response.text?.trim() || '{}';
      return JSON.parse(text);
    } catch (err: any) {
      const isQuotaOrRateLimit = err.status === 429 || (err.message && /quota|rate limit|429|resource exhausted/i.test(err.message));
      if (isQuotaOrRateLimit && rotateApiKey()) {
        console.log(`[Retry] Retrying Comment #${commentNum} with rotated key...`);
        continue;
      }
      console.error(`Error processing Comment #${commentNum}:`, err.message);
      return {
        clause_id: 'Error',
        issue_flagged: 'Processing error',
        exact_quote_from_comment: commentText.slice(0, 100),
        exact_quote_from_final_gazette: 'No adopting provision found in final regulation',
        classification_status: 'REJECTED',
        determinism_proof: err.message,
      };
    }
  }
}

async function main() {
  const { comments: commentsPath, final: finalPath, draft: draftPath, output: outputPath } = parseArgs();

  console.log('\x1b[36m================================================================');
  console.log(' CERC Regulatory Comment-to-Final Statement Verifier (Pure Model)');
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

  // 2. Split comments
  const commentsList = splitComments(commentsText);
  console.log(`\x1b[32m[OK]\x1b[0m Found ${commentsList.length} stakeholder comment(s) to verify.\n`);

  const results: any[] = [];
  let acceptedCount = 0;
  let partialCount = 0;
  let rejectedCount = 0;

  // 3. Process each comment against final.pdf
  for (let i = 0; i < commentsList.length; i++) {
    const item = commentsList[i];
    process.stdout.write(`Evaluating Comment ${item.number}/${commentsList.length}... `);

    const result = await verifyComment(item.text, item.number, draftText, finalText);
    results.push({
      comment_number: item.number,
      ...result,
    });

    const status = (result.classification_status || 'REJECTED').toUpperCase();
    if (status.includes('PARTIAL')) {
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
    console.log(`   └─ Evidence from final.pdf: "${(result.exact_quote_from_final_gazette || '').slice(0, 120)}..."\n`);
  }

  // 4. Save results
  const summary = {
    total_comments: commentsList.length,
    accepted: acceptedCount,
    partially_accepted: partialCount,
    rejected: rejectedCount,
    acceptance_rate: `${Math.round(((acceptedCount + partialCount * 0.5) / commentsList.length) * 100)}%`,
    evaluations: results,
  };

  fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2), 'utf-8');

  console.log('\x1b[36m================================================================');
  console.log(' VERIFICATION COMPLETE — SUMMARY');
  console.log('================================================================\x1b[0m');
  console.log(`• Total Comments Evaluated : ${commentsList.length}`);
  console.log(`• \x1b[32mACCEPTED\x1b[0m                 : ${acceptedCount}`);
  console.log(`• \x1b[33mPARTIALLY ACCEPTED\x1b[0m       : ${partialCount}`);
  console.log(`• \x1b[31mREJECTED\x1b[0m                 : ${rejectedCount}`);
  console.log(`\x1b[32m✔ Results successfully saved to: ${outputPath}\x1b[0m\n`);
}

main().catch(err => {
  console.error('Execution failed:', err);
  process.exit(1);
});
