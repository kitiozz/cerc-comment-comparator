# Regulatory Comment Comparator

A tool that checks whether stakeholder comments on a **draft regulation** were adopted in the **final regulation**. For each comment it returns **Accepted**, **Partially Accepted** or **Rejected**, together with the exact sentence from the final regulation that supports the verdict, so every result can be checked by a person.

The bundled electricity-sector documents are optional demonstration data only. The analysis workflow is domain-neutral: upload a Draft, stakeholder Comments, and a Final document from any regulatory subject area, industry, regulator, or jurisdiction.

## What it does

1. Lets users upload their own Draft, Comments, and Final documents for each comparison.
2. Splits the comments file into individual comments (you can review and edit them before running).
3. Extracts text from supported formats while preserving multilingual content.
4. Sends **one comment at a time** to Gemini 2.5 Flash together with the regulation text. The model must classify the comment and quote the supporting sentence from the final regulation verbatim.
5. **Checks the quote**: the server looks for the cited text in the final regulation and records which paragraph it came from.
6. **Guardrail**: if the model says Accepted but its quote cannot be found, the verdict is downgraded.
7. Shows results in a dashboard (filters, search, "locate in document") and exports them to Excel.

## Tech stack

- **Frontend:** React 18, Vite, Tailwind CSS 4
- **Backend:** Node.js, Express, TypeScript (`tsx` for development)
- **Model:** Google Gemini 2.5 Flash via `@google/genai`
- **Documents:** `pdf-parse` (PDF), `mammoth` (DOCX), `xlsx` (XLS/XLSX and export), `multer` (uploads)
- **Retrieval:** BM25 (own implementation in `src/services/bm25.ts`), used for long documents

## Project structure

```
server.ts                      Express API: extract, analyze-comment, export-excel
verify.ts                      Command-line version of the same pipeline
src/
  App.tsx, components/         Dashboard UI
  services/
    analysis.ts                Cleaning, context selection, evidence check, guardrail, result normalisation
    bm25.ts                    BM25 ranking, clause splitting, query building
    commentParser.ts           Regex-based comment splitter
  data/sampleDataset.ts        Static demo cases shown before anything is uploaded
test/analysis.test.ts          Unit tests for the logic in analysis.ts and bm25.ts
comments.pdf, draft.pdf, final.pdf   Bundled benchmark documents
results.json, results.xlsx     Example output from the CLI on the benchmark
```

## Setup

```bash
npm install
cp .env.example .env      # then put your key in GEMINI_API_KEY
npm run dev               # web app at http://localhost:3000
```

Other commands:

```bash
npm run verify -- --comments=comments.pdf --final=final.pdf --draft=draft.pdf --output=results.json
npm test                  # unit tests
npm run lint              # type check (src, server.ts, verify.ts, tests)
npm run build && npm start
```

**Environment variables**

| Variable | Purpose |
| --- | --- |
| `GEMINI_API_KEY` | Required for AI analysis. The CLI also accepts `GEMINI_API_KEY_2` ... `_10` and rotates to the next key on a rate limit. The web server uses the first key it finds. |
| `MAX_FULL_CONTEXT_CHARS` | Optional. Regulation text up to this length (default 60000 characters) is sent to the model in full. Longer text goes through BM25 retrieval. |

## Uploading your own documents

Choose **Input / Upload Files** and upload one file for each role: Draft (optional context), Comments (requests to evaluate), and Final (the authoritative outcome). Supported text-bearing formats: PDF, DOCX, XLSX, XLS, TXT, MD, CSV, JSON, XML, and HTML. The workflow is intended for different regulatory domains, industries, regulators, and jurisdictions; the bundled electricity-sector files are only sample data. Review parsed comments before running the analysis because unusual document layouts may need manual correction.

Scanned/image-only PDFs are not OCR-processed yet. Password-protected or malformed files may fail extraction.

## How long documents are handled

- **Short regulations** (the benchmark final is about 10,600 characters) are sent to the model in full, so it can see every clause.
- **Long regulations** are split into clauses, ranked against the comment with BM25 (word matching, not semantic), and only the top clauses are sent. Each result records how much text the model saw in `context_mode` (`full`, `retrieved` or `truncated`).
- The evidence check always runs against the **full** cleaned final text, not only the clauses the model was shown.
- BM25 can miss a clause that uses different wording from the comment. For very long documents, adding embeddings would help.

## Fallback behaviour

If there is no API key, or the model call fails or returns an unusable reply, the server falls back to a simple keyword-overlap check. Those results are clearly labelled **"Keyword heuristic (no AI model)"**, cite no evidence and are never marked as verified.

## Limitations

- **No accuracy measurement yet.** There is no labelled test set, so the quality of the verdicts has not been measured.
- **The evidence check proves a quote exists, not that the verdict is right.** A model can cite a real sentence and still misjudge it.
- Temperature 0 and a fixed JSON schema make output consistent, but an LLM is not strictly deterministic.
- Scanned/image-only PDFs require OCR, which is not included yet. The comment splitter is layout-sensitive, so review and edit parsed comments before analysis.
- Comment splitting is regex-based and can mis-split unusual layouts, which is why the review step exists.
- Comments are analysed one after another, and custom analyses live only in browser memory (lost on refresh).
- Prototype security: no authentication, open CORS, no rate limiting.

## Possible improvements

- A hand-labelled benchmark to measure accuracy.
- Embedding-based retrieval alongside BM25.
- Draft-versus-final comparison, so text that was already in the draft is not treated as a new adoption.
- Parallel comment analysis with rate limiting, and saved analysis history.
