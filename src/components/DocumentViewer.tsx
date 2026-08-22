import React, { useState, useEffect, useRef } from 'react';
import { Search, BookOpen, FileText, Layers, ExternalLink, ShieldCheck, MapPin, CheckCircle2 } from 'lucide-react';
import { ComparisonDataset } from '../types';

interface DocumentViewerProps {
  dataset: ComparisonDataset;
  initialDoc?: 'draft' | 'final' | 'comments';
  highlightParagraphIndex?: number | null;
  highlightText?: string | null;
  highlightCommentNumber?: number | null;
}

export const DocumentViewer: React.FC<DocumentViewerProps> = ({
  dataset,
  initialDoc = 'final',
  highlightParagraphIndex,
  highlightText,
  highlightCommentNumber,
}) => {
  const [selectedDoc, setSelectedDoc] = useState<'draft' | 'final' | 'comments'>(initialDoc);
  const [searchTerm, setSearchTerm] = useState('');
  const paragraphRefs = useRef<{ [key: number]: HTMLDivElement | null }>({});

  useEffect(() => {
    if (initialDoc) {
      setSelectedDoc(initialDoc);
    }
  }, [initialDoc]);

  // Auto-scroll into view when highlighted paragraph is specified
  useEffect(() => {
    if (highlightParagraphIndex && selectedDoc === 'final') {
      const el = paragraphRefs.current[highlightParagraphIndex];
      if (el) {
        setTimeout(() => {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 150);
      }
    }
  }, [highlightParagraphIndex, selectedDoc]);

  const getDocTitle = () => {
    switch (selectedDoc) {
      case 'draft':
        return dataset.draftDoc.title;
      case 'final':
        return dataset.finalDoc.title;
      case 'comments':
        return `Stakeholder Comments (${dataset.comments.length} Submissions)`;
    }
  };

  const getDocFileName = () => {
    switch (selectedDoc) {
      case 'draft':
        return dataset.draftDoc.fileName;
      case 'final':
        return dataset.finalDoc.fileName;
      case 'comments':
        return 'comments.pdf';
    }
  };

  const getParagraphs = () => {
    if (selectedDoc === 'draft') return dataset.draftDoc.paragraphs;
    if (selectedDoc === 'final') return dataset.finalDoc.paragraphs;
    return dataset.comments.map(
      (c) => `Comment #${c.number}: ${c.title}\n\n${c.body}`
    );
  };

  const paragraphs = getParagraphs();
  const filteredParagraphs = paragraphs
    .map((para, originalIdx) => ({ para, originalIndex: originalIdx + 1 }))
    .filter(({ para }) =>
      searchTerm.trim() ? para.toLowerCase().includes(searchTerm.toLowerCase()) : true
    );

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
      
      {/* Top Selector Bar */}
      <div className="p-4 border-b border-slate-200 bg-slate-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        
        {/* Document Switcher Buttons */}
        <div className="flex items-center gap-1.5 bg-slate-200/70 p-1 rounded-xl">
          <button
            id="doc-view-draft-btn"
            onClick={() => setSelectedDoc('draft')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              selectedDoc === 'draft'
                ? 'bg-white text-blue-700 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Draft Regulation
          </button>
          <button
            id="doc-view-final-btn"
            onClick={() => setSelectedDoc('final')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 ${
              selectedDoc === 'final'
                ? 'bg-white text-blue-700 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Final Gazette
            {highlightParagraphIndex && (
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            )}
          </button>
          <button
            id="doc-view-comments-btn"
            onClick={() => setSelectedDoc('comments')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              selectedDoc === 'comments'
                ? 'bg-white text-blue-700 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Stakeholder Comments
          </button>
        </div>

        {/* In-document Search Input */}
        <div className="relative max-w-xs w-full">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search keywords or clauses..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 text-slate-800"
          />
        </div>

      </div>

      {/* Header Info Banner */}
      <div className="px-6 py-3 bg-blue-50/50 border-b border-blue-100 flex flex-wrap items-center justify-between gap-2 text-xs text-blue-900">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-blue-600" />
          <span className="font-bold">{getDocTitle()}</span>
          <span className="text-blue-500 text-[11px]">({getDocFileName()})</span>
        </div>
        
        {highlightParagraphIndex && selectedDoc === 'final' ? (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-900 font-semibold text-[11px] border border-emerald-300">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            Focusing on Verified Evidence Source: Paragraph #{highlightParagraphIndex}
            {highlightCommentNumber ? ` (Comment #${highlightCommentNumber})` : ''}
          </div>
        ) : (
          <div className="text-[11px] text-blue-700 font-medium">
            Showing {filteredParagraphs.length} clauses / blocks
          </div>
        )}
      </div>

      {/* Document Content List */}
      <div className="p-6 space-y-4 max-h-[650px] overflow-y-auto font-mono text-xs text-slate-800 divide-y divide-slate-100">
        {filteredParagraphs.length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            No matching paragraphs found for "{searchTerm}".
          </div>
        ) : (
          filteredParagraphs.map(({ para, originalIndex }) => {
            const isTargetPara = selectedDoc === 'final' && highlightParagraphIndex === originalIndex;

            return (
              <div
                key={originalIndex}
                ref={(el) => {
                  paragraphRefs.current[originalIndex] = el;
                }}
                className={`pt-3 first:pt-0 transition-all duration-300 ${
                  isTargetPara ? 'scroll-mt-12' : ''
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1.5 text-[11px] font-sans font-bold">
                  <div className="flex items-center gap-2 text-slate-500">
                    <span
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-mono transition-colors ${
                        isTargetPara
                          ? 'bg-emerald-600 text-white font-bold shadow-xs'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {originalIndex}
                    </span>
                    <span>Clause / Paragraph Unit #{originalIndex}</span>
                  </div>

                  {isTargetPara && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                      <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                      Verified Source Citation
                      {highlightCommentNumber ? ` for Comment #${highlightCommentNumber}` : ''}
                    </span>
                  )}
                </div>

                <div
                  className={`p-4 rounded-xl border transition-all duration-300 ${
                    isTargetPara
                      ? 'bg-emerald-50/80 border-emerald-400 ring-2 ring-emerald-400/50 shadow-sm'
                      : 'bg-slate-50/70 border-slate-200/70'
                  }`}
                >
                  <p className="whitespace-pre-line leading-relaxed text-slate-900 font-sans text-xs">
                    {para}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>

    </div>
  );
};
