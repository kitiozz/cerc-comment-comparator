import React from 'react';
import { CheckCircle2, AlertCircle, XCircle, FileText, TrendingUp } from 'lucide-react';
import { AnalysisSummary, ClassificationType } from '../types';

interface SummaryCardsProps {
  summary: AnalysisSummary;
  selectedFilter: ClassificationType | 'ALL';
  onSelectFilter: (filter: ClassificationType | 'ALL') => void;
}

export const SummaryCards: React.FC<SummaryCardsProps> = ({
  summary,
  selectedFilter,
  onSelectFilter,
}) => {
  const total = summary.total || 1;
  const acceptedPct = Math.round((summary.ACCEPTED / total) * 100) || 0;
  const partialPct = Math.round((summary.PARTIALLY_ACCEPTED / total) * 100) || 0;
  const rejectedPct = Math.round((summary.REJECTED / total) * 100) || 0;
  const overallAcceptanceRate = Math.round(((summary.ACCEPTED + summary.PARTIALLY_ACCEPTED * 0.5) / total) * 100) || 0;

  return (
    <div className="space-y-4">
      {/* Metric Cards Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
        
        {/* Total Comments Card */}
        <button
          id="filter-all-card"
          onClick={() => onSelectFilter('ALL')}
          className={`text-left p-4 rounded-xl border transition-all relative overflow-hidden ${
            selectedFilter === 'ALL'
              ? 'bg-blue-50/70 border-blue-300 ring-2 ring-blue-500/20 shadow-xs'
              : 'bg-white border-slate-200/90 hover:border-slate-300 hover:shadow-xs'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Total Comments
            </span>
            <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-600">
              <FileText className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-extrabold text-slate-900">{summary.total}</span>
            <span className="text-xs text-slate-500 font-medium">Evaluated</span>
          </div>
          <div className="mt-2 text-[11px] text-slate-500">
            Click to view all comments
          </div>
        </button>

        {/* Accepted Card */}
        <button
          id="filter-accepted-card"
          onClick={() => onSelectFilter('ACCEPTED')}
          className={`text-left p-4 rounded-xl border transition-all relative overflow-hidden ${
            selectedFilter === 'ACCEPTED'
              ? 'bg-emerald-50/80 border-emerald-300 ring-2 ring-emerald-500/20 shadow-xs'
              : 'bg-white border-slate-200/90 hover:border-emerald-200 hover:shadow-xs'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-emerald-700 uppercase tracking-wider">
              Accepted
            </span>
            <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center text-emerald-700">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-extrabold text-emerald-800">{summary.ACCEPTED}</span>
            <span className="text-xs font-bold text-emerald-700">({acceptedPct}%)</span>
          </div>
          <div className="mt-2 text-[11px] text-emerald-700/80">
            Adopted in final gazette
          </div>
        </button>

        {/* Partially Accepted Card */}
        <button
          id="filter-partial-card"
          onClick={() => onSelectFilter('PARTIALLY_ACCEPTED')}
          className={`text-left p-4 rounded-xl border transition-all relative overflow-hidden ${
            selectedFilter === 'PARTIALLY_ACCEPTED'
              ? 'bg-amber-50/80 border-amber-300 ring-2 ring-amber-500/20 shadow-xs'
              : 'bg-white border-slate-200/90 hover:border-amber-200 hover:shadow-xs'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-amber-700 uppercase tracking-wider">
              Partially Accepted
            </span>
            <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center text-amber-700">
              <AlertCircle className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-extrabold text-amber-800">{summary.PARTIALLY_ACCEPTED}</span>
            <span className="text-xs font-bold text-amber-700">({partialPct}%)</span>
          </div>
          <div className="mt-2 text-[11px] text-amber-700/80">
            Selective sub-clause adoption
          </div>
        </button>

        {/* Rejected Card */}
        <button
          id="filter-rejected-card"
          onClick={() => onSelectFilter('REJECTED')}
          className={`text-left p-4 rounded-xl border transition-all relative overflow-hidden ${
            selectedFilter === 'REJECTED'
              ? 'bg-rose-50/80 border-rose-300 ring-2 ring-rose-500/20 shadow-xs'
              : 'bg-white border-slate-200/90 hover:border-rose-200 hover:shadow-xs'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-rose-700 uppercase tracking-wider">
              Rejected
            </span>
            <div className="w-8 h-8 rounded-lg bg-rose-100 flex items-center justify-center text-rose-700">
              <XCircle className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-extrabold text-rose-800">{summary.REJECTED}</span>
            <span className="text-xs font-bold text-rose-700">({rejectedPct}%)</span>
          </div>
          <div className="mt-2 text-[11px] text-rose-700/80">
            No change from draft
          </div>
        </button>

      </div>

      {/* Progress & Acceptance Breakdown Bar */}
      <div className="bg-white p-3.5 rounded-xl border border-slate-200/90 shadow-2xs">
        <div className="flex items-center justify-between text-xs mb-2">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-blue-600" />
            <span className="font-semibold text-slate-800">Stakeholder Implementation Index:</span>
            <span className="font-extrabold text-blue-700">{overallAcceptanceRate}%</span>
          </div>
          <div className="flex items-center gap-4 text-slate-500 font-medium text-[11px]">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
              Accepted ({acceptedPct}%)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" />
              Partial ({partialPct}%)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block" />
              Rejected ({rejectedPct}%)
            </span>
          </div>
        </div>

        {/* Multi-segment progress bar */}
        <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden flex">
          <div
            className="h-full bg-emerald-500 transition-all duration-500"
            style={{ width: `${acceptedPct}%` }}
            title={`Accepted: ${acceptedPct}%`}
          />
          <div
            className="h-full bg-amber-400 transition-all duration-500"
            style={{ width: `${partialPct}%` }}
            title={`Partially Accepted: ${partialPct}%`}
          />
          <div
            className="h-full bg-rose-500 transition-all duration-500"
            style={{ width: `${rejectedPct}%` }}
            title={`Rejected: ${rejectedPct}%`}
          />
        </div>
      </div>
    </div>
  );
};
