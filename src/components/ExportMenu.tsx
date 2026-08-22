import React, { useState } from 'react';
import { Download, FileSpreadsheet, FileCode, Copy, Check } from 'lucide-react';
import { CommentAnalysisResult, AnalysisSummary } from '../types';

interface ExportMenuProps {
  results: CommentAnalysisResult[];
  summary: AnalysisSummary;
  datasetName: string;
}

export const ExportMenu: React.FC<ExportMenuProps> = ({
  results,
  summary,
  datasetName,
}) => {
  const [copiedMd, setCopiedMd] = useState(false);
  const [isExportingExcel, setIsExportingExcel] = useState(false);

  const handleDownloadJson = () => {
    const reportData = {
      dataset_name: datasetName,
      generated_at: new Date().toISOString(),
      summary,
      results,
    };

    const blob = new Blob([JSON.stringify(reportData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cerc_results_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadExcel = async () => {
    setIsExportingExcel(true);
    try {
      const response = await fetch('/api/export-excel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          results,
          summary,
          datasetName,
        }),
      });

      if (!response.ok) throw new Error('Failed to generate Excel');

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cerc_results_${Date.now()}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Excel download failed:', err);
      // Fallback: client-side JSON download
      handleDownloadJson();
    } finally {
      setIsExportingExcel(false);
    }
  };

  const handleCopyMarkdown = () => {
    let md = `# CERC Comment Comparator — Analysis Report\n`;
    md += `**Dataset:** ${datasetName}  \n`;
    md += `**Date:** ${new Date().toLocaleDateString()}  \n\n`;
    md += `## Executive Summary\n`;
    md += `- **Total Comments:** ${summary.total}\n`;
    md += `- **Accepted:** ${summary.ACCEPTED} (${Math.round((summary.ACCEPTED / (summary.total || 1)) * 100)}%)\n`;
    md += `- **Partially Accepted:** ${summary.PARTIALLY_ACCEPTED} (${Math.round((summary.PARTIALLY_ACCEPTED / (summary.total || 1)) * 100)}%)\n`;
    md += `- **Rejected:** ${summary.REJECTED} (${Math.round((summary.REJECTED / (summary.total || 1)) * 100)}%)\n\n`;
    md += `## Detailed Comment Analysis\n\n`;

    results.forEach((r) => {
      md += `### Comment #${r.comment_number}: ${r.comment_title}\n`;
      md += `- **Verdict:** ${r.classification}\n`;
      md += `- **Referenced Clause:** ${r.referenced_clause || 'N/A'}\n`;
      md += `- **Draft Position:** ${r.draft_position}\n`;
      md += `- **Stakeholder Request:** ${r.requested_change}\n`;
      md += `- **Final Position:** ${r.final_position}\n`;
      md += `- **Reasoning:** ${r.reasoning}\n`;
      md += `- **Verbatim Final Evidence:** "${r.evidence_in_final}"\n\n`;
    });

    navigator.clipboard.writeText(md);
    setCopiedMd(true);
    setTimeout(() => setCopiedMd(false), 2000);
  };

  return (
    <div className="flex items-center gap-2">
      {/* Excel Download */}
      <button
        id="export-excel-btn"
        onClick={handleDownloadExcel}
        disabled={isExportingExcel}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 rounded-lg text-xs font-semibold transition-colors shadow-2xs"
        title="Download structured Excel report"
      >
        <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
        {isExportingExcel ? 'Generating...' : 'Excel (.xlsx)'}
      </button>

      {/* JSON Download */}
      <button
        id="export-json-btn"
        onClick={handleDownloadJson}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 rounded-lg text-xs font-semibold transition-colors shadow-2xs"
        title="Download raw results.json"
      >
        <FileCode className="w-3.5 h-3.5 text-slate-600" />
        JSON (.json)
      </button>

      {/* Markdown Copy */}
      <button
        id="copy-markdown-report-btn"
        onClick={handleCopyMarkdown}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg text-xs font-semibold transition-colors shadow-2xs"
        title="Copy complete analysis as Markdown"
      >
        {copiedMd ? (
          <>
            <Check className="w-3.5 h-3.5 text-emerald-600" />
            Copied!
          </>
        ) : (
          <>
            <Copy className="w-3.5 h-3.5 text-slate-500" />
            Copy Markdown
          </>
        )}
      </button>
    </div>
  );
};
