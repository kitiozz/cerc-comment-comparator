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
    pass

try:
    import fitz
except ImportError:
    pass

try:
    from groq import Groq
except ImportError:
    pass

# Ollama is optional — only needed for --use-ollama flag
try:
    import requests as _requests
    OLLAMA_AVAILABLE = True
except ImportError:
    OLLAMA_AVAILABLE = False

try:
    from rank_bm25 import BM25Okapi
except ImportError:
    pass

try:
    from rapidfuzz import fuzz
except ImportError:
    pass

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

try:
    from pdf2image import convert_from_path as _pdf2images
    import pytesseract as _pytesseract
    OCR_AVAILABLE = True
except ImportError:
    OCR_AVAILABLE = False

_OCR_MIN_CHARS_PER_PAGE = 80


def _ocr_pdf(pdf_path: str) -> str:
    if not OCR_AVAILABLE:
        print(
            "[OCR] WARNING: Scanned PDF detected but OCR libs not installed.\n"
            "      Falling back to empty text."
        )
        return ""

    print(f"[OCR] Scanned PDF detected — running OCR on '{Path(pdf_path).name}' ...")
    try:
        images = _pdf2images(pdf_path, dpi=300)
        pages_text = []
        for i, img in enumerate(images, 1):
            page_text = _pytesseract.image_to_string(img, lang="eng")
            pages_text.append(page_text)
        return "\n\n".join(pages_text)
    except Exception as exc:
        print(f"[OCR] OCR failed: {exc}")
        return ""


def _is_scanned(doc) -> bool:
    pages_to_check = min(4, len(doc))
    total = sum(
        len(doc[i].get_text("text").strip())
        for i in range(pages_to_check)
    )
    return (total / max(pages_to_check, 1)) < _OCR_MIN_CHARS_PER_PAGE


def extract_text(pdf_path: str) -> str:
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
    doc = fitz.open(pdf_path)

    if _is_scanned(doc):
        doc.close()
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
                        continue
                    is_italic = bool(span["flags"] & 2)
                    if is_italic:
                        line_parts.append(f"<<ITALIC>>{raw}<<END_ITALIC>>")
                    else:
                        line_parts.append(raw)
                if line_parts:
                    out.append("".join(line_parts))
        out.append("")

    doc.close()
    full = "\n".join(out)

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
                    opens  = span.count("<<ITALIC>>")
                    closes = span.count("<<END_ITALIC>>")
                    if opens == closes:
                        result.append(f"<<QUOTED>>{span}<<END_QUOTED>>")
                        i = end + 1
                        continue
            result.append(text[i])
            i += 1
        return "".join(result)

    return tag_quotes(full)


def strip_excluded_spans(tagged_text: str) -> str:
    text = re.sub(r'<<ITALIC>>.*?<<END_ITALIC>>', '', tagged_text, flags=re.DOTALL)
    text = re.sub(r'<<QUOTED>>.*?<<END_QUOTED>>', '', text,        flags=re.DOTALL)
    text = re.sub(r'<<\w+>>', '', text)
    text = re.sub(r'<{1,3}\n', '\n', text)
    text = re.sub(r'\s*<+\s*', ' ', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    text = re.sub(r'[ \t]{2,}', ' ', text)
    return text.strip()


def get_draft_quote_from_tags(tagged_body: str) -> str:
    italic = re.findall(r'<<ITALIC>>(.*?)<<END_ITALIC>>', tagged_body, re.DOTALL)
    quoted = re.findall(r'<<QUOTED>>(.*?)<<END_QUOTED>>', tagged_body, re.DOTALL)
    return " ".join(italic + quoted).strip()


def split_ocr_comment_body(body: str) -> tuple[str, str]:
    body=re.sub(r"\s+"," ",body).strip()
    cues=["It is suggested that","It is proposed that","It is recommended that","It is requested that","It is submitted that"]
    for c in cues:
        m=re.search(c,body,re.IGNORECASE)
        if m: return body[:m.start()].strip(" :-"), body[m.start():].strip()
    return "", body

def split_comment_body(tagged_body: str) -> tuple[str, str]:
    if "<<ITALIC>>" in tagged_body or "<<QUOTED>>" in tagged_body:
        draft_quote=get_draft_quote_from_tags(tagged_body)
        suggestion=strip_excluded_spans(tagged_body)
        return draft_quote,suggestion
    return split_ocr_comment_body(tagged_body)


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
    for ch in text:
        cp = ord(ch)
        for start, end in _NON_ENGLISH_RANGES:
            if start <= cp <= end:
                return True
    return False


def _is_real_english(text: str) -> bool:
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
    text = re.sub(r' {2,}', ' ', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    text = re.sub(r'\n(\d+\.\d+\.)', r'\n\n\1', text)
    text = re.sub(r'\n(\d+\.\s+[A-Z])', r'\n\n\1', text)
    text = re.sub(r'\n([a-o]\)\s)', r'\n\n\1', text)

    raw = [p.strip() for p in text.split('\n\n')]

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

    return [p for p in merged if len(p) > 80 and _is_real_english(p)]


def _clean_gazette_page(page_text: str) -> str:
    lines = page_text.splitlines()
    english_lines = []
    for line in lines:
        line = line.strip()
        if not line:
            english_lines.append("")
            continue
        if _has_non_english_script(line):
            continue
        if re.match(r'^\d+ (GI|THE GAZETTE)$', line): continue
        if "GAZETTE OF INDIA" in line and "EXTRAORDINARY" in line: continue
        if "PART III" in line and "SEC" in line: continue
        if re.match(r'^\(\d+\)$', line): continue
        if re.match(r'^xxxGID[HE]xxx$', line): continue
        if re.match(r'^(REGD\.|rjist|CG-DL)', line): continue
        english_lines.append(line)
    return "\n".join(english_lines)


def split_final_by_page(pdf_path: str) -> list[str]:
    doc = fitz.open(pdf_path)

    if _is_scanned(doc):
        doc.close()
        ocr_text = _ocr_pdf(pdf_path)
        if not ocr_text.strip():
            return []
        cleaned = _clean_gazette_page(ocr_text)
        return split_into_paragraphs(cleaned) if cleaned.strip() else []

    all_paragraphs = []

    for page in doc:
        raw = page.get_text("text")
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
        if total > 0 and hindi_roman_count / total > 0.60:
            continue

        cleaned = _clean_gazette_page(raw)
        if not cleaned.strip():
            continue
        page_paras = split_into_paragraphs(cleaned)
        all_paragraphs.extend(page_paras)

    doc.close()

    seen = set()
    unique = []
    for p in all_paragraphs:
        key = p[:100]
        if key not in seen:
            seen.add(key)
            unique.append(p)
    return unique


def extract_clause_numbers(text: str) -> list[str]:
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
    return list(dict.fromkeys(found))


def get_clause_paragraphs(clause_nums: list[str], paragraphs: list[str]) -> list[str]:
    results = []
    for num in clause_nums:
        pattern = re.compile(
            r'(?:^|\s)' + re.escape(num) + r'[.)\s]',
        )
        for p in paragraphs:
            if pattern.search(p[:50]):
                results.append(p)
                break
    return results


def multi_query_bm25(queries: list[str], paragraphs: list[str],
                     bm25: BM25Okapi, top_k: int = 5) -> list[str]:
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
    phrases = []
    phrases += re.findall(r'"([^"]{5,60})"', text)
    phrases += re.findall(r'\u201c([^\u201d]{5,60})\u201d', text)
    phrases += re.findall(r'\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,4})\b', text)
    phrases += re.findall(
        r'(?:clause|regulation|section|sub-clause|article)\s+[\d.]+[a-z]?',
        text, re.IGNORECASE
    )
    phrases += re.findall(r'\b\d+(?:\.\d+)?\s*(?:%|percent|MW|kW|kV|units?|days?|months?|years?)\b', text, re.IGNORECASE)
    seen = set()
    unique = [p.strip() for p in phrases if p.strip() and p.strip() not in seen and not seen.add(p.strip())]
    return " ".join(unique[:12])


def build_queries(suggestion: str, draft_quote: str, comment_body: str) -> list[str]:
    queries = []
    if suggestion:
        queries.append(suggestion[:400])
    if draft_quote:
        queries.append(draft_quote[:300])
    if suggestion:
        first_sent = re.split(r'[.!?]', suggestion)[0].strip()
        if len(first_sent) > 20:
            queries.append(first_sent)
    if comment_body:
        queries.append(comment_body[:300])
    noun_q = extract_noun_phrases((suggestion or "") + " " + (draft_quote or ""))
    if noun_q:
        queries.append(noun_q)
    return [q for q in queries if q.strip()]


def search_final(suggestion: str, final_paragraphs: list[str],
                 bm25: BM25Okapi, top_k: int = 6, max_chars: int = 3500,
                 draft_quote: str = "", comment_body: str = "",
                 clause_nums: list[str] = None) -> str:
    results_set = []
    seen_keys = set()

    def add(paras):
        for p in paras:
            key = p[:80]
            if key not in seen_keys:
                seen_keys.add(key)
                results_set.append(p)

    if len(final_paragraphs) <= 50:
        if clause_nums:
            add(get_clause_paragraphs(clause_nums, final_paragraphs))
        queries = build_queries(suggestion, draft_quote, comment_body)
        if queries:
            ranked = multi_query_bm25(
                queries, final_paragraphs, bm25, top_k=len(final_paragraphs)
            )
            add(ranked)
    else:
        if clause_nums:
            add(get_clause_paragraphs(clause_nums, final_paragraphs))
        queries = build_queries(suggestion, draft_quote, comment_body)
        bm25_results = multi_query_bm25(queries, final_paragraphs, bm25, top_k=top_k)
        add(bm25_results)
        if len(results_set) < 3:
            add(final_paragraphs[:10])

    combined = "\n\n---\n\n".join(results_set)
    return combined[:max_chars]


def search_draft(draft_quote: str, suggestion: str,
                 draft_paragraphs: list[str], bm25_draft: BM25Okapi,
                 top_k: int = 4, max_chars: int = 1500,
                 clause_nums: list[str] = None) -> str:
    results_set = []
    seen_keys = set()

    def add(paras):
        for p in paras:
            key = p[:80]
            if key not in seen_keys:
                seen_keys.add(key)
                results_set.append(p)

    if len(draft_paragraphs) <= 50:
        add(draft_paragraphs)
    else:
        if clause_nums:
            add(get_clause_paragraphs(clause_nums, draft_paragraphs))
        queries = build_queries(suggestion, draft_quote, "")
        add(multi_query_bm25(queries, draft_paragraphs, bm25_draft, top_k=top_k))

    combined = "\n\n---\n\n".join(results_set)
    return combined[:max_chars]


_HINDI_ROMAN_TOKENS = {
    'vk','gS','dk','dks','esa','ds','dh','ij','ls','vkSj',
    'gksa',';g',';s','fd','tks','tc','rks','uk','gha','Hkh',
    'ml','bl','bls','mls',';k','rFkk','lHkh','dqN','cgqr',
    'tkrk','gksrk','djrk','djrs','djuk','jgk','jgh','jgs',
    'feyk','feyr','feys','tkus','vkus','tkrh','gksrh','djrh',
    'gksaxs','tk,','djsa','gksa','jgsa','djsaxs',
    'lkFk','igys','vkt','dy','vc','ugha','gka','laca/k',
    'vkjbZlh','vkjihvks','vkjlhvks','ohihih,','lhbZvkjlh',
    'fo|qr','ÅtkZ','vf/kfu;e','fofu;e','vuqca/k','miHkksäk',
    'vk;ksx','ljdkj','çek.ki=','vuqikyu','fofufnZ"V',
    'uohdj.kh;','vkjbZth,l','çkIr','varj.k','mi;ksx',
    'ifjp;','ifjHkk"kk','dk;kZUo;u','Hkqxrku','fookn',
    'ç;kstuksa','ç;ksx','lÙkk','vf/kdkj','ç.kkyh',
}

_HINDI_ROMAN_PATTERNS = [
    r'[a-z]{1,3}[½¼]{1}[a-z]{1,3}',
    r'[a-zA-Z]+[Ø]{1}[a-zA-Z]+',
    r'[a-z]{1,2}[&]{1}[a-z]{1,3}',
    r'\b[a-z]{1,3}[;]{1}[a-z]{1,3}\b',
    r'\bvk[a-z]{2,}\b',
    r'\b[d][a-z]{1,2}[;k]\b',
    r'\b(g[Sk][a-z]|[dl][a-z][&])\b',
]
_HINDI_ROMAN_RE = re.compile(
    '|'.join('(?:' + p + ')' for p in _HINDI_ROMAN_PATTERNS)
)


def _is_transliterated_hindi(line: str) -> bool:
    if not line.strip():
        return False
    words = line.strip().lower().split()
    if not words:
        return False
    hindi_word_count = sum(1 for w in words
                           if w.rstrip('.,;:') in _HINDI_ROMAN_TOKENS)
    if len(words) >= 3 and hindi_word_count / len(words) > 0.25:
        return True
    if _HINDI_ROMAN_RE.search(line):
        return True
    return False


def clean_context_for_llm(text: str) -> str:
    lines = text.splitlines()
    clean = []
    for line in lines:
        stripped = line.strip()
        if not stripped:
            clean.append("")
            continue
        if _has_non_english_script(stripped):
            continue
        if _is_transliterated_hindi(stripped):
            continue
        if re.match(r'^\d+ (GI|THE GAZETTE)$', stripped): continue
        if re.match(r'^\(\d+\)$', stripped): continue
        if re.match(r'^xxxGID[HE]xxx$', stripped): continue
        if re.match(r'^(REGD\.|CG-DL|sn\.)', stripped): continue
        clean.append(line)
    result = re.sub(r'\n{3,}', '\n\n', '\n'.join(clean))
    return result.strip()


def build_diff_summary(draft_context: str, final_context: str) -> str:
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


def extract_comments(tagged_text: str) -> list[dict]:
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

        if len(plain_body_stripped) < 40:
            continue

        first_line = plain_body_stripped.splitlines()[0].strip()

        if re.match(r'^[\d\s.,%/\-mgNmkWhMWkVA°Cμ]+$', first_line, re.IGNORECASE):
            continue

        if not re.search(r'[a-zA-Z]{4,}', first_line):
            continue

        if len(first_line) < 15:
            continue

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


SYSTEM_PROMPT = """[SYSTEM MANDATE: DETERMINISTIC COMMENT-WISE IMPLEMENTATION VERIFIER]
You are acting as a regulatory reviewer, not a document-similarity engine. Your task is comment-wise implementation verification: for THIS ONE stakeholder comment only, determine whether its specific recommendation was implemented in the Final Gazette Notification, using the Draft Text as the baseline. You must eliminate all stylistic and interpretive variance across runs.

[SINGLE-COMMENT ISOLATION — MANDATORY]
- Evaluate only the one comment given to you in this request. Never use another comment's topic, wording, or outcome as evidence, even if it discusses the same clause.
- Evidence must originate ONLY from this comment's text and the matching Final Gazette excerpt. If a Final excerpt matches the topic but reflects a different stakeholder's request, it is NOT valid evidence — treat it as absent.

[EXECUTION ENGINE PARAMETERS]
- TEMPERATURE: 0.0 (Strictly enforce top-1 logprob tokens)
- OUTPUT FORMAT: Strict Minified JSON only. No conversational prose, intro, or outro text.

[STRICT CLASSIFICATION ALGORITHM — SEMANTIC, NOT LITERAL]
Compare meaning and regulatory effect, not exact wording. Paraphrased or reworded final text that preserves the same effect is still a match — do not require identical terminology.

For the recommendation in this comment, run this 4-question test against the candidate Final Gazette excerpt:
1. Same subject?    — Do both address the same clause/topic?
2. Same suggestion?  — Is the stakeholder's specific request present in the final text (in meaning, even if reworded)?
3. Same condition?   — Are the exceptions, thresholds, or limits the stakeholder specified preserved (not dropped or loosened/tightened)?
4. Same outcome?     — Does the final text actually produce the rule the stakeholder asked for, not just mention the same topic?

Classify using the result of that test:
- ACCEPTED: all four checks pass — the complete recommendation's meaning and effect is implemented, wording aside.
- PARTIALLY ACCEPTED: some but not all checks pass — e.g. the topic/subject is addressed but a condition or part of the request is missing, weakened, or narrower than asked.
- REJECTED: the checks fail — the final text matches the draft verbatim, omits the stakeholder's topic entirely, or contradicts the request (opposite outcome).

[SPECIFIC-PARAMETER FIDELITY RULE — DO NOT ROUND THIS OFF]
A comment's recommendation is more than its general topic or mechanism — it usually carries one or more specific parameters that must ALSO match before you call it ACCEPTED: a number (percentage, rupee value, days, units, threshold), a scope/eligibility (who it applies to — "all consumers" vs "industrial consumers only"), a timeframe ("immediate effect" vs "from next FY"), a condition/exception ("in all cases" vs "except during force majeure"), or a responsible entity/authority ("Commission" vs "the utility"). Agreeing on the general concept or pulling the same lever is NOT the same as matching the specific parameter.

For each such parameter present in the comment:
- The final text matches it exactly, or grants something at least as favorable to the stakeholder as requested (e.g. asked for a minimum of 30%, final grants 30% or more; asked for "all consumers", final covers all consumers or a superset) → that parameter passes.
- The final text adopts the same general mechanism/direction but the specific parameter differs and is less favorable or narrower than requested (asked for a 30% increase, final grants 25%; asked to cover "all consumers", final covers only "industrial consumers"; asked for "immediate effect", final delays it) → this parameter is only a PARTIAL match. Do not classify ACCEPTED just because the same lever was pulled — score the request as PARTIALLY ACCEPTED (or note this specific parameter as not implemented if other parameters in the same comment did pass).
- The final text is silent on the parameter, or moves in the opposite direction (asked to increase, final decreases/removes it) → that parameter fails entirely, contributing toward REJECTED for that request.

Only call a request ACCEPTED when every specific parameter it carries is satisfied — not just its general topic or direction.

[REQUIRED DETERMINISTIC JSON SCHEMA]
Output exactly one JSON object following this structural type definition. Do not deviate by a single character across invocations:

{
    "metadata": {
        "state": "[Insert State]",
        "domain": "[Insert Domain]"
    },
    "mapping_analysis": [
        {
            "clause_id": "[Insert specific clause reference, e.g., Clause 2(i)(k)(ii)]",
            "issue_flagged": "[Direct, punchy summary under 15 words of the gap in the draft]",
            "exact_quote_from_comment": "[Extract and paste the exact line of recommendation from the comment file]",
            "exact_quote_from_final_gazette": "[Extract and paste the exact modified text line from the final gazette]",
            "classification_status": "[ACCEPTED or PARTIALLY ACCEPTED or REJECTED]",
            "determinism_proof": "Draft line states: '[quote]'. Comment requested: '[quote]'. Final line states: '[quote]'. Therefore, logic dictates [Classification Status]."
        }
    ]
}

Process exactly one stakeholder comment per request. Match that comment semantically against the draft and final text, and identify whether each requested mechanism is present, altered, or absent.
"""


def extract_json(raw: str) -> dict:
    raw = re.sub(r'^```(?:json)?\s*', '', raw.strip(), flags=re.IGNORECASE)
    raw = re.sub(r'```\s*$', '', raw).strip()

    def normalize_mapping_result(parsed: dict) -> dict:
        mappings = parsed.get("mapping_analysis")
        if not isinstance(mappings, list) or not mappings:
            return parsed

        valid = {"ACCEPTED", "PARTIALLY ACCEPTED", "REJECTED"}
        statuses = [
            str(item.get("classification_status", "")).upper()
            for item in mappings if isinstance(item, dict)
        ]
        status = statuses[0] if statuses else "REJECTED"
        if status not in valid:
            status = "REJECTED"

        implemented = []
        not_implemented = []
        for item in mappings:
            if not isinstance(item, dict):
                continue
            request = str(item.get("exact_quote_from_comment", "")).strip()
            if str(item.get("classification_status", "")).upper() == "ACCEPTED":
                implemented.append(request)
            else:
                not_implemented.append(request)

        return {
            "classification": status.replace(" ", "_"),
            "draft_position": " ".join(
                str(item.get("clause_id", "")) for item in mappings
                if isinstance(item, dict)
            ).strip(),
            "requested_change": " ".join(
                str(item.get("exact_quote_from_comment", "")) for item in mappings
                if isinstance(item, dict)
            ).strip(),
            "final_position": " ".join(
                str(item.get("exact_quote_from_final_gazette", "")) for item in mappings
                if isinstance(item, dict)
            ).strip(),
            "implemented_requests": implemented,
            "not_implemented_requests": not_implemented,
            "reasoning": " ".join(
                str(item.get("determinism_proof", "")) for item in mappings
                if isinstance(item, dict)
            ).strip(),
            "evidence_in_final": " ".join(
                str(item.get("exact_quote_from_final_gazette", "")) for item in mappings
                if isinstance(item, dict)
            ).strip() or "Not found in final regulation",
        }

    try:
        return normalize_mapping_result(json.loads(raw))
    except json.JSONDecodeError:
        pass

    start = raw.find('{')
    end   = raw.rfind('}')
    if start != -1 and end > start:
        try:
            return normalize_mapping_result(json.loads(raw[start:end + 1]))
        except json.JSONDecodeError:
            pass

    cls_match = re.search(
        r'"classification"\s*:\s*"(ACCEPTED|PARTIALLY_ACCEPTED|REJECTED)"', raw
    )
    if not cls_match:
        raise json.JSONDecodeError("No valid JSON found in LLM response", raw, 0)
    
    result = {"classification": cls_match.group(1)}
    reasoning_match = re.search(r'"reasoning"\s*:\s*"(.*?)"(?:\s*[,}])', raw, re.DOTALL)
    result["reasoning"] = reasoning_match.group(1) if reasoning_match else "JSON parse completed."
    result["implemented_requests"] = []
    result["not_implemented_requests"] = []
    return result


def main():
    print("CERC Comment Comparator Pipeline ready.")

if __name__ == "__main__":
    main()
