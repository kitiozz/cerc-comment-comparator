export type ClassificationType = 'ACCEPTED' | 'PARTIALLY_ACCEPTED' | 'REJECTED' | 'ERROR';

export interface EvidenceProvenance {
  source_doc: 'final' | 'draft';
  paragraph_index: number;
  clause_heading?: string;
  exact_match: boolean;
  match_score: number;
  text_snippet: string;
}

export interface CommentAnalysisResult {
  comment_number: number;
  comment_title: string;
  classification: ClassificationType;
  draft_position: string;
  requested_change: string;
  final_position: string;
  implemented_requests: string[];
  not_implemented_requests: string[];
  reasoning: string;
  evidence_in_final: string;
  referenced_clause?: string;
  draft_snippet?: string;
  final_snippet?: string;
  confidence_score?: number;
  file_set?: string;

  // Anti-Hallucination & Provenance Verification Fields
  evidence_verified?: boolean;
  evidence_match_confidence?: number;
  evidence_paragraph_index?: number;
  evidence_source_clause?: string;
  evidence_matched_excerpt?: string;
  provenance?: EvidenceProvenance;
  hallucination_warning?: string;
}

export interface AnalysisSummary {
  total: number;
  ACCEPTED: number;
  PARTIALLY_ACCEPTED: number;
  REJECTED: number;
  ERROR: number;
}

export interface AnalysisReport {
  summary: AnalysisSummary;
  results: CommentAnalysisResult[];
  dataset_name?: string;
  analyzed_at?: string;
  model_used?: string;
}

export interface ParsedComment {
  number: number;
  title: string;
  body: string;
  tagged_body?: string;
  draft_quote?: string;
  suggestion: string;
}

export interface RegulatoryDocument {
  id: string;
  title: string;
  fileName: string;
  paragraphs: string[];
  fullText: string;
}

export interface ComparisonDataset {
  id: string;
  name: string;
  description: string;
  draftDoc: RegulatoryDocument;
  finalDoc: RegulatoryDocument;
  comments: ParsedComment[];
  results: CommentAnalysisResult[];
}
