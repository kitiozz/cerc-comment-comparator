import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import pdfParse from 'pdf-parse';
import * as XLSX from 'xlsx';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import {
  cleanContextForLLM,
  selectContext,
  verifyEvidenceQuotes,
  applyGroundingGuardrail,
  normalizeMappingResult,
  heuristicClassify,
  NO_ADOPTING_PROVISION,
  type Verdict,
} from './src/services/analysis';
import { buildQueries } from './src/services/bm25';

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 } // 30MB
});

function getGeminiClient(): GoogleGenAI | null {
  const key = process.env.GEMINI_API_KEY || process.env.API_KEY || process.env.GEMINI_API_KEY_2 || process.env.GEMINI_API_KEY_3;
  if (!key) return null;
  return new GoogleGenAI({ apiKey: key });
}

// ─────────────────────────────────────────────
// SYSTEM PROMPT FOR REGULATORY COMMENT -> FINAL REGULATION MATCHING
// (temperature 0 + fixed JSON schema keep output consistent; they do not make an LLM strictly deterministic)
// ─────────────────────────────────────────────
const SYSTEM_PROMPT = `[SYSTEM MANDATE: REGULATORY COMMENT-TO-FINAL-STATEMENT SEMANTIC MATCHING ENGINE]
You are a specialized power-sector regulatory compliance analyst (e.g. CERC / State Electricity Regulatory Commissions).
Your task is to take a stakeholder comment from "comments.pdf" and search the "final.pdf" (Final Gazette Regulation) to determine whether the statement/mechanism requested by the stakeholder was implemented in the final text.

[CORE ARCHITECTURAL RULE: COMMENT <-> FINAL SEMANTIC MATCHING]
1. The decision is based strictly on matching the SEMANTIC MEANING of the comment (from comments.pdf) against the STATEMENTS in the final regulation (final.pdf).
2. The draft regulation (draft.pdf) serves ONLY as contextual background to clarify what clause or baseline the stakeholder was referencing. It is NOT the evidence.
3. THE ONLY VALID EVIDENCE IS THE MATCHING STATEMENT FOUND IN FINAL.PDF.

[ALGORITHM FOR 3-WAY CLASSIFICATION]
Take the recommendation/suggestions from the stakeholder comment and search for corresponding statements in final.pdf:

A. ACCEPTED:
   - The full semantic meaning, intent, and all specific conditions/parameters (e.g., percentages, timelines, formulas, scopes, thresholds) requested in the comment are matched and implemented by statements in final.pdf.
   - Evidence: Copy the exact verbatim statement from final.pdf that implements the full request.

B. PARTIALLY ACCEPTED:
   - A statement in final.pdf adopts part of the stakeholder's suggestion (e.g. introduces the general mechanism, but with narrower parameters, lower thresholds, or excludes one of the sub-demands), OR accepts 1 out of multiple recommendations in the comment while omitting the rest.
   - Evidence: Copy the exact statement from final.pdf that implements the partial portion, and explicitly explain which part was adopted and which was omitted.

C. REJECTED:
   - No statement in final.pdf embodies the requested comment, the topic is omitted, or the final regulation retains the contrary rule.
   - Evidence: Set to "No adopting provision found in final regulation".

[SINGLE-COMMENT ISOLATION]
- Evaluate only the single comment provided in this request.
- Match its semantic meaning against all provided excerpts of final.pdf.

[ANTI-HALLUCINATION & PROVENANCE MANDATES]
1. ZERO-FABRICATION RULE: The field "exact_quote_from_final_gazette" MUST be copied verbatim as an exact substring from the FINAL REGULATION EXCERPTS provided. Never invent or synthesize text.
2. ABSENCE PROOF: If the final regulation did not adopt the stakeholder suggestion, set "exact_quote_from_final_gazette" to "No adopting provision found in final regulation" and classify as REJECTED.

[REQUIRED JSON SCHEMA]
Output strictly one minified JSON object following this exact schema:

{
    "metadata": {
        "state": "[Insert State/Central, e.g., CERC / Central / Rajasthan]",
        "domain": "[Insert Domain, e.g., Power Sector / Deviation Settlement / Grid Code / Tariff]"
    },
    "mapping_analysis": [
        {
            "clause_id": "[Specific clause or regulation heading where matching statement occurs in final.pdf, e.g., Regulation 7 / Annexure-I Clause (iii)]",
            "issue_flagged": "[Summary under 15 words of what the stakeholder requested]",
            "exact_quote_from_comment": "[Exact quote of recommendation from comments.pdf]",
            "exact_quote_from_final_gazette": "[VERBATIM matching statement from final.pdf, or 'No adopting provision found in final regulation']",
            "classification_status": "[ACCEPTED or PARTIALLY ACCEPTED or REJECTED]",
            "justification": "Comment in comments.pdf requested: '[quote]'. Statement in final.pdf provides: '[quote]'. Semantic match assessment: [Full/Partial/None]. Therefore, classified as [ACCEPTED / PARTIALLY ACCEPTED / REJECTED]."
        }
    ]
}`;


// ─────────────────────────────────────────────
// API ROUTES
// ─────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  const hasKey = !!(process.env.GEMINI_API_KEY || process.env.API_KEY || process.env.GEMINI_API_KEY_2 || process.env.GEMINI_API_KEY_3);
  res.json({
    status: 'ok',
    hasGeminiKey: hasKey,
    timestamp: new Date().toISOString()
  });
});

// Universal Document Text Extraction (supports PDF, TXT, MD, CSV, JSON)
async function extractDocumentBuffer(buffer: Buffer, originalName: string) {
  const isPdf =
    originalName.toLowerCase().endsWith('.pdf') ||
    (buffer.length >= 4 && buffer.slice(0, 4).toString() === '%PDF');

  let fullText = '';
  let pageCount = 1;

  if (isPdf) {
    const data = await pdfParse(buffer);
    fullText = data.text || '';
    pageCount = data.numpages || 1;
  } else {
    fullText = buffer.toString('utf-8');
    pageCount = 1;
  }

  const paragraphs = fullText
    .replace(/\r\n/g, '\n')
    .split(/\n\n+/)
    .map(p => p.trim())
    .filter(p => p.length > 25);

  return {
    fileName: originalName,
    pageCount,
    textLength: fullText.length,
    fullText,
    paragraphs,
  };
}

// PDF Text Extraction Route (backward-compatible)
app.post('/api/extract-pdf', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    const result = await extractDocumentBuffer(req.file.buffer, req.file.originalname);
    res.json(result);
  } catch (error: any) {
    console.error('Error parsing document:', error);
    res.status(500).json({ error: 'Failed to extract text from document: ' + error.message });
  }
});

// Universal Document Extraction Endpoint
app.post('/api/extract-document', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    const result = await extractDocumentBuffer(req.file.buffer, req.file.originalname);
    res.json(result);
  } catch (error: any) {
    console.error('Error parsing document:', error);
    res.status(500).json({ error: 'Failed to extract document: ' + error.message });
  }
});

// Load Pre-existing Benchmark Files from Repository (comments.pdf, draft.pdf, final.pdf)
app.get('/api/load-repo-files', async (req, res) => {
  try {
    const cwd = process.cwd();
    const commentsPath = path.join(cwd, 'comments.pdf');
    const draftPath = path.join(cwd, 'draft.pdf');
    const finalPath = path.join(cwd, 'final.pdf');
    const resultsJsonPath = path.join(cwd, 'results.json');

    const result: any = {
      hasCommentsPdf: fs.existsSync(commentsPath),
      hasDraftPdf: fs.existsSync(draftPath),
      hasFinalPdf: fs.existsSync(finalPath),
      hasResultsJson: fs.existsSync(resultsJsonPath),
      comments: null,
      draft: null,
      final: null,
      cachedResults: null,
    };

    if (result.hasDraftPdf) {
      const buf = fs.readFileSync(draftPath);
      result.draft = await extractDocumentBuffer(buf, 'draft.pdf');
    }

    if (result.hasFinalPdf) {
      const buf = fs.readFileSync(finalPath);
      result.final = await extractDocumentBuffer(buf, 'final.pdf');
    }

    if (result.hasCommentsPdf) {
      const buf = fs.readFileSync(commentsPath);
      result.comments = await extractDocumentBuffer(buf, 'comments.pdf');
    }

    if (result.hasResultsJson) {
      try {
        const raw = fs.readFileSync(resultsJsonPath, 'utf-8');
        result.cachedResults = JSON.parse(raw);
      } catch (e) {
        console.warn('Failed parsing results.json:', e);
      }
    }

    res.json(result);
  } catch (error: any) {
    console.error('Error loading repo files:', error);
    res.status(500).json({ error: error.message });
  }
});


// AI Analysis Route using Gemini API
app.post('/api/analyze-comment', async (req, res) => {
  try {
    const { comment, draftContext, finalContext, finalParagraphs } = req.body;

    if (!comment || (!comment.suggestion && !comment.body)) {
      return res.status(400).json({ error: 'Missing comment suggestion' });
    }

    const activeSuggestion: string = comment.suggestion || comment.body;
    const commentNumber = comment.number || 1;
    const commentTitle = comment.title || 'Comment ' + commentNumber;

    const cleanedDraft = cleanContextForLLM(draftContext || '');
    const cleanedFinal = cleanContextForLLM(finalContext || '');

    // Short documents are sent to the model in full. Long documents go through BM25 retrieval
    // so the prompt only contains the clauses most likely to matter for this comment.
    const queries = buildQueries(activeSuggestion, comment.draft_quote || '', comment.body || '');
    const finalCtx = selectContext(cleanedFinal, queries);
    const draftCtx = selectContext(cleanedDraft, queries, { maxChars: 20000 });
    const truncationWarning =
      finalCtx.mode === 'truncated'
        ? `[CONTEXT WARNING] The final regulation is long and no relevant clauses were found by retrieval, so only its first ${finalCtx.text.length} characters were analysed.`
        : undefined;

    const ai = getGeminiClient();
    let modelError: string | null = null;

    if (ai) {
      const userPrompt = `
=== DRAFT REGULATION CONTEXT (Reference only to clarify background clause) ===
${draftCtx.text || 'No draft excerpts provided.'}

=== STAKEHOLDER COMMENT FROM comments.pdf (Comment #${commentNumber}) ===
Title: ${comment.title || 'Regulatory Comment'}
Draft Clause Reference: ${comment.draft_quote || 'N/A'}
Stakeholder Suggestion / Recommendation to match against final regulation:
"${activeSuggestion}"

=== STATEMENTS IN FINAL REGULATION (final.pdf)${finalCtx.mode === 'retrieved' ? ' — most relevant clauses only' : ''} ===
${finalCtx.text || 'No final regulation text provided.'}

TASK:
Search the statements in final.pdf to evaluate if the semantic meaning of the stakeholder comment from comments.pdf was implemented:
- Full semantic match of all conditions/recommendations in final.pdf -> ACCEPTED (evidence = exact statement in final.pdf)
- Partial statement / subset of conditions implemented in final.pdf -> PARTIALLY ACCEPTED (evidence = exact statement in final.pdf)
- Not present / no matching statement in final.pdf -> REJECTED (evidence = "${NO_ADOPTING_PROVISION}")

Output strictly the minified JSON object conforming to the required schema.`;

      try {
        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [
            { role: 'user', parts: [{ text: `${SYSTEM_PROMPT}\n\n${userPrompt}` }] }
          ],
          config: {
            responseMimeType: 'application/json',
            temperature: 0.0,
          }
        });

        const rawText = response.text || '{}';
        const cleanJson = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const parsed = JSON.parse(cleanJson);
        const normalized = normalizeMappingResult(parsed, activeSuggestion);

        // Grounding check: every quote the model cited must exist in the FULL cleaned final text
        // (not only in the retrieved clauses), and an ungrounded Accepted/Partial verdict is downgraded.
        const verification = verifyEvidenceQuotes(normalized.evidence_quotes, cleanedFinal, finalParagraphs);
        const guard = applyGroundingGuardrail(normalized.classification, verification);

        let reasoning = normalized.reasoning;
        if (guard.downgraded) {
          reasoning += ' [Verification Notice: the cited evidence could not be located in the uploaded final regulation.]';
        }
        const warning =
          [guard.warning || verification.hallucination_warning, truncationWarning].filter(Boolean).join(' ') || undefined;

        return res.json({
          comment_number: commentNumber,
          comment_title: commentTitle,
          classification: guard.verdict,
          draft_position: normalized.draft_position || 'Not specified in draft',
          requested_change: normalized.requested_change || activeSuggestion,
          final_position: normalized.final_position || 'Not addressed in final',
          implemented_requests: normalized.implemented_requests,
          not_implemented_requests: normalized.not_implemented_requests,
          reasoning,
          evidence_in_final: normalized.evidence_in_final,
          referenced_clause: verification.evidence_source_clause || normalized.referenced_clause || ('Clause ' + commentNumber),
          file_set: comment.file_set || 'custom',

          // How this result was produced
          analysis_mode: 'gemini',
          context_mode: finalCtx.mode,

          // Evidence grounding & provenance
          evidence_verified: verification.evidence_verified,
          evidence_match_confidence: verification.evidence_match_confidence,
          evidence_paragraph_index: verification.evidence_paragraph_index,
          evidence_source_clause: verification.evidence_source_clause,
          evidence_matched_excerpt: verification.evidence_matched_excerpt,
          provenance: verification.provenance,
          hallucination_warning: warning,
        });
      } catch (geminiError: any) {
        modelError = geminiError?.message || String(geminiError);
        console.warn('Gemini analysis failed, using keyword heuristic fallback:', modelError);
      }
    }

    // Keyword-overlap fallback (no API key, or the model call failed). It cites no evidence,
    // so nothing is marked as verified.
    const { classification, matchRatio } = heuristicClassify(activeSuggestion, cleanedFinal);
    const pct = Math.round(matchRatio * 100);
    const why = modelError ? `model call failed: ${modelError.slice(0, 120)}` : 'no Gemini API key configured';

    return res.json({
      comment_number: commentNumber,
      comment_title: commentTitle,
      classification: classification as Verdict,
      draft_position: comment.draft_quote ? `Draft reference: ${comment.draft_quote}` : 'Baseline draft provisions apply.',
      requested_change: activeSuggestion,
      final_position:
        classification === 'REJECTED'
          ? 'Few keywords from the comment appear in the final text.'
          : 'Many keywords from the comment appear in the final text.',
      implemented_requests: classification !== 'REJECTED' ? [activeSuggestion.slice(0, 100)] : [],
      not_implemented_requests: classification === 'REJECTED' ? [activeSuggestion.slice(0, 100)] : [],
      reasoning: `[Heuristic fallback, no AI model used: ${why}] ${pct}% of the comment's keywords (words over 4 letters) appear in the final text. This is a rough keyword check, not a semantic comparison.`,
      evidence_in_final: 'Not available (heuristic fallback cites no evidence)',
      referenced_clause: 'Clause ' + commentNumber,
      file_set: comment.file_set || 'custom',

      analysis_mode: 'heuristic',
      context_mode: finalCtx.mode,

      evidence_verified: false,
      evidence_match_confidence: 0,
      evidence_matched_excerpt: '',
      hallucination_warning: ['Heuristic fallback: no model was used and no evidence was cited.', truncationWarning]
        .filter(Boolean)
        .join(' '),
    });

  } catch (error: any) {
    console.error('Error in analyze-comment:', error);
    res.status(500).json({ error: error.message });
  }
});

// Excel Export Route
app.post('/api/export-excel', (req, res) => {
  try {
    const { results, summary, datasetName } = req.body;

    const workbook = XLSX.utils.book_new();

    // 1. Summary Sheet
    const summaryData = [
      ['CERC Comment Comparator — Analysis Report'],
      ['Dataset / Case Study', datasetName || 'Regulatory Comparison'],
      ['Generated Date', new Date().toLocaleString()],
      [],
      ['Metric', 'Count', 'Percentage'],
      ['Total Comments', summary?.total || 0, '100%'],
      ['Accepted', summary?.ACCEPTED || 0, `${Math.round(((summary?.ACCEPTED || 0) / (summary?.total || 1)) * 100)}%`],
      ['Partially Accepted', summary?.PARTIALLY_ACCEPTED || 0, `${Math.round(((summary?.PARTIALLY_ACCEPTED || 0) / (summary?.total || 1)) * 100)}%`],
      ['Rejected', summary?.REJECTED || 0, `${Math.round(((summary?.REJECTED || 0) / (summary?.total || 1)) * 100)}%`],
    ];

    const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Executive Summary');

    // 2. Detailed Results Sheet
    const rows = (results || []).map((r: any) => ({
      'Comment #': r.comment_number,
      'Title': r.comment_title,
      'Classification': r.classification,
      'Referenced Clause': r.referenced_clause || 'N/A',
      'Analysis Mode': r.analysis_mode === 'heuristic' ? 'Keyword heuristic (no AI model)' : 'Gemini',
      'Evidence Verified': r.evidence_verified ? `YES (${r.evidence_match_confidence ?? 100}% match)` : 'UNVERIFIED',
      'Gazette Location': r.evidence_paragraph_index ? `Paragraph #${r.evidence_paragraph_index}` : 'N/A',
      'Draft Position': r.draft_position,
      'Requested Change': r.requested_change,
      'Final Position': r.final_position,
      'Implemented Requests': Array.isArray(r.implemented_requests) ? r.implemented_requests.join('; ') : '',
      'Not Implemented Requests': Array.isArray(r.not_implemented_requests) ? r.not_implemented_requests.join('; ') : '',
      'Reasoning': r.reasoning,
      'Evidence in Final Regulation': r.evidence_in_final,
      'Anti-Hallucination Warning': r.hallucination_warning || 'None'
    }));

    const resultsSheet = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, resultsSheet, 'Comment Details');

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=cerc_comment_analysis_${Date.now()}.xlsx`);
    res.send(buffer);
  } catch (error: any) {
    console.error('Error generating Excel:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────
// VITE MIDDLEWARE & SERVER STARTUP
// ─────────────────────────────────────────────

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`CERC Comment Comparator server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
