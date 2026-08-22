import React, { useState } from 'react';
import {
  X,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Quote,
  Check,
  Scale,
  Sparkles,
  Layers,
  Copy,
  FileSpreadsheet,
  ShieldCheck,
  MapPin,
  AlertTriangle
} from 'lucide-react';
import { CommentAnalysisResult } from '../types';

interface CommentDetailsModalProps {
  result: CommentAnalysisResult | null;
  onClose: () => void;
  onLocateInDoc?: (result: CommentAnalysisResult) => void;
}

export const CommentDetailsModal: React.FC<CommentDetailsModalProps> = ({
  result,
  onClose,
  onLocateInDoc,
}) => {
  const [copied, setCopied] = useState(false);

  if (!result) return null;

  const handleCopySummary = () => {
    const text = `
=== REGULATORY COMMENT AUDIT REPORT ===
Comment #${result.comment_number}: ${result.comment_title}
Status: ${result.classification}
Referenced Clause: ${result.referenced_clause || 'N/A'}
Evidence Verification: ${result.evidence_verified ? `VERIFIED IN GAZETTE (${result.evidence_match_confidence || 100}% MATCH)` : 'UNVERIFIED'}
Gazette Location: ${result.evidence_paragraph_index ? `Paragraph #${result.evidence_paragraph_index}` : 'N/A'}

1. DRAFT POSITION:
${result.draft_position}

2. STAKEHOLDER REQUESTED CHANGE:
${result.requested_change}

3. FINAL REGULATION POSITION:
${result.final_position}

4. IMPLEMENTATION BREAKDOWN:
- Implemented: ${result.implemented_requests.join(', ') || 'None'}
- Not Implemented: ${result.not_implemented_requests.join(', ') || 'None'}

5. ANALYTICAL REASONING:
${result.reasoning}

6. VERBATIM EVIDENCE IN FINAL GAZETTE:
"${result.evidence_in_final}"
    `.trim();

    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleLocate = () => {
    if (onLocateInDoc && result) {
      onClose();
      onLocateInDoc(result);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-3xl w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Modal Header */}
        <div className="p-5 border-b border-slate-200 flex items-start justify-between bg-slate-50/80">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center font-bold text-sm shadow-xs">
              #{result.comment_number}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base sm:text-lg font-bold text-slate-900">
                  {result.comment_title}
                </h2>
                <span
                  className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold ${
                    result.classification === 'ACCEPTED'
                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                      : result.classification === 'PARTIALLY_ACCEPTED'
                      ? 'bg-amber-100 text-amber-800 border border-amber-300'
                      : 'bg-rose-100 text-rose-800 border border-rose-300'
                  }`}
                >
                  {result.classification === 'ACCEPTED' && <CheckCircle2 className="w-3.5 h-3.5" />}
                  {result.classification === 'PARTIALLY_ACCEPTED' && <AlertCircle className="w-3.5 h-3.5" />}
                  {result.classification === 'REJECTED' && <XCircle className="w-3.5 h-3.5" />}
                  {result.classification}
                </span>

                {/* Evidence Verified Tag */}
                {result.evidence_verified && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-300">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                    Verified Evidence ({result.evidence_match_confidence || 100}% Verbatim Match)
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                <span>Clause: <strong>{result.referenced_clause || 'General Regulation'}</strong></span>
                {result.file_set && <span>Document: {result.file_set}</span>}
              </div>
            </div>
          </div>

          <button
            id="close-modal-btn"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-200/60 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-5 text-sm">
          
          {/* Hallucination / Grounding Notice */}
          {result.hallucination_warning && (
            <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2.5 text-xs text-amber-900">
              <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <span className="font-bold">Anti-Hallucination Grounding Notice:</span>
                <p className="mt-0.5 leading-relaxed">{result.hallucination_warning}</p>
              </div>
            </div>
          )}

          {/* Step 1 & 2: Draft vs Stakeholder Recommendation */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            
            <div className="bg-amber-50/50 rounded-xl p-4 border border-amber-200/80">
              <span className="text-xs font-bold text-amber-900 uppercase tracking-wider block mb-1.5">
                1. Draft Baseline Position
              </span>
              <p className="text-slate-800 leading-relaxed text-xs sm:text-sm">
                {result.draft_position}
              </p>
            </div>

            <div className="bg-blue-50/50 rounded-xl p-4 border border-blue-200/80">
              <span className="text-xs font-bold text-blue-900 uppercase tracking-wider block mb-1.5">
                2. Stakeholder Recommendation
              </span>
              <p className="text-slate-800 leading-relaxed text-xs sm:text-sm font-medium">
                {result.requested_change}
              </p>
            </div>

          </div>

          {/* Step 3: Final Gazette Position */}
          <div className="bg-emerald-50/50 rounded-xl p-4 border border-emerald-200/80">
            <span className="text-xs font-bold text-emerald-900 uppercase tracking-wider block mb-1.5">
              3. Final Regulation Outcome
            </span>
            <p className="text-slate-800 leading-relaxed text-xs sm:text-sm">
              {result.final_position}
            </p>
          </div>

          {/* Step 4: Specific Request Breakdown */}
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
            <span className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-2">
              4. Specific Request Breakdown
            </span>
            <div className="space-y-2">
              {result.implemented_requests.length > 0 && (
                <div>
                  <span className="text-xs font-semibold text-emerald-700 block mb-1">
                    Adopted in Final Gazette:
                  </span>
                  <ul className="space-y-1">
                    {result.implemented_requests.map((item, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-xs text-slate-800">
                        <Check className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {result.not_implemented_requests.length > 0 && (
                <div className="mt-2">
                  <span className="text-xs font-semibold text-rose-700 block mb-1">
                    Rejected / Omitted:
                  </span>
                  <ul className="space-y-1">
                    {result.not_implemented_requests.map((item, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-xs text-slate-800">
                        <X className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {result.implemented_requests.length === 0 && result.not_implemented_requests.length === 0 && (
                <p className="text-xs text-slate-500 italic">No itemized sub-requests specified.</p>
              )}
            </div>
          </div>

          {/* Step 5: Analytical Reasoning */}
          <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-2xs">
            <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5 mb-2">
              <Sparkles className="w-4 h-4 text-blue-600" />
              5. Analytical Reasoning & Verification Matrix
            </span>
            <p className="text-slate-800 leading-relaxed text-xs sm:text-sm">
              {result.reasoning}
            </p>
          </div>

          {/* Step 6: Evidence Provenance & Location */}
          <div className="bg-slate-900 text-slate-100 rounded-xl p-4 border border-slate-800 shadow-inner">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                <Quote className="w-4 h-4 text-emerald-400" />
                6. Direct Gazette Citation & Source Provenance
              </span>

              {result.evidence_paragraph_index && onLocateInDoc && (
                <button
                  id="modal-locate-btn"
                  onClick={handleLocate}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-md transition-colors"
                >
                  <MapPin className="w-3.5 h-3.5" />
                  Locate Paragraph #{result.evidence_paragraph_index} in Document Viewer
                </button>
              )}
            </div>

            {result.evidence_source_clause && (
              <div className="text-[11px] text-slate-400 mb-2 font-mono">
                Clause Heading: <span className="text-slate-200">{result.evidence_source_clause}</span>
                {result.evidence_paragraph_index && (
                  <span className="ml-2 px-1.5 py-0.5 rounded bg-slate-800 text-emerald-400 border border-slate-700">
                    Paragraph #{result.evidence_paragraph_index}
                  </span>
                )}
              </div>
            )}

            <blockquote className="font-mono text-xs text-slate-200 bg-slate-800/80 p-3 rounded-lg border border-slate-700 leading-relaxed">
              "{result.evidence_in_final}"
            </blockquote>
          </div>

        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-slate-200 flex items-center justify-between bg-slate-50/80">
          <button
            id="copy-audit-summary-btn"
            onClick={handleCopySummary}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-700 transition-colors shadow-2xs"
          >
            {copied ? (
              <>
                <Check className="w-4 h-4 text-emerald-600" />
                Copied Report!
              </>
            ) : (
              <>
                <Copy className="w-4 h-4 text-slate-600" />
                Copy Audit Section
              </>
            )}
          </button>

          <button
            id="close-modal-footer-btn"
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-semibold transition-colors"
          >
            Close Inspector
          </button>
        </div>

      </div>
    </div>
  );
};
