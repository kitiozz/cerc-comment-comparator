import { ParsedComment } from '../types';

/**
 * Parses raw text from a stakeholder comments document into structured comment items.
 * Detects numbered items, clauses, stakeholder suggestions, and draft references.
 */
export function parseCommentsFromText(text: string): ParsedComment[] {
  if (!text || !text.trim()) return [];

  const lines = text.split(/\r?\n/);
  const items: ParsedComment[] = [];
  let currentLines: string[] = [];
  let count = 1;

  const isHeaderLine = (line: string): boolean => {
    const s = line.trim();
    if (!s) return false;
    
    // Examples: "1.", "1. Contract Rate:", "Comment 1:", "Issue 2:", "Clause 4.1:", "Point 3:"
    const hasNumberedHeader =
      /^(?:comment|issue|suggestion|point|clause|submission|item)?\s*#?\s*\d+[\.:)]\s+[A-Za-z]/i.test(s) ||
      /^\d+[\.:)]\s+[A-Za-z]/.test(s) ||
      /^(?:Issue|Comment|Suggestion|Point)\s+\d+[:\s]/i.test(s);

    return hasNumberedHeader;
  };

  for (const line of lines) {
    if (isHeaderLine(line) && currentLines.join('\n').trim().length > 30) {
      const full = currentLines.join('\n').trim();
      const firstLine = full.split('\n')[0].replace(/^[\d#.:\s\-_)]+/, '').trim().slice(0, 90);
      
      const draftMatch = full.match(/(?:draft\s+(?:clause|regulation|text|rule)|proposed\s+clause)[^:]*:\s*["“]?([^"”\n]{15,250})["”]?/i);
      const suggMatch = full.match(/(?:recommend(?:ed)?|suggest(?:ed)?|propose(?:d)?|request(?:ed)?)[^.]*?\.\s*(.*)/i);

      items.push({
        number: count++,
        title: firstLine || `Comment #${count - 1}`,
        body: full,
        draft_quote: draftMatch ? draftMatch[1].trim() : undefined,
        suggestion: suggMatch ? suggMatch[0].trim() : full,
      });
      currentLines = [line];
    } else {
      currentLines.push(line);
    }
  }

  if (currentLines.join('\n').trim().length > 20) {
    const full = currentLines.join('\n').trim();
    const firstLine = full.split('\n')[0].replace(/^[\d#.:\s\-_)]+/, '').trim().slice(0, 90);
    const draftMatch = full.match(/(?:draft\s+(?:clause|regulation|text|rule)|proposed\s+clause)[^:]*:\s*["“]?([^"”\n]{15,250})["”]?/i);
    const suggMatch = full.match(/(?:recommend(?:ed)?|suggest(?:ed)?|propose(?:d)?|request(?:ed)?)[^.]*?\.\s*(.*)/i);

    items.push({
      number: count++,
      title: firstLine || `Comment #${count - 1}`,
      body: full,
      draft_quote: draftMatch ? draftMatch[1].trim() : undefined,
      suggestion: suggMatch ? suggMatch[0].trim() : full,
    });
  }

  // Fallback: If no headers detected and text is multiple paragraphs
  if (items.length <= 1 && text.length > 400) {
    const paras = text
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 40);

    if (paras.length > 1) {
      return paras.map((p, idx) => ({
        number: idx + 1,
        title: p.split('\n')[0].replace(/^[\d#.:\s\-_)]+/, '').trim().slice(0, 90) || `Comment #${idx + 1}`,
        body: p,
        suggestion: p,
      }));
    }
  }

  if (items.length === 0 && text.trim().length > 0) {
    items.push({
      number: 1,
      title: text.split('\n')[0].slice(0, 80) || 'Stakeholder Submission',
      body: text.trim(),
      suggestion: text.trim(),
    });
  }

  return items;
}
