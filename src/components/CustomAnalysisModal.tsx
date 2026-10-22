import React, { useState, useEffect } from 'react';
import {
  X,
  UploadCloud,
  FileText,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Plus,
  Trash2,
  Edit3,
  BookOpen,
  FileCheck,
  Layers,
  ArrowRight,
  Database,
  Info
} from 'lucide-react';
import { ParsedComment } from '../types';
import { parseCommentsFromText } from '../services/commentParser';

interface CustomAnalysisModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRunAnalysis: (
    comments: ParsedComment[],
    draftText: string,
    finalText: string,
    datasetName: string,
    draftFileName?: string,
    finalFileName?: string
  ) => Promise<void>;
  isAnalyzing: boolean;
  currentDraftText?: string;
  currentFinalText?: string;
}

export const CustomAnalysisModal: React.FC<CustomAnalysisModalProps> = ({
  isOpen,
  onClose,
  onRunAnalysis,
  isAnalyzing,
  currentDraftText = '',
  currentFinalText = '',
}) => {
  const [activeTab, setActiveTab] = useState<'upload' | 'comments' | 'text' | 'repo'>('upload');
  const [datasetTitle, setDatasetTitle] = useState('Custom Regulatory Consultation');

  // File States
  const [draftFile, setDraftFile] = useState<File | null>(null);
  const [commentsFile, setCommentsFile] = useState<File | null>(null);
  const [finalFile, setFinalFile] = useState<File | null>(null);

  // File Names
  const [draftFileName, setDraftFileName] = useState('draft.pdf');
  const [commentsFileName, setCommentsFileName] = useState('comments.pdf');
  const [finalFileName, setFinalFileName] = useState('final.pdf');

  // Extracted Text States
  const [draftText, setDraftText] = useState(currentDraftText);
  const [commentsRawText, setCommentsRawText] = useState('');
  const [finalText, setFinalText] = useState(currentFinalText);

  // Parsed Comments
  const [parsedComments, setParsedComments] = useState<ParsedComment[]>([]);

  // Editing state for an individual comment in preview list
  const [editingCommentIndex, setEditingCommentIndex] = useState<number | null>(null);

  // Status and extraction loading
  const [isExtracting, setIsExtracting] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Repository files availability
  const [repoLoading, setRepoLoading] = useState(false);

  // Sync current text if initial props change
  useEffect(() => {
    if (currentDraftText && !draftText) setDraftText(currentDraftText);
    if (currentFinalText && !finalText) setFinalText(currentFinalText);
  }, [currentDraftText, currentFinalText]);

  if (!isOpen) return null;

  // Handle single file upload & extraction
  const handleFileUpload = async (file: File, type: 'draft' | 'comments' | 'final') => {
    setIsExtracting(type);
    setStatusMessage(`Extracting text from ${file.name}...`);
    setErrorMessage(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/extract-document', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        throw new Error(`Server returned HTTP ${res.status}`);
      }

      const data = await res.json();
      const text = data.fullText || '';

      if (type === 'draft') {
        setDraftFile(file);
        setDraftFileName(file.name);
        setDraftText(text);
        setStatusMessage(`✔ Extracted Draft: ${data.paragraphs?.length || 0} clauses (${Math.round(text.length / 1024)} KB)`);
      } else if (type === 'final') {
        setFinalFile(file);
        setFinalFileName(file.name);
        setFinalText(text);
        setStatusMessage(`✔ Extracted Final Gazette: ${data.paragraphs?.length || 0} statements (${Math.round(text.length / 1024)} KB)`);
      } else if (type === 'comments') {
        setCommentsFile(file);
        setCommentsFileName(file.name);
        setCommentsRawText(text);
        const comments = parseCommentsFromText(text);
        setParsedComments(comments);
        setStatusMessage(`✔ Extracted Comments: Identified ${comments.length} stakeholder submission(s)`);
        // If comments found, auto-switch to comments tab to let user review
        if (comments.length > 0) {
          setActiveTab('comments');
        }
      }
    } catch (err: any) {
      console.error(err);
      setErrorMessage(`Failed to extract ${file.name}: ${err.message}`);
    } finally {
      setIsExtracting(null);
    }
  };

  // One-click load pre-existing repository files (comments.pdf, draft.pdf, final.pdf)
  const handleLoadRepoFiles = async () => {
    setRepoLoading(true);
    setStatusMessage('Reading repository files (comments.pdf, draft.pdf, final.pdf)...');
    setErrorMessage(null);

    try {
      const res = await fetch('/api/load-repo-files');
      if (!res.ok) throw new Error('Failed to read repository files');
      const data = await res.json();

      if (data.draft) {
        setDraftText(data.draft.fullText);
        setDraftFileName('draft.pdf');
      }
      if (data.final) {
        setFinalText(data.final.fullText);
        setFinalFileName('final.pdf');
      }
      if (data.comments) {
        setCommentsRawText(data.comments.fullText);
        setCommentsFileName('comments.pdf');
        const comments = parseCommentsFromText(data.comments.fullText);
        setParsedComments(comments);
      }

      setDatasetTitle('Repository Consultation (HPERC DSM Benchmark)');
      setStatusMessage('✔ Successfully loaded comments.pdf, draft.pdf, and final.pdf from workspace!');
      setActiveTab('comments');
    } catch (err: any) {
      setErrorMessage(`Error loading repository files: ${err.message}`);
    } finally {
      setRepoLoading(false);
    }
  };

  // Add a new blank comment manually
  const handleAddComment = () => {
    const newNum = parsedComments.length + 1;
    setParsedComments((prev) => [
      ...prev,
      {
        number: newNum,
        title: `Comment #${newNum}`,
        body: '',
        suggestion: '',
      },
    ]);
    setEditingCommentIndex(parsedComments.length);
  };

  // Remove a comment
  const handleRemoveComment = (index: number) => {
    setParsedComments((prev) =>
      prev
        .filter((_, idx) => idx !== index)
        .map((c, idx) => ({ ...c, number: idx + 1 }))
    );
  };

  // Update a comment field
  const handleUpdateComment = (index: number, field: keyof ParsedComment, value: string) => {
    setParsedComments((prev) =>
      prev.map((c, idx) => {
        if (idx !== index) return c;
        return { ...c, [field]: value };
      })
    );
  };

  // When comments raw text is edited manually in text tab
  const handleReparseFromText = (text: string) => {
    setCommentsRawText(text);
    const parsed = parseCommentsFromText(text);
    setParsedComments(parsed);
  };

  // Run the analysis
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!finalText.trim()) {
      alert('Please provide the Final Gazette Regulation (file or text). This is required for evidence matching.');
      setActiveTab('upload');
      return;
    }

    if (parsedComments.length === 0) {
      if (commentsRawText.trim()) {
        const parsed = parseCommentsFromText(commentsRawText);
        if (parsed.length > 0) {
          setParsedComments(parsed);
          await onRunAnalysis(
            parsed,
            draftText.trim(),
            finalText.trim(),
            datasetTitle.trim() || 'Custom Consultation',
            draftFileName,
            finalFileName
          );
          onClose();
          return;
        }
      }
      alert('Please upload or input at least one stakeholder comment to analyze.');
      setActiveTab('upload');
      return;
    }

    await onRunAnalysis(
      parsedComments,
      draftText.trim(),
      finalText.trim(),
      datasetTitle.trim() || 'Custom Consultation',
      draftFileName,
      finalFileName
    );

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
      <div className="bg-white rounded-2xl max-w-4xl w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]">
        
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-xs">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-900">
                Input Consultation Documents
              </h2>
              <p className="text-xs text-slate-500">
                Input your custom Final Gazette, Comments file, and Draft regulation to perform comparative analysis
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-200/60 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-1 border-b border-slate-200 px-4 sm:px-6 bg-white overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab('upload')}
            className={`flex items-center gap-1.5 py-3 px-3 text-xs font-semibold border-b-2 transition-all whitespace-nowrap ${
              activeTab === 'upload'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <UploadCloud className="w-4 h-4" />
            Upload 3 Files (Draft, Comments, Final)
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('comments')}
            className={`flex items-center gap-1.5 py-3 px-3 text-xs font-semibold border-b-2 transition-all whitespace-nowrap ${
              activeTab === 'comments'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <FileText className="w-4 h-4" />
            Review Comments
            {parsedComments.length > 0 && (
              <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700">
                {parsedComments.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('text')}
            className={`flex items-center gap-1.5 py-3 px-3 text-xs font-semibold border-b-2 transition-all whitespace-nowrap ${
              activeTab === 'text'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Edit3 className="w-4 h-4" />
            Paste / Edit Raw Text
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('repo')}
            className={`flex items-center gap-1.5 py-3 px-3 text-xs font-semibold border-b-2 transition-all whitespace-nowrap ${
              activeTab === 'repo'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Database className="w-4 h-4" />
            Bundled Files Preset
          </button>
        </div>

        {/* Notification Banners */}
        {statusMessage && (
          <div className="bg-emerald-50 border-b border-emerald-100 px-5 py-2 text-xs font-medium text-emerald-800 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              {statusMessage}
            </span>
            <button
              onClick={() => setStatusMessage(null)}
              className="text-emerald-500 hover:text-emerald-700 text-xs ml-2"
            >
              ✕
            </button>
          </div>
        )}

        {errorMessage && (
          <div className="bg-rose-50 border-b border-rose-100 px-5 py-2 text-xs font-medium text-rose-800 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
              {errorMessage}
            </span>
            <button
              onClick={() => setErrorMessage(null)}
              className="text-rose-500 hover:text-rose-700 text-xs ml-2"
            >
              ✕
            </button>
          </div>
        )}

        {/* Content Body */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-5 text-xs">
          
          {/* Title Field */}
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Case Study / Consultation Name:
            </label>
            <input
              type="text"
              value={datasetTitle}
              onChange={(e) => setDatasetTitle(e.target.value)}
              placeholder="e.g. CERC Deviation Settlement Regulations 2024"
              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 focus:ring-1 focus:ring-blue-500 text-xs font-medium"
              required
            />
          </div>

          {/* TAB 1: 3-DOCUMENT UPLOAD WORKSPACE */}
          {activeTab === 'upload' && (
            <div className="space-y-4">
              <div className="bg-blue-50/70 border border-blue-200 rounded-xl p-3 flex items-start gap-2.5 text-blue-900">
                <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                <p className="text-xs leading-relaxed">
                  Upload your 3 regulatory documents in PDF or TXT format. The comparator matches the semantic recommendations from the <strong>Comments file</strong> directly against the provisions in the <strong>Final Gazette</strong>, with the <strong>Draft file</strong> providing baseline clause context.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
                
                {/* 1. Draft Regulation Dropzone */}
                <div className="border border-slate-200 rounded-xl p-4 bg-slate-50 flex flex-col justify-between hover:border-slate-300 transition-colors">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-bold text-slate-800 text-xs flex items-center gap-1.5">
                        <span className="w-4 h-4 rounded-full bg-slate-200 text-slate-700 text-[10px] flex items-center justify-center font-bold">1</span>
                        Draft Regulation
                      </span>
                      <span className="text-[10px] text-slate-400">Context</span>
                    </div>
                    <p className="text-[11px] text-slate-500 mb-3">
                      The baseline consultation draft published for public feedback.
                    </p>
                  </div>

                  <div className="space-y-2">
                    {draftText ? (
                      <div className="bg-white p-2.5 rounded-lg border border-emerald-200 text-emerald-800 space-y-1">
                        <div className="font-semibold text-xs truncate flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          {draftFileName}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          {Math.round(draftText.length / 1024)} KB loaded • {draftText.split('\n\n').filter(Boolean).length} sections
                        </div>
                      </div>
                    ) : (
                      <div className="bg-white/60 p-2.5 rounded-lg border border-dashed border-slate-300 text-center text-slate-400 text-[11px]">
                        No draft file loaded
                      </div>
                    )}

                    <label className="cursor-pointer flex items-center justify-center gap-1.5 px-3 py-2 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg text-xs font-semibold text-slate-700 transition-colors">
                      <UploadCloud className="w-3.5 h-3.5 text-blue-600" />
                      {isExtracting === 'draft' ? 'Extracting...' : draftText ? 'Replace Draft File' : 'Upload Draft (.pdf, .txt)'}
                      <input
                        type="file"
                        accept=".pdf,.txt,.md,.csv,.json"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleFileUpload(f, 'draft');
                        }}
                      />
                    </label>
                  </div>
                </div>

                {/* 2. Stakeholder Comments Dropzone */}
                <div className="border-2 border-blue-200 rounded-xl p-4 bg-blue-50/30 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-bold text-blue-900 text-xs flex items-center gap-1.5">
                        <span className="w-4 h-4 rounded-full bg-blue-600 text-white text-[10px] flex items-center justify-center font-bold">2</span>
                        Stakeholder Comments
                      </span>
                      <span className="text-[10px] font-bold text-blue-600 bg-blue-100 px-1.5 py-0.2 rounded">Core Input</span>
                    </div>
                    <p className="text-[11px] text-slate-500 mb-3">
                      Submissions, recommendations, and requested clause modifications.
                    </p>
                  </div>

                  <div className="space-y-2">
                    {parsedComments.length > 0 ? (
                      <div className="bg-white p-2.5 rounded-lg border border-blue-300 text-blue-900 space-y-1">
                        <div className="font-semibold text-xs truncate flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                          {commentsFileName}
                        </div>
                        <div className="text-[10px] text-blue-700 font-semibold flex items-center justify-between">
                          <span>{parsedComments.length} comment(s) parsed</span>
                          <button
                            type="button"
                            onClick={() => setActiveTab('comments')}
                            className="underline hover:text-blue-900"
                          >
                            Review →
                          </button>
                        </div>
                      </div>
                    ) : commentsRawText ? (
                      <div className="bg-white p-2.5 rounded-lg border border-slate-200 text-slate-700 text-[11px] truncate">
                        {commentsFileName} loaded ({Math.round(commentsRawText.length / 1024)} KB)
                      </div>
                    ) : (
                      <div className="bg-white/60 p-2.5 rounded-lg border border-dashed border-blue-200 text-center text-slate-400 text-[11px]">
                        No comments file loaded
                      </div>
                    )}

                    <label className="cursor-pointer flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors">
                      <UploadCloud className="w-3.5 h-3.5" />
                      {isExtracting === 'comments' ? 'Extracting...' : parsedComments.length > 0 ? 'Replace Comments File' : 'Upload Comments (.pdf, .txt)'}
                      <input
                        type="file"
                        accept=".pdf,.txt,.md,.csv,.json"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleFileUpload(f, 'comments');
                        }}
                      />
                    </label>
                  </div>
                </div>

                {/* 3. Final Gazette Dropzone */}
                <div className="border border-slate-200 rounded-xl p-4 bg-slate-50 flex flex-col justify-between hover:border-slate-300 transition-colors">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-bold text-slate-800 text-xs flex items-center gap-1.5">
                        <span className="w-4 h-4 rounded-full bg-slate-200 text-slate-700 text-[10px] flex items-center justify-center font-bold">3</span>
                        Final Gazette
                      </span>
                      <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-200">Evidence</span>
                    </div>
                    <p className="text-[11px] text-slate-500 mb-3">
                      The official enacted notification published in the Gazette of India.
                    </p>
                  </div>

                  <div className="space-y-2">
                    {finalText ? (
                      <div className="bg-white p-2.5 rounded-lg border border-emerald-200 text-emerald-800 space-y-1">
                        <div className="font-semibold text-xs truncate flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          {finalFileName}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          {Math.round(finalText.length / 1024)} KB loaded • {finalText.split('\n\n').filter(Boolean).length} statements
                        </div>
                      </div>
                    ) : (
                      <div className="bg-white/60 p-2.5 rounded-lg border border-dashed border-slate-300 text-center text-slate-400 text-[11px]">
                        No final gazette loaded
                      </div>
                    )}

                    <label className="cursor-pointer flex items-center justify-center gap-1.5 px-3 py-2 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg text-xs font-semibold text-slate-700 transition-colors">
                      <UploadCloud className="w-3.5 h-3.5 text-blue-600" />
                      {isExtracting === 'final' ? 'Extracting...' : finalText ? 'Replace Final Gazette' : 'Upload Final Gazette (.pdf, .txt)'}
                      <input
                        type="file"
                        accept=".pdf,.txt,.md,.csv,.json"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleFileUpload(f, 'final');
                        }}
                      />
                    </label>
                  </div>
                </div>

              </div>

              {/* Quick load shortcut */}
              <div className="pt-2 flex items-center justify-between text-xs text-slate-500 border-t border-slate-100">
                <span>Want to test with the project files?</span>
                <button
                  type="button"
                  onClick={handleLoadRepoFiles}
                  disabled={repoLoading}
                  className="font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-1"
                >
                  <Database className="w-3.5 h-3.5" />
                  {repoLoading ? 'Loading repository files...' : 'Load comments.pdf, draft.pdf, final.pdf from workspace'}
                </button>
              </div>
            </div>
          )}

          {/* TAB 2: REVIEW & EDIT EXTRACTED COMMENTS */}
          {activeTab === 'comments' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-slate-800 text-xs">
                    Extracted Stakeholder Comments ({parsedComments.length})
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Each item will be individually verified against candidate statements in the Final Gazette.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleAddComment}
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg font-semibold hover:bg-blue-100 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Another Comment
                </button>
              </div>

              {parsedComments.length === 0 ? (
                <div className="p-8 text-center bg-slate-50 border border-dashed border-slate-300 rounded-xl space-y-2">
                  <FileText className="w-8 h-8 text-slate-400 mx-auto" />
                  <p className="text-slate-600 font-semibold text-xs">
                    No comments parsed yet
                  </p>
                  <p className="text-slate-400 text-[11px]">
                    Upload a comments file on the "Upload 3 Files" tab or paste text in the "Paste / Edit Raw Text" tab.
                  </p>
                  <button
                    type="button"
                    onClick={handleAddComment}
                    className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded-lg font-semibold text-xs mt-2"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Create Comment Manually
                  </button>
                </div>
              ) : (
                <div className="space-y-3 max-h-[46vh] overflow-y-auto pr-1">
                  {parsedComments.map((comment, idx) => (
                    <div
                      key={idx}
                      className="p-3.5 bg-white border border-slate-200 rounded-xl space-y-2 hover:border-slate-300 transition-all shadow-2xs"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 flex-1">
                          <span className="w-5 h-5 rounded-md bg-blue-100 text-blue-700 text-xs flex items-center justify-center font-bold shrink-0">
                            #{comment.number}
                          </span>
                          <input
                            type="text"
                            value={comment.title}
                            onChange={(e) => handleUpdateComment(idx, 'title', e.target.value)}
                            placeholder="Comment Title / Subject..."
                            className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded text-xs font-semibold text-slate-800"
                          />
                        </div>

                        <button
                          type="button"
                          onClick={() => handleRemoveComment(idx)}
                          className="text-slate-400 hover:text-rose-600 p-1 rounded transition-colors"
                          title="Remove comment"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Recommendation text */}
                      <div>
                        <label className="text-[10px] font-semibold text-slate-500 uppercase block mb-0.5">
                          Stakeholder Recommendation / Requested Change:
                        </label>
                        <textarea
                          rows={2}
                          value={comment.suggestion || comment.body}
                          onChange={(e) => handleUpdateComment(idx, 'suggestion', e.target.value)}
                          placeholder="Exact suggestion or request to match against final text..."
                          className="w-full p-2 bg-slate-50 border border-slate-200 rounded text-xs text-slate-800 leading-relaxed font-sans"
                        />
                      </div>

                      {/* Draft quote */}
                      <div>
                        <label className="text-[10px] font-semibold text-slate-500 uppercase block mb-0.5">
                          Draft Clause Reference (Context Baseline):
                        </label>
                        <input
                          type="text"
                          value={comment.draft_quote || ''}
                          onChange={(e) => handleUpdateComment(idx, 'draft_quote', e.target.value)}
                          placeholder="e.g. Clause 5.2 / Annexure-I (Optional)"
                          className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded text-[11px] text-slate-700 font-mono"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: PASTE RAW TEXT */}
          {activeTab === 'text' && (
            <div className="space-y-4">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  1. Stakeholder Comments Text (auto-parsed into comments):
                </label>
                <textarea
                  rows={4}
                  value={commentsRawText}
                  onChange={(e) => handleReparseFromText(e.target.value)}
                  placeholder="Paste raw text from stakeholder comments document here. Numbered points (e.g. 1., 2.) will be parsed into distinct comments."
                  className="w-full p-2.5 bg-white border border-slate-200 rounded-lg text-slate-800 font-sans text-xs"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  2. Final Gazette Notification Text (Candidate evidence corpus):
                </label>
                <textarea
                  rows={4}
                  value={finalText}
                  onChange={(e) => setFinalText(e.target.value)}
                  placeholder="Paste verbatim statements or full text of the Final Gazette Regulation..."
                  className="w-full p-2.5 bg-white border border-slate-200 rounded-lg text-slate-800 font-mono text-xs"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  3. Draft Regulation Text (Optional baseline context):
                </label>
                <textarea
                  rows={3}
                  value={draftText}
                  onChange={(e) => setDraftText(e.target.value)}
                  placeholder="Paste text of the initial draft regulation..."
                  className="w-full p-2.5 bg-white border border-slate-200 rounded-lg text-slate-800 font-sans text-xs"
                />
              </div>
            </div>
          )}

          {/* TAB 4: BUNDLED FILES PRESET */}
          {activeTab === 'repo' && (
            <div className="space-y-4">
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                <div className="flex items-center gap-2 text-slate-800 font-bold">
                  <Database className="w-4 h-4 text-blue-600" />
                  Workspace Repository Benchmark Dataset
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  The application has bundled PDF copies of <strong>comments.pdf</strong>, <strong>draft.pdf</strong>, and <strong>final.pdf</strong> corresponding to the real Himachal Pradesh / Central electricity regulatory consultation benchmarks.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                  <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                    <div className="font-semibold text-slate-800">draft.pdf</div>
                    <div className="text-[10px] text-slate-500">Draft Amendment Regulations</div>
                  </div>
                  <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                    <div className="font-semibold text-slate-800">comments.pdf</div>
                    <div className="text-[10px] text-slate-500">5 Stakeholder Submissions</div>
                  </div>
                  <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                    <div className="font-semibold text-slate-800">final.pdf</div>
                    <div className="text-[10px] text-slate-500">Final Gazette Notification</div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleLoadRepoFiles}
                  disabled={repoLoading}
                  className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold text-xs transition-colors shadow-xs"
                >
                  {repoLoading ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      Loading & Parsing Files...
                    </>
                  ) : (
                    <>
                      <FileCheck className="w-3.5 h-3.5" />
                      Load & Compare Repository Files
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Submit Action Bar */}
          <div className="pt-3 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="text-[11px] text-slate-500 flex items-center gap-2">
              <span>Ready to analyze:</span>
              <span className="font-semibold text-slate-700">
                {parsedComments.length} comment{parsedComments.length === 1 ? '' : 's'}
              </span>
              <span>•</span>
              <span className="font-semibold text-slate-700">
                {finalText ? `${Math.round(finalText.length / 1024)} KB Final Gazette` : 'No Final Gazette'}
              </span>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-semibold transition-colors text-xs"
              >
                Cancel
              </button>

              <button
                type="submit"
                disabled={isAnalyzing || !finalText || (parsedComments.length === 0 && !commentsRawText)}
                className="flex items-center justify-center gap-1.5 px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold text-xs shadow-xs disabled:opacity-50 transition-colors"
              >
                {isAnalyzing ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Running AI Comparison...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    Run Comparative Analysis
                  </>
                )}
              </button>
            </div>
          </div>

        </form>

      </div>
    </div>
  );
};
