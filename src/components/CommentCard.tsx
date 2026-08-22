import React, { useState } from 'react';
import {
  CheckCircle2,
  AlertCircle,
  XCircle,
  ChevronDown,
  ChevronUp,
  Quote,
  Check,
  X,
  FileCheck2,
  Scale,
  Sparkles,
  Layers,
  ShieldCheck,
  MapPin,
  AlertTriangle
} from 'lucide-react';
import { CommentAnalysisResult, ClassificationType } from '../types';

interface CommentCardProps {
  result: CommentAnalysisResult;
  onOpenDetails: (result: CommentAnalysisResult) => void;
  onLocateInDoc?: (result: CommentAnalysisResult) => void;
}

export const CommentCard: React.FC<CommentCardProps> = ({
  result,
  onOpenDetails,
  onLocateInDoc,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const getStatusBadge = (classification: ClassificationType) => {
    switch (classification) {
      case 'ACCEPTED':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100/80 text-emerald-800 border border-emerald-300">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            ACCEPTED
          </span>
        );
      case 'PARTIALLY_ACCEPTED':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-100/80 text-amber-800 border border-amber-300">
            <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
            PARTIALLY ACCEPTED
          </span>
        );
      case 'REJECTED':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-100/80 text-rose-800 border border-rose-300">
            <XCircle className="w-3.5 h-3.5 text-rose-600" />
            REJECTED
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-800 border border-slate-300">
            {classification}
          </span>
        );
    }
  };

  return (
    <div
      id={`comment-card-${result.comment_number}`}
      className="bg-white rounded-xl border border-slate-200 shadow-2xs hover:shadow-sm transition-all duration-200 overflow-hidden"
    >
      {/* Card Header */}
      <div className="p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 flex items-center justify-center font-bold text-xs">
              #{result.comment_number}
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-bold text-slate-900 leading-snug">
                {result.comment_title}
              </h3>
              <div className="flex flex-wrap items-center gap-2 mt-1.5 text-xs text-slate-500">
                {result.referenced_clause && (
                  <span className="inline-flex items-center gap-1 font-medium bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-[11px]">
                    <Layers className="w-3 h-3 text-slate-500" />
                    {result.referenced_clause}
                  </span>
                )}

                {/* Evidence Verification Badge */}
                {result.evidence_verified && (
                  <span className="inline-flex items-center gap-1 font-medium bg-emerald-50 text-emerald-800 border border-emerald-200 px-2 py-0.5 rounded text-[11px]">
                    <ShieldCheck className="w-3 h-3 text-emerald-600" />
                    Verified in Gazette
                    {result.evidence_paragraph_index ? ` (Para #${result.evidence_paragraph_index})` : ''}
                  </span>
                )}

                {result.file_set && (
                  <span className="text-[11px] text-slate-400">
                    Source: {result.file_set}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            {getStatusBadge(result.classification)}
          </div>
        </div>

        {/* Hallucination Warning Banner if present */}
        {result.hallucination_warning && (
          <div className="mt-3 p-2.5 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2 text-xs text-amber-900">
            <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <span className="font-bold">Grounding Notice:</span> {result.hallucination_warning}
            </div>
          </div>
        )}

        {/* Core Comparison Chain Preview */}
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          
          {/* Stakeholder Requested Change */}
          <div className="bg-slate-50/80 rounded-lg p-3 border border-slate-200/70">
            <div className="font-semibold text-slate-700 flex items-center gap-1.5 mb-1 text-[11px] uppercase tracking-wider">
              <span className="w-2 h-2 rounded-full bg-blue-500" />
              Stakeholder Request
            </div>
            <p className="text-slate-800 font-medium line-clamp-3 leading-relaxed">
              {result.requested_change}
            </p>
          </div>

          {/* Final Regulation Outcome */}
          <div className="bg-slate-50/80 rounded-lg p-3 border border-slate-200/70">
            <div className="font-semibold text-slate-700 flex items-center gap-1.5 mb-1 text-[11px] uppercase tracking-wider">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              Final Gazette Decision
            </div>
            <p className="text-slate-800 font-medium line-clamp-3 leading-relaxed">
              {result.final_position}
            </p>
          </div>

        </div>

        {/* Sub-requests breakdown chips */}
        {(result.implemented_requests.length > 0 || result.not_implemented_requests.length > 0) && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {result.implemented_requests.map((req, idx) => (
              <span
                key={`impl-${idx}`}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-50 text-emerald-800 border border-emerald-200/80"
              >
                <Check className="w-3 h-3 text-emerald-600" />
                <span className="truncate max-w-xs">{req}</span>
              </span>
            ))}
            {result.not_implemented_requests.map((req, idx) => (
              <span
                key={`not-impl-${idx}`}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-rose-50 text-rose-800 border border-rose-200/80"
              >
                <X className="w-3 h-3 text-rose-600" />
                <span className="truncate max-w-xs">{req}</span>
              </span>
            ))}
          </div>
        )}

        {/* Expanded Analytical Reasoning & Direct Evidence */}
        {isExpanded && (
          <div className="mt-4 pt-4 border-t border-slate-200 space-y-3.5">
            
            {/* Draft Baseline Position */}
            {result.draft_position && (
              <div className="text-xs bg-amber-50/50 p-3 rounded-lg border border-amber-200/70">
                <span className="font-bold text-amber-900 block mb-1 text-[11px] uppercase tracking-wider">
                  Baseline Draft Position:
                </span>
                <p className="text-slate-800 leading-relaxed">
                  {result.draft_position}
                </p>
              </div>
            )}

            {/* Analytical Reasoning */}
            <div className="text-xs bg-blue-50/40 p-3.5 rounded-lg border border-blue-100">
              <span className="font-bold text-blue-900 flex items-center gap-1.5 mb-1.5 text-[11px] uppercase tracking-wider">
                <Sparkles className="w-3.5 h-3.5 text-blue-600" />
                Comparative Analytical Reasoning:
              </span>
              <p className="text-slate-800 leading-relaxed">
                {result.reasoning}
              </p>
            </div>

            {/* Direct Verbatim Evidence in Final Regulation */}
            <div className="text-xs bg-emerald-50/40 p-3.5 rounded-lg border border-emerald-200/80">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="font-bold text-emerald-900 flex items-center gap-1.5 text-[11px] uppercase tracking-wider">
                  <Quote className="w-3.5 h-3.5 text-emerald-600" />
                  Verbatim Evidence in Final Regulation:
                </span>
                {result.evidence_paragraph_index && onLocateInDoc && (
                  <button
                    onClick={() => onLocateInDoc(result)}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 hover:text-emerald-900 underline"
                  >
                    <MapPin className="w-3 h-3" />
                    Locate in Document (Para #{result.evidence_paragraph_index})
                  </button>
                )}
              </div>
              <blockquote className="italic font-mono text-[11.5px] text-slate-800 bg-white/80 p-2.5 rounded border border-emerald-200/60 leading-relaxed">
                "{result.evidence_in_final}"
              </blockquote>
            </div>

          </div>
        )}

        {/* Footer Actions */}
        <div className="mt-4 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
          <button
            id={`toggle-expand-btn-${result.comment_number}`}
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-900 py-1 transition-colors"
          >
            {isExpanded ? (
              <>
                <ChevronUp className="w-3.5 h-3.5" />
                Collapse Analysis
              </>
            ) : (
              <>
                <ChevronDown className="w-3.5 h-3.5" />
                View Detailed Reasoning & Evidence
              </>
            )}
          </button>

          <div className="flex items-center gap-2">
            {result.evidence_paragraph_index && onLocateInDoc && (
              <button
                id={`locate-doc-btn-${result.comment_number}`}
                onClick={() => onLocateInDoc(result)}
                className="flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 py-1 px-2.5 rounded border border-emerald-200 transition-colors"
              >
                <MapPin className="w-3.5 h-3.5 text-emerald-600" />
                Locate in Gazette
              </button>
            )}

            <button
              id={`inspect-modal-btn-${result.comment_number}`}
              onClick={() => onOpenDetails(result)}
              className="flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800 py-1 px-2 rounded hover:bg-blue-50 transition-colors"
            >
              <FileCheck2 className="w-3.5 h-3.5" />
              Full Audit Modal
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
