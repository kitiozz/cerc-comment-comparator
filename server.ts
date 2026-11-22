import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import pdfParse from 'pdf-parse';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
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
const SYSTEM_PROMPT = `[SYSTEM MANDATE: DOMAIN-GENERAL REGULATORY COMMENT IMPLEMENTATION ANALYSIS]
You are an impartial regulatory-policy and document-analysis assistant. Uploaded documents may concern ANY regulatory domain, jurisdiction, industry, or subject. Do not assume electricity, energy, CERC, a country, regulator, or legal framework unless the documents establish it.

ROLE OF INPUTS:
1. DRAFT: baseline/context only. Use it to understand the prior provision. It is not evidence of adoption.
2. COMMENTS: stakeholder requests, objections, or recommendations. Evaluate each distinct request separately.
3. FINAL: authoritative outcome. Only text actually present in this document can prove implementation.

CLASSIFICATION:
- ACCEPTED: the final document implements all material parts of the request, including conditions, limits, dates, thresholds, scope, and exceptions.
- PARTIALLY_ACCEPTED: the final document implements some, but not all, material parts, or adopts the request with materially different limits or conditions.
- REJECTED: no relevant adopting provision is found, or the final document retains an incompatible position.
Do not infer acceptance merely because the final document discusses the same topic.

EVIDENCE AND ACCURACY:
- Quote evidence verbatim from the supplied FINAL document text. Never invent, paraphrase, or complete a quotation.
- For ACCEPTED or PARTIALLY_ACCEPTED, provide the smallest sufficient exact excerpt(s) supporting the adopted part.
- For REJECTED, use exactly "No adopting provision found in final regulation" as the evidence quote.
- Explain which parts were adopted and which were not. Do not assume domain-specific terminology or expand acronyms without support.
- If a comment contains multiple independent requests, create a separate mapping entry for each and aggregate: all accepted = ACCEPTED; all rejected = REJECTED; mixed/partial = PARTIALLY_ACCEPTED.

Return one valid JSON object, without markdown:
{
  "metadata": { "jurisdiction": "Jurisdiction/regulator if stated, otherwise Not specified", "domain": "Domain inferred from the documents, otherwise Not specified" },
  "mapping_analysis": [{
    "clause_id": "Relevant section/clause in final document, or Not found",
    "issue_flagged": "Short description of the request",
    "exact_quote_from_comment": "Verbatim request from comments",
    "exact_quote_from_final_gazette": "Verbatim supporting excerpt, or No adopting provision found in final regulation",
    "classification_status": "ACCEPTED, PARTIALLY ACCEPTED, or REJECTED",
    "justification": "Explain the comparison, adopted and omitted elements, and why the classification follows."
  }]
}
`;


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

// Extract text from supported, text-bearing document formats.
// Scanned/image-only PDFs require OCR, which is not enabled in this version.
async function extractDocumentBuffer(buffer: Buffer, originalName: string) {
  const ext = path.extname(originalName).toLowerCase();
  let fullText = '';
  let pageCount = 1;
  if (ext === '.pdf' || (buffer.length >= 4 && buffer.slice(0, 4).toString() === '%PDF')) {
    const data = await pdfParse(buffer);
    fullText = data.text || '';
    pageCount = data.numpages || 1;
    if (!fullText.trim()) throw new Error('This PDF contains no selectable text. It may be scanned or image-only; OCR is not enabled yet.');
  } else if (ext === '.docx') {
    const data = await mammoth.extractRawText({ buffer });
    fullText = data.value || '';
  } else if (ext === '.xlsx' || ext === '.xls') {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    fullText = workbook.SheetNames.map((name) => 'Sheet: ' + name + '\n' + XLSX.utils.sheet_to_csv(workbook.Sheets[name], { blankrows: false })).join('\n\n');
  } else if (['.txt', '.md', '.csv', '.json', '.xml'].includes(ext)) {
    fullText = buffer.toString('utf-8');
  } else if (ext === '.html' || ext === '.htm') {
    fullText = buffer.toString('utf-8').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<\/(p|div|h[1-6]|li|tr|section|article)>/gi, '\n').replace(/<[^>]+>/g, ' ');
  } else {
    throw new Error('Unsupported file type ' + (ext || 'unknown') + '. Supported formats: PDF, DOCX, XLSX, XLS, TXT, MD, CSV, JSON, XML, and HTML.');
  }
  fullText = fullText.replace(/\u0000/g, '').replace(/\r\n/g, '\n').trim();
  if (!fullText) throw new Error('No readable text was extracted from this file.');
  const paragraphs = fullText.split(/\n\s*\n+/).map((p) => p.trim()).filter(Boolean);
  return { fileName: originalName, pageCount, textLength: fullText.length, fullText, paragraphs };
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
    res.status(422).json({ error: error.message || 'Failed to extract document.' });
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
    res.status(422).json({ error: error.message || 'Failed to extract document.' });
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
=== DRAFT DOCUMENT CONTEXT (baseline/background only) ===
${draftCtx.text || 'No draft excerpts provided.'}

=== STAKEHOLDER COMMENT (Comment #${commentNumber}) ===
Title: ${comment.title || 'Regulatory Comment'}
Draft Clause Reference: ${comment.draft_quote || 'N/A'}
Stakeholder Suggestion / Recommendation to match against final regulation:
"${activeSuggestion}"

=== TEXT FROM FINAL DOCUMENT${finalCtx.mode === 'retrieved' ? ' — most relevant clauses only' : ''} ===
${finalCtx.text || 'No final regulation text provided.'}

TASK:
Compare the stakeholder request with the final document, using the draft only as background. Evaluate meaning, scope, conditions, exceptions, dates, thresholds, and every material part of the request:
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
      ['Regulatory Comment Comparator — Analysis Report'],
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
    console.log(`Regulatory Comment Comparator server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
