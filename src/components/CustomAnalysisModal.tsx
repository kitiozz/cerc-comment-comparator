import React, { useState } from 'react';
import {
  X,
  UploadCloud,
  FileText,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Plus
} from 'lucide-react';
import { CommentAnalysisResult, ParsedComment } from '../types';

interface CustomAnalysisModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRunAnalysis: (
    comments: ParsedComment[],
    draftText: string,
    finalText: string,
    datasetName: string
  ) => Promise<void>;
  isAnalyzing: boolean;
}

export const CustomAnalysisModal: React.FC<CustomAnalysisModalProps> = ({
  isOpen,
  onClose,
  onRunAnalysis,
  isAnalyzing,
}) => {
  const [datasetTitle, setDatasetTitle] = useState('Custom Regulatory Consultation');
  const [draftFile, setDraftFile] = useState<File | null>(null);
  const [finalFile, setFinalFile] = useState<File | null>(null);
  const [commentsFile, setCommentsFile] = useState<File | null>(null);

  const [draftText, setDraftText] = useState('');
  const [finalText, setFinalText] = useState('');
  const [commentInput, setCommentInput] = useState('');
  const [commentQuote, setCommentQuote] = useState('');
  const [commentTitle, setCommentTitle] = useState('');

  const [uploadStatus, setUploadStatus] = useState<string>('');

  if (!isOpen) return null;

  const handleUploadPdf = async (file: File, type: 'draft' | 'final' | 'comments') => {
    setUploadStatus(`Extracting text from ${file.name}...`);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/extract-pdf', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        throw new Error(`Server returned status ${res.status}`);
      }

      const data = await res.json();
      if (type === 'draft') {
        setDraftFile(file);
        setDraftText(data.fullText || '');
      } else if (type === 'final') {
        setFinalFile(file);
        setFinalText(data.fullText || '');
      } else if (type === 'comments') {
        setCommentsFile(file);
        setCommentInput(data.fullText || '');
      }
      setUploadStatus(`Extracted ${data.textLength || 0} characters from ${file.name}`);
    } catch (err: any) {
      console.error(err);
      setUploadStatus(`Error parsing ${file.name}: ${err.message}`);
    }
  };

  const handleStartAnalysis = async (e: React.FormEvent) => {
    e.preventDefault();

    const parsedComments: ParsedComment[] = [];

    if (commentInput.trim()) {
      // Split if multiple comments formatted with numbers
      const commentBlocks = commentInput.split(/(?=\n[1-9]\d{0,2}[.)]\s+)/);

      if (commentBlocks.length > 1) {
        commentBlocks.forEach((block, idx) => {
          const clean = block.trim();
          if (clean.length > 20) {
            const firstLine = clean.split('\n')[0].slice(0, 80);
            parsedComments.push({
              number: idx + 1,
              title: firstLine,
              body: clean,
              draft_quote: commentQuote.trim() || undefined,
              suggestion: clean,
            });
          }
        });
      } else {
        parsedComments.push({
          number: 1,
          title: commentTitle.trim() || 'Custom Stakeholder Recommendation',
          body: commentInput.trim(),
          draft_quote: commentQuote.trim() || undefined,
          suggestion: commentInput.trim(),
        });
      }
    }

    if (parsedComments.length === 0) {
      alert('Please provide at least one stakeholder comment to analyze.');
      return;
    }

    await onRunAnalysis(
      parsedComments,
      draftText.trim(),
      finalText.trim(),
      datasetTitle.trim() || 'Custom Consultation'
    );

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center">
              <UploadCloud className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Analyze Custom Consultation Documents
              </h2>
              <p className="text-xs text-slate-500">
                Upload Draft, Comments & Final PDFs or paste text excerpts directly
              </p>
            </div>
          </div>

          <button
            id="close-upload-modal-btn"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-200/60"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleStartAnalysis} className="p-6 overflow-y-auto space-y-4 text-xs">
          
          {/* Dataset Name */}
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Consultation Title / Agency:
            </label>
            <input
              type="text"
              value={datasetTitle}
              onChange={(e) => setDatasetTitle(e.target.value)}
              placeholder="e.g. CERC Tariff Regulations 2024"
              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 focus:ring-1 focus:ring-blue-500 font-medium"
              required
            />
          </div>

          {/* PDF Upload Buttons */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            
            {/* Draft PDF */}
            <div className="p-3 bg-slate-50 border border-dashed border-slate-300 rounded-xl text-center">
              <span className="font-bold text-slate-700 block mb-1">1. Draft Regulation</span>
              <label className="cursor-pointer inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-slate-200 rounded-md text-[11px] font-semibold text-blue-600 hover:bg-blue-50">
                <UploadCloud className="w-3.5 h-3.5" />
                {draftFile ? 'Replace PDF' : 'Upload Draft PDF'}
                <input
                  type="file"
                  accept=".pdf"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleUploadPdf(f, 'draft');
                  }}
                />
              </label>
              {draftFile && (
                <div className="mt-1 text-[10px] text-emerald-700 truncate font-mono">
                  {draftFile.name}
                </div>
              )}
            </div>

            {/* Comments PDF */}
            <div className="p-3 bg-slate-50 border border-dashed border-slate-300 rounded-xl text-center">
              <span className="font-bold text-slate-700 block mb-1">2. Comments PDF</span>
              <label className="cursor-pointer inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-slate-200 rounded-md text-[11px] font-semibold text-blue-600 hover:bg-blue-50">
                <UploadCloud className="w-3.5 h-3.5" />
                {commentsFile ? 'Replace PDF' : 'Upload Comments PDF'}
                <input
                  type="file"
                  accept=".pdf"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleUploadPdf(f, 'comments');
                  }}
                />
              </label>
              {commentsFile && (
                <div className="mt-1 text-[10px] text-emerald-700 truncate font-mono">
                  {commentsFile.name}
                </div>
              )}
            </div>

            {/* Final PDF */}
            <div className="p-3 bg-slate-50 border border-dashed border-slate-300 rounded-xl text-center">
              <span className="font-bold text-slate-700 block mb-1">3. Final Gazette PDF</span>
              <label className="cursor-pointer inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-slate-200 rounded-md text-[11px] font-semibold text-blue-600 hover:bg-blue-50">
                <UploadCloud className="w-3.5 h-3.5" />
                {finalFile ? 'Replace PDF' : 'Upload Final PDF'}
                <input
                  type="file"
                  accept=".pdf"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleUploadPdf(f, 'final');
                  }}
                />
              </label>
              {finalFile && (
                <div className="mt-1 text-[10px] text-emerald-700 truncate font-mono">
                  {finalFile.name}
                </div>
              )}
            </div>

          </div>

          {uploadStatus && (
            <div className="text-[11px] text-blue-700 bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-200">
              {uploadStatus}
            </div>
          )}

          {/* Stakeholder Suggestion Input Area */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="font-semibold text-slate-700">
                Stakeholder Comment / Recommendation Text:
              </label>
              <span className="text-[11px] text-slate-400">
                (Type or edit extracted comment)
              </span>
            </div>
            <input
              type="text"
              value={commentTitle}
              onChange={(e) => setCommentTitle(e.target.value)}
              placeholder="Comment Subject / Clause Reference (Optional)"
              className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-800 mb-2"
            />
            <textarea
              rows={4}
              value={commentInput}
              onChange={(e) => setCommentInput(e.target.value)}
              placeholder="Enter the specific regulatory recommendation made by the stakeholder..."
              className="w-full p-3 bg-white border border-slate-200 rounded-lg text-slate-800 font-sans leading-relaxed focus:ring-1 focus:ring-blue-500"
              required
            />
          </div>

          {/* Draft Clause Reference Excerpt */}
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Referenced Draft Clause Excerpt (Optional Context):
            </label>
            <textarea
              rows={2}
              value={commentQuote || draftText.slice(0, 300)}
              onChange={(e) => setCommentQuote(e.target.value)}
              placeholder="The clause in the draft regulation that this comment references..."
              className="w-full p-2.5 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs"
            />
          </div>

          {/* Final Regulation Excerpt */}
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Final Regulation Excerpt (for comparison verification):
            </label>
            <textarea
              rows={3}
              value={finalText}
              onChange={(e) => setFinalText(e.target.value)}
              placeholder="Text from the published final gazette notification..."
              className="w-full p-2.5 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs font-mono"
            />
          </div>

          {/* Submit */}
          <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isAnalyzing}
              className="flex items-center gap-1.5 px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold shadow-xs disabled:opacity-50"
            >
              {isAnalyzing ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Running AI Evaluation...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Run AI Comparison
                </>
              )}
            </button>
          </div>

        </form>

      </div>
    </div>
  );
};
