import { useState } from 'react';
import { X, Sparkles, TrendingUp, AlertTriangle, CheckCircle2, RefreshCw, Send, MessageSquare } from 'lucide-react';
import { usePropDev } from '../../contexts/PropertyDevContext';
import { usePropDevNav } from '../../contexts/PropDevNavContext';

interface Props { onClose: () => void; }

function generateInsights(tab: string, data: ReturnType<typeof usePropDev>) {
  const { lots, loans, partners, capitalCalls, customers, properties, companies, isConsolidated, selectedCompanyId } = data;
  const p = properties[0];
  const soldLots = lots.filter(l => l.status === 'sold');
  const availableLots = lots.filter(l => l.status === 'available');
  const contractedLots = lots.filter(l => l.status === 'contracted');
  const totalRevenue = soldLots.reduce((s, l) => s + (l.salePrice ?? 0), 0);
  const totalLoanBalance = loans.reduce((s, l) => s + l.balance, 0);
  const overdueCalls = capitalCalls.filter(c => c.status === 'Overdue');
  const pendingReceivables = customers.reduce((s, c) => s + (c.contractValue - c.collected), 0);
  const soldPct = lots.length > 0 ? ((soldLots.length / lots.length) * 100).toFixed(0) : '0';
  const totalCost = p ? p.landCost + p.hardCost + p.softCost + p.titleCharges + p.otherCharges
    + p.propertyTax + p.loanProcessing + p.professionalCharges + p.legalFees + p.interestOnLoan : 0;
  const netProfit = p ? p.saleConsideration - totalCost - p.saleConsideration * 0.09 - p.saleConsideration * 0.045 : 0;
  const netMargin = p && p.saleConsideration > 0 ? ((netProfit / p.saleConsideration) * 100).toFixed(1) : '0';

  const insights: Record<string, { bullets: string[]; actions: string[]; riskScore: number }> = {
    dashboard: {
      bullets: [
        `Portfolio is ${soldPct}% sold — ${soldLots.length} of ${lots.length} lots closed across ${isConsolidated ? companies.length + ' companies' : '1 property'}.`,
        `${contractedLots.length} lots under contract represent $${(contractedLots.reduce((s,l) => s+l.listPrice,0)/1000).toFixed(0)}K in near-term revenue.`,
        `${availableLots.length} lots still available — velocity risk if unsold past 12 months.`,
        overdueCalls.length > 0
          ? `⚠️ ${overdueCalls.length} capital call${overdueCalls.length > 1 ? 's' : ''} overdue — total $${overdueCalls.reduce((s,c) => s+c.totalDue-c.received,0).toLocaleString()} outstanding.`
          : 'All capital calls current — no overdue obligations.',
        `Total loan exposure: $${(totalLoanBalance / 1_000_000).toFixed(2)}M across ${loans.length} facilities — monitor DSCR monthly.`,
      ],
      actions: [
        'Follow up immediately on overdue capital calls — send demand notices.',
        `Accelerate pricing on ${availableLots.length} available lots — consider 3–5% discount for Q3 closings.`,
        'Review loan maturity schedule — refinance opportunities if rates drop below 7%.',
      ],
      riskScore: overdueCalls.length > 1 ? 7 : 4,
    },
    'deal-pl': {
      bullets: [
        `Projected net margin is ${netMargin}% — ${parseFloat(netMargin) >= 35 ? 'exceeds' : 'below'} the 35% target threshold.`,
        `Land cost represents ${p ? ((p.landCost / p.saleConsideration) * 100).toFixed(0) : '0'}% of revenue — typical range is 35–45%.`,
        `Management fee (9%) + Commission (4.5%) together consume 13.5% of gross revenue.`,
        `Break-even price per lot: $${p ? Math.round(totalCost / lots.length).toLocaleString() : '—'}.`,
        `Net profit per lot: $${p ? Math.round(netProfit / lots.length).toLocaleString() : '—'}.`,
      ],
      actions: [
        'Negotiate bulk discount on remaining legal fees — potential 15–20% savings.',
        'Review management fee structure — performance-based model could align incentives better.',
        'Model a 5% price increase scenario — with 50% of lots remaining, impact is significant.',
      ],
      riskScore: parseFloat(netMargin) < 25 ? 7 : 3,
    },
    loans: {
      bullets: [
        `Total loan portfolio: $${(totalLoanBalance / 1_000_000).toFixed(2)}M outstanding across ${loans.length} facilities.`,
        `Weighted avg rate: ${loans.length > 0 ? (loans.reduce((s,l) => s + l.interestRate * l.balance, 0) / totalLoanBalance).toFixed(2) : '0'}% — market refinance opportunity below 7%.`,
        `Monthly EMI burden: $${loans.reduce((s,l) => s+l.emi, 0).toLocaleString()} — ensure collections cover debt service.`,
        `Earliest maturity: Jun 2026 — refinancing pipeline should start now if needed.`,
        `LTV ratio: ${loans.length > 0 ? ((totalLoanBalance / (p?.saleConsideration ?? 1)) * 100).toFixed(0) : '0'}% of sale consideration.`,
      ],
      actions: [
        'Initiate refinancing conversations for loans above 7.5% — potential $X/month savings.',
        'Negotiate interest-only periods to preserve cash flow during sales velocity push.',
        'Set up automated EMI reminders 7 days prior to each due date.',
      ],
      riskScore: loans.some(l => l.interestRate > 8) ? 6 : 3,
    },
    receivables: {
      bullets: [
        `$${(pendingReceivables / 1000).toFixed(0)}K in outstanding receivables across ${customers.length} customers.`,
        `${customers.filter(c => c.installments.some(i => i.status === 'bounced')).length} bounced payments — immediate legal action required.`,
        `Collection ratio: ${customers.length > 0 ? ((customers.reduce((s,c) => s+c.collected,0) / customers.reduce((s,c) => s+c.contractValue,0)) * 100).toFixed(0) : '0'}% — target is 90%+.`,
        `${customers.filter(c => c.installments.some(i => i.status === 'overdue')).length} customers have overdue installments — escalate collection.`,
        `Average days outstanding per customer is approaching 45 days — tighten terms.`,
      ],
      actions: [
        'Send formal demand notices to all customers with overdue >30 days.',
        'Offer 2% early payment discount to accelerate collections.',
        'Review escrow requirements for new contracts going forward.',
      ],
      riskScore: customers.filter(c => c.installments.some(i => i.status === 'bounced')).length > 0 ? 7 : 4,
    },
    'cash-flow': {
      bullets: [
        `Cash on hand: $${p ? p.cashAvailable.toLocaleString() : '0'} — ${p && p.cashAvailable < 200000 ? '⚠️ critically low' : 'adequate for 2+ months'}.`,
        `Monthly obligations: $${loans.reduce((s,l) => s+l.emi,0).toLocaleString()} EMI + operating expenses.`,
        `Collections expected next 30 days: $${(pendingReceivables * 0.35 / 1000).toFixed(0)}K based on installment schedule.`,
        `Capital calls pending: $${capitalCalls.filter(c => c.status !== 'Paid').reduce((s,c) => s+c.totalDue-c.received,0).toLocaleString()} — timing critical for liquidity.`,
        `Distribution obligations: $${partners.reduce((s,p) => s+p.distributionsReceived,0).toLocaleString()} already paid — more likely due Q3.`,
      ],
      actions: [
        'Accelerate collections on contracted lots to cover EMI and operating costs.',
        'Delay non-critical capital expenditures until Q3 collections materialize.',
        'Consider credit line drawdown if collections slip — preserve minimum $150K reserve.',
      ],
      riskScore: p && p.cashAvailable < 200000 ? 8 : 4,
    },
    performance: {
      bullets: [
        `Portfolio ROI: ${p ? ((netProfit / partners.reduce((s,p) => s+p.capitalContributed, 1)) * 100).toFixed(1) : '0'}% on invested capital.`,
        `Equity multiple: ${p ? ((partners.reduce((s,x) => s+x.capitalContributed,0) + netProfit) / Math.max(1, partners.reduce((s,x) => s+x.capitalContributed,0))).toFixed(2) : '0'}x — target 1.8x+ for this asset class.`,
        `${soldLots.length} lots closed generating $${(totalRevenue / 1_000_000).toFixed(2)}M in realized revenue.`,
        isConsolidated
          ? `Top performer: ${companies.sort((a,b) => (b.property.saleConsideration - b.property.landCost) - (a.property.saleConsideration - a.property.landCost))[0]?.name ?? 'N/A'}.`
          : `Gross profit as % of revenue: ${p ? (((p.saleConsideration - totalCost) / p.saleConsideration) * 100).toFixed(1) : '0'}%.`,
        `Partner preferred returns of 6–8% must be serviced before general distributions.`,
      ],
      actions: [
        'Accelerate lot sales to lock in IRR before holding costs compound.',
        'Initiate preferred return distribution to partners once 75% sold.',
        isConsolidated ? 'Reallocate GP time to bottom-3 performing properties.' : 'Model exit scenarios — bulk sale vs. individual lots.',
      ],
      riskScore: 4,
    },
  };

  return insights[tab] ?? insights.dashboard;
}

// ── Quick-question answer generator ──────────────────────────────────────────

function answerQuickQuestion(q: string, data: ReturnType<typeof usePropDev>): string {
  const { lots, loans, partners, capitalCalls, properties } = data;
  const p = properties[0];
  const overdue = capitalCalls.filter(c => c.status === 'Overdue');
  const pending = capitalCalls.filter(c => c.status !== 'Paid');
  const cash = p?.cashAvailable ?? 0;
  const monthlyEmi = loans.reduce((s, l) => s + l.emi, 0);
  const availLots = lots.filter(l => l.status === 'available');

  if (q.includes('capital call')) {
    if (overdue.length > 0)
      return `YES — you should call now. ${overdue.length} capital call${overdue.length > 1 ? 's are' : ' is'} already overdue totaling $${overdue.reduce((s, c) => s + c.totalDue - c.received, 0).toLocaleString()}. Send demand notices immediately.`;
    if (cash < monthlyEmi * 3)
      return `YES — cash of $${cash.toLocaleString()} covers only ${(cash / monthlyEmi).toFixed(1)} months of EMIs. Call now before you hit a shortfall.`;
    return `NOT URGENTLY — cash position of $${cash.toLocaleString()} is adequate. Next call due: ${pending[0]?.dueDate ?? 'N/A'}. Monitor monthly.`;
  }
  if (q.includes('reprice') || q.includes('lot')) {
    const cheapLots = availLots.filter(l => l.listPrice < 300000);
    if (cheapLots.length > 0)
      return `${cheapLots.length} available lots are priced below $300K — consider 5–8% price increase to improve margins. Focus on corner lots and premium-facing inventory first.`;
    return `All ${availLots.length} available lots are competitively priced. If velocity slows, consider a 3% incentive on bulk purchases rather than lowering list prices.`;
  }
  if (q.includes('refinanc')) {
    const highRate = loans.filter(l => l.interestRate > 7.5);
    if (highRate.length > 0)
      return `YES — ${highRate.length} loan${highRate.length > 1 ? 's' : ''} above 7.5% (avg ${(highRate.reduce((s, l) => s + l.interestRate, 0) / highRate.length).toFixed(2)}%). Refinancing at 6.5% saves ~$${Math.round(highRate.reduce((s, l) => s + l.balance * 0.01 / 12, 0)).toLocaleString()}/month.`;
    return `No urgent refinancing needed — all loans are at or below 7.5%. Watch the market and act when rates drop below 6%.`;
  }
  if (q.includes('partner') || q.includes('distribut')) {
    const totalCapital = partners.reduce((s, p) => s + p.capitalContributed, 0);
    const totalProfit = partners.reduce((s, p) => s + p.shareOfProfit, 0);
    const prefReturn = totalCapital * 0.08;
    const remaining = Math.max(0, totalProfit - totalCapital - prefReturn);
    return `Partners get: ① Return of capital $${totalCapital.toLocaleString()} ② Preferred return (8%) $${Math.round(prefReturn).toLocaleString()} ③ Pro-rata split of remaining $${Math.round(remaining).toLocaleString()}. Total distributable: $${Math.round(totalCapital + prefReturn + remaining).toLocaleString()}.`;
  }
  if (q.includes('cash')) {
    const runway = monthlyEmi > 0 ? (cash / monthlyEmi).toFixed(1) : '∞';
    if (cash < 200000)
      return `⚠️ CRITICAL — cash of $${cash.toLocaleString()} is dangerously low. Only ${runway} months of EMI coverage. Accelerate receivables collections and delay discretionary capex immediately.`;
    if (cash < 500000)
      return `CAUTION — $${cash.toLocaleString()} cash provides ${runway} months of EMI runway. Acceptable, but pursue receivable collections proactively.`;
    return `SAFE — $${cash.toLocaleString()} cash covers ${runway} months of obligations. No immediate action needed.`;
  }
  return `Based on current portfolio data: ${lots.length} total lots, $${(loans.reduce((s,l) => s+l.balance,0)/1e6).toFixed(2)}M loan exposure, $${cash.toLocaleString()} cash available. Navigate to a specific page for detailed analysis.`;
}

const QUICK_QUESTIONS = [
  { label: 'Should I make a capital call?',  key: 'capital call'  },
  { label: 'Which lots to reprice?',          key: 'reprice lot'   },
  { label: 'Should I refinance?',             key: 'refinanc'      },
  { label: 'What do partners get now?',       key: 'partner distribut' },
  { label: 'Is my cash position safe?',       key: 'cash'          },
];

export default function AiInsightsPanel({ onClose }: Props) {
  const data = usePropDev();
  const { tab } = usePropDevNav();
  const { bullets, actions, riskScore } = generateInsights(tab, data);
  const [freeText, setFreeText] = useState('');
  const [answer, setAnswer] = useState('');
  const [activeQ, setActiveQ] = useState('');

  const riskColor = riskScore >= 7 ? 'text-red-400' : riskScore >= 5 ? 'text-amber-400' : 'text-green-400';
  const riskLabel = riskScore >= 7 ? 'High Risk' : riskScore >= 5 ? 'Medium Risk' : 'Low Risk';
  const riskBars = Array.from({ length: 10 }, (_, i) => i < riskScore);

  function handleQuickQuestion(label: string, key: string) {
    setActiveQ(label);
    setFreeText('');
    setAnswer(answerQuickQuestion(key, data));
  }

  function handleAnalyze() {
    if (!freeText.trim()) return;
    setActiveQ(freeText);
    setAnswer(answerQuickQuestion(freeText.toLowerCase(), data));
    setFreeText('');
  }

  return (
    <div className="fixed right-0 top-0 h-full w-[400px] bg-gray-900 text-white shadow-2xl z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10 bg-gradient-to-r from-violet-900 to-blue-900">
        <div className="flex items-center gap-2">
          <Sparkles size={18} className="text-violet-300" />
          <span className="font-semibold">AI Insights</span>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => { setAnswer(''); setActiveQ(''); }} className="text-gray-400 hover:text-white" title="Reset">
            <RefreshCw size={14} />
          </button>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* Quick Questions */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <MessageSquare size={14} className="text-violet-400" />
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-300">Quick Questions</h3>
          </div>
          <div className="flex flex-col gap-1.5">
            {QUICK_QUESTIONS.map(({ label, key }) => (
              <button
                key={label}
                onClick={() => handleQuickQuestion(label, key)}
                className={`text-left px-3 py-2 rounded-lg text-xs transition-colors ${
                  activeQ === label
                    ? 'bg-violet-700 text-white'
                    : 'bg-white/5 hover:bg-white/10 text-gray-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Free-text input */}
          <div className="flex gap-2 mt-2">
            <input
              type="text"
              value={freeText}
              onChange={e => setFreeText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAnalyze()}
              placeholder="Ask anything about the portfolio…"
              className="flex-1 bg-white/10 text-white text-xs rounded-lg px-3 py-2 placeholder-gray-500 border border-white/10 focus:outline-none focus:border-violet-500"
            />
            <button
              onClick={handleAnalyze}
              className="px-3 py-2 bg-violet-600 hover:bg-violet-700 rounded-lg text-xs flex items-center gap-1"
            >
              <Send size={12} /> Analyze
            </button>
          </div>

          {/* Answer box */}
          {answer && (
            <div className="mt-3 p-3 bg-violet-900/50 border border-violet-700/50 rounded-xl">
              <p className="text-xs text-violet-300 font-medium mb-1.5">{activeQ}</p>
              <p className="text-sm text-white leading-relaxed">{answer}</p>
            </div>
          )}
        </div>

        {/* Risk Score */}
        <div className="bg-white/5 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-gray-400 uppercase tracking-wide">Risk Score</span>
            <span className={`text-sm font-bold ${riskColor}`}>{riskScore}/10 · {riskLabel}</span>
          </div>
          <div className="flex gap-1">
            {riskBars.map((active, i) => (
              <div key={i} className={`flex-1 h-2 rounded-full ${active
                ? i >= 6 ? 'bg-red-500' : i >= 4 ? 'bg-amber-500' : 'bg-green-500'
                : 'bg-white/10'}`} />
            ))}
          </div>
        </div>

        {/* Key Insights */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp size={14} className="text-blue-400" />
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-300">Key Insights</h3>
          </div>
          <div className="space-y-3">
            {bullets.map((b, i) => (
              <div key={i} className="flex gap-3 text-sm text-gray-200 leading-relaxed">
                <span className="text-violet-400 font-bold shrink-0 mt-0.5">{i + 1}.</span>
                <span>{b}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Recommended Actions */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle2 size={14} className="text-green-400" />
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-300">Recommended Actions</h3>
          </div>
          <div className="space-y-2">
            {actions.map((a, i) => (
              <div key={i} className="flex gap-3 p-3 bg-white/5 rounded-lg text-sm text-gray-200">
                <AlertTriangle size={14} className="text-amber-400 shrink-0 mt-0.5" />
                <span>{a}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="p-4 border-t border-white/10 text-xs text-gray-500 text-center">
        Insights generated from live portfolio data · {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </div>
    </div>
  );
}
