import { useState } from 'react';
import { X, Sparkles, TrendingUp, AlertTriangle, CheckCircle2, RefreshCw, Send, MessageSquare, Building2 } from 'lucide-react';
import { usePropDev } from '../../contexts/PropertyDevContext';
import { usePropDevNav } from '../../contexts/PropDevNavContext';

interface Props { onClose: () => void; }

// ── Company-aware insight generator ──────────────────────────────────────────

function generateInsights(tab: string, data: ReturnType<typeof usePropDev>) {
  const { lots, loans, partners, capitalCalls, customers, properties, companies, isConsolidated } = data;
  const p = properties[0];
  const companyLabel = isConsolidated ? `Portfolio (${companies.length} companies)` : p?.name ?? 'Company';

  const soldLots = lots.filter(l => l.status === 'sold');
  const availableLots = lots.filter(l => l.status === 'available');
  const contractedLots = lots.filter(l => l.status === 'contracted');
  const totalRevenue = soldLots.reduce((s, l) => s + (l.salePrice ?? 0), 0);
  const totalLoanBalance = loans.reduce((s, l) => s + l.balance, 0);
  const overdueCalls = capitalCalls.filter(c => c.status === 'Overdue');
  const pendingReceivables = customers.reduce((s, c) => s + (c.contractValue - c.collected), 0);
  const soldPct = lots.length > 0 ? ((soldLots.length / lots.length) * 100).toFixed(0) : '0';

  // Correct formulas (management fee = 9% of land cost, commission uses explicit override)
  const totalCost = p
    ? p.landCost + p.hardCost + p.softCost + p.titleCharges + p.otherCharges
      + p.propertyTax + p.loanProcessing + p.professionalCharges + p.legalFees + p.interestOnLoan
    : 0;
  const managementFee = p ? p.landCost * p.managementFeeRate : 0;
  const commission = p ? (p.commission ?? p.saleConsideration * p.commissionRate) : 0;
  const netProfit = p ? p.saleConsideration - totalCost - managementFee - commission : 0;
  const netMargin = p && p.saleConsideration > 0 ? ((netProfit / p.saleConsideration) * 100).toFixed(1) : '0';
  const totalCapital = partners.reduce((s, x) => s + x.capitalContributed, 0);
  const roi = totalCapital > 0 ? ((netProfit / totalCapital) * 100).toFixed(1) : '0';

  const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;

  const insights: Record<string, { bullets: string[]; actions: string[]; riskScore: number }> = {
    dashboard: {
      bullets: [
        `${companyLabel}: ${soldLots.length} of ${companies.length || lots.length} properties sold, generating ${fmt(totalRevenue)} in realized revenue.`,
        `${contractedLots.length} propert${contractedLots.length !== 1 ? 'ies' : 'y'} under contract represent ${fmt(contractedLots.reduce((s,l) => s+l.listPrice,0))} in near-term revenue.`,
        `${availableLots.length} propert${availableLots.length !== 1 ? 'ies' : 'y'} still for sale — review pricing if unsold past 12 months.`,
        overdueCalls.length > 0
          ? `⚠️ ${overdueCalls.length} capital call${overdueCalls.length > 1 ? 's' : ''} overdue — ${fmt(overdueCalls.reduce((s,c) => s+c.totalDue-c.received,0))} outstanding.`
          : 'All capital calls current — no overdue obligations.',
        `Total loan exposure: ${fmt(totalLoanBalance)} across ${loans.length} facilit${loans.length === 1 ? 'y' : 'ies'}.`,
      ],
      actions: [
        overdueCalls.length > 0
          ? `Send demand notices for ${overdueCalls.length} overdue call${overdueCalls.length > 1 ? 's' : ''} — ${fmt(overdueCalls.reduce((s,c) => s+c.totalDue-c.received,0))} at risk.`
          : 'Issue next capital call before cash drops below 2× monthly EMI.',
        `Review pricing on ${availableLots.length} unsold propert${availableLots.length !== 1 ? 'ies' : 'y'} — consider market comparables.`,
        'Review loan maturity schedule — start refinancing conversations now if rates below 7%.',
      ],
      riskScore: overdueCalls.length > 1 ? 7 : 4,
    },
    pricing: {
      bullets: [
        `${companyLabel}: ${availableLots.length} propert${availableLots.length !== 1 ? 'ies' : 'y'} for sale, avg list ${fmt(availableLots.reduce((s,l)=>s+l.listPrice,0)/Math.max(1,availableLots.length))}.`,
        `Break-even sale price (basic) ≈ ${fmt(totalCost + managementFee + commission)}.`,
        `${contractedLots.length} propert${contractedLots.length !== 1 ? 'ies' : 'y'} contracted — maintain pricing to protect margin.`,
        `Sold properties avg price: ${fmt(soldLots.reduce((s,l)=>s+(l.salePrice??0),0)/Math.max(1,soldLots.length))}.`,
        `Total unsold value: ${fmt(availableLots.reduce((s,l)=>s+l.listPrice,0))}.`,
      ],
      actions: [
        'Price property above the Partnership break-even threshold to cover preferred returns.',
        `Review pricing vs break-even — run Scenario Slider to test +5% impact.`,
      ],
      riskScore: availableLots.some(l => l.listPrice < (totalCost + managementFee + commission) / Math.max(1, lots.length)) ? 6 : 3,
    },
    loans: {
      bullets: [
        `${companyLabel}: ${fmt(totalLoanBalance)} loan balance across ${loans.length} facilit${loans.length === 1 ? 'y' : 'ies'}.`,
        `Weighted avg rate: ${loans.length > 0 ? (loans.reduce((s,l) => s + l.interestRate * l.balance, 0) / Math.max(1, totalLoanBalance)).toFixed(2) : '0'}% — market refinance threshold is 7%.`,
        `Monthly EMI burden: ${fmt(loans.reduce((s,l) => s+l.emi, 0))} — verify collections cover debt service.`,
        `Earliest maturity: Jun 2026 — begin refinancing pipeline 6–9 months before.`,
        `LTV: ${p ? ((totalLoanBalance / p.saleConsideration) * 100).toFixed(0) : '0'}% of sale consideration.`,
      ],
      actions: [
        loans.some(l => l.interestRate > 7.5)
          ? `Refinance ${loans.filter(l=>l.interestRate>7.5).length} loan(s) above 7.5% — estimated saving ${fmt(loans.filter(l=>l.interestRate>7.5).reduce((s,l)=>s+l.balance*(l.interestRate-6.5)/100/12,0))}/month.`
          : 'All loans within acceptable rate range. Monitor market for sub-6.5% windows.',
        'Negotiate interest-only periods to preserve cash flow during sales push.',
        'Set EMI reminders 7 days before each due date to avoid defaults.',
      ],
      riskScore: loans.some(l => l.interestRate > 8) ? 6 : 3,
    },
    partners: {
      bullets: [
        `${companyLabel}: ${partners.length} partner${partners.length === 1 ? '' : 's'}, ${fmt(totalCapital)} total capital contributed.`,
        `Projected ROI on capital: ${roi}% — target for this asset class is 20%+.`,
        `Preferred return obligations: ${fmt(totalCapital * 0.08)} at 8% (must be distributed before profit split).`,
        `${partners.filter(p=>p.distributionsReceived>0).length} partner${partners.filter(p=>p.distributionsReceived>0).length!==1?'s have':' has'} received distributions so far.`,
        `Largest stake: ${partners.sort((a,b)=>b.sharePercent-a.sharePercent)[0]?.name ?? '—'} at ${partners.sort((a,b)=>b.sharePercent-a.sharePercent)[0]?.sharePercent ?? 0}%.`,
      ],
      actions: [
        'Run Distribution Waterfall calculator to confirm entitlements before any payout.',
        'Preferred return distribution should trigger upon property sale.',
        'Send quarterly capital account statements to all partners to maintain trust.',
      ],
      riskScore: 3,
    },
    'capital-calls': {
      bullets: [
        `${companyLabel}: ${overdueCalls.length} overdue, ${capitalCalls.filter(c=>c.status==='Outstanding').length} outstanding, ${capitalCalls.filter(c=>c.status==='Paid').length} paid.`,
        overdueCalls.length > 0
          ? `Overdue total: ${fmt(overdueCalls.reduce((s,c)=>s+c.totalDue-c.received,0))} — legal action threshold approaching.`
          : 'No overdue capital calls — all partners current.',
        `Monthly EMI: ${fmt(loans.reduce((s,l)=>s+l.emi,0))} — cash ${fmt(p?.cashAvailable ?? 0)} covers ${fmt(p?.cashAvailable??0) !== '$0' ? ((p?.cashAvailable??0) / Math.max(1, loans.reduce((s,l)=>s+l.emi,0))).toFixed(1) : '0'} months.`,
        `Total outstanding receivables from partners: ${fmt(capitalCalls.filter(c=>c.status!=='Paid').reduce((s,c)=>s+c.totalDue-c.received,0))}.`,
        'Issue capital calls at least 14 days before cash falls below 1.5× monthly EMI.',
      ],
      actions: [
        overdueCalls.length > 0 ? 'Send formal demand notices to overdue partners immediately.' : 'Prepare next call based on 6-month expense forecast.',
        'Use Expense Builder to calculate call amount before issuing.',
        'Follow up 48 hours after due date — escalate to legal at day 30.',
      ],
      riskScore: overdueCalls.length > 0 ? 7 : 3,
    },
    'cash-flow': {
      bullets: [
        `${companyLabel}: ${fmt(p?.cashAvailable ?? 0)} cash on hand — ${p && p.cashAvailable < 200000 ? '⚠️ critically low' : 'adequate for operations'}.`,
        `Monthly EMI: ${fmt(loans.reduce((s,l)=>s+l.emi,0))} — runway ${p ? ((p.cashAvailable / Math.max(1, loans.reduce((s,l)=>s+l.emi,0))).toFixed(1)) : '0'} months.`,
        `Collections next 30 days: ~${fmt(pendingReceivables * 0.35)} per installment schedule.`,
        `Capital calls pending: ${fmt(capitalCalls.filter(c=>c.status!=='Paid').reduce((s,c)=>s+c.totalDue-c.received,0))} — timing critical for liquidity.`,
        `Partner distributions paid: ${fmt(partners.reduce((s,p)=>s+p.distributionsReceived,0))}.`,
      ],
      actions: [
        'Accelerate collections on contracted lots to cover EMI + operating expenses.',
        'Delay non-critical capex until Q3 collections materialize.',
        'Maintain minimum $150K cash reserve — draw credit line if collections slip.',
      ],
      riskScore: p && p.cashAvailable < 200000 ? 8 : 4,
    },
  };

  return insights[tab] ?? insights.dashboard;
}

// ── Quick-question answer generator ──────────────────────────────────────────

function answerQuickQuestion(q: string, data: ReturnType<typeof usePropDev>): string {
  const { lots, loans, partners, capitalCalls, properties, isConsolidated, companies } = data;
  const p = properties[0];
  const companyName = isConsolidated ? `the portfolio (${companies.length} companies)` : (p?.name ?? 'this company');
  const overdue = capitalCalls.filter(c => c.status === 'Overdue');
  const pending = capitalCalls.filter(c => c.status !== 'Paid');
  const cash = p?.cashAvailable ?? 0;
  const monthlyEmi = loans.reduce((s, l) => s + l.emi, 0);
  const availLots = lots.filter(l => l.status === 'available');
  const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;

  // Management fee: 9% of land cost (correct formula)
  const totalCost = p
    ? p.landCost + p.hardCost + p.softCost + p.titleCharges + p.otherCharges
      + p.propertyTax + p.loanProcessing + p.professionalCharges + p.legalFees + p.interestOnLoan
    : 0;
  const managementFee = p ? p.landCost * p.managementFeeRate : 0;
  const commission = p ? (p.commission ?? p.saleConsideration * p.commissionRate) : 0;
  const fullBreakEven = lots.length > 0 ? (totalCost + managementFee + commission) / lots.length : 0;

  if (q.includes('capital call')) {
    if (overdue.length > 0)
      return `YES — ${companyName} should call NOW. ${overdue.length} call${overdue.length>1?'s are':' is'} overdue totaling ${fmt(overdue.reduce((s,c)=>s+c.totalDue-c.received,0))}. Send demand notices immediately.`;
    if (cash < monthlyEmi * 3)
      return `YES — ${companyName} cash of ${fmt(cash)} covers only ${(cash/Math.max(1,monthlyEmi)).toFixed(1)} months of EMIs (${fmt(monthlyEmi)}/mo). Issue a call now before hitting shortfall.`;
    return `NOT URGENTLY — ${companyName} cash of ${fmt(cash)} is adequate. Next call due: ${pending[0]?.dueDate ?? 'TBD'}. Monitor monthly.`;
  }

  if (q.includes('reprice') || q.includes('lot')) {
    const cheapLots = availLots.filter(l => l.listPrice < fullBreakEven);
    if (cheapLots.length > 0)
      return `${cheapLots.length} available lot${cheapLots.length>1?'s':''} in ${companyName} priced BELOW break-even (${fmt(fullBreakEven)}): ${cheapLots.map(l=>l.lotNo).slice(0,5).join(', ')}. Raise to at least ${fmt(Math.ceil(fullBreakEven*1.1/1000)*1000)} (+10% buffer).`;
    const lowMargin = availLots.filter(l => (l.listPrice - fullBreakEven)/l.listPrice < 0.15);
    if (lowMargin.length > 0)
      return `${lowMargin.length} lots in ${companyName} have <15% margin above break-even. Consider 5–8% price increase. Focus on corner/premium-facing lots first.`;
    return `All ${availLots.length} available lots in ${companyName} clear break-even (${fmt(fullBreakEven)}). If velocity slows, try 3% bulk-purchase incentive rather than list price cuts.`;
  }

  if (q.includes('refinanc')) {
    const highRate = loans.filter(l => l.interestRate > 7.5);
    if (highRate.length > 0)
      return `YES — ${companyName} has ${highRate.length} loan${highRate.length>1?'s':''} above 7.5% (avg ${(highRate.reduce((s,l)=>s+l.interestRate,0)/highRate.length).toFixed(2)}%). Refinancing at 6.5% saves ~${fmt(highRate.reduce((s,l)=>s+l.balance*0.01/12,0))}/month.`;
    return `No urgent refinancing for ${companyName} — all loans at or below 7.5%. Watch the market and act when rates drop below 6.5%.`;
  }

  if (q.includes('partner') || q.includes('distribut')) {
    const totalCapital = partners.reduce((s, p) => s + p.capitalContributed, 0);
    const prefReturn = totalCapital * 0.08;
    const totalProfit = p ? (p.saleConsideration - totalCost - managementFee - commission) : 0;
    const afterPref = Math.max(0, totalProfit - prefReturn);
    return `${companyName} waterfall:\n① Return of capital: ${fmt(totalCapital)}\n② Preferred return (8%): ${fmt(Math.round(prefReturn))}\n③ Remaining profit split: ${fmt(Math.round(afterPref))}\nTotal distributable: ${fmt(Math.round(totalCapital + prefReturn + afterPref))}`;
  }

  if (q.includes('cash')) {
    const runway = monthlyEmi > 0 ? (cash / monthlyEmi).toFixed(1) : '∞';
    if (cash < 200000)
      return `⚠️ CRITICAL — ${companyName} cash ${fmt(cash)} dangerously low. Only ${runway} months EMI coverage. Accelerate receivables and suspend discretionary capex immediately.`;
    if (cash < 500000)
      return `CAUTION — ${companyName} has ${fmt(cash)} cash (${runway} months EMI runway). Acceptable short-term — pursue collections proactively.`;
    return `SAFE — ${companyName} has ${fmt(cash)} cash (${runway} months runway). No immediate action needed.`;
  }

  return `${companyName} snapshot: ${lots.length} lots (${lots.filter(l=>l.status==='sold').length} sold), ${fmt(p?.cashAvailable??0)} cash, ${fmt(loans.reduce((s,l)=>s+l.balance,0))} loan balance, ${fmt(totalCost + managementFee + commission)} total cost. Navigate to a specific tab for detailed analysis.`;
}

const QUICK_QUESTIONS = [
  { label: 'Should I make a capital call?',  key: 'capital call'  },
  { label: 'Which properties to reprice?',          key: 'reprice lot'   },
  { label: 'Should I refinance?',             key: 'refinanc'      },
  { label: 'What do partners get now?',       key: 'partner distribut' },
  { label: 'Is my cash position safe?',       key: 'cash'          },
];

export default function AiInsightsPanel({ onClose }: Props) {
  const data = usePropDev();
  const { tab } = usePropDevNav();
  const { properties, isConsolidated, companies } = data;
  const p = properties[0];
  const companyName = isConsolidated
    ? `Portfolio — ${companies.length} Companies`
    : (p?.name ?? 'Company');

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
    <div className="fixed right-0 top-0 h-full w-[420px] bg-gray-900 text-white shadow-2xl z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10 bg-gradient-to-r from-violet-900 to-blue-900">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles size={18} className="text-violet-300 shrink-0" />
          <div className="min-w-0">
            <div className="text-xs text-violet-300 font-medium">AI Insights</div>
            <div className="flex items-center gap-1 mt-0.5">
              <Building2 size={11} className="text-white/60 shrink-0" />
              <span className="text-sm font-bold text-white truncate">{companyName}</span>
            </div>
          </div>
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
              placeholder={`Ask about ${isConsolidated ? 'the portfolio' : companyName}…`}
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
              <p className="text-sm text-white leading-relaxed whitespace-pre-line">{answer}</p>
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
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-300">Key Insights — {isConsolidated ? 'All Companies' : companyName}</h3>
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
        Data: {companyName} · {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </div>
    </div>
  );
}
