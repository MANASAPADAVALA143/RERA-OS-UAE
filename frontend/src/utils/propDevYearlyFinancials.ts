/**
 * Convert company yearly_pl / yearly_bs / yearly_cf JSON into uploaded-financial shape.
 * Same logic as Financials tab resolveFinForCompany fallback.
 */
import type { CompanyData, YearlyBS, YearlyCF, YearlyPL } from '../contexts/PropertyDevContext';
import type { PropDevFinItem, PropDevUploadedFinancials } from './propDevFinancialApi';
import { pruneInactivePropDevYears } from './propDevPeriodKpis';
import { clubPartnerInvestmentSectionRows, PARTNER_INVESTMENTS_CLUB_LABEL, tidyPropDevStatementRows } from './finItemYearUtils';

function makeItem(label: string, values: Record<number, number>, opts?: Partial<PropDevFinItem>): PropDevFinItem {
  return { label, values, indent: 0, isTotal: false, isSectionHeader: false, isNetIncome: false, ...opts };
}

function wwbgBuildPL(yearlyPL: Record<string, YearlyPL>, years: number[]): PropDevFinItem[] {
  const yv = (key: keyof YearlyPL) =>
    Object.fromEntries(years.map(y => [y, yearlyPL[String(y)]?.[key] as number ?? 0])) as Record<number, number>;
  const items: PropDevFinItem[] = [
    makeItem('Income', {}, { isSectionHeader: true }),
    makeItem('Lot Sales Revenue', Object.fromEntries(years.map(y => [y, 0]))),
    makeItem('Other Income', Object.fromEntries(years.map(y => [y, Math.abs(yearlyPL[String(y)]?.other_income ?? 0)]))),
    makeItem('Total for Income', Object.fromEntries(years.map(y => [y, Math.abs(yearlyPL[String(y)]?.other_income ?? 0)])), { isTotal: true }),
    makeItem('Expenses', {}, { isSectionHeader: true }),
  ];

  const firstWithCats = years.find(y => Object.keys(yearlyPL[String(y)]?.expenses_by_category ?? {}).length > 0);
  const catLabels: Record<string, string> = {
    interest_on_loan: 'Business Loan Interest',
    property_tax: 'Property Tax',
    hard_cost: 'Engineering Cost',
    soft_cost: 'Appraisal Fee',
    professional_charges: 'Book Keeping & Professional',
    legal_fees: 'Legal & Professional',
    title_charges: 'Escrow & Title Charges',
    loan_processing: 'Loan Processing Fee',
    other_charges: 'Management & Other',
  };
  if (firstWithCats !== undefined) {
    const allCats = Object.keys(yearlyPL[String(firstWithCats)]?.expenses_by_category ?? {});
    for (const cat of allCats) {
      const catVals = Object.fromEntries(
        years.map(y => [y, yearlyPL[String(y)]?.expenses_by_category?.[cat] ?? 0]),
      ) as Record<number, number>;
      items.push(makeItem(catLabels[cat] ?? cat, catVals, { indent: 2 }));
    }
  }

  items.push(makeItem('Total for Expenses', yv('total_expenses'), { isTotal: true }));
  items.push(makeItem('Net Income', yv('net_income'), { isNetIncome: true }));
  return items;
}

function wwbgBuildBS(yearlyBS: Record<string, YearlyBS>, years: number[]): PropDevFinItem[] {
  const yv = (key: keyof YearlyBS) =>
    Object.fromEntries(years.map(y => [y, yearlyBS[String(y)]?.[key] as number ?? 0])) as Record<number, number>;
  const equityVals = Object.fromEntries(years.map(y => {
    const bs = yearlyBS[String(y)];
    return [y, bs ? bs.total_assets - bs.total_liabilities : 0];
  })) as Record<number, number>;

  return [
    makeItem('Current Assets', {}, { isSectionHeader: true }),
    makeItem('Total for Bank Accounts', yv('cash'), { isTotal: true }),
    makeItem('Fixed Assets', {}, { isSectionHeader: true }),
    makeItem('WWBL (Land)', yv('land'), { indent: 2 }),
    makeItem('Improvements', yv('improvements'), { indent: 2 }),
    makeItem('Interest Capitalised', yv('interest_capitalised'), { indent: 2 }),
    makeItem('Total for Assets', yv('total_assets'), { isTotal: true }),
    makeItem('Liabilities', {}, { isSectionHeader: true }),
    makeItem('Long-term Business Loan (Greater Plains Bank)', yv('loan_balance'), { indent: 2 }),
    makeItem('Total for Liabilities', yv('total_liabilities'), { isTotal: true }),
    makeItem('Equity', {}, { isSectionHeader: true }),
    makeItem('Total for Equity', equityVals, { isTotal: true }),
  ];
}

export function wwbgBuildCF(yearlyCF: Record<string, YearlyCF>, years: number[]): PropDevFinItem[] {
  const yv = (key: keyof YearlyCF) =>
    Object.fromEntries(years.map(y => [y, yearlyCF[String(y)]?.[key] ?? 0])) as Record<number, number>;

  return [
    makeItem('Operating Activities', {}, { isSectionHeader: true }),
    makeItem('Operating Cash Flow', yv('operating'), { indent: 2 }),
    makeItem('Investing Activities', {}, { isSectionHeader: true }),
    makeItem('Investing Cash Flow (land / development spend)', yv('investing'), { indent: 2 }),
    makeItem('Financing Activities', {}, { isSectionHeader: true }),
    makeItem('Financing Cash Flow (capital calls + loan draws)', yv('financing'), { indent: 2 }),
    makeItem('Partner Investments', yv('partner_investments'), { indent: 2 }),
    makeItem('Net Change in Cash', yv('net_change'), { isTotal: true, isNetIncome: true }),
  ];
}

function normalizeCfLabel(label: string): string {
  return label
    .replace(/\u00a0/g, ' ')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/[\uFF1A\uFE55]/g, ':')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Exact rollup / total — keep as-is (not a per-partner detail line). */
function isPartnerInvestmentRollupLabel(label: string): boolean {
  const t = normalizeCfLabel(label);
  return /^total\s+(for\s+)?partner\s+investments?$/i.test(t)
    || /^partner\s+investments?$/i.test(t);
}

/**
 * Per-partner CF lines, e.g. "Partner investments:Bhanu Pittampally - Capital".
 * Matches any Partner investment(s) line that is not the bare rollup/total.
 */
function isPartnerInvestmentDetailLabel(label: string): boolean {
  const t = normalizeCfLabel(label).replace(/\s*:\s*/g, ':');
  if (!/^partner\s+investments?\b/i.test(t)) return false;
  if (isPartnerInvestmentRollupLabel(t)) return false;
  return true;
}

/**
 * Club all "Partner investments:Name…" CF lines into one "Partner Investments" total.
 * If a rollup/"Total for Partner investments" already exists, keep that amount and
 * drop the detail lines (rename Total → Partner Investments so tidy does not delete it).
 */
export function clubPartnerInvestmentCfRows<T extends PropDevFinItem>(items: T[]): T[] {
  // Section-shaped workbooks: "Partner investments" band + plain "Name - Equity" rows.
  const sectioned = clubPartnerInvestmentSectionRows(items);
  const details = sectioned.filter(i => isPartnerInvestmentDetailLabel(i.label));
  if (!details.length) {
    // Still canonicalize a lone Total / bare rollup to the board label.
    return sectioned.map(i =>
      isPartnerInvestmentRollupLabel(i.label)
        ? ({
            ...i,
            label: PARTNER_INVESTMENTS_CLUB_LABEL,
            isTotal: false,
            isSectionHeader: false,
            isNetIncome: false,
          } as T)
        : i,
    );
  }
  items = sectioned;

  const totals = items.filter(i => /^total\s+(for\s+)?partner\s+investments?$/i.test(normalizeCfLabel(i.label)));
  const bares = items.filter(i => /^partner\s+investments?$/i.test(normalizeCfLabel(i.label)));
  if (totals.length || bares.length) {
    const source = totals[0] ?? bares[0]!;
    const values: Record<number, number> = { ...(source.values ?? {}) };
    const monthlyValues: Record<string, number> = source.monthlyValues ? { ...source.monthlyValues } : {};
    // Fill $0 years on the rollup from leaf detail (parent often holds early years only).
    const leafDetails = details.filter(d =>
      !details.some(o => o !== d && (
        normalizeCfLabel(o.label).replace(/\s*:\s*/g, ':').startsWith(`${normalizeCfLabel(d.label).replace(/\s*:\s*/g, ':')}:`)
      )),
    );
    for (const item of leafDetails.length ? leafDetails : details) {
      for (const [k, v] of Object.entries(item.values ?? {})) {
        const y = Number(k);
        if (!Number.isFinite(y)) continue;
        const n = typeof v === 'number' ? v : Number(String(v).replace(/[,$]/g, ''));
        if (!Number.isFinite(n)) continue;
        if ((values[y] ?? 0) === 0 && n !== 0) values[y] = n;
      }
      if (item.monthlyValues) {
        for (const [k, v] of Object.entries(item.monthlyValues)) {
          if ((monthlyValues[k] ?? 0) === 0 && (Number(v) || 0) !== 0) {
            monthlyValues[k] = Number(v) || 0;
          }
        }
      }
    }
    const clubbed = {
      ...source,
      label: PARTNER_INVESTMENTS_CLUB_LABEL,
      values,
      monthlyValues: Object.keys(monthlyValues).length ? monthlyValues : undefined,
      isTotal: false,
      isSectionHeader: false,
      isNetIncome: false,
    } as T;
    const out: T[] = [];
    let inserted = false;
    for (const item of items) {
      if (isPartnerInvestmentDetailLabel(item.label) || isPartnerInvestmentRollupLabel(item.label)) {
        if (!inserted) {
          out.push(clubbed);
          inserted = true;
        }
        continue;
      }
      out.push(item);
    }
    return out;
  }

  // Sum leaf colon paths only — parent "…:VR Estates - Equity" often includes children.
  const leafDetails = details.filter(d =>
    !details.some(o => o !== d && (
      normalizeCfLabel(o.label).replace(/\s*:\s*/g, ':').startsWith(`${normalizeCfLabel(d.label).replace(/\s*:\s*/g, ':')}:`)
      || normalizeCfLabel(o.label).replace(/\s*:\s*/g, ':').startsWith(`${normalizeCfLabel(d.label).replace(/\s*:\s*/g, ':')} :`)
    )),
  );
  const sumDetails = leafDetails.length ? leafDetails : details;

  const values: Record<number, number> = {};
  const monthlyValues: Record<string, number> = {};
  let indent = sumDetails[0]?.indent ?? 2;
  for (const item of sumDetails) {
    for (const [k, v] of Object.entries(item.values ?? {})) {
      const y = Number(k);
      if (!Number.isFinite(y)) continue;
      const n = typeof v === 'number' ? v : Number(String(v).replace(/[,$]/g, ''));
      if (!Number.isFinite(n)) continue;
      values[y] = (values[y] ?? 0) + n;
    }
    if (item.monthlyValues) {
      for (const [k, v] of Object.entries(item.monthlyValues)) {
        monthlyValues[k] = (monthlyValues[k] ?? 0) + (Number(v) || 0);
      }
    }
  }

  const clubbed = {
    ...sumDetails[0],
    label: PARTNER_INVESTMENTS_CLUB_LABEL,
    values,
    indent,
    monthlyValues: Object.keys(monthlyValues).length ? monthlyValues : undefined,
    isTotal: false,
    isSectionHeader: false,
    isNetIncome: false,
  } as T;

  const out: T[] = [];
  let inserted = false;
  for (const item of items) {
    if (isPartnerInvestmentDetailLabel(item.label)) {
      if (!inserted) {
        out.push(clubbed);
        inserted = true;
      }
      continue;
    }
    out.push(item);
  }
  return out;
}

/** Same resolution as the Cash Flow tab: uploaded CF rows, else company yearlyCF seed. */
export function resolvePropDevCfItems(
  fin: { years: number[]; cf?: PropDevFinItem[] | null },
  company?: CompanyData | null,
): PropDevFinItem[] {
  let rows: PropDevFinItem[] = [];
  if (fin.cf && fin.cf.length > 0) {
    rows = fin.cf;
  } else {
    const yearlyCF = company?.property.yearlyCF;
    if (!yearlyCF || Object.keys(yearlyCF).length === 0) return [];
    const years = Array.from(new Set([
      ...fin.years,
      ...Object.keys(yearlyCF).map(Number).filter(n => !Number.isNaN(n)),
    ])).sort((a, b) => a - b);
    rows = wwbgBuildCF(yearlyCF, years);
  }
  return tidyPropDevStatementRows(clubPartnerInvestmentCfRows(rows));
}

/** Fill empty `fin.cf` from yearlyCF so PDF / KPIs match the Cash Flow tab. Always clubs partner lines. */
export function enrichPropDevFinWithCf<T extends { years: number[]; cf?: PropDevFinItem[] | null }>(
  fin: T,
  company?: CompanyData | null,
): T {
  const baseCf = (fin.cf?.length ?? 0) > 0
    ? (fin.cf as PropDevFinItem[])
    : resolvePropDevCfItems(fin, company);
  if (!baseCf.length) return fin;
  // resolve already clubs + tidies; club/tidy again for uploaded cf that skipped resolve.
  const cf = tidyPropDevStatementRows(clubPartnerInvestmentCfRows(baseCf));
  return { ...fin, cf };
}

export function buildYearlyUploadedFinancials(company: CompanyData): PropDevUploadedFinancials | null {
  const yearlyPL = company.property.yearlyPL;
  const yearlyBS = company.property.yearlyBS;
  const yearlyCF = company.property.yearlyCF;
  if (!yearlyPL && !yearlyBS && !yearlyCF) return null;

  const allYears = Array.from(new Set([
    ...Object.keys(yearlyPL ?? {}),
    ...Object.keys(yearlyBS ?? {}),
    ...Object.keys(yearlyCF ?? {}),
  ])).map(Number).filter(n => !Number.isNaN(n)).sort((a, b) => a - b);
  if (!allYears.length) return null;

  return pruneInactivePropDevYears({
    companyName: company.name,
    years: allYears,
    plFile: 'From database (yearly summary)',
    bsFile: 'From database (yearly summary)',
    uploadedAt: new Date().toISOString(),
    pl: yearlyPL ? wwbgBuildPL(yearlyPL, allYears) : [],
    bs: yearlyBS ? wwbgBuildBS(yearlyBS, allYears) : [],
    cf: yearlyCF ? wwbgBuildCF(yearlyCF, allYears) : [],
  });
}

export function resolveCompanyUploadedFinancials(
  company: CompanyData,
  fromApi?: PropDevUploadedFinancials | null,
): PropDevUploadedFinancials | null {
  if (fromApi && (fromApi.pl.length > 0 || fromApi.bs.length > 0 || (fromApi.cf?.length ?? 0) > 0)) {
    return enrichPropDevFinWithCf(fromApi, company);
  }
  return buildYearlyUploadedFinancials(company);
}
