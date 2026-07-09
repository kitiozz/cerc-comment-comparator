"""
CERC Comment Comparator
=======================
Pipeline:
  1. Parse each comment from comments.pdf
     - italic part  = draft clause being referenced (context only)
     - non-italic   = actual CER suggestion (what we compare)
  2. Use draft.pdf to confirm which clause is being discussed
  3. Search ENTIRE final.pdf semantically for the suggestion's meaning
     - Final may have renumbered clauses, so never rely on clause numbers alone
     - Split final into paragraphs, score each against suggestion
     - Send top matching paragraphs to LLM
  4. LLM does pure semantic comparison:
     suggestion meaning vs final meaning
     → ACCEPTED / PARTIALLY_ACCEPTED / REJECTED

Usage:
  python main.py --comments comments.pdf --draft draft.pdf --final final.pdf
"""

import argparse
import json
import os
import re
import sys
import textwrap
from pathlib import Path
import time

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    sys.exit("python-dotenv not installed. Run: pip install python-dotenv")

try:
    import fitz
except ImportError:
    sys.exit("pymupdf not installed. Run: pip install pymupdf")

try:
    from groq import Groq
except ImportError:
    sys.exit("groq not installed. Run: pip install groq")

# Ollama is optional — only needed for --use-ollama flag
try:
    import requests as _requests
    OLLAMA_AVAILABLE = True
except ImportError:
    OLLAMA_AVAILABLE = False

try:
    from rank_bm25 import BM25Okapi
except ImportError:
    sys.exit("rank_bm25 not installed. Run: pip install rank_bm25")

try:
    from rapidfuzz import fuzz
except ImportError:
    sys.exit("rapidfuzz not installed. Run: pip install rapidfuzz")

try:
    import openpyxl
    from openpyxl.styles import (PatternFill, Font, Alignment,
                                  Border, Side)
    EXCEL_AVAILABLE = True
except ImportError:
    EXCEL_AVAILABLE = False


# ─────────────────────────────────────────────
# 1. PDF EXTRACTION
# ─────────────────────────────────────────────

# Optional OCR dependencies — only needed for scanned PDFs
try:
    from pdf2image import convert_from_path as _pdf2images
    import pytesseract as _pytesseract
    OCR_AVAILABLE = True
except ImportError:
    OCR_AVAILABLE = False

# Minimum avg characters per page to treat a PDF as digital (not scanned)
_OCR_MIN_CHARS_PER_PAGE = 80


def _ocr_pdf(pdf_path: str) -> str:
    """
    Full OCR fallback using pdf2image + pytesseract.
    Auto-called when digital text extraction yields too little text.

    Install requirements:
        pip install pdf2image pytesseract
        apt install tesseract-ocr          # Linux
        brew install tesseract             # macOS
        # Windows: https://github.com/UB-Mannheim/tesseract/wiki
    """
    if not OCR_AVAILABLE:
        print(
            "[OCR] WARNING: Scanned PDF detected but OCR libs not installed.\n"
            "      Run:  pip install pdf2image pytesseract\n"
            "      Also install Tesseract binary on your system.\n"
            "      Falling back to empty text — results will be incomplete."
        )
        return ""

    print(f"[OCR] Scanned PDF detected — running OCR on '{Path(pdf_path).name}' ...")
    try:
        images = _pdf2images(pdf_path, dpi=300)
        pages_text = []
        for i, img in enumerate(images, 1):
            print(f"[OCR]   page {i}/{len(images)} ...", end="\r")
            # lang="eng" keeps it English-only; add "+hin" later if Hindi OCR needed
            page_text = _pytesseract.image_to_string(img, lang="eng")
            pages_text.append(page_text)
        print(f"[OCR] Done — {len(images)} pages processed.              ")
        return "\n\n".join(pages_text)
    except Exception as exc:
        print(f"[OCR] OCR failed: {exc}")
        return ""


def _is_scanned(doc) -> bool:
    """
    Heuristic: if the first 4 pages average fewer than _OCR_MIN_CHARS_PER_PAGE
    characters of extracted text, treat the PDF as scanned.
    """
    pages_to_check = min(4, len(doc))
    total = sum(
        len(doc[i].get_text("text").strip())
        for i in range(pages_to_check)
    )
    return (total / max(pages_to_check, 1)) < _OCR_MIN_CHARS_PER_PAGE


def extract_text(pdf_path: str) -> str:
    """
    Plain text extraction for draft and final PDFs.
    Auto-detects scanned PDFs and falls back to OCR when digital
    text layer is absent or yields too little content.
    """
    doc = fitz.open(pdf_path)

    if _is_scanned(doc):
        doc.close()
        ocr_text = _ocr_pdf(pdf_path)
        return ocr_text if ocr_text else ""

    pages = []
    for page in doc:
        pages.append(page.get_text("text"))
    doc.close()
    return "\n\n".join(pages)


def extract_english_section(text: str) -> str:
    """
    Slice out only the English portion of a mixed Hindi+English PDF.
    RERC/CERC gazettes have Hindi first, English translation after.
    Falls back to full text if no English marker found.
    """
    markers = [
        "Rajasthan Electricity Regulatory Commission",
        "Central Electricity Regulatory Commission",
        "NOTIFICATION",
        "In exercise of the powers",
    ]
    for marker in markers:
        idx = text.find(marker)
        if idx >= 0:
            return text[idx:]
    return text


def extract_comments_spans(pdf_path: str) -> str:
    """
    Font-aware extraction for the comments PDF.
    - Drops non-English (Hindi/Devanagari) spans
    - Tags italic spans as <<ITALIC>>...<<END_ITALIC>>
    - Tags quoted spans as <<QUOTED>>...<<END_QUOTED>>
    Plain text = actual CER suggestion text for comparison.

    If the PDF is scanned (no digital text layer), falls back to OCR.
    OCR output has no font information so italic tagging is skipped —
    the full OCR text is returned as plain suggestion text.
    """
    doc = fitz.open(pdf_path)

    if _is_scanned(doc):
        doc.close()
        print("[OCR] comments.pdf is scanned — italic detection unavailable; "
              "entire OCR text used as suggestion.")
        return _ocr_pdf(pdf_path)

    out = []

    for page in doc:
        blocks = page.get_text("dict")["blocks"]
        for block in blocks:
            if block["type"] != 0:
                continue
            for line in block["lines"]:
                line_parts = []
                for span in line["spans"]:
                    raw = span["text"]
                    if _has_non_english_script(raw):
                        continue                      # drop any non-English script
                    is_italic = bool(span["flags"] & 2)
                    if is_italic:
                        line_parts.append(f"<<ITALIC>>{raw}<<END_ITALIC>>")
                    else:
                        line_parts.append(raw)
                if line_parts:
                    out.append("".join(line_parts))
        out.append("")   # blank line between pages

    doc.close()
    full = "\n".join(out)

    # Tag quoted text ("..." and curly quotes) not already inside ITALIC tags
    def tag_quotes(text: str) -> str:
        result = []
        i = 0
        inside_italic = False
        while i < len(text):
            chunk = text[i:]
            if chunk.startswith("<<ITALIC>>"):
                inside_italic = True
                result.append(text[i])
            elif chunk.startswith("<<END_ITALIC>>"):
                inside_italic = False
                result.append(text[i])
            elif not inside_italic and text[i] in ('"', '\u201c', '\u201d'):
                close_map = {'"': '"', '\u201c': '\u201d', '\u201d': '"'}
                close = close_map.get(text[i], '"')
                end   = text.find(close, i + 1)
                if end > i:
                    span = text[i:end + 1]
                    # Guard: if this span's closing quote character sits
                    # INSIDE an italic run (i.e. an <<ITALIC>> tag opens
                    # somewhere in the span but its matching <<END_ITALIC>>
                    # falls just after `end`), wrapping it in <<QUOTED>>
                    # here would split an italic pair across the QUOTED
                    # boundary. That corrupts the nesting and causes the
                    # later regex-based stripper to over-match all the way
                    # to the NEXT unrelated <<END_QUOTED>> in the document,
                    # silently deleting real suggestion text in between.
                    # Detect this by checking for balanced ITALIC tags
                    # strictly within the span; if unbalanced, don't wrap —
                    # the italic-stripping pass already handles this text.
                    opens  = span.count("<<ITALIC>>")
                    closes = span.count("<<END_ITALIC>>")
                    if opens == closes:
                        result.append(f"<<QUOTED>>{span}<<END_QUOTED>>")
                        i = end + 1
                        continue
                    # Unbalanced — fall through and emit the quote char
                    # plain; the italic tags around it will still be
                    # stripped correctly by strip_excluded_spans.
            result.append(text[i])
            i += 1
        return "".join(result)

    return tag_quotes(full)


def strip_excluded_spans(tagged_text: str) -> str:
    """Remove italic and quoted tags — leaves only plain CER suggestion text."""
    text = re.sub(r'<<ITALIC>>.*?<<END_ITALIC>>', '', tagged_text, flags=re.DOTALL)
    text = re.sub(r'<<QUOTED>>.*?<<END_QUOTED>>', '', text,        flags=re.DOTALL)
    # Clean up any partial/broken tags and lone angle brackets
    text = re.sub(r'<<\w+>>', '', text)
    text = re.sub(r'<{1,3}\n', '\n', text)
    text = re.sub(r'\s*<+\s*', ' ', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    text = re.sub(r'[ \t]{2,}', ' ', text)
    return text.strip()


def get_draft_quote_from_tags(tagged_body: str) -> str:
    """Extract italic + quoted portions — these are the referenced draft clauses."""
    italic = re.findall(r'<<ITALIC>>(.*?)<<END_ITALIC>>', tagged_body, re.DOTALL)
    quoted = re.findall(r'<<QUOTED>>(.*?)<<END_QUOTED>>', tagged_body, re.DOTALL)
    return " ".join(italic + quoted).strip()


# ─────────────────────────────────────────────
# 2. SPLIT COMMENT: italic/quoted (draft ref) vs plain (suggestion)
#    Now driven by font tags, not fragile trigger phrases.
# ─────────────────────────────────────────────

def split_comment_body(tagged_body: str) -> tuple[str, str]:
    """
    Split a tagged comment into:
      draft_quote = italic + quoted text (referenced draft clause)
      suggestion  = plain text only (actual CER recommendation)
    """
    draft_quote = get_draft_quote_from_tags(tagged_body)
    suggestion  = strip_excluded_spans(tagged_body)
    return draft_quote, suggestion


# ─────────────────────────────────────────────
# 3. PARAGRAPH SPLITTER FOR FINAL DOC
#    Split final.pdf into meaningful paragraphs
#    each paragraph = one searchable unit
# ─────────────────────────────────────────────

# ── Language detection ──────────────────────────────────────────
# Unicode ranges for non-English scripts to ignore entirely.
# Every file has an English translation — we only ever need English.
_NON_ENGLISH_RANGES = [
    (0x0600, 0x06FF),   # Arabic / Urdu
    (0x0900, 0x097F),   # Devanagari (Hindi)
    (0x0980, 0x09FF),   # Bengali
    (0x0A00, 0x0A7F),   # Gurmukhi
    (0x0A80, 0x0AFF),   # Gujarati
    (0x0B00, 0x0B7F),   # Oriya
    (0x0B80, 0x0BFF),   # Tamil
    (0x0C00, 0x0C7F),   # Telugu
    (0x0C80, 0x0CFF),   # Kannada
    (0x0D00, 0x0D7F),   # Malayalam
    (0x4E00, 0x9FFF),   # CJK Unified Ideographs
    (0x3040, 0x30FF),   # Hiragana / Katakana
]

def _has_non_english_script(text: str) -> bool:
    """Returns True if text contains ANY character from a non-English script."""
    for ch in text:
        cp = ord(ch)
        for start, end in _NON_ENGLISH_RANGES:
            if start <= cp <= end:
                return True
    return False


def _is_real_english(text: str) -> bool:
    """
    Returns True only if:
    1. No non-English script characters present, AND
    2. Contains at least one common English word
       (rejects romanised/transliterated Indian language text).
    """
    if not text.strip():
        return False
    if _has_non_english_script(text):
        return False
    return bool(re.search(
        r'\b(the|of|and|to|in|for|shall|may|under|any|such|or|with|'
        r'as|by|are|be|is|that|this|these|from|which|were|been|has|'
        r'have|their|its|not|on|at|if|a|an)\b',
        text, re.IGNORECASE))




def split_into_paragraphs(text: str) -> list[str]:
    """
    Split document text into clause-level chunks for BM25 indexing.
    Gazette PDFs often use single newlines between clauses and sub-clauses.
    We split on clause number patterns AND double newlines.
    """
    # Normalize whitespace
    text = re.sub(r' {2,}', ' ', text)
    text = re.sub(r'\n{3,}', '\n\n', text)

    # Insert double newline before clause patterns so we split on them
    # Patterns: "5.1." "6.1." "a)" "b)" "9." at start of line
    text = re.sub(r'\n(\d+\.\d+\.)', r'\n\n\1', text)   # 5.1.  6.2. etc
    text = re.sub(r'\n(\d+\.\s+[A-Z])', r'\n\n\1', text)  # 5. OVERVIEW ...
    text = re.sub(r'\n([a-o]\)\s)', r'\n\n\1', text)        # a) b) c) ...

    # Split on double newlines
    raw = [p.strip() for p in text.split('\n\n')]

    # Merge very short clause-number-only lines with next chunk
    merged = []
    buffer = ""
    for p in raw:
        if not p: continue
        is_stub = len(p) < 40 and re.match(r'^[\d.]+\s*$|^[a-o]\)\s*$', p)
        if is_stub:
            buffer = (buffer + " " + p).strip() if buffer else p
        else:
            merged.append(((buffer + " " + p).strip()) if buffer else p)
            buffer = ""
    if buffer: merged.append(buffer)

    # Filter: meaningful length + real English only
    return [p for p in merged if len(p) > 80 and _is_real_english(p)]


def _clean_gazette_page(page_text: str) -> str:
    """
    Strip non-English lines and gazette boilerplate from a page.
    Uses Unicode script detection — if a line contains ANY character
    from a non-English script (Devanagari, Arabic, CJK etc.), drop it.
    """
    lines = page_text.splitlines()
    english_lines = []
    for line in lines:
        line = line.strip()
        if not line:
            english_lines.append("")
            continue
        # Drop lines containing any non-English script character
        if _has_non_english_script(line):
            continue
        # Drop common gazette boilerplate
        if re.match(r'^\d+ (GI|THE GAZETTE)$', line): continue
        if "GAZETTE OF INDIA" in line and "EXTRAORDINARY" in line: continue
        if "PART III" in line and "SEC" in line: continue
        if re.match(r'^\(\d+\)$', line): continue
        if re.match(r'^xxxGID[HE]xxx$', line): continue
        if re.match(r'^(REGD\.|rjist|CG-DL)', line): continue
        english_lines.append(line)
    return "\n".join(english_lines)


def split_final_by_page(pdf_path: str) -> list[str]:
    """
    Page-aware extraction for gazette PDFs.
    - Skips pages that are predominantly transliterated Hindi
    - Strips remaining Hindi lines and boilerplate within each page
    - Splits English text into clause-level chunks for BM25 indexing

    Auto-detects scanned PDFs (no digital text layer) and falls back
    to OCR before paragraph-splitting, same as extract_text(). Without
    this, a scanned draft/final PDF silently produces zero paragraphs,
    which later crashes BM25Okapi with a ZeroDivisionError.
    """
    doc = fitz.open(pdf_path)

    if _is_scanned(doc):
        doc.close()
        ocr_text = _ocr_pdf(pdf_path)
        if not ocr_text.strip():
            return []
        # OCR text has no page boundaries to iterate, so clean +
        # split it as a single block instead of per-page.
        cleaned = _clean_gazette_page(ocr_text)
        return split_into_paragraphs(cleaned) if cleaned.strip() else []

    all_paragraphs = []

    for page in doc:
        raw = page.get_text("text")

        # Count real English vs transliterated Hindi lines on this page
        page_lines = raw.splitlines()
        english_count = 0
        hindi_roman_count = 0
        for line in page_lines:
            s = line.strip()
            if not s: continue
            if _has_non_english_script(s): continue
            if _is_transliterated_hindi(s):
                hindi_roman_count += 1
            elif _is_real_english(s):
                english_count += 1

        total = english_count + hindi_roman_count
        # Skip page if more than 60% is transliterated Hindi
        if total > 0 and hindi_roman_count / total > 0.60:
            continue

        cleaned = _clean_gazette_page(raw)
        if not cleaned.strip():
            continue
        page_paras = split_into_paragraphs(cleaned)
        all_paragraphs.extend(page_paras)

    doc.close()

    # Deduplicate while preserving order
    seen = set()
    unique = []
    for p in all_paragraphs:
        key = p[:100]
        if key not in seen:
            seen.add(key)
            unique.append(p)
    return unique



# ─────────────────────────────────────────────
# 4. SEMANTIC SEARCH OVER FINAL
#    BM25 to find top paragraphs in final
#    that are most relevant to the suggestion
# ─────────────────────────────────────────────

def extract_clause_numbers(text: str) -> list[str]:
    """
    Extract clause numbers referenced in CER comment text.
    e.g. "Clause 5.2", "Draft Clause 6.1", "clause 9.1" -> ["5.2", "6.1", "9.1"]
    """
    patterns = [
        r'(?:Draft\s+)?[Cc]lause\s+(?:No\.?\s*)?(\d+\.\d+(?:\.\d+)?)',
        r'(?:Draft\s+)?[Cc]lause\s+(?:No\.?\s*)?(\d+)',
        r'[Ss]ection\s+(\d+(?:\.\d+)?)',
        r'[Rr]egulation\s+(\d+(?:\.\d+)?)',
        r'\bClause\s+(\d+[a-z]?)\b',
    ]
    found = []
    for pat in patterns:
        found.extend(re.findall(pat, text))
    return list(dict.fromkeys(found))  # deduplicate preserving order


def get_clause_paragraphs(clause_nums: list[str], paragraphs: list[str]) -> list[str]:
    """
    Given clause numbers like ["5.2", "6.1"], return the paragraphs
    from the document that start with or contain those clause numbers.
    """
    results = []
    for num in clause_nums:
        # Match "5.2." or "5.2 " at start, or "5.2." anywhere in first 20 chars
        pattern = re.compile(
            r'(?:^|\s)' + re.escape(num) + r'[.)\s]',
        )
        for p in paragraphs:
            if pattern.search(p[:50]):
                results.append(p)
                break  # one match per clause number
    return results


def multi_query_bm25(queries: list[str], paragraphs: list[str],
                     bm25: BM25Okapi, top_k: int = 5) -> list[str]:
    """
    Run multiple query formulations through BM25 and union results.
    Scores are summed across queries to surface paragraphs relevant
    to any formulation of the suggestion.
    """
    combined_scores = [0.0] * len(paragraphs)
    for query in queries:
        tokens = query.lower().split()
        if not tokens:
            continue
        scores = bm25.get_scores(tokens)
        for i, s in enumerate(scores):
            combined_scores[i] += s

    top_indices = sorted(
        range(len(combined_scores)),
        key=lambda i: combined_scores[i],
        reverse=True
    )[:top_k]

    return [paragraphs[i] for i in top_indices if combined_scores[i] > 0]


def extract_noun_phrases(text: str) -> str:
    """
    Extract key noun phrases (capitalized multi-word terms, quoted phrases,
    and domain-specific patterns) from suggestion text.
    These produce more precise BM25 queries than full sentences.
    """
    phrases = []
    # Quoted phrases — often the exact wording the stakeholder wants
    phrases += re.findall(r'"([^"]{5,60})"', text)
    phrases += re.findall(r'\u201c([^\u201d]{5,60})\u201d', text)
    # Capitalized multi-word terms (e.g. "Renewable Purchase Obligation")
    phrases += re.findall(r'\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,4})\b', text)
    # Regulatory patterns: "clause X.X", "regulation X", "section X"
    phrases += re.findall(
        r'(?:clause|regulation|section|sub-clause|article)\s+[\d.]+[a-z]?',
        text, re.IGNORECASE
    )
    # Numeric thresholds — often the exact change being asked for
    phrases += re.findall(r'\b\d+(?:\.\d+)?\s*(?:%|percent|MW|kW|kV|units?|days?|months?|years?)\b', text, re.IGNORECASE)
    # Return unique phrases joined as one query string
    seen = set()
    unique = [p.strip() for p in phrases if p.strip() and p.strip() not in seen and not seen.add(p.strip())]
    return " ".join(unique[:12])  # cap to avoid very long query


def build_queries(suggestion: str, draft_quote: str, comment_body: str) -> list[str]:
    """
    Build 5 query formulations from different parts of the comment
    to maximize BM25 recall across different phrasings in the final.
    """
    queries = []
    # Q1: full suggestion text
    if suggestion:
        queries.append(suggestion[:400])
    # Q2: draft quote (to find the specific clause being discussed)
    if draft_quote:
        queries.append(draft_quote[:300])
    # Q3: first sentence of suggestion (often the core ask)
    if suggestion:
        first_sent = re.split(r'[.!?]', suggestion)[0].strip()
        if len(first_sent) > 20:
            queries.append(first_sent)
    # Q4: key noun phrases from full body
    if comment_body:
        queries.append(comment_body[:300])
    # Q5 (NEW): noun phrases — precise terms that appear verbatim in final clauses
    noun_q = extract_noun_phrases((suggestion or "") + " " + (draft_quote or ""))
    if noun_q:
        queries.append(noun_q)
    return [q for q in queries if q.strip()]


def search_final(suggestion: str, final_paragraphs: list[str],
                 bm25: BM25Okapi, top_k: int = 6, max_chars: int = 3500,
                 draft_quote: str = "", comment_body: str = "",
                 clause_nums: list[str] = None) -> str:
    """
    Multi-strategy retrieval from final document:
    1. Clause-number-aware: fetch exact clauses CER referenced
    2. Multi-query BM25: union of 4 query formulations
    3. Full document fallback for short documents (<15 paragraphs)
    """
    results_set = []
    seen_keys = set()

    def add(paras):
        for p in paras:
            key = p[:80]
            if key not in seen_keys:
                seen_keys.add(key)
                results_set.append(p)

    # Strategy 1: if doc is short enough, consider ALL paragraphs —
    # but ORDER them by relevance to this specific comment first.
    # (Previously this just appended paragraphs in raw document order,
    #  which meant max_chars truncation below silently dropped every
    #  clause past whatever point in the document happened to fill the
    #  budget — e.g. clauses 5–9 of a 9-clause gazette were routinely cut.)
    if len(final_paragraphs) <= 50:  # short docs: rank-then-send-all
        # Always anchor on clause-number matches first — these are the
        # exact clauses the comment is talking about.
        if clause_nums:
            add(get_clause_paragraphs(clause_nums, final_paragraphs))

        # Rank the remaining paragraphs by BM25 relevance to the comment
        # so the most relevant ones survive the max_chars cutoff.
        queries = build_queries(suggestion, draft_quote, comment_body)
        if queries:
            ranked = multi_query_bm25(
                queries, final_paragraphs, bm25, top_k=len(final_paragraphs)
            )
            add(ranked)

        # Anything BM25 scored as 0 relevance (e.g. boilerplate, headers)
        # still gets appended last, in original order, as a safety net —
        # only matters if max_chars is generous enough to reach this far.

    else:
        # Strategy 2: clause-number-aware retrieval
        if clause_nums:
            add(get_clause_paragraphs(clause_nums, final_paragraphs))

        # Strategy 3: multi-query BM25
        queries = build_queries(suggestion, draft_quote, comment_body)
        bm25_results = multi_query_bm25(queries, final_paragraphs, bm25, top_k=top_k)
        add(bm25_results)

        # Strategy 4: if still very few results, add more BM25 hits
        if len(results_set) < 3:
            add(final_paragraphs[:10])  # fallback: first 10 clauses

    combined = "\n\n---\n\n".join(results_set)
    return combined[:max_chars]


# ─────────────────────────────────────────────
# 5. ALSO GET DRAFT CONTEXT
# ─────────────────────────────────────────────

def search_draft(draft_quote: str, suggestion: str,
                 draft_paragraphs: list[str], bm25_draft: BM25Okapi,
                 top_k: int = 4, max_chars: int = 1500,
                 clause_nums: list[str] = None) -> str:
    """
    Find the relevant draft clause(s) for baseline comparison.
    Uses clause-number lookup first, then multi-query BM25.
    For short docs, returns all draft paragraphs.
    """
    results_set = []
    seen_keys = set()

    def add(paras):
        for p in paras:
            key = p[:80]
            if key not in seen_keys:
                seen_keys.add(key)
                results_set.append(p)

    # For short documents return everything
    if len(draft_paragraphs) <= 50:
        add(draft_paragraphs)
    else:
        # Clause-number lookup
        if clause_nums:
            add(get_clause_paragraphs(clause_nums, draft_paragraphs))
        # BM25 search
        queries = build_queries(suggestion, draft_quote, "")
        add(multi_query_bm25(queries, draft_paragraphs, bm25_draft, top_k=top_k))

    combined = "\n\n---\n\n".join(results_set)
    return combined[:max_chars]


# Transliterated Hindi tokens (romanised Devanagari using Latin chars)
# These pass Unicode script checks because they use ASCII characters
# but are actually Hindi written phonetically in English letters
_HINDI_ROMAN_TOKENS = {
    # Common particles and postpositions
    'vk','gS','dk','dks','esa','ds','dh','ij','ls','vkSj',
    'gksa',';g',';s','fd','tks','tc','rks','uk','gha','Hkh',
    'ml','bl','bls','mls',';k','rFkk','lHkh','dqN','cgqr',
    # Common verb forms
    'tkrk','gksrk','djrk','djrs','djuk','jgk','jgh','jgs',
    'feyk','feyr','feys','tkus','vkus','tkrh','gksrh','djrh',
    'gksaxs','tk,','djsa','gksa','jgsa','djsaxs',
    # Common nouns/adjectives
    'lkFk','igys','vkt','dy','vc','ugha','gka','laca/k',
    'vkjbZlh','vkjihvks','vkjlhvks','ohihih,','lhbZvkjlh',
    'fo|qr','ÅtkZ','vf/kfu;e','fofu;e','vuqca/k','miHkksäk',
    'vk;ksx','ljdkj','çek.ki=','vuqikyu','fofufnZ"V',
    'uohdj.kh;','vkjbZth,l','çkIr','varj.k','mi;ksx',
    # Gazette-specific transliterations
    'ifjp;','ifjHkk"kk','dk;kZUo;u','Hkqxrku','fookn',
    'ç;kstuksa','ç;ksx','lÙkk','vf/kdkj','ç.kkyh',
}

# Regex patterns that indicate transliterated Hindi
_HINDI_ROMAN_PATTERNS = [
    r'[a-z]{1,3}[½¼]{1}[a-z]{1,3}',    # ¼ih,evkj&4½ style
    r'[a-zA-Z]+[Ø]{1}[a-zA-Z]+',         # Ø character used in transliteration
    r'[a-z]{1,2}[&]{1}[a-z]{1,3}',       # vk/kkj& style
    r'\b[a-z]{1,3}[;]{1}[a-z]{1,3}\b',  # ;g, ;s style
    r'\bvk[a-z]{2,}\b',                  # vkSj, vkjbZ style
    r'\b[d][a-z]{1,2}[;k]\b',            # dk, dh, dks style
    r'\b(g[Sk][a-z]|[dl][a-z][&])\b',   # gS, ls, dk& style
]
_HINDI_ROMAN_RE = re.compile(
    '|'.join('(?:' + p + ')' for p in _HINDI_ROMAN_PATTERNS)
)


def _is_transliterated_hindi(line: str) -> bool:
    """
    Detect lines of transliterated Hindi (Hindi written in Latin script).
    These are common in Indian gazette PDFs where the PDF font encoding
    maps Devanagari glyphs to Latin characters.
    """
    if not line.strip():
        return False
    words = line.strip().lower().split()
    if not words:
        return False
    # Check word-level token match
    hindi_word_count = sum(1 for w in words
                           if w.rstrip('.,;:') in _HINDI_ROMAN_TOKENS)
    if len(words) >= 3 and hindi_word_count / len(words) > 0.25:
        return True
    # Check regex patterns
    if _HINDI_ROMAN_RE.search(line):
        return True
    return False


def clean_context_for_llm(text: str) -> str:
    """
    Final clean of context before sending to LLM.
    Removes:
    1. Lines with non-English Unicode script (Devanagari, Arabic etc.)
    2. Lines of transliterated Hindi (romanised Devanagari in Latin chars)
    3. Gazette boilerplate (page numbers, header noise)
    """
    lines = text.splitlines()
    clean = []
    for line in lines:
        stripped = line.strip()
        if not stripped:
            clean.append("")
            continue
        # Drop non-English script
        if _has_non_english_script(stripped):
            continue
        # Drop transliterated Hindi
        if _is_transliterated_hindi(stripped):
            continue
        # Drop gazette boilerplate
        if re.match(r'^\d+ (GI|THE GAZETTE)$', stripped): continue
        if re.match(r'^\(\d+\)$', stripped): continue
        if re.match(r'^xxxGID[HE]xxx$', stripped): continue
        if re.match(r'^(REGD\.|CG-DL|sn\.)', stripped): continue
        clean.append(line)
    # Remove runs of blank lines
    result = re.sub(r'\n{3,}', '\n\n', '\n'.join(clean))
    return result.strip()


def build_diff_summary(draft_context: str, final_context: str) -> str:
    """
    Build a plain-English diff summary highlighting what changed
    between draft and final. Helps LLM focus on actual changes.
    """
    if not draft_context or not final_context:
        return ""

    draft_paras = [p.strip() for p in draft_context.split("---") if len(p.strip()) > 50]
    final_paras  = [p.strip() for p in final_context.split("---") if len(p.strip()) > 50]

    changes = []
    for dp in draft_paras:
        dp_short = dp[:200].lower()
        best_sim = max(
            (fuzz.partial_ratio(dp_short, fp[:200].lower()) for fp in final_paras),
            default=0
        )
        clause_match = re.match(r'^(\d+\.\d+|\d+\.)', dp.strip())
        clause_id = clause_match.group(1) if clause_match else "?"

        if best_sim >= 93:
            changes.append(f"  Clause {clause_id}: UNCHANGED in final — do NOT use as evidence")
        elif best_sim >= 60:
            changes.append(f"  Clause {clause_id}: MODIFIED in final (similarity {best_sim}%) — only the changed portion counts as evidence")
        else:
            changes.append(f"  Clause {clause_id}: SIGNIFICANTLY CHANGED or ABSENT in final")

    for fp in final_paras:
        fp_short = fp[:200].lower()
        best_sim = max(
            (fuzz.partial_ratio(fp_short, dp[:200].lower()) for dp in draft_paras),
            default=0
        )
        if best_sim < 50:
            clause_match = re.match(r'^(\d+\.\d+|\d+\.)', fp.strip())
            if clause_match:
                changes.append(f"  Clause {clause_match.group(1)}: NEW in final (absent from draft) — VALID evidence if it matches the comment's request")

    if not changes:
        return ""
    return "=== DRAFT vs FINAL DIFF (auto-detected) ===\n" + "\n".join(changes)


def tag_final_context_with_status(final_context: str, draft_context: str) -> str:
    """
    Annotate each paragraph in the final context with its change status
    relative to the draft: [UNCHANGED], [MODIFIED], or [NEW].
    This is injected directly into the final context so the LLM sees
    the status label right next to each clause — not in a separate section
    that can be ignored.

    This is a structural signal only (has the wording changed vs draft).
    Whether a clause is actually *about* the same thing the stakeholder
    asked for is left entirely to the LLM's semantic judgment in the
    classification prompt — that's a meaning comparison, not something
    a keyword/string-overlap heuristic should be deciding.
    """
    if not draft_context:
        return final_context

    draft_paras = [p.strip() for p in draft_context.split("---") if len(p.strip()) > 50]
    final_paras = [p.strip() for p in final_context.split("---") if len(p.strip()) > 50]

    tagged = []
    for fp in final_paras:
        if not fp.strip():
            continue
        fp_short = fp[:200].lower()
        best_sim = max(
            (fuzz.partial_ratio(fp_short, dp[:200].lower()) for dp in draft_paras),
            default=0
        )
        if best_sim >= 93:
            label = "[UNCHANGED FROM DRAFT — NOT valid evidence of implementation]"
        elif best_sim >= 60:
            label = "[MODIFIED FROM DRAFT — only the NEW portions count as evidence]"
        else:
            label = "[NEW in final — valid evidence if it matches the comment's request]"
        tagged.append(f"{label}\n{fp}")

    return "\n\n---\n\n".join(tagged) if tagged else final_context


# ─────────────────────────────────────────────
# 6. PARSE COMMENTS
# ─────────────────────────────────────────────

def extract_comments(tagged_text: str) -> list[dict]:
    """
    Parse ALL numbered comment paragraphs from font-tagged text.
    - Captures every paragraph that starts with N. or N) at line start
    - Duplicate numbers are kept (different comments can share a number)
    - Skips only clear non-comment junk: table cells, pure numbers/units,
      emission values, dates, very short non-text lines
    - Each captured entry gets a unique index so nothing is lost
    """
    pattern = re.compile(
        r'(?:^|\n)[ \t]*([1-9]\d{0,2})[.)]\s+(.+?)(?=\n[ \t]*[1-9]\d{0,2}[.)]\s+|\Z)',
        re.DOTALL
    )
    matches = pattern.findall(tagged_text)

    comments = []

    for num_str, body in matches:
        num = int(num_str)

        body = re.sub(r'\n{3,}', '\n\n', body).strip()
        plain_body = strip_excluded_spans(body)
        plain_body_stripped = plain_body.strip()

        # ── Skip clear junk only ──────────────────────────────────────
        # 1. Body too short to be a real comment
        if len(plain_body_stripped) < 40:
            continue

        first_line = plain_body_stripped.splitlines()[0].strip()

        # 2. First line is purely numeric / unit data (table row)
        #    e.g. "03 mg/Nm3", "50mg/Nm3", "100/200 MW", "01-01-2017"
        if re.match(r'^[\d\s.,%/\-mgNmkWhMWkVA°Cμ]+$', first_line, re.IGNORECASE):
            continue

        # 3. First line has no real word at all (< 4 consecutive letters)
        if not re.search(r'[a-zA-Z]{4,}', first_line):
            continue

        # 4. First line is suspiciously short — likely a header stub or label
        if len(first_line) < 15:
            continue
        # ─────────────────────────────────────────────────────────────

        lines_list = plain_body_stripped.splitlines()
        title = lines_list[0].strip()[:120] if lines_list else f"Comment {num}"

        draft_quote, suggestion = split_comment_body(body)

        comments.append({
            "number":      num,
            "title":       title,
            "body":        plain_body_stripped,
            "tagged_body": body,
            "draft_quote": draft_quote,
            "suggestion":  suggestion,
        })

    # Sort by comment number (stable sort keeps relative order for same number)
    comments.sort(key=lambda c: c["number"])

    if not comments:
        cer_idx = tagged_text.find("CER Opinion")
        section = tagged_text[cer_idx:] if cer_idx >= 0 else tagged_text
        plain   = strip_excluded_spans(section)
        comments.append({
            "number": 1, "title": "CER Opinion (full)",
            "body": plain, "tagged_body": section,
            "draft_quote": "", "suggestion": plain,
        })

    return comments


# ─────────────────────────────────────────────
# 7. SYSTEM PROMPT
# ─────────────────────────────────────────────

SYSTEM_PROMPT = """You are an expert regulatory analyst specializing in consultation-response analysis.

Your task is to determine whether a stakeholder comment has been implemented in the final regulation.

You will receive:

Draft Regulation Excerpts
Stakeholder Comment (CERC Comment)
Final Regulation Excerpts

Your objective is to determine whether the specific recommendation made by the stakeholder was implemented in the final regulation.

Do NOT compare only the Comment and the Final.

Always follow this reasoning chain:

Draft Position
→ Requested Change
→ Final Position
→ Implementation Status

The question is:

"What change did the stakeholder request compared to the draft, and was that specific change implemented in the final regulation?"

Identify what the draft regulation originally provided.

Summarize only the portion relevant to the stakeholder comment.

Store as:

draft_position

Identify the exact regulatory change requested by the stakeholder.

Break complex comments into separate requests whenever multiple independent recommendations are made.

Store as:

requested_change

Identify what the final regulation ultimately provides.

Store as:

final_position

Compare the requested change directly against the final regulation.

Focus on:

Regulatory outcome
Legal effect
Policy intent
Operational impact

Use semantic meaning.

Do not rely on keyword overlap.

Different wording may still represent implementation if the regulatory outcome is substantially the same.

Do NOT classify a comment as ACCEPTED or PARTIALLY_ACCEPTED merely because:

The final regulation discusses the same topic.
The final regulation contains related clauses.
The final regulation introduces new provisions in the same area.
Similar words appear in both documents.

Implementation requires evidence that the specific recommendation was adopted.

Topic similarity is NOT implementation.

Evaluate each stakeholder comment independently.

Treat every comment as a separate regulatory recommendation.

Do not use requests, concerns, recommendations, or issues raised in any other stakeholder comment.

Do not merge multiple comments together.

Do not infer additional requests from related comments.

Only evaluate the specific requests explicitly contained within the current stakeholder comment.

A requested change may only be classified as implemented, partially implemented, or not implemented if that request was explicitly made in the current comment.

If a provision in the final regulation relates to a different stakeholder comment, ignore it unless it directly addresses the current comment.

Example:

Comment 1:
"Recognize Virtual Power Purchase Agreements (VPPAs) for RPO/RCO compliance."

Comment 2:
"Allow trading of surplus RECs."

Final:
"VPPAs may be used for RPO/RCO compliance."
"Surplus RECs shall not be traded."

Result for Comment 1:
ACCEPTED

Reason:
The VPPA recommendation was implemented.
The REC trading issue belongs to Comment 2 and must not influence the classification of Comment 1.

Result for Comment 2:
REJECTED

Reason:
The requested tradability of surplus RECs was not implemented.

Always classify the current comment solely on the basis of the requests contained within that comment.

ACCEPTED

Use ACCEPTED only when:

All material requested changes are implemented.
The final regulatory outcome substantially matches the requested outcome.
Minor drafting differences are acceptable.

PARTIALLY_ACCEPTED

Use PARTIALLY_ACCEPTED only when:

At least one requested change was implemented.
AND
At least one requested change was not implemented.

There must be both implemented and non-implemented requests.

If no requested change was implemented, do NOT use PARTIALLY_ACCEPTED.

REJECTED

Use REJECTED when:

No requested change was implemented.
The final regulation remains materially similar to the draft on the issue raised.
The requested recommendation does not appear in the final regulation.
The final regulation merely discusses the same topic without implementing the requested change.

Example 1

Comment:
Allow trading of surplus RECs.

Final:
Surplus RECs may be carried forward but shall not be traded.

Result:
REJECTED

Reason:
The requested change was tradability.
Carry-forward is a different measure.
The requested change was not implemented.

Example 2

Comment:
Allow trading of surplus RECs and allow carry-forward of surplus RECs.

Final:
Surplus RECs may be carried forward but shall not be traded.

Result:
PARTIALLY_ACCEPTED

Reason:
Carry-forward implemented.
Tradability rejected.

Example 3

Comment:
Clarify distinction between Trading License and OTC Registration.

Final:
VPPAs may be executed as OTC contracts.

Result:
REJECTED

Reason:
Mentioning OTC contracts does not provide the requested clarification.

Example 4

Comment:
Allow innovative pricing contracts under VPPAs.

Final:
The regulation introduces VPPA definitions and operational procedures but does not address innovative pricing structures.

Result:
REJECTED

Reason:
The requested pricing innovation was not implemented.
Related VPPA provisions do not constitute implementation.

Evidence MUST come only from the FINAL regulation.

Evidence must be:

Exact clause
Exact sentence
Exact paragraph

copied directly from the final regulation.

Do NOT provide summaries as evidence.

Do NOT provide interpretations as evidence.

Do NOT provide draft text as evidence.

Do NOT provide stakeholder comment text as evidence.

Evidence must support the current comment only.

Do not use evidence related to requests from other comments.

If no supporting clause exists, return exactly:

"Not found in final regulation"

Return valid JSON only.

{
"classification": "ACCEPTED | PARTIALLY_ACCEPTED | REJECTED",
"draft_position": "",
"requested_change": "",
"final_position": "",
"implemented_requests": [],
"not_implemented_requests": [],
"reasoning": "",
"evidence_in_final": ""
}
}"""


# ─────────────────────────────────────────────
# 8. LLM CLASSIFICATION
# ─────────────────────────────────────────────

def call_groq(client, model, messages, retries=3):
    """Call Groq API with automatic retry on rate limit."""
    for attempt in range(retries):
        try:
            response = client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=0.0,
                max_tokens=1800,
                seed=42
            )
            return response.choices[0].message.content.strip()
        except Exception as e:
            err = str(e)
            # Rate limit hit — wait and retry
            if "429" in err or "413" in err or "rate_limit" in err.lower():
                wait = 60 * (attempt + 1)  # 60s, 120s, 180s
                print(f"    ⏳ Rate limit hit. Waiting {wait}s before retry (attempt {attempt+1}/{retries})...")
                time.sleep(wait)
            else:
                raise  # non-rate-limit error, raise immediately
    raise Exception(f"Failed after {retries} retries due to rate limits")


def call_ollama(model, messages):
    """Call local Ollama API (must be running on localhost:11434)."""
    import requests
    response = requests.post(
        "http://localhost:11434/api/chat",
        json={
            "model": model,
            "messages": messages,
            "stream": False,
            "options": {"temperature": 0.0, "num_predict": 1800, "seed": 42}
        },
        timeout=300
    )
    response.raise_for_status()
    return response.json()["message"]["content"].strip()


def extract_json(raw: str) -> dict:
    """
    Robustly extract a JSON object from LLM output.
    Handles: markdown fences, leading/trailing text, truncated JSON.
    """
    # Strip markdown fences
    raw = re.sub(r'^```(?:json)?\s*', '', raw.strip(), flags=re.IGNORECASE)
    raw = re.sub(r'```\s*$', '', raw).strip()

    # Try direct parse first
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass

    # Find first { and last } and try to parse that slice
    start = raw.find('{')
    end   = raw.rfind('}')
    if start != -1 and end > start:
        try:
            return json.loads(raw[start:end + 1])
        except json.JSONDecodeError:
            pass

    # Last resort: regex-extract just the classification field so we don't lose the result
    cls_match = re.search(
        r'"classification"\s*:\s*"(ACCEPTED|PARTIALLY_ACCEPTED|REJECTED)"', raw
    )
    if cls_match:
        # Build a minimal valid result from whatever we can salvage
        reasoning_match = re.search(r'"reasoning"\s*:\s*"(.*?)"(?:\s*[,}])', raw, re.DOTALL)
        return {
            "classification": cls_match.group(1),
            "implemented_requests":     [],
            "not_implemented_requests": [],
            "reasoning": reasoning_match.group(1) if reasoning_match else "JSON parse failed — classification extracted by regex.",
            "evidence_in_final": "N/A",
        }

    raise json.JSONDecodeError("No valid JSON found in LLM response", raw, 0)


def classify_comment(
    client,
    model: str,
    comment: dict,
    draft_paragraphs: list[str],
    bm25_draft: BM25Okapi,
    final_paragraphs: list[str],
    bm25_final: BM25Okapi,
    use_ollama: bool = False,
) -> dict:

    suggestion   = comment.get("suggestion", comment["body"])
    draft_quote  = comment.get("draft_quote", "")
    comment_body = comment.get("body", "")

    # Fix: if stripping italic/quoted left suggestion nearly empty,
    # fall back to the full body so retrieval and LLM have real content.
    if len(suggestion.strip()) < 80 and len(comment_body.strip()) >= 80:
        suggestion = comment_body

    # Extract clause numbers CER is referencing
    clause_nums = extract_clause_numbers(draft_quote + " " + comment_body)

    # ── Multi-strategy retrieval ──
    draft_context = search_draft(
        draft_quote, suggestion,
        draft_paragraphs, bm25_draft,
        top_k=4, max_chars=1500,
        clause_nums=clause_nums
    )

    final_context = search_final(
        suggestion,
        final_paragraphs, bm25_final,
        top_k=10, max_chars=11000,
        draft_quote=draft_quote,
        comment_body=comment_body,
        clause_nums=clause_nums
    )

    # ── Clean contexts before sending to LLM ──
    draft_context = clean_context_for_llm(draft_context)
    final_context = clean_context_for_llm(final_context)

    # Only drop lines that contain actual non-English script — don't drop short English lines
    # (the previous _is_real_english filter was too aggressive: it stripped clause numbers,
    #  headings, and other short structural lines that the LLM needs as anchors)
    final_context = "\n".join(
        line for line in final_context.split("\n")
        if not _has_non_english_script(line) and not _is_transliterated_hindi(line)
    )

    # ── Build diff summary and tag final context inline ──
    diff_summary = build_diff_summary(draft_context, final_context)
    tagged_final  = tag_final_context_with_status(final_context, draft_context)

    # Send full suggestion — truncating causes incomplete semantic mapping
    suggestion_full = suggestion[:2000]  # generous limit; rarely needed

    user_content = f"""════════════════════════════════════════════════════════
STEP 1 — DRAFT CLAUSES
These are the clauses from the DRAFT regulation relevant to this comment.
════════════════════════════════════════════════════════
{draft_context if draft_context else "Not found in draft."}

════════════════════════════════════════════════════════
STEP 2 — STAKEHOLDER COMMENT
Read carefully. Identify what the stakeholder is requesting.
Is it a NEW change to the draft, or just endorsing something already in the draft?
════════════════════════════════════════════════════════
{suggestion_full}

════════════════════════════════════════════════════════
STEP 3 — FINAL REGULATION EXCERPTS
Each clause below is labelled with its change status vs the draft:
  [UNCHANGED FROM DRAFT]  → already existed; NOT valid evidence of implementation
  [MODIFIED FROM DRAFT]   → only the changed portion is valid evidence
  [NEW in final]          → valid evidence if it matches the comment's request
════════════════════════════════════════════════════════
{tagged_final if tagged_final else "Not found in final document."}

════════════════════════════════════════════════════════
STEP 4 — CHANGE STATUS SUMMARY (auto-detected)
════════════════════════════════════════════════════════
{diff_summary if diff_summary else "No diff computed."}

════════════════════════════════════════════════════════
STEP 5 — YOUR CLASSIFICATION TASK
════════════════════════════════════════════════════════

Answer these questions IN ORDER before classifying:

Q1. What is the comment actually asking for?
    Read the comment carefully.
    — Is it requesting a CHANGE or ADDITION to the draft?
    — Or is it only ENDORSING / SUPPORTING something already in the draft?
    If endorsing only → REJECTED (there is nothing to implement).

Q2. For each specific request in the comment:
    Look at the DRAFT CLAUSES above. Look at the FINAL EXCERPTS above.
    Check the [UNCHANGED / MODIFIED / NEW] label on each final clause.

    CRITICAL RULE:
    Any final clause labelled [UNCHANGED FROM DRAFT] was already in the draft.
    It CANNOT be cited as evidence that a comment was implemented.
    It was there before the comment was submitted.

Q3. Determine for each request:
    — Final clause is [NEW] and directly addresses the request → IMPLEMENTED
    — Final clause is [MODIFIED] and the modification matches the request → IMPLEMENTED
    — Final clause is [UNCHANGED FROM DRAFT] → NOT IMPLEMENTED (it pre-existed)
    — No corresponding clause in final → NOT IMPLEMENTED

Q4. Classify:
    ACCEPTED          → ALL requests implemented via NEW or MODIFIED clauses
    PARTIALLY_ACCEPTED → SOME implemented, SOME not (only valid if multiple distinct requests)
    REJECTED          → NONE implemented, OR comment only endorsed existing draft

Q5. Evidence:
    — Quote ONLY clauses labelled [NEW in final] or the changed portion of [MODIFIED] clauses.
    — NEVER quote a clause labelled [UNCHANGED FROM DRAFT] as evidence.
    — If no valid evidence exists → "Not found in final regulation"
""".strip()

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user",   "content": user_content}
    ]

    try:
        if use_ollama:
            raw = call_ollama(model, messages)
        else:
            raw = call_groq(client, model, messages)

        result = extract_json(raw)
        
        if "evidence_in_final" in result:
            evidence =str(result["evidence_in_final"])
            evidence = clean_context_for_llm(evidence)

    

            result["evidence_in_final"]=evidence
        if result.get("classification") == "PARTIALLY_ACCEPTED":
            if len(result.get("implemented_requests",[]))==0:
                result["classification"] ="REJECTED"
        
        result["comment_number"] = comment["number"]
        result["comment_title"]  = comment["title"]
        return result

    except json.JSONDecodeError as e:
        return {
            "comment_number": comment["number"],
            "comment_title":  comment["title"],
            "classification": "ERROR",

            "draft_position":"",
            "requested_change": "",
            "final_position": "",

            "implemented_requests":     [],
            "not_implemented_requests": [],
            "reasoning": f"JSON parse error: {e}",
            "evidence_in_final": "N/A",
        }
    except Exception as e:
        return {
            "comment_number": comment["number"],
            "comment_title":  comment["title"],
            "classification": "ERROR",

            "draft_position": "",
            "requested_change": "",
            "final_position": "",

            "implemented_requests":     [],
            "not_implemented_requests": [],
            "reasoning": str(e),
            "evidence_in_final": "N/A",
        }


# ─────────────────────────────────────────────
# 9. REPORTING
# ─────────────────────────────────────────────

LABEL_ICONS = {
    "ACCEPTED":           "✅",
    "PARTIALLY_ACCEPTED": "⚠️ ",
    "REJECTED":           "❌",
    "ERROR":              "🔴"
}

def print_report(results: list[dict]) -> None:
    counts = {"ACCEPTED": 0, "PARTIALLY_ACCEPTED": 0, "REJECTED": 0, "ERROR": 0}

    print("\n" + "="*72)
    print("  CERC COMMENT COMPARATOR — RESULTS")
    print("="*72)

    for r in results:
        cls  = r.get("classification", "ERROR")
        counts[cls] = counts.get(cls, 0) + 1
        icon = LABEL_ICONS.get(cls, "❓")

        print(f"\n{icon}  Comment #{r['comment_number']}  [{cls}]")
        print(f"   Title    : {r.get('comment_title','')[:80]}")
        print(f"   Reasoning: {r.get('reasoning','')}")

        implemented = r.get("implemented_requests", [])
        not_impl    = r.get("not_implemented_requests", [])
        if implemented:
            print("   ✔ Implemented:")
            for req in implemented:
                print(f"       - {req}")
        if not_impl:
            print("   ✘ Not Implemented:")
            for req in not_impl:
                print(f"       - {req}")

        ev = r.get("evidence_in_final", "")
        if ev and ev not in ("Not found in final.", "Not found in final", "N/A", ""):
            wrapped = textwrap.fill(
                ev, width=66,
                initial_indent   ="   Evidence : ",
                subsequent_indent="              "
            )
            print(wrapped)

    total = len(results)
    print("\n" + "─"*72)
    print(f"  SUMMARY  ({total} comment(s) analysed)")
    print("─"*72)
    for label, icon in LABEL_ICONS.items():
        c = counts.get(label, 0)
        if c == 0 and label == "ERROR":
            continue
        pct = (c / total * 100) if total else 0
        bar = "█" * int(pct / 5)
        print(f"  {icon}  {label:<22}  {c:>2} / {total}  ({pct:5.1f}%)  {bar}")
    print("─"*72 + "\n")


def save_results(results: list[dict], output_path: str) -> None:
    counts = {"ACCEPTED": 0, "PARTIALLY_ACCEPTED": 0, "REJECTED": 0, "ERROR": 0}
    for r in results:
        cls = r.get("classification", "ERROR")
        counts[cls] = counts.get(cls, 0) + 1
    payload = {"summary": {"total": len(results), **counts}, "results": results}
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
    print(f"  JSON saved → {output_path}")


def save_excel(all_results: list[dict], output_path: str,
               file_labels: list[str] = None) -> None:
    """
    Save all results to a formatted Excel workbook.
    - One summary sheet showing all file sets
    - One sheet per file set with full comment details
    """
    if not EXCEL_AVAILABLE:
        print("  ⚠️  openpyxl not installed. Run: pip install openpyxl")
        return

    # ── Colour palette ──────────────────────────────────────────
    COLORS = {
        "ACCEPTED":           "C6EFCE",   # green
        "PARTIALLY_ACCEPTED": "FFEB9C",   # amber
        "REJECTED":           "FFC7CE",   # red
        "ERROR":              "D9D9D9",   # grey
        "HEADER":             "1F4E79",   # dark blue
        "SUBHEADER":          "2E75B6",   # medium blue
        "ALT_ROW":            "EBF3FB",   # light blue
    }

    def cell_fill(color_hex):
        return PatternFill("solid", fgColor=color_hex)

    def header_font(white=True):
        return Font(bold=True, color="FFFFFF" if white else "000000", size=11)

    def wrap_align():
        return Alignment(wrap_text=True, vertical="top")

    thin = Side(style="thin", color="BFBFBF")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)

    wb = openpyxl.Workbook()

    # ── SUMMARY SHEET ────────────────────────────────────────────
    ws_sum = wb.active
    ws_sum.title = "Summary"

    # Title
    ws_sum.merge_cells("A1:H1")
    ws_sum["A1"] = "Regulatory Comment Analysis — Summary"
    ws_sum["A1"].font = Font(bold=True, size=14, color="FFFFFF")
    ws_sum["A1"].fill = cell_fill(COLORS["HEADER"])
    ws_sum["A1"].alignment = Alignment(horizontal="center", vertical="center")
    ws_sum.row_dimensions[1].height = 28

    # Column headers
    sum_headers = ["File Set", "Comment #", "Comment Title",
                   "Classification", "Implemented", "Not Implemented",
                   "Evidence in Final", "Reasoning"]
    for col, h in enumerate(sum_headers, 1):
        c = ws_sum.cell(row=2, column=col, value=h)
        c.font = header_font()
        c.fill = cell_fill(COLORS["SUBHEADER"])
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        c.border = border
    ws_sum.row_dimensions[2].height = 20

    sum_row = 3
    for file_idx, results in enumerate(all_results):
        label = (file_labels[file_idx]
                 if file_labels and file_idx < len(file_labels)
                 else f"File Set {file_idx + 1}")
        for r in results:
            cls = r.get("classification", "ERROR")
            row_fill = cell_fill(COLORS.get(cls, COLORS["ALT_ROW"]))
            if sum_row % 2 == 0 and cls not in COLORS:
                row_fill = cell_fill(COLORS["ALT_ROW"])

            vals = [
                label,
                r.get("comment_number", ""),
                r.get("comment_title", "")[:120],
                cls,
                "\n".join(r.get("implemented_requests", [])),
                "\n".join(r.get("not_implemented_requests", [])),
                r.get("evidence_in_final", "")[:300],
                r.get("reasoning", "")[:400],
            ]
            for col, val in enumerate(vals, 1):
                c = ws_sum.cell(row=sum_row, column=col, value=str(val) if val else "")
                c.fill = row_fill
                c.alignment = wrap_align()
                c.border = border
                if col == 4:  # classification column — bold
                    c.font = Font(bold=True)
            ws_sum.row_dimensions[sum_row].height = 60
            sum_row += 1

    # Column widths for summary
    for col, width in zip("ABCDEFGH", [18, 10, 35, 18, 35, 35, 40, 50]):
        ws_sum.column_dimensions[chr(64 + col if isinstance(col, int)
                                     else ord(col))].width = width

    # ── PER FILE-SET SHEETS ──────────────────────────────────────
    for file_idx, results in enumerate(all_results):
        label = (file_labels[file_idx]
                 if file_labels and file_idx < len(file_labels)
                 else f"File Set {file_idx + 1}")
        # Sheet name max 31 chars, no special chars
        sheet_name = re.sub(r'[\/*?:\[\]]', '', label)[:31]
        ws = wb.create_sheet(title=sheet_name)

        # Title
        ws.merge_cells("A1:F1")
        ws["A1"] = f"Comments Analysis — {label}"
        ws["A1"].font = Font(bold=True, size=13, color="FFFFFF")
        ws["A1"].fill = cell_fill(COLORS["HEADER"])
        ws["A1"].alignment = Alignment(horizontal="center", vertical="center")
        ws.row_dimensions[1].height = 26

        # Stats row
        counts = {"ACCEPTED": 0, "PARTIALLY_ACCEPTED": 0,
                  "REJECTED": 0, "ERROR": 0}
        for r in results:
            counts[r.get("classification", "ERROR")] =                 counts.get(r.get("classification", "ERROR"), 0) + 1
        total = len(results)
        ws.merge_cells("A2:F2")
        stats = (f"Total: {total}  |  "
                 f"✅ Accepted: {counts['ACCEPTED']}  |  "
                 f"⚠️ Partially: {counts['PARTIALLY_ACCEPTED']}  |  "
                 f"❌ Rejected: {counts['REJECTED']}")
        ws["A2"] = stats
        ws["A2"].font = Font(bold=True, size=11)
        ws["A2"].fill = cell_fill(COLORS["SUBHEADER"])
        ws["A2"].font = Font(bold=True, color="FFFFFF")
        ws["A2"].alignment = Alignment(horizontal="center", vertical="center")
        ws.row_dimensions[2].height = 20

        # Column headers
        detail_headers = ["Comment #", "Title", "Classification",
                          "Implemented", "Not Implemented",
                          "Evidence in Final", "Reasoning"]
        for col, h in enumerate(detail_headers, 1):
            c = ws.cell(row=3, column=col, value=h)
            c.font = header_font()
            c.fill = cell_fill(COLORS["SUBHEADER"])
            c.alignment = Alignment(horizontal="center", vertical="center",
                                    wrap_text=True)
            c.border = border
        ws.row_dimensions[3].height = 20

        for row_idx, r in enumerate(results, 4):
            cls = r.get("classification", "ERROR")
            row_fill = cell_fill(COLORS.get(cls, COLORS["ALT_ROW"]))
            vals = [
                r.get("comment_number", ""),
                r.get("comment_title", "")[:150],
                cls,
                "\n".join(r.get("implemented_requests", [])),
                "\n".join(r.get("not_implemented_requests", [])),
                r.get("evidence_in_final", "")[:400],
                r.get("reasoning", ""),
            ]
            for col, val in enumerate(vals, 1):
                c = ws.cell(row=row_idx, column=col,
                            value=str(val) if val else "")
                c.fill = row_fill
                c.alignment = wrap_align()
                c.border = border
                if col == 3:
                    c.font = Font(bold=True)
            ws.row_dimensions[row_idx].height = 80

        # Column widths
        for col, width in zip(range(1, 8),
                              [10, 35, 18, 35, 35, 45, 55]):
            ws.column_dimensions[
                openpyxl.utils.get_column_letter(col)].width = width

    wb.save(output_path)
    print(f"  Excel saved → {output_path}")


# ─────────────────────────────────────────────
# 10. PROCESS ONE FILE SET
# ─────────────────────────────────────────────

def process_file_set(
    comments_path: str,
    draft_path: str,
    final_path: str,
    client,
    model: str,
    use_ollama: bool,
    comment_numbers: list = None,
    label: str = "",
) -> list[dict]:
    """
    Process one set of (comments, draft, final) PDFs.
    Returns list of classification results.
    """
    prefix = f"[{label}] " if label else ""

    print(f"\n{prefix}📄  Extracting text from PDFs…")
    comments_tagged  = extract_comments_spans(comments_path)
    print(f"    comments : {len(comments_tagged):,} chars (tagged)")

    print(f"{prefix}📚  Building semantic indexes…")
    draft_paragraphs = split_final_by_page(draft_path)
    final_paragraphs = split_final_by_page(final_path)
    print(f"    draft paragraphs : {len(draft_paragraphs)}")
    print(f"    final paragraphs : {len(final_paragraphs)}")

    if len(final_paragraphs) < 5:
        print("    ⚠️  Very few final paragraphs — falling back to full text…")
        final_text       = extract_text(final_path)
        final_text       = extract_english_section(final_text)
        final_paragraphs = split_into_paragraphs(final_text)
        print(f"    final paragraphs (fallback): {len(final_paragraphs)}")

    if len(draft_paragraphs) < 5:
        print("    ⚠️  Very few draft paragraphs — falling back to full text…")
        draft_text       = extract_text(draft_path)
        draft_text       = extract_english_section(draft_text)
        draft_paragraphs = split_into_paragraphs(draft_text)
        print(f"    draft paragraphs (fallback): {len(draft_paragraphs)}")

    for i, p in enumerate(final_paragraphs):
        if "THE GAZETTE OF INDIA" in p.upper():
            final_paragraphs = final_paragraphs[i:]
            print(f"  English section starts at paragraph {i}")
            break

    # Guard: BM25Okapi divides by corpus size internally, so an empty
    # paragraph list (e.g. OCR genuinely failed / PDF has no readable
    # text at all) would raise a ZeroDivisionError. Fail with a clear
    # message instead of a cryptic stack trace.
    if not draft_paragraphs:
        sys.exit(
            f"No readable text could be extracted from draft PDF: {draft_path}\n"
            "  This usually means it's a scanned PDF and OCR could not read it.\n"
            "  Check that pdf2image, pytesseract, and the Tesseract binary are installed."
        )
    if not final_paragraphs:
        sys.exit(
            f"No readable text could be extracted from final PDF: {final_path}\n"
            "  This usually means it's a scanned PDF and OCR could not read it.\n"
            "  Check that pdf2image, pytesseract, and the Tesseract binary are installed."
        )

    bm25_draft = BM25Okapi([p.lower().split() for p in draft_paragraphs])
    bm25_final = BM25Okapi([p.lower().split() for p in final_paragraphs])

    comments = extract_comments(comments_tagged)
    print(f"{prefix}🔍  Found {len(comments)} comment(s)")

    if comment_numbers:
        comments = [c for c in comments if c["number"] in comment_numbers]

    print(f"{prefix}📋  Parsed suggestions:")
    for idx, c in enumerate(comments, 1):
        print(f"    [#{idx}] comment no.{c['number']} | {c['suggestion'][:70]}…")

    print(f"{prefix}🤖  Classifying…")
    results = []
    for i, comment in enumerate(comments, 1):
        print(f"    [{i}/{len(comments)}] Comment #{comment['number']}: "
              f"{comment['title'][:55]}…")
        if i > 1:
            print("    ⏱️  Waiting 45s for rate limit…")
            time.sleep(45)
        result = classify_comment(
            client=client,
            model=model,
            comment=comment,
            draft_paragraphs=draft_paragraphs,
            bm25_draft=bm25_draft,
            final_paragraphs=final_paragraphs,
            bm25_final=bm25_final,
            use_ollama=use_ollama,
        )
        result["file_set"] = label
        results.append(result)

    return results


# ─────────────────────────────────────────────
# 11. MAIN
# ─────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="CERC Comment Comparator — single or batch mode",
        formatter_class=argparse.RawTextHelpFormatter,
        epilog="""
SINGLE FILE MODE:
  python main.py --comments c.pdf --draft d.pdf --final f.pdf

BATCH MODE (multiple file sets):
  python main.py --batch \
      --comments c1.pdf c2.pdf c3.pdf \
      --draft    d1.pdf d2.pdf d3.pdf \
      --final    f1.pdf f2.pdf f3.pdf \
      --labels   "RERC_2024" "CERC_VPPA" "MPERC_2023"
        """
    )

    # ── Single file args ──────────────────────────────────────────
    parser.add_argument("--comments", nargs="+",
                        help="Comments PDF(s). One for single, many for batch.")
    parser.add_argument("--draft",    nargs="+",
                        help="Draft PDF(s).")
    parser.add_argument("--final",    nargs="+",
                        help="Final gazette PDF(s).")
    parser.add_argument("--labels",   nargs="*", default=None,
                        help="Optional label for each file set (batch mode).")

    # ── Common args ───────────────────────────────────────────────
    parser.add_argument("--model",    default="llama-3.3-70b-versatile")
    parser.add_argument("--api-key",  default=None)
    parser.add_argument("--output",   default="results",
                        help="Output base name (no extension). "
                             "Creates <output>.json and <output>.xlsx")
    parser.add_argument("--comment-numbers", nargs="*", type=int, default=None)
    parser.add_argument("--use-ollama", action="store_true")
    parser.add_argument("--batch",    action="store_true",
                        help="Explicitly enable batch mode.")

    args = parser.parse_args()

    # ── Validate inputs ───────────────────────────────────────────
    if not args.comments or not args.draft or not args.final:
        parser.error("--comments, --draft, and --final are required.")

    n = len(args.comments)
    if len(args.draft) != n or len(args.final) != n:
        parser.error(
            f"Number of --comments ({n}), --draft ({len(args.draft)}), "
            f"and --final ({len(args.final)}) must match."
        )

    for paths in [args.comments, args.draft, args.final]:
        for p in paths:
            if not Path(p).exists():
                sys.exit(f"File not found: {p}")

    # ── Labels ────────────────────────────────────────────────────
    if args.labels and len(args.labels) == n:
        labels = args.labels
    else:
        # Auto-generate labels from filename stems
        labels = [Path(c).stem for c in args.comments]

    is_batch = n > 1 or args.batch
    mode = "BATCH" if is_batch else "SINGLE"
    print("\n" + "="*60)
    print(f"  CERC Comment Comparator — {mode} MODE ({n} file set(s))")
    print(f"{'='*60}")

    # ── Setup LLM client ─────────────────────────────────────────
    if args.use_ollama and args.model == "llama-3.3-70b-versatile":
        args.model = "qwen2.5:14b"

    if args.use_ollama:
        client = None
        print(f"🦙  Ollama  (model: {args.model})")
    else:
        api_key = args.api_key or os.environ.get("GROQ_API_KEY")
        if not api_key:
            sys.exit("No Groq API key. Set GROQ_API_KEY in .env or pass --api-key.")
        client = Groq(api_key=api_key)
        print(f"☁️   Groq API  (model: {args.model})")

    # ── Process each file set ─────────────────────────────────────
    all_results = []
    for i, (comments_path, draft_path, final_path, label) in enumerate(
        zip(args.comments, args.draft, args.final, labels), 1
    ):
        print(f"\n{'─'*60}")
        print(f"  File Set {i}/{n}: {label}")
        print(f"    comments : {comments_path}")
        print(f"    draft    : {draft_path}")
        print(f"    final    : {final_path}")
        print(f"{'─'*60}")

        results = process_file_set(
            comments_path=comments_path,
            draft_path=draft_path,
            final_path=final_path,
            client=client,
            model=args.model,
            use_ollama=args.use_ollama,
            comment_numbers=args.comment_numbers,
            label=label,
        )
        print_report(results)
        all_results.append(results)

    # ── Save outputs ──────────────────────────────────────────────
    print(f"\n{'='*60}")
    print("  SAVING OUTPUTS")
    print(f"{'='*60}")

    # Flatten all results for JSON
    flat_results = [r for rs in all_results for r in rs]

    # JSON — always saved
    json_path = args.output if args.output.endswith(".json")                 else args.output + ".json"
    save_results(flat_results, json_path)

    # Excel
    xlsx_path = (args.output.replace(".json", "") if args.output.endswith(".json")
                 else args.output) + ".xlsx"
    save_excel(all_results, xlsx_path, file_labels=labels)

    print(f"\n✅  Done. {len(flat_results)} comment(s) across {n} file set(s).")


if __name__ == "__main__":
    main()