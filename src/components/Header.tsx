import React from 'react';
import { Scale, Sparkles, UploadCloud, BookOpen, Layers, RefreshCw } from 'lucide-react';
import { ComparisonDataset } from '../types';

interface HeaderProps {
  datasets: ComparisonDataset[];
  selectedDatasetId: string;
  onSelectDataset: (id: string) => void;
  onOpenUploadModal: () => void;
  activeTab: 'results' | 'documents' | 'diff';
  onChangeTab: (tab: 'results' | 'documents' | 'diff') => void;
  isAnalyzing?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  datasets,
  selectedDatasetId,
  onSelectDataset,
  onOpenUploadModal,
  activeTab,
  onChangeTab,
  isAnalyzing = false,
}) => {
  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between py-3.5 gap-3">
          
          {/* Logo & App Title */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-sm shadow-blue-500/20">
              <Scale className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold text-slate-900 leading-none">
                  CERC Comment Comparator
                </h1>
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200/60">
                  v2.0
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                AI Consultation-Response Analysis & Implementation Auditor
              </p>
            </div>
          </div>

          {/* Controls: Dataset Selector, Navigation Tabs, Upload Button */}
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Case Study Selector */}
            <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-lg border border-slate-200/80">
              <label htmlFor="dataset-select" className="text-xs font-medium text-slate-600 px-2">
                Case Study:
              </label>
              <select
                id="dataset-select"
                value={selectedDatasetId}
                onChange={(e) => onSelectDataset(e.target.value)}
                className="text-xs font-semibold bg-white border border-slate-200 rounded-md px-2.5 py-1 text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer shadow-2xs"
              >
                {datasets.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>

            {/* View Switcher Tabs */}
            <div className="flex items-center bg-slate-100 p-1 rounded-lg border border-slate-200/80">
              <button
                id="tab-results-btn"
                onClick={() => onChangeTab('results')}
                className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-all ${
                  activeTab === 'results'
                    ? 'bg-white text-blue-700 shadow-2xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                Comments & Verdicts
              </button>

              <button
                id="tab-documents-btn"
                onClick={() => onChangeTab('documents')}
                className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-all ${
                  activeTab === 'documents'
                    ? 'bg-white text-blue-700 shadow-2xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <BookOpen className="w-3.5 h-3.5" />
                Source Gazette PDFs
              </button>
            </div>

            {/* Upload & Compare Action */}
            <button
              id="upload-custom-pdf-btn"
              onClick={onOpenUploadModal}
              disabled={isAnalyzing}
              className="flex items-center gap-1.5 px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-lg text-xs font-semibold transition-colors shadow-sm shadow-blue-500/20 disabled:opacity-50"
            >
              {isAnalyzing ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <UploadCloud className="w-3.5 h-3.5" />
                  Analyze Custom PDFs
                </>
              )}
            </button>
          </div>

        </div>
      </div>
    </header>
  );
};
