import React, { useState, useMemo } from 'react';
import {
  Search,
  Filter,
  Layers,
  Sparkles,
  RefreshCw,
  SlidersHorizontal,
  Info,
  Scale,
  CheckCircle2,
  AlertCircle,
  XCircle,
  FileText
} from 'lucide-react';
import { Header } from './components/Header';
import { SummaryCards } from './components/SummaryCards';
import { CommentCard } from './components/CommentCard';
import { CommentDetailsModal } from './components/CommentDetailsModal';
import { DocumentViewer } from './components/DocumentViewer';
import { CustomAnalysisModal } from './components/CustomAnalysisModal';
import { ExportMenu } from './components/ExportMenu';
import { SAMPLE_DATASETS } from './data/sampleDataset';
import {
  CommentAnalysisResult,
  ClassificationType,
  ComparisonDataset,
  ParsedComment,
  AnalysisSummary,
} from './types';

export default function App() {
  const [datasets, setDatasets] = useState<ComparisonDataset[]>(SAMPLE_DATASETS);
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>(SAMPLE_DATASETS[0].id);

  const [activeTab, setActiveTab] = useState<'results' | 'documents' | 'diff'>('results');
  const [selectedFilter, setSelectedFilter] = useState<ClassificationType | 'ALL'>('ALL');
  const [searchTerm, setSearchTerm] = useState<string>('');

  const [selectedModalResult, setSelectedModalResult] = useState<CommentAnalysisResult | null>(null);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Evidence citation focus state for DocumentViewer
  const [highlightParagraphIndex, setHighlightParagraphIndex] = useState<number | null>(null);
  const [highlightText, setHighlightText] = useState<string | null>(null);
  const [highlightCommentNumber, setHighlightCommentNumber] = useState<number | null>(null);

  // Handler to locate exact paragraph in document viewer
  const handleLocateInDoc = (result: CommentAnalysisResult) => {
    if (result.evidence_paragraph_index) {
      setHighlightParagraphIndex(result.evidence_paragraph_index);
      setHighlightText(result.evidence_in_final);
      setHighlightCommentNumber(result.comment_number);
      setActiveTab('documents');
    }
  };

  // Currently active dataset
  const activeDataset = useMemo(() => {
    return datasets.find((d) => d.id === selectedDatasetId) || datasets[0];
  }, [datasets, selectedDatasetId]);

  // Compute live summary statistics for active dataset
  const summary: AnalysisSummary = useMemo(() => {
    const results = activeDataset.results || [];
    let accepted = 0;
    let partial = 0;
    let rejected = 0;
    let error = 0;

    for (const r of results) {
      if (r.classification === 'ACCEPTED') accepted++;
      else if (r.classification === 'PARTIALLY_ACCEPTED') partial++;
      else if (r.classification === 'REJECTED') rejected++;
      else error++;
    }

    return {
      total: results.length,
      ACCEPTED: accepted,
      PARTIALLY_ACCEPTED: partial,
      REJECTED: rejected,
      ERROR: error,
    };
  }, [activeDataset]);

  // Filtered comments based on search & verdict filter
  const filteredResults = useMemo(() => {
    return (activeDataset.results || []).filter((r) => {
      // Filter by classification status
      if (selectedFilter !== 'ALL' && r.classification !== selectedFilter) {
        return false;
      }
      // Filter by search query
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const matchesTitle = r.comment_title.toLowerCase().includes(q);
        const matchesRequest = r.requested_change.toLowerCase().includes(q);
        const matchesReasoning = r.reasoning.toLowerCase().includes(q);
        const matchesEvidence = r.evidence_in_final.toLowerCase().includes(q);
        const matchesClause = (r.referenced_clause || '').toLowerCase().includes(q);
        return matchesTitle || matchesRequest || matchesReasoning || matchesEvidence || matchesClause;
      }
      return true;
    });
  }, [activeDataset, selectedFilter, searchTerm]);

  // Handler to run live AI analysis on custom comments or files
  const handleRunCustomAnalysis = async (
    comments: ParsedComment[],
    draftText: string,
    finalText: string,
    datasetTitle: string
  ) => {
    setIsAnalyzing(true);
    try {
      const results: CommentAnalysisResult[] = [];
      const finalParagraphs = finalText
        ? finalText.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
        : activeDataset.finalDoc.paragraphs;

      for (const comment of comments) {
        const res = await fetch('/api/analyze-comment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            comment,
            draftContext: draftText || activeDataset.draftDoc.fullText,
            finalContext: finalText || activeDataset.finalDoc.fullText,
            finalParagraphs,
          }),
        });

        if (!res.ok) {
          throw new Error(`Failed analyzing comment #${comment.number}`);
        }

        const data = await res.json();
        results.push(data);
      }

      const newDatasetId = `custom-${Date.now()}`;
      const newDataset: ComparisonDataset = {
        id: newDatasetId,
        name: datasetTitle,
        description: `User-analyzed dataset with ${comments.length} stakeholder comments.`,
        draftDoc: {
          id: `draft-${newDatasetId}`,
          title: `${datasetTitle} (Draft)`,
          fileName: 'custom_draft.pdf',
          paragraphs: draftText ? draftText.split('\n\n').filter(Boolean) : activeDataset.draftDoc.paragraphs,
          fullText: draftText || activeDataset.draftDoc.fullText,
        },
        finalDoc: {
          id: `final-${newDatasetId}`,
          title: `${datasetTitle} (Final Gazette)`,
          fileName: 'custom_final.pdf',
          paragraphs: finalParagraphs,
          fullText: finalText || activeDataset.finalDoc.fullText,
        },
        comments,
        results,
      };

      setDatasets((prev) => [newDataset, ...prev]);
      setSelectedDatasetId(newDatasetId);
      setActiveTab('results');
    } catch (err: any) {
      console.error('Analysis error:', err);
      alert(`Error during comparative analysis: ${err.message}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      
      {/* App Navigation Bar */}
      <Header
        datasets={datasets}
        selectedDatasetId={selectedDatasetId}
        onSelectDataset={setSelectedDatasetId}
        onOpenUploadModal={() => setIsUploadModalOpen(true)}
        activeTab={activeTab}
        onChangeTab={setActiveTab}
        isAnalyzing={isAnalyzing}
      />

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        
        {/* Case Study Context Header */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-2xs">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="px-2.5 py-0.5 rounded-md text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200">
                  Active Consultation Case
                </span>
                <h2 className="text-lg font-bold text-slate-900">
                  {activeDataset.name}
                </h2>
              </div>
              <p className="text-xs text-slate-600 max-w-3xl leading-relaxed">
                {activeDataset.description}
              </p>
            </div>

            {/* Export & Action Tools */}
            <div className="flex items-center gap-3">
              <ExportMenu
                results={activeDataset.results}
                summary={summary}
                datasetName={activeDataset.name}
              />
            </div>
          </div>
        </div>

        {/* Tab 1: Comments & Implementation Verdicts */}
        {activeTab === 'results' && (
          <div className="space-y-6">
            
            {/* KPI Metric Summary & Acceptance Bar */}
            <SummaryCards
              summary={summary}
              selectedFilter={selectedFilter}
              onSelectFilter={setSelectedFilter}
            />

            {/* Filter & Search Toolbar */}
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs flex flex-col sm:flex-row items-center justify-between gap-3">
              
              {/* Search Bar */}
              <div className="relative w-full sm:w-80">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  id="search-comments-input"
                  type="text"
                  placeholder="Search comments, requests, evidence..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 text-slate-800"
                />
              </div>

              {/* Status Filter Badges */}
              <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto">
                <span className="text-xs font-semibold text-slate-500 mr-1 flex items-center gap-1">
                  <Filter className="w-3.5 h-3.5" />
                  Filter:
                </span>
                
                <button
                  onClick={() => setSelectedFilter('ALL')}
                  className={`px-3 py-1 text-xs font-semibold rounded-lg transition-colors ${
                    selectedFilter === 'ALL'
                      ? 'bg-slate-800 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  All ({summary.total})
                </button>

                <button
                  onClick={() => setSelectedFilter('ACCEPTED')}
                  className={`px-3 py-1 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1 ${
                    selectedFilter === 'ACCEPTED'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200'
                  }`}
                >
                  <CheckCircle2 className="w-3 h-3" />
                  Accepted ({summary.ACCEPTED})
                </button>

                <button
                  onClick={() => setSelectedFilter('PARTIALLY_ACCEPTED')}
                  className={`px-3 py-1 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1 ${
                    selectedFilter === 'PARTIALLY_ACCEPTED'
                      ? 'bg-amber-600 text-white'
                      : 'bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200'
                  }`}
                >
                  <AlertCircle className="w-3 h-3" />
                  Partial ({summary.PARTIALLY_ACCEPTED})
                </button>

                <button
                  onClick={() => setSelectedFilter('REJECTED')}
                  className={`px-3 py-1 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1 ${
                    selectedFilter === 'REJECTED'
                      ? 'bg-rose-600 text-white'
                      : 'bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200'
                  }`}
                >
                  <XCircle className="w-3 h-3" />
                  Rejected ({summary.REJECTED})
                </button>
              </div>

            </div>

            {/* List of Evaluated Comment Cards */}
            <div className="space-y-4">
              {filteredResults.length === 0 ? (
                <div className="bg-white rounded-2xl p-12 text-center border border-slate-200 text-slate-500">
                  <FileText className="w-10 h-10 mx-auto text-slate-300 mb-3" />
                  <p className="font-semibold text-sm">No comments match the selected filter or search term.</p>
                  <button
                    onClick={() => {
                      setSelectedFilter('ALL');
                      setSearchTerm('');
                    }}
                    className="mt-3 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-xs font-semibold hover:bg-blue-100 transition-colors"
                  >
                    Reset Filters
                  </button>
                </div>
              ) : (
                filteredResults.map((result) => (
                  <CommentCard
                    key={`comment-${result.comment_number}`}
                    result={result}
                    onOpenDetails={setSelectedModalResult}
                    onLocateInDoc={handleLocateInDoc}
                  />
                ))
              )}
            </div>

          </div>
        )}

        {/* Tab 2: Gazette Document Viewer */}
        {activeTab === 'documents' && (
          <DocumentViewer
            dataset={activeDataset}
            initialDoc="final"
            highlightParagraphIndex={highlightParagraphIndex}
            highlightText={highlightText}
            highlightCommentNumber={highlightCommentNumber}
          />
        )}

      </main>

      {/* Comment Detailed Audit Modal */}
      <CommentDetailsModal
        result={selectedModalResult}
        onClose={() => setSelectedModalResult(null)}
        onLocateInDoc={handleLocateInDoc}
      />

      {/* Custom PDF Upload & Analysis Modal */}
      <CustomAnalysisModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        onRunAnalysis={handleRunCustomAnalysis}
        isAnalyzing={isAnalyzing}
      />

      {/* Footer */}
      <footer className="mt-auto border-t border-slate-200 bg-white py-4 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>
            CERC Comment Comparator — Regulatory Consultation Response Evaluation Framework
          </span>
          <span className="text-[11px] text-slate-400">
            Node.js Runtime & Gemini-Powered Semantic Clause Verification
          </span>
        </div>
      </footer>

    </div>
  );
}
