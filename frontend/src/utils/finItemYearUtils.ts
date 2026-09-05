/** Shared helpers for P&L / BS / CF line items â€” year keys, merge on upload. */

import { isBareSectionHeaderLabel } from './financialExcelParser';

export interface FinItemLike {
  label: string;
  values: Record<number | string, number>;
  monthlyValues?: Record<string, number>;
  indent: number;
  isTotal: boolean;
  isSectionHeader: boolean;
  isNetIncome: boolean;
  /** True when the label came from an uploaded Category column. Category-driven
   * datasets are already clean (one row per category, blanks dropped, duplicates
   * summed) and must skip the legacy label-pattern "club*" pipeline below, which
   * exists only to guess categories out of raw, uncategorized QBO account text. */
  fromCategory?: boolean;
}

/**
 * True once any row in a dataset is category-driven, so legacy label-pattern
 * clubbing is skipped entirely and the Category column trusted as-is.
 * Deliberately `some`, not `every`: strict Category parsing already drops every
 * blank-Category detail row at parse time (totals/headers/net income are exempt
 * from that drop and never carry fromCategory), so a real category upload will
 * have every surviving detail row flagged already — requiring *all* of them made
 * one missed cell anywhere in the file silently revert the whole statement back
 * to legacy regex guessing, which is exactly the inconsistent per-company
 * behavior the Category column exists to eliminate.
 */
function isCategoryDrivenDataset<T extends FinItemLike>(items: T[]): boolean {
  const detail = items.filter(i => !i.isTotal && !i.isSectionHeader && !i.isNetIncome);
  if (!detail.length) return false;
  return detail.some(i => i.fromCategory === true);
}

/** JSON round-trips and some DB drivers stringify year keys â€” accept both shapes. */
export function yearVal(values: Record<number | string, number> | undefined, y: number): number {
  if (!values) return 0;
  // Declared type says every value is `number`, but the whole point of this function is
  // to tolerate real-world data that violates that (stringified numbers from JSON/DB
  // round-trips) â€” without this `unknown` annotation, TS narrows the string branch below
  // to `never` and .trim() no longer typechecks.
  const raw: unknown = values[y] ?? values[String(y)];
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(String(raw).replace(/[,$]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** Collect fiscal years present in line-item value maps (ignores junk keys). */
export function yearsFromItems(items: FinItemLike[]): number[] {
  const ys = new Set<number>();
  for (const item of items) {
    for (const k of Object.keys(item.values ?? {})) {
      const n = Number(k);
      if (Number.isFinite(n) && n >= 1990 && n <= 2100) ys.add(n);
    }
  }
  return [...ys].sort((a, b) => a - b);
}

/**
 * Collect fiscal years that have at least one non-zero value in the statement rows.
 * Useful when uploads contain year headers/keys but the amounts are all blank/0.
 */
export function yearsFromItemsWithNonZeroValues(items: FinItemLike[]): number[] {
  const ys = new Set<number>();
  for (const item of items) {
    for (const k of Object.keys(item.values ?? {})) {
      const n = Number(k);
      if (!Number.isFinite(n) || n < 1990 || n > 2100) continue;
      if (yearVal(item.values, n) !== 0) ys.add(n);
    }
  }
  return [...ys].sort((a, b) => a - b);
}

/** True for empty section title rows (CONSULTING EXP, Income, Assets, â€¦) â€” not rolled-up amounts. */
export function isEmptySectionHeaderRow(item: FinItemLike, years?: number[]): boolean {
  if (item.isTotal || item.isNetIncome) return false;
  const ys = years?.length ? years : yearsFromItems([item]);
  const hasAmount = ys.some(y => yearVal(item.values, y) !== 0)
    || Object.keys(item.values ?? {}).some(k => {
      const y = Number(k);
      return Number.isFinite(y) && yearVal(item.values, y) !== 0;
    });
  if (hasAmount) return false;
  if (item.isSectionHeader) return true;
  // Structural BS bands (Other Current Assets, Bank Accounts, â€¦) with only $0 cells
  // are empty shells â€” drop unless a later pass finds non-zero children.
  return isBareSectionHeaderLabel(item.label) || isStructuralSubHeaderLabel(item.label);
}

function absYearSum(item: FinItemLike, years: number[]): number {
  return years.reduce((s, y) => s + Math.abs(yearVal(item.values, y)), 0);
}

/** Meaningful non-zero for YoY boards — ignore ±$0.00 noise / float dust. */
const STATEMENT_AMOUNT_EPS = 0.005;

export function rowHasMeaningfulYearAmount(item: FinItemLike, years: number[]): boolean {
  return years.some(y => Math.abs(yearVal(item.values, y)) > STATEMENT_AMOUNT_EPS);
}

/** Income / Expenses / Assets / … — not empty QBO expense shells (Loan Consulting fee, Escrow, …). */
export function isMajorPropDevStatementBanner(label: string): boolean {
  return /^(income|other\s+income|expenses?|cost of goods sold|gross profit|other expenses?|assets|liabilit(?:y|ies)|equity|operating\s+activit(?:y|ies)|investing\s+activit(?:y|ies)|financing\s+activit(?:y|ies))$/i.test(
    label.trim(),
  );
}

/** True when the line has any non-zero annual or monthly amount (drop pure $0 noise rows). */
export function hasNonZeroStatementAmount(item: FinItemLike, years?: number[]): boolean {
  if (item.isNetIncome) return true;
  const ys = years?.length ? years : yearsFromItems([item]);
  if (ys.length && absYearSum(item, ys) !== 0) return true;
  if (!ys.length && Object.keys(item.values ?? {}).some(k => {
    const y = Number(k);
    return Number.isFinite(y) && yearVal(item.values, y) !== 0;
  })) return true;
  return Object.values(item.monthlyValues ?? {}).some(v => Number(v) !== 0);
}

function normLabel(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Canonical label when accounting / book-keeping expense lines are clubbed together. */
export const BOOK_KEEPING_CHARGES_CLUB_LABEL = 'Book Keeping Charges';

/** @deprecated Alias — accounting fees club into {@link BOOK_KEEPING_CHARGES_CLUB_LABEL}. */
export const ACCOUNTING_BOOKKEEPING_CLUB_LABEL = BOOK_KEEPING_CHARGES_CLUB_LABEL;

/** Canonical label when legal / professional / office / shipping lines are clubbed. */
export const LEGAL_PROFESSIONAL_CLUB_LABEL = 'Professional services';

/** Folded into Professional services â€” kept for older imports. */
export const OFFICE_EXPENSE_CLUB_LABEL = LEGAL_PROFESSIONAL_CLUB_LABEL;

/** Canonical label when salary / wage / per-diem expense lines are clubbed. */
export const OTHER_SALARIES_WAGES_CLUB_LABEL = 'Other salaries and wages';

/** Canonical label when software / membership subscription expense lines are clubbed. */
export const SOFTWARE_SUBSCRIPTIONS_CLUB_LABEL = 'Software & Other Subscriptions';

/** Canonical label when property-tax expense lines are clubbed. */
export const PROPERTY_TAXES_CLUB_LABEL = 'Property taxes';

/** Canonical label when travel / hotel expense lines are clubbed. */
export const TRAVEL_HOTELS_CLUB_LABEL = 'Travel and hotels';

/** Canonical label when electricity / internet utility lines are clubbed. */
export const ELECTRICITY_INTERNET_CLUB_LABEL = 'Electricity and Internet services';

/** Canonical label when other-income variants are clubbed. */
export const OTHER_INCOME_CLUB_LABEL = 'Other Income';

/** Canonical label when vehicle expense variants are clubbed. */
export const VEHICLE_EXPENSES_CLUB_LABEL = 'Vehicle expenses';

/** Canonical label when miscellaneous expense variants are clubbed together. */
export const MISCELLANEOUS_EXPENSE_CLUB_LABEL = 'Miscellaneous Expenses';

/** Canonical label when General / Other Business Expenses are clubbed. */
export const GENERAL_BUSINESS_EXPENSES_CLUB_LABEL = 'General business expenses';

/** Canonical label when Water & sewer utility account lines are clubbed. */
export const WATER_SEWER_CLUB_LABEL = 'Water & sewer';

/** Canonical label when Cleaning / Janitorial expense variants are clubbed. */
export const JANITORIAL_EXPENSES_CLUB_LABEL = 'Janitorial expenses';

/** Canonical label when QuickBooks colon-nested Improvements rows are clubbed. */
export const IMPROVEMENTS_CLUB_LABEL = 'Improvements';

/** Canonical label for long-term business loan CF/BS bands (drop nested bank detail). */
export const LONG_TERM_BUSINESS_LOANS_CLUB_LABEL = 'Long-term business loans';

/** Canonical label when related-party loan lines are clubbed together. */
export const INTERCOMPANY_LOANS_CLUB_LABEL = 'Inter Company Loans';

/** Canonical label when insurance expense variants are clubbed together. */
export const PROPERTY_INSURANCE_CLUB_LABEL = 'Property insurance';

/** Canonical label when reimbursement CF/BS detail rows are clubbed. */
export const REIMBURSEMENT_CLUB_LABEL = 'Reimbursement';

/** Canonical label when Sale of Land / Lot / Property revenue variants are clubbed. */
export const SALE_OF_PROPERTY_CLUB_LABEL = 'Sale of Property';

/** @deprecated Alias — Sale of Land now clubs into {@link SALE_OF_PROPERTY_CLUB_LABEL}. */
export const SALE_OF_LAND_CLUB_LABEL = SALE_OF_PROPERTY_CLUB_LABEL;

/** Canonical label when BS land parcel / Total for Land rows are clubbed. */
export const LAND_CLUB_LABEL = 'Land';

/** Canonical label when asset "Investment in …" / Investments rows are clubbed. */
export const INVESTMENTS_CLUB_LABEL = 'Investments';

/** Canonical label when Owner's Investment:… equity detail is clubbed. */
export const OWNERS_INVESTMENTS_CLUB_LABEL = "Owner's Investments";

/** Canonical label when Partner investments:… equity / CF detail is clubbed. */
export const PARTNER_INVESTMENTS_CLUB_LABEL = 'Partner Investments';

/**
 * Canonical label when entity / company "… Equity" contribution lines are clubbed
 * ("Texas Spark Constructions Equity", "VR Estates Equity", …).
 * Partner personal-name capital lines stay separate.
 */
export const TOTAL_EQUITY_CLUB_LABEL = 'Total Equity';

/** Canonical label when equity shareholder distribution rows are clubbed. */
export const SHAREHOLDER_DISTRIBUTION_CLUB_LABEL = 'Shareholder Distribution';

/** Canonical label when Accu Dep / Accumulated Depreciation detail is clubbed. */
export const ACCUMULATED_DEPRECIATION_CLUB_LABEL = 'Accumulated Depreciation';

/** Canonical label when Loans & Advances / Loan to â€¦ detail is clubbed. */
export const LOANS_AND_ADVANCES_CLUB_LABEL = 'Loans & Advances';

/** Canonical label when payroll wages / tax payable detail is clubbed. */
export const PAYROLL_WAGES_AND_TAX_CLUB_LABEL = 'Payroll wages and tax';

/** Canonical label when Fixed Assets / year Fixed Assets detail is clubbed. */
export const FIXED_ASSETS_CLUB_LABEL = 'Fixed Assets';

/** Canonical label when Other Current Assets colon-detail lines are clubbed. */
export const OTHER_CURRENT_ASSETS_CLUB_LABEL = 'Other Current Assets';

/** Canonical label when Riviera investor / partner loan lines are clubbed. */
export const LOAN_FOR_RIVIERA_CLUB_LABEL = 'Loan for Riviera';

/**
 * Canonical board label for non-bank long-term / "from others" loan lines.
 */
export const LOANS_AND_ADVANCES_FROM_OTHERS_CLUB_LABEL = 'Long Term Loans Others';

/**
 * Canonical label when property / GPB–GBP / loan-account liability lines are clubbed
 * ("GPB Loan", "GPB Suite 120 Loan", "Loan on Property", …).
 */
export const LOANS_CLUB_LABEL = 'Loan';

/**
 * Canonical label when Building / CWIP / property / Building Improvement lines are clubbed.
 * (Former separate "Buildings" + "Building Improvement" board lines.)
 */
export const BUILDINGS_CLUB_LABEL = 'Buildings';

/** @deprecated Alias — Building Improvement now clubs into {@link BUILDINGS_CLUB_LABEL}. */
export const BUILDING_IMPROVEMENT_CLUB_LABEL = BUILDINGS_CLUB_LABEL;

/** Canonical label when Other Payables colon-detail lines are clubbed. */
export const OTHER_PAYABLES_CLUB_LABEL = 'Other Payables';

/** Canonical label when unit rent / Rental Income lines are clubbed. */
export const RENTAL_INCOME_CLUB_LABEL = 'Rental Income';

/** Canonical label when Other Long Term Loans colon-detail lines are clubbed. */
export const OTHER_LONG_TERM_LOANS_CLUB_LABEL = 'Other Long Term Loans';

/** Canonical label when Short Term Loans & Liabilities detail lines are clubbed. */
export const SHORT_TERM_LOANS_AND_LIABILITIES_CLUB_LABEL = 'Short Term Loans and Liabilities';

/** Canonical label when per-suite / per-property HOA lines are clubbed. */
export const SUITE_HOA_CLUB_LABEL = 'Suite HOA';

/** Canonical label when C-to-S conversion retained-earnings detail is clubbed. */
export const RE_CONVERSION_C_TO_S_CLUB_LABEL = 'RE from Conversion of C to S';

/**
 * Canonical label when institutional bank term loans (Bank Ozk, Loan - No, …)
 * are clubbed under Long-term Liabilities. Property-tagged "Bank Loan - …" lines stay separate.
 */
export const BANK_LOANS_CLUB_LABEL = 'Bank Loans';

const EXPENSE_CLUB_RULES: Array<{ key: string; label: string; test: (n: string) => boolean }> = [
  {
    // Per-suite / per-property HOA dues, e.g. "4433 Punjabway Suit 400 HOA", "Suit - 410 /HOA".
    key: 'suite-hoa',
    label: SUITE_HOA_CLUB_LABEL,
    test: n =>
      /\bhoa\b/i.test(n)
      && !/\b(payable|payables|receivable|receivables|prepaid|deposit|deposits|liabilit)\b/i.test(n),
  },
  {
    key: 'accounting-bookkeeping',
    label: ACCOUNTING_BOOKKEEPING_CLUB_LABEL,
    test: n =>
      /book\s*[- ]?keep|bookkeeper/i.test(n)
      || (/accounting/i.test(n) && /charge|fee|expense|services?/i.test(n))
      || /^accounting\s+(charges?|fees?)$/i.test(n),
  },
  {
    key: 'legal-professional',
    label: LEGAL_PROFESSIONAL_CLUB_LABEL,
    test: n =>
      (/\blegal\b/i.test(n) && /professional|attorney|services?|fee(s)?/i.test(n))
      || /^professional\s+(charges?|fees?|services?)$/i.test(n)
      || /^office\s+exp(ense)?s?$/i.test(n)
      || /^office\s+(expenses?|costs?|supplies?)$/i.test(n)
      || /^office\s+exp\b/i.test(n)
      || /^shipping\s*(&|and)?\s*postage$/i.test(n)
      || /^postage\s*(&|and)?\s*shipping$/i.test(n)
      || /^postage$/i.test(n)
      || /^shipping$/i.test(n)
      // Bare "Other Expenses" detail rows (not Other Operating Expenses section totals).
      || /^other\s+expenses?$/i.test(n),
  },
  {
    key: 'other-salaries-wages',
    label: OTHER_SALARIES_WAGES_CLUB_LABEL,
    test: n =>
      /^other\s+salaries?\s*(&|and)?\s*wages?$/i.test(n)
      || /^salaries?\s*(&|and)?\s*wages?$/i.test(n)
      || /^wages?\s*(&|and)?\s*salaries?$/i.test(n)
      || /^per\s*[- ]?diems?$/i.test(n),
  },
  {
    key: 'software-subscriptions',
    label: SOFTWARE_SUBSCRIPTIONS_CLUB_LABEL,
    test: n =>
      /^software\s*(&|and)?\s*other\s+subscriptions?$/i.test(n)
      || /^software\s+subscriptions?$/i.test(n)
      || /^memberships?\s*(&|and)?\s*subscriptions?$/i.test(n)
      || /^subscriptions?\s*(&|and)?\s*memberships?$/i.test(n),
  },
  {
    key: 'property-taxes',
    label: PROPERTY_TAXES_CLUB_LABEL,
    test: n =>
      !/\b(payable|payables|liabilit)\b/i.test(n)
      && (
        /^property\s*tax(?:es)?$/i.test(n)
        || /property\s*tax(?:es)?\b/i.test(n)
        || /prop(?:erty)?\s*tax(?:es)?\b/i.test(n)
        // Parcel / CAD account lines: "P900… - B-400 Property Tax", "R969…B04001 - B400 Property Tax"
        // Also Denton CAD style: "307567DEN -5880 Clearwater Dr…", "14C45260000010200 -2414 Marsh Lane…"
        // Bare ids after address strip: "1015230DEN"
        || (/^[pr]\d{4,}[a-z0-9]*\b/i.test(n) && /\btax(?:es)?\b/i.test(n))
        || (/^[pr]\d{4,}[a-z0-9]*\b/i.test(n) && /\bb-?\d{3}\b/i.test(n))
        || /^\d{4,}den$/i.test(n)
        || /^taxes\s+paid$/i.test(n)
        || isCadParcelTaxAccountLabel(n)
      ),
  },
  {
    key: 'travel-hotels',
    label: TRAVEL_HOTELS_CLUB_LABEL,
    test: n =>
      /^travel(\s*(&|and)?\s*hotels?)?$/i.test(n)
      || /^hotels?$/i.test(n)
      || /^travel\s*(&|and)?\s*(lodging|meals|entertainment)$/i.test(n),
  },
  {
    key: 'electricity-internet',
    label: ELECTRICITY_INTERNET_CLUB_LABEL,
    test: n =>
      /^electricity(\s*(&|and)?\s*internet(\s+services?)?)?$/i.test(n)
      || /^electricity\s+account(\s+no\.?)?$/i.test(n)
      || /^internet\s*(&|and)?\s*tv\s+services?$/i.test(n)
      || /^internet(\s+services?)?$/i.test(n)
      || /^internet\s*[#(]/i.test(n)
      || /^utilities?\s*[-–—:]\s*(electricity|internet)/i.test(n),
  },
  {
    key: 'other-income',
    label: OTHER_INCOME_CLUB_LABEL,
    test: n =>
      /^other\s+income$/i.test(n)
      || /^other\s+miscellaneous\s+income$/i.test(n)
      || /^miscellaneous\s+income$/i.test(n)
      || /^other\s+misc\.?\s+income$/i.test(n),
  },
  {
    key: 'vehicle-expenses',
    label: VEHICLE_EXPENSES_CLUB_LABEL,
    test: n =>
      /^vehicle\s+expenses?$/i.test(n)
      || /^vehicle\s+gas\s*(&|and)?\s*fuels?$/i.test(n)
      || /^gas\s*(&|and)?\s*fuels?$/i.test(n)
      || /^parking\s*(&|and)?\s*tolls?$/i.test(n)
      || /^tolls?\s*(&|and)?\s*parking$/i.test(n)
      || /^automobile\s+expenses?$/i.test(n)
      || /^auto\s+expenses?$/i.test(n),
  },
  {
    key: 'miscellaneous-expense',
    label: MISCELLANEOUS_EXPENSE_CLUB_LABEL,
    // Includes common misspelling "Miscelleneous" from source ledgers.
    test: n =>
      /^misc(ellaneous|elleneous)?\s+(exp(ense)?s?|charges?|costs?)?$/i.test(n)
      || /^miscellaneous\s+(expenses?|charges?|costs?)?$/i.test(n)
      || /^miscelleneous\s+(expenses?|charges?|costs?)?$/i.test(n)
      || /^misc\.?\s+(expenses?|charges?)$/i.test(n),
  },
  {
    key: 'janitorial-expenses',
    label: JANITORIAL_EXPENSES_CLUB_LABEL,
    test: n =>
      /^cleaning(\s+(exp(ense)?s?|charges?|costs?|fees?))?\b/i.test(n)
      || /^janitorial(\s+(exp(ense)?s?|charges?|costs?|fees?|services?))?\b/i.test(n),
  },
  {
    key: 'water-sewer',
    label: WATER_SEWER_CLUB_LABEL,
    test: n =>
      /^water\s*(&|and|\/)\s*sewers?\b/i.test(n)
      || /^water\s+and\s+sewer(age)?\b/i.test(n)
      || /^sewer\s*(&|and|\/)\s*water\b/i.test(n),
  },
  {
    key: 'general-business-expenses',
    label: GENERAL_BUSINESS_EXPENSES_CLUB_LABEL,
    test: n => {
      const leaf = n.includes(':') ? (n.split(':').pop() ?? n).trim() : n;
      return /^general\s+business\s+exp(ense)?s?$/i.test(leaf)
        || /^other\s+business\s+exp(ense)?s?$/i.test(leaf)
        || /^utilities?(\s+(exp(ense)?s?|charges?))?$/i.test(leaf)
        || /^impact\s+fees?$/i.test(leaf)
        || /^commissions?\s*(&|and)?\s*fees?$/i.test(leaf)
        || /^commissions?$/i.test(leaf)
        || /^commitment\s+fees?$/i.test(leaf)
        || /^engineering\s+services?$/i.test(leaf)
        || /^engineering$/i.test(leaf);
    },
  },
  {
    key: 'property-insurance',
    label: PROPERTY_INSURANCE_CLUB_LABEL,
    test: n =>
      /^insurance$/i.test(n)
      || /^property\s+insurance$/i.test(n)
      || /^business\s+insurance$/i.test(n)
      || /^insurance\s+(expense|premium|premiums)$/i.test(n)
      || /^general\s+liability\s+insurance$/i.test(n),
  },
  {
    key: 'reimbursement',
    label: REIMBURSEMENT_CLUB_LABEL,
    test: n =>
      /^reimbursements?$/i.test(n)
      || /^reimbursements?\s*[-:]/i.test(n)
      || /\breimbursements?\b/i.test(n),
  },
  {
    key: 'sale-of-property',
    label: SALE_OF_PROPERTY_CLUB_LABEL,
    test: n => isSaleOfPropertyDetailNorm(n),
  },
];

/** Sale of Land / Lot / Property detail (normalized label, non-total). */
function isSaleOfPropertyDetailNorm(n: string): boolean {
  // QBO often nests under Income:/Sales: — match the leaf after the last colon.
  const leaf = n.includes(':') ? (n.split(':').pop() ?? n).trim() : n;
  return /^sale\s+of\s+(land|lots?|propert(?:y|ies))\b/i.test(leaf)
    || /^(land|lot|property)\s+sales?\b/i.test(leaf)
    || /^(gain|loss)\s+on\s+(the\s+)?sale\s+of\s+(land|lots?|propert(?:y|ies))\b/i.test(leaf)
    || /(?:^|:)\s*sale\s+of\s+(land|lots?|propert(?:y|ies))\b/i.test(n);
}

function isTotalForSaleOfPropertyLabel(label: string): boolean {
  const n = normLabel(label);
  const leaf = n.includes(':') ? (n.split(':').pop() ?? n).trim() : n;
  return /^total\s+(for\s+)?sale\s+of\s+(land|lots?|propert(?:y|ies))\b/i.test(n)
    || /^total\s+(for\s+)?(land|lot|property)\s+sales?\b/i.test(n)
    || /^total\s+(for\s+)?(gain|loss)\s+on\s+(the\s+)?sale\s+of\s+(land|lots?|propert(?:y|ies))\b/i.test(n)
    || /^total\s+(for\s+)?sale\s+of\s+(land|lots?|propert(?:y|ies))\b/i.test(leaf);
}

function isSaleOfPropertyBandLabel(label: string): boolean {
  const n = normLabel(label);
  if (isTotalForSaleOfPropertyLabel(label)) return true;
  if (/^total\s+(for\s+)?/.test(n)) return false;
  return isSaleOfPropertyDetailNorm(n);
}

/** QuickBooks "Parent:Child" paths â€” club detail under the root label. */
const COLON_CLUB_RULES: Array<{ key: string; label: string; root: string }> = [
  { key: 'improvements', label: IMPROVEMENTS_CLUB_LABEL, root: 'improvements' },
  { key: 'improvements', label: IMPROVEMENTS_CLUB_LABEL, root: 'improvement' },
  {
    key: 'long-term-business-loans',
    label: LONG_TERM_BUSINESS_LOANS_CLUB_LABEL,
    root: 'long-term business loans',
  },
  { key: 'property-insurance', label: PROPERTY_INSURANCE_CLUB_LABEL, root: 'insurance' },
  { key: 'reimbursement', label: REIMBURSEMENT_CLUB_LABEL, root: 'reimbursements' },
  { key: 'reimbursement', label: REIMBURSEMENT_CLUB_LABEL, root: 'reimbursement' },
  { key: 'land', label: LAND_CLUB_LABEL, root: 'land' },
  { key: 'land', label: LAND_CLUB_LABEL, root: 'land improvements' },
  { key: 'land', label: LAND_CLUB_LABEL, root: 'land improvement' },
  { key: 'investments', label: INVESTMENTS_CLUB_LABEL, root: 'investments' },
  { key: 'owners-investments', label: OWNERS_INVESTMENTS_CLUB_LABEL, root: "owner's investment" },
  { key: 'owners-investments', label: OWNERS_INVESTMENTS_CLUB_LABEL, root: "owner's investments" },
  { key: 'owners-investments', label: OWNERS_INVESTMENTS_CLUB_LABEL, root: 'owners investment' },
  { key: 'owners-investments', label: OWNERS_INVESTMENTS_CLUB_LABEL, root: 'owners investments' },
  { key: 'partner-investments', label: PARTNER_INVESTMENTS_CLUB_LABEL, root: 'partner investments' },
  { key: 'partner-investments', label: PARTNER_INVESTMENTS_CLUB_LABEL, root: 'partner investment' },
  { key: 'loans-and-advances', label: LOANS_AND_ADVANCES_CLUB_LABEL, root: 'loans & advances' },
  { key: 'loans-and-advances', label: LOANS_AND_ADVANCES_CLUB_LABEL, root: 'loans and advances' },
  { key: 'payroll-wages-tax', label: PAYROLL_WAGES_AND_TAX_CLUB_LABEL, root: 'payroll wages and tax to pay' },
  { key: 'payroll-wages-tax', label: PAYROLL_WAGES_AND_TAX_CLUB_LABEL, root: 'payroll wages and tax' },
  { key: 'fixed-assets', label: FIXED_ASSETS_CLUB_LABEL, root: 'fixed assets' },
  { key: 'fixed-assets', label: FIXED_ASSETS_CLUB_LABEL, root: 'fixed asset' },
  { key: 'other-current-assets', label: OTHER_CURRENT_ASSETS_CLUB_LABEL, root: 'other current assets' },
  { key: 'other-current-assets', label: OTHER_CURRENT_ASSETS_CLUB_LABEL, root: 'other current asset' },
  { key: 'other-payables', label: OTHER_PAYABLES_CLUB_LABEL, root: 'other payables' },
  { key: 'other-payables', label: OTHER_PAYABLES_CLUB_LABEL, root: 'other payable' },
  { key: 'rental-income', label: RENTAL_INCOME_CLUB_LABEL, root: 'rental income' },
  { key: 'rental-income', label: RENTAL_INCOME_CLUB_LABEL, root: 'rental - income' },
  { key: 'janitorial-expenses', label: JANITORIAL_EXPENSES_CLUB_LABEL, root: 'janitorial expenses' },
  { key: 'janitorial-expenses', label: JANITORIAL_EXPENSES_CLUB_LABEL, root: 'janitorial expense' },
  { key: 'janitorial-expenses', label: JANITORIAL_EXPENSES_CLUB_LABEL, root: 'cleaning expenses' },
  { key: 'janitorial-expenses', label: JANITORIAL_EXPENSES_CLUB_LABEL, root: 'cleaning expense' },
  { key: 'janitorial-expenses', label: JANITORIAL_EXPENSES_CLUB_LABEL, root: 'janitorial' },
  { key: 'janitorial-expenses', label: JANITORIAL_EXPENSES_CLUB_LABEL, root: 'cleaning' },
  { key: 'other-long-term-loans', label: OTHER_LONG_TERM_LOANS_CLUB_LABEL, root: 'other long term loans' },
  { key: 'other-long-term-loans', label: OTHER_LONG_TERM_LOANS_CLUB_LABEL, root: 'other long-term loans' },
  {
    key: 'loans-and-advances-from-others',
    label: LOANS_AND_ADVANCES_FROM_OTHERS_CLUB_LABEL,
    root: 'long term loans others',
  },
  {
    key: 'loans-and-advances-from-others',
    label: LOANS_AND_ADVANCES_FROM_OTHERS_CLUB_LABEL,
    root: 'long-term loans others',
  },
  {
    key: 'loans-and-advances-from-others',
    label: LOANS_AND_ADVANCES_FROM_OTHERS_CLUB_LABEL,
    root: 'long term loan others',
  },
  {
    key: 'loans-and-advances-from-others',
    label: LOANS_AND_ADVANCES_FROM_OTHERS_CLUB_LABEL,
    root: 'long term loan from others',
  },
  {
    key: 'loans-and-advances-from-others',
    label: LOANS_AND_ADVANCES_FROM_OTHERS_CLUB_LABEL,
    root: 'long term loans from others',
  },
  {
    key: 'loans-and-advances-from-others',
    label: LOANS_AND_ADVANCES_FROM_OTHERS_CLUB_LABEL,
    root: 'long-term loan from others',
  },
  {
    key: 'loans-and-advances-from-others',
    label: LOANS_AND_ADVANCES_FROM_OTHERS_CLUB_LABEL,
    root: 'long-term loans from others',
  },
  {
    key: 'loans-and-advances-from-others',
    label: LOANS_AND_ADVANCES_FROM_OTHERS_CLUB_LABEL,
    root: 'loans and advances from others',
  },
  {
    key: 'loans-and-advances-from-others',
    label: LOANS_AND_ADVANCES_FROM_OTHERS_CLUB_LABEL,
    root: 'loans & advances from others',
  },
  {
    key: 're-conversion-c-to-s',
    label: RE_CONVERSION_C_TO_S_CLUB_LABEL,
    root: 're from conversion of c to s',
  },
  { key: 'short-term-loans-liabilities', label: SHORT_TERM_LOANS_AND_LIABILITIES_CLUB_LABEL, root: 'short term loans & liabilities' },
  { key: 'short-term-loans-liabilities', label: SHORT_TERM_LOANS_AND_LIABILITIES_CLUB_LABEL, root: 'short term loans and liabilities' },
  { key: 'short-term-loans-liabilities', label: SHORT_TERM_LOANS_AND_LIABILITIES_CLUB_LABEL, root: 'short-term loans & liabilities' },
  { key: 'short-term-loans-liabilities', label: SHORT_TERM_LOANS_AND_LIABILITIES_CLUB_LABEL, root: 'short-term loans and liabilities' },
];

function expenseClubLabel(key: string): string {
  return EXPENSE_CLUB_RULES.find(r => r.key === key)?.label ?? key;
}

function colonHierarchicalClubKey(label: string): string | null {
  const n = normLabel(label);
  if (!n) return null;
  for (const rule of COLON_CLUB_RULES) {
    if (n === rule.root || n.startsWith(`${rule.root}:`) || n === `total for ${rule.root}` || n === `total ${rule.root}`) {
      // Totals stay as totals â€” only club detail / parent:child paths.
      if (n.startsWith('total ')) return null;
      return rule.key;
    }
  }
  // Also match pluralization / hyphen variants for long-term business loan(s).
  if (/^long[- ]?term\s+business\s+loans?(?::|$)/i.test(n) && !n.startsWith('total ')) {
    return 'long-term-business-loans';
  }
  // "Other Long Term Loans" / "Other Long-term Loan:…" variants.
  if (/^other\s+long[- ]?term\s+loans?(?::|$)/i.test(n) && !n.startsWith('total ')) {
    return 'other-long-term-loans';
  }
  // "Long Term Loans Others:…" / "Long Term Loan from Others:…" / board label.
  if (
    (/^long[- ]?term\s+loans?\s+others?(?::|$)/i.test(n)
      || /^long[- ]?term\s+loans?\s+from\s+others?(?::|$)/i.test(n)
      || /^loans?\s*(&|and)?\s*advances?\s+from\s+others?$/i.test(n))
    && !n.startsWith('total ')
  ) {
    return 'loans-and-advances-from-others';
  }
  // "Short Term Loans & Liabilities:Loan From …" variants.
  if (/^short[- ]?term\s+loans?\s*(&|and)\s*liabilit(?:y|ies)(?::|$)/i.test(n) && !n.startsWith('total ')) {
    return 'short-term-loans-liabilities';
  }
  // "RE from Conversion of C to S:Dividend on Convers / :Federal Tax".
  if (/^re\s+from\s+conversion\s+of\s+c\s+to\s+s(?::|$)/i.test(n) && !n.startsWith('total ')) {
    return 're-conversion-c-to-s';
  }
  // "Owner's Investment:Assure Life LLC" / "Owner's Investments:…"
  if (/^owner'?s?\s+investments?(?::|$)/i.test(n) && !n.startsWith('total ')) {
    return 'owners-investments';
  }
  // Partner investments:Name stays a named equity line on the BS — do not club here.
  // Singular / property-prefixed improvement paths:
  // "Improvement:Improvement-4433", "Punjab:Improvement-", "Improvement".
  if (isImprovementsClubLabel(n) && !n.startsWith('total ')) {
    return 'improvements';
  }
  return null;
}

/**
 * Fixed-asset improvement lines (any spelling / property prefix) → Improvements club.
 * Includes "Improvements - Others" / en-dash / em-dash variants.
 * Keeps land-improvement closing costs, Building Improvement (→ Building), Accu Dep alone.
 */
function isImprovementsClubLabel(labelOrNorm: string): boolean {
  const n = normLabel(labelOrNorm).replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, '-');
  if (!n || n.startsWith('total ')) return false;
  // Land Improvements (+ colon detail) club into Land, not Improvements.
  if (/^land\b/i.test(n) && /\bimprov/i.test(n)) return false;
  // Buildings:… - Improvem / Building Improvement club into "Building", not Improvements.
  if (isBuildingImprovementClubLabel(n)) return false;
  // Accu Dep on improvements is handled by the depreciation club.
  if (/(?:accu(?:mulated)?\.?\s*[-–—]?\s*dep|accum\.?\s*[-–—]?\s*dep|accumulated\s+depreciation)/i.test(n)) {
    return false;
  }
  return /^improvements?$/i.test(n)
    || /^improvements?\s*[-–—:./]/i.test(n)
    || /^improvements?\s+others?\b/i.test(n)
    || /^improvements?\s*:/i.test(n)
    || /:\s*improvements?\b/i.test(n);
}

function isTotalForImprovementsLabel(label: string): boolean {
  const n = normLabel(label).replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, '-');
  return /^total\s+(for\s+)?improvements?\b/i.test(n);
}

function isImprovementsBandLabel(label: string): boolean {
  if (isTotalForImprovementsLabel(label)) return true;
  return isImprovementsClubLabel(label);
}

/**
 * "Buildings:… - Improvem" / bare "Building Improvement" → Building club (with Buildings).
 * Truncated QBO "Improvem" counts; land-improvement closing costs stay under Land.
 */
function isBuildingImprovementClubLabel(labelOrNorm: string): boolean {
  const n = normLabel(labelOrNorm);
  if (!n) return false;
  if (/^land\b/i.test(n) && /\bimprov/i.test(n)) return false;
  if (/^total\s+(for\s+)?/.test(n)) {
    return (/\bbuild(?:ing|ong)s?\b/i.test(n) && /\bimprov/i.test(n))
      || /^total\s+(for\s+)?building\s+improvements?\b/i.test(n);
  }
  if (/^building\s+improvements?$/i.test(n)) return true;
  return /\bbuild(?:ing|ong)s?\b/i.test(n) && /\bimprov/i.test(n);
}

function statementClubLabel(key: string): string {
  if (key === 'intercompany-loans') return INTERCOMPANY_LOANS_CLUB_LABEL;
  // Riviera under Long Term Loan from Others folds into the board liability line.
  if (key === 'loan-for-riviera') return LOANS_AND_ADVANCES_FROM_OTHERS_CLUB_LABEL;
  if (key === 'loans-and-advances-from-others') return LOANS_AND_ADVANCES_FROM_OTHERS_CLUB_LABEL;
  if (key === 'loans') return LOANS_CLUB_LABEL;
  if (key === 'bank-loans') return BANK_LOANS_CLUB_LABEL;
  // building-improvement is a legacy key; both map to "Building".
  if (key === 'building-improvement' || key === 'buildings') return BUILDINGS_CLUB_LABEL;
  if (key === 'improvements') return IMPROVEMENTS_CLUB_LABEL;
  if (key === 'rental-income') return RENTAL_INCOME_CLUB_LABEL;
  if (key === 'owners-investments') return OWNERS_INVESTMENTS_CLUB_LABEL;
  if (key === 'partner-investments') return PARTNER_INVESTMENTS_CLUB_LABEL;
  if (key === 'total-equity') return TOTAL_EQUITY_CLUB_LABEL;
  if (key === 'sale-of-property' || key === 'sale-of-land') return SALE_OF_PROPERTY_CLUB_LABEL;
  const fromExpense = EXPENSE_CLUB_RULES.find(r => r.key === key)?.label;
  if (fromExpense) return fromExpense;
  const fromColon = COLON_CLUB_RULES.find(r => r.key === key)?.label;
  if (fromColon) return fromColon;
  return key;
}

/** Riviera investor loan lines under Long-term Liabilities (and Total for â€¦). */
function isRivieraLoanLabel(label: string): boolean {
  const n = normLabel(label);
  if (!n) return false;
  // Keep under Other Long Term Loans / Short Term Loans & Liabilities — do not peel into Loan for Riviera.
  if (/^other\s+long[- ]?term\s+loans?\b/i.test(n)) return false;
  if (/^short[- ]?term\s+loans?\s*(&|and)\s*liabilit/i.test(n)) return false;
  if (/^total\s+(for\s+)?/.test(n)) {
    return /\briviera\b/i.test(n);
  }
  // Already-clubbed canonical line.
  if (/^loan\s+for\s+riviera$/i.test(n)) return true;
  return /^riviera\b/i.test(n)
    || /^loans?\s+(for|from|to)\s+riviera\b/i.test(n)
    || (/\briviera\b/i.test(n) && /\b(loan|liabilit|payable|traders|investor|partner)\b/i.test(n));
}

/**
 * Club every Riviera investor / partner loan detail into
 * "Loans and Advances from Others" (same board line as Long Term Loan from Others).
 */
export function clubRivieraLoanRows<T extends FinItemLike>(items: T[]): T[] {
  if (!items.length) return items;

  const idxs: number[] = [];
  for (let i = 0; i < items.length; i++) {
    const lab = items[i]!.label;
    if (isRivieraLoanLabel(lab) && !/^total\s+(for\s+)?/.test(normLabel(lab))) {
      idxs.push(i);
    }
  }
  if (!idxs.length) return items;

  const anchor = idxs[0]!;
  const base = items[anchor]!;
  const values: Record<number, number> = {};
  const monthlyValues: Record<string, number> = {};
  for (const i of idxs) addRowValues(values, monthlyValues, items[i]!);

  const drop = new Set(idxs.filter(i => i !== anchor));
  const out: T[] = [];
  for (let i = 0; i < items.length; i++) {
    if (drop.has(i)) continue;
    if (i === anchor) {
      out.push({
        ...base,
        label: LOANS_AND_ADVANCES_FROM_OTHERS_CLUB_LABEL,
        values,
        monthlyValues: Object.keys(monthlyValues).length ? monthlyValues : undefined,
        isSectionHeader: false,
        isTotal: false,
        isNetIncome: false,
      } as T);
      continue;
    }
    out.push(items[i]!);
  }
  return out;
}

/**
 * Bare street / named-property lines (not generic "Buildings" / CWIP / improvements).
 * On P&L + Cash Flow these often carry property operating cash and club into Rental Income;
 * on the balance sheet they stay in the Building club.
 */
function isPropertyStreetAddressClubLabel(label: string): boolean {
  const n = normLabel(label);
  if (!n) return false;
  if (/\b(rent|rental|hoa|tax|payable|loan|interest)\b/i.test(n)) return false;
  if (/\bimprov|depreciat|insurance|permit|maintenance|repair|cwip|boxwood\b/i.test(n)) return false;
  if (/^buildings?$/i.test(n) || /\bbuilding\s+propert(?:y|ies)\b/i.test(n) || /\bbldg\b/i.test(n)) return false;
  if (/700\s*w?\s*new\s+hops?\b/i.test(n)) return false;
  if (/^total\s+(for\s+)?/.test(n)) {
    return /^total\s+(for\s+)?\d{3,6}\s+.+\b(highway|hwy|road|rd\b|street|st\b|way\b|drive|dr\b|lane|ln\b|place|pl\b|avenue|ave\b|blvd|boulevard|parkway|pkwy)\b/i.test(n)
      || /\bold\s+shepard\b/i.test(n)
      || /^total\s+(for\s+)?build(?:ing|ong)s?\s+\d{3,6}\b/i.test(n);
  }
  return /^\d{3,6}\s+.+\b(highway|hwy|road|rd\b|street|st\b|way\b|drive|dr\b|lane|ln\b|place|pl\b|avenue|ave\b|blvd|boulevard|parkway|pkwy)\b/i.test(n)
    || /\bold\s+shepard\b/i.test(n)
    || /^build(?:ing|ong)s?\s+\d{3,6}\b/i.test(n);
}

/**
 * Building / CWIP / FFE / property cost lines (+ Building Improvement) to roll into "Buildings"
 * (Boxwood Bend CWIP, Building Property, Building 4601 old Shepard, 26875 US Highway, FFE, …).
 */
function isBuildingsClubLabel(label: string): boolean {
  const n = normLabel(label);
  if (!n) return false;
  // Building Improvement paths share this club (handled before Improvements).
  if (isBuildingImprovementClubLabel(n) && !/^total\s+(for\s+)?/.test(n)) return true;
  if (/^total\s+(for\s+)?/.test(n)) {
    return /^total\s+(for\s+)?buildings?\b/i.test(n)
      || /^total\s+(for\s+)?ffe\b/i.test(n)
      || /^total\s+(for\s+)?f\.?\s*f\.?\s*&?\s*e\b/i.test(n)
      || /^total\s+(for\s+)?furniture\b/i.test(n)
      || /\bboxwood\b/i.test(n)
      || /700\s*w?\s*new\s+hops?\b/i.test(n)
      || (/^total\s+(for\s+)?build(?:ing|ong)s?\b/i.test(n) && !/\binsurance|permit|maintenance|repair/i.test(n))
      || (/^total\s+(for\s+)?\d{3,6}\s+.+\b(highway|hwy|road|rd\b|street|st\b|way\b|drive|dr\b|lane|ln\b|place|pl\b|avenue|ave\b|blvd|boulevard)\b/i.test(n));
  }
  // Keep land / general Improvements / depreciation / insurance out of the Buildings club.
  if (/^land\b/i.test(n) || /\bdepreciat/i.test(n)) return false;
  if (/\bimprov/i.test(n)) return false;
  if (/\binsurance\b|\bpermit|\bmaintenance\b|\brepair/i.test(n)) return false;
  // Rent / HOA / tax operating lines that happen to include a street address.
  if (/\b(rent|rental|hoa|tax|payable|loan|interest)\b/i.test(n)) return false;
  return /^buildings?$/i.test(n)
    || /^build(?:ing|ong)s?\b/i.test(n)
    || /\bbuilding\s+propert(?:y|ies)\b/i.test(n)
    || /\bbldg\b/i.test(n)
    // Furniture, Fixtures & Equipment (FFE) → Buildings board line.
    || /^ffe\b/i.test(n)
    || /^f\.?\s*f\.?\s*&?\s*e\b/i.test(n)
    || /^furniture(\s*,?\s*fixtures?)?(\s*&?\s*equip(ment)?)?$/i.test(n)
    || /^fixtures?\s*&?\s*equip(ment)?$/i.test(n)
    || /\bboxwood\b/i.test(n)
    || /700\s*w?\s*new\s+hops?\b/i.test(n)
    // Bare property cost basis: "26875 US Highway", "4601 Old Shepard Place".
    || /^\d{3,6}\s+.+\b(highway|hwy|road|rd\b|street|st\b|way\b|drive|dr\b|lane|ln\b|place|pl\b|avenue|ave\b|blvd|boulevard|parkway|pkwy)\b/i.test(n)
    || /\bold\s+shepard\b/i.test(n)
    || (/:\s*cwip\b/i.test(n) && (/\bboxwood\b|\b4608\b|700\s*w?\s*new\s+hop/i.test(n)));
}

function statementLineClubKey(label: string, sheet?: 'pl' | 'bs' | 'cf'): string | null {
  // Colon Other Long Term Loans / Short Term Loans before Riviera, so "…:Loan from Riviera …" stays in that band.
  const colonKey = colonHierarchicalClubKey(label);
  if (colonKey === 'other-long-term-loans' || colonKey === 'short-term-loans-liabilities') return colonKey;
  if (colonKey === 'loans-and-advances-from-others') return colonKey;
  // P&L / CF: street-address property lines → Rental Income (BS keeps them under Building).
  if (
    (sheet === 'pl' || sheet === 'cf')
    && isPropertyStreetAddressClubLabel(label)
    && !/^total\s+(for\s+)?/.test(normLabel(label))
  ) {
    return 'rental-income';
  }
  // Buildings / Building Improvement / Building Property before general Improvements.
  if (isBuildingImprovementClubLabel(label) && !/^total\s+(for\s+)?/.test(normLabel(label))) {
    return 'buildings';
  }
  if (colonKey === 'improvements') return colonKey;
  if (isImprovementsClubLabel(label) && !/^total\s+(for\s+)?/.test(normLabel(label))) {
    return 'improvements';
  }
  if (isBuildingsClubLabel(label) && !/^total\s+(for\s+)?/.test(normLabel(label))) {
    return 'buildings';
  }
  // Riviera investor loans fold into "Loans and Advances from Others" with Long Term Loan from Others.
  if (isRivieraLoanLabel(label) && !/^total\s+(for\s+)?/.test(normLabel(label))) {
    return 'loans-and-advances-from-others';
  }
  // Lender-only bank term loans (Bank Ozk, Loan - No → "No") → one "Bank Loans" line.
  // Property-tagged "Bank Loan - Punjab Way" stays on its own key (no club here).
  if (isBankLoansClubLabel(label) && !/^total\s+(for\s+)?/.test(normLabel(label))) {
    return 'bank-loans';
  }
  // Property / GPB–GBP / loan-account lines → one "Loan" line.
  if (isPropertyLoansClubLabel(label) && !/^total\s+(for\s+)?/.test(normLabel(label))) {
    return 'loans';
  }
  // Unit rent + Rental Income → one club key (also handled later by clubRentalIncomeRows).
  if (isRentalIncomeBandLabel(label, sheet) && !/^total\s+(for\s+)?/.test(normLabel(label))) {
    return 'rental-income';
  }
  // Asset Investment in / towards … → one Investments line (not Partner/Owner equity).
  if (isInvestmentsBandLabel(label) && !/^total\s+(for\s+)?/.test(normLabel(label))) {
    return 'investments';
  }
  // Owner's Investment:… equity detail → one "Owner's Investments" line.
  if (isOwnersInvestmentBandLabel(label) && !/^total\s+(for\s+)?/.test(normLabel(label))) {
    return 'owners-investments';
  }
  // Entity "… Equity" contribution lines → one "Total Equity" line.
  if (isEntityEquityBandLabel(label) && !/^total\s+(for\s+)?/.test(normLabel(label))) {
    return 'total-equity';
  }
  return expenseLineClubKey(label)
    ?? colonKey
    // Only the Inter Company Loans parent / due-to-related lines share a duplicate-club key.
    // Do not merge "Loan to Ravi â€¦" detail into that key (double-counts the parent).
    ?? (isBareIntercompanyLoansLabel(label)
      || /^due\s+(to|from)\s+related\b/i.test(normLabel(label))
      ? 'intercompany-loans'
      : null);
}

function stripTrailingAccountNumber(segment: string): string {
  let s = segment.trim();
  // QuickBooks bank lines: "Great Plains Bank(7563)" / "Bank(8241)" â†’ name only
  s = s.replace(/\s*\(\d{3,12}\)\s*$/g, '').trim();
  // Utility / vendor account refs: "Water & sewer (001-0009500-002)" → "Water & sewer"
  s = s.replace(/\s*\(\d{2,}(?:-\d{2,}){1,4}\)\s*$/g, '').trim();
  // "â€¦ A/C - 6000007570" / "â€¦ A/C 8241" / "â€¦ Account #123456"
  s = s.replace(/\s+a\/?c(?:count)?\.?\s*[-â€“â€”âˆ’#:]*\s*\d[\d\s-]{2,}\s*$/i, '').trim();
  s = s.replace(/\s+(?:acct|account)\.?\s*#?\s*\d{3,}\s*$/i, '').trim();
  // "â€¦ Bank - 330006890" / "â€¦ Bank - 8241" (any dash variant; 3+ digit accounts)
  s = s.replace(/\s*[-â€“â€”âˆ’â€â€‘â€’â€“â€”#]\s*\d{3,}\s*$/g, '').trim();
  // Trailing bare account digits on bank / loan lines: "Bank Name 8241"
  if (/\b(bank|loan|credit\s+union|federal)\b/i.test(s)) {
    s = s.replace(/\s+\d{3,12}\s*$/g, '').trim();
  }
  // Utility / vendor account refs: "Electricity 9001397713" â†’ "Electricity".
  // 5+ digits so 4-digit years ("Improvements 2018") and lot numbers survive.
  s = s.replace(/\s+#?\d{5,14}\s*$/g, '').trim();
  // Unit tags glued with underscore: "Janitorial Expenses_2812".
  s = s.replace(/_\d{3,6}\s*$/g, '').trim();
  // Ownership / share markers: "Bank Ozk @75%" / "No @25%" / "Partner (50%)" â†’ name only.
  s = s.replace(/\s*@\s*\d{1,3}(?:\.\d+)?\s*%\s*$/g, '').trim();
  s = s.replace(/\s*\(\s*\d{1,3}(?:\.\d+)?\s*%\s*\)\s*$/g, '').trim();
  s = s.replace(/\s*[-â€“â€”:]\s*\d{1,3}(?:\.\d+)?\s*%\s*$/g, '').trim();
  return s;
}

/**
 * Lender is a bank / financial institution rather than a partner or related party.
 * Used to keep institutional term loans out of the partner / intercompany loan clubs.
 */
export function isBankLenderName(label: string): boolean {
  return /\b(bank|bancorp|banc|ozk|credit\s*union|chase|wells\s*fargo|bofa|pnc|regions|truist|citibank|capital\s+one|great\s+plains|prosperity|frost|comerica|synovus|mortgage|federal\s+savings)\b/i.test(
    label,
  );
}

/**
 * Institutional bank term-loan lines to fold into one "Bank Loans" liability row.
 * Keeps cash "Bank", bank fees, and property-tagged "Bank Loan - Punjab Way" separate.
 */
function isBankLoansClubLabel(label: string): boolean {
  const n = normLabel(label);
  if (!n) return false;
  if (/^total\s+(for\s+)?/.test(n)) {
    return /^total\s+(for\s+)?(long[- ]?term\s+)?loans?\s+from\s+banks?\b/i.test(n)
      || /^total\s+(for\s+)?bank\s+loans?\b/i.test(n);
  }
  // Already-clubbed board line / Long Term Loans from Bank parent.
  if (/^bank\s+loans?$/i.test(n)) return true;
  if (/^long[- ]?term\s+loans?\s+from\s+banks?(?::|$)/i.test(n)) return true;
  // Property-financed loans keep their own "Bank Loan - <Property>" lines.
  if (/^bank\s+loans?\s*[-–—:]/i.test(n)) return false;
  // Cash Bank / Bank Accounts / bank fee expense — never liabilities.
  if (/^banks?$/i.test(n) || /^bank\s+accounts?\b/i.test(n)) return false;
  if (/^bank\s+(fees?|charges?|service)/i.test(n)) return false;
  if (/\b(checking|savings|money\s*market|operating\s+account|cash\s+on\s+hand)\b/i.test(n)) return false;
  // "Loan - No" / "Loan No. …" sanitize down to "No" / "No. …".
  if (/^no\.?(?:\s|$)/i.test(n) || /^no\.?\s*\d/i.test(n)) return true;
  // Lender-only names after "Loan - Bank Ozk" → "Bank Ozk".
  return isBankLenderName(n);
}

/**
 * Property / GPB–GBP / loan-account liability lines to fold into one "Loan" row.
 * Keeps Bank Loans, Long Term Loans Others, partner/intercompany bands, and rent payable out.
 */
function isPropertyLoansClubLabel(label: string): boolean {
  const n = normLabel(label);
  if (!n) return false;
  if (/^total\s+(for\s+)?/.test(n)) {
    return /^total\s+(for\s+)?loans?\s+on\s+propert/i.test(n)
      || /^total\s+(for\s+)?loans?$/i.test(n)
      || /^total\s+(for\s+)?g[pb]b\b.*\bloans?\b/i.test(n);
  }
  // Already-clubbed board line / parent.
  if (/^loans?$/i.test(n)) return true;
  if (/^loans?\s+on\s+propert/i.test(n)) return true;
  // Exclude bands handled elsewhere.
  if (/^bank\s+loans?\b/i.test(n)) return false;
  if (/^long[- ]?term\s+loans?\s+from\b/i.test(n)) return false;
  if (/^long[- ]?term\s+loans?\s+others?\b/i.test(n)) return false;
  if (/^loans?\s*(&|and)?\s*advances?\b/i.test(n)) return false;
  if (/^other\s+long[- ]?term\s+loans?\b/i.test(n)) return false;
  if (/^short[- ]?term\s+loans?\b/i.test(n)) return false;
  // Interest expense on GPB loans stays under Interest paid — not the Loan liability.
  if (/\b(payable|receivable|deposit|interest|partner|riviera)\b/i.test(n)) return false;
  if (isBankLoansClubLabel(label)) return false;
  // "GPB Loan" / "GBP Loan" / "GPB Suite 120 Loan" (also OCR "12O").
  if (/^g[pb]b\s+loans?$/i.test(n)) return true;
  if (/^g[pb]b\b.*\bloans?\b/i.test(n)) return true;
  // "5880 Loan Account (0099) - 2"
  if (/\bloan\s+accounts?\b/i.test(n)) return true;
  // "Lloyd Loan No." / "Loan No. …"
  if (/^[a-z0-9].*\bloan\s+no\.?\b/i.test(n) || /^loans?\s+no\.?\b/i.test(n)) return true;
  // "Loan - 706330398 - 2414 Marsh Lane" / "Loan - 8011697 Dr Comanche"
  if (/^loans?\s*[-–—:]\s*\d{3,}/i.test(n)) return true;
  return false;
}

/**
 * Clean loan / bank display labels — strip account numbers across all entities.
 * e.g. "Loan from First American Bank - 330006890" → "First American Bank"
 * e.g. "Loan from First Capital Bank A/C - 6000007570" → "First Capital Bank"
 * e.g. "Great Plains Bank(7563)" → "Great Plains Bank"
 * e.g. "Loan - Bank Ozk" / "Loan from Bank Ozk" → "Bank Ozk"
 * e.g. "Loan - No …" / "Loan No. …" → "No …"
 *
 * Lenders without "Bank" in the name keep the "Loan from" prefix, so a term loan
 * stays distinguishable from a cash account of the same name ("Bancorp south").
 */
function stripLoanAccountRef(segment: string): string {
  let s = stripTrailingAccountNumber(segment);
  // "Loan A/c No" / "Loan A/C No." / "Loan Account No 123" → "Loan"
  if (/^loan\s+a\/?c(?:count)?\.?\s*(no\.?|#)?\b/i.test(s)) {
    return 'Loan';
  }
  // Bank / OZK term loans: keep lender name only (drop "Loan from/to/-").
  if (/\bbank\b/i.test(s) || /\bozk\b/i.test(s)) {
    s = s.replace(/^loan\s+(from|to)\s+/i, '').trim();
    s = s.replace(/^loan\s*[-–—:]\s*/i, '').trim();
    s = s.replace(/^loan\s+/i, '').trim();
  }
  // "Loan - No …" / "Loan No. 123 …" — drop the Loan prefix, keep the rest.
  if (/^loan\s*(no\.?|#)\b/i.test(s) || /^loan\s*[-–—:]\s*no\b/i.test(s)) {
    s = s.replace(/^loan\s*/i, '').trim();
    s = s.replace(/^[-–—:]\s*/i, '').trim();
  }
  return stripTrailingAccountNumber(s);
}

/**
 * QuickBooks repeats the parent inside the child on nested asset paths:
 *   "4433 Punjab Way:4433 Punjab Way - Closing Cost" → "4433 Punjab Way - Closing Cost"
 *   "Bldg-248 Howard Property:Bldg-248 Howard Propert" → "Bldg-248 Howard Property"
 * Collapses exact repeats, child-repeats-parent, and truncated-child variants.
 */
function collapseDuplicateColonSegments(label: string): string {
  const parts = label.split(':').map(p => p.trim()).filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? label.trim();

  // A repeat only counts on a word boundary, so "Land" never swallows "Landscaping".
  const repeatsPrefix = (child: string, parent: string): boolean => {
    if (parent.length < 4 || !child.startsWith(parent)) return false;
    const next = child.charAt(parent.length);
    return next === '' || !/[a-z0-9]/i.test(next);
  };
  // QBO truncates long child names ("… Property" → "… Propert").
  const isTruncatedRepeat = (child: string, parent: string): boolean =>
    child.length >= 6 && parent.startsWith(child);

  const collapsed: string[] = [];
  for (const part of parts) {
    if (!collapsed.length) {
      collapsed.push(part);
      continue;
    }
    const prevRaw = collapsed[collapsed.length - 1]!;
    const prev = normLabel(prevRaw);
    const n = normLabel(part);
    if (n === prev) continue;
    if (repeatsPrefix(n, prev)) {
      // Child already carries the parent name — keep the richer child only.
      collapsed[collapsed.length - 1] = part;
      continue;
    }
    if (isTruncatedRepeat(n, prev)) continue;
    // Stray one/two-character tail ("… - Closing Cost:A") is a truncated remnant.
    if (n.length <= 2) continue;
    collapsed.push(part);
  }

  if (!collapsed.length) return label.trim();
  if (collapsed.length === 1) return collapsed[0]!;
  if (collapsed.every(p => normLabel(p) === normLabel(collapsed[0]!))) return collapsed[0]!;
  return collapsed.join(':');
}

/**
 * Fixed-asset ledgers often split the same property/improvement into year buckets
 * ("- 2018", "- 2019", "- Others"). Normalize these to one display label so rows club.
 */
function normalizeFixedAssetBandLabel(label: string): string {
  let s = label.trim();
  if (!s) return s;
  s = s.replace(/\s*[-â€“â€”:]\s*(?:19|20)\d{2}\s*$/i, '').trim();
  // Year buckets are normalized; "Improvements - Others" clubs into Improvements later.
  s = s.replace(/^total\s+for\s+/i, 'Total for ');
  return s;
}

// Last alternative catches QBO truncations such as "Accm De" / "Accum Dep".
const ACCU_DEP_RE =
  /(?:accu(?:mulated)?\.?\s*[-–—]?\s*dep(?:reciation|reciat)?|accum\.?\s*[-–—]?\s*dep(?:reciation|reciat)?|accumulated\s+depreciation|acc[um]m?\.?\s*[-–—]?\s*de\b)/i;

/**
 * "5-Year Property:5-Year Property - Other" â†’ "5-Year Property"
 * (drop the colon child / "- Other" suffix)
 */
function collapseYearPropertyColonDetail(label: string): string | null {
  const s = label.trim();
  const m = /^(\d+)\s*[- ]?year\s+property\s*:\s*\1\s*[- ]?year\s+property(?:\s*[-â€“â€”:].*)?$/i.exec(s);
  if (!m) return null;
  return `${m[1]}-Year Property`;
}

/**
 * "5-Year Property:Accu Dep - 5-Year Property" â†’ "Accu Depreciation - 5-Year Property"
 * "Gardenia Village Office Park:accu Dep - Gardenia" â†’ "Accu Depreciation - Gardenia Village Office Park"
 */
function normalizeAccuDepreciationLabel(label: string): string | null {
  const s = label.trim();
  if (!s || !ACCU_DEP_RE.test(s)) return null;

  const colon = new RegExp(
    `^(.+?)\\s*:\\s*${ACCU_DEP_RE.source}\\s*[-â€“â€”:]?\\s*(.*)$`,
    'i',
  ).exec(s);
  const plain = new RegExp(
    `^${ACCU_DEP_RE.source}\\s*[-â€“â€”:]\\s*(.+)$`,
    'i',
  ).exec(s);

  const parent = colon?.[1]?.trim() ?? '';
  const target = (colon?.[2] ?? plain?.[1] ?? '').trim();

  // Prefer the colon parent when it is the real asset (QBO often truncates the right side).
  const assetName = (() => {
    if (parent) {
      const yp = /^(\d+)\s*[- ]?year\s+propert(?:y|ies)/i.exec(parent);
      if (yp) return `${yp[1]}-Year Property`;
      if (/office\s+park/i.test(parent) || /^gardenia\b/i.test(parent)) return toTitleWords(parent);
      if (/^improvements?\s*[-â€“â€”]\s*others?/i.test(parent)) return 'Improvements';
      if (/^improvements?/i.test(parent)) return 'Improvements';
    }
    if (!target) return parent ? toTitleWords(parent) : null;
    const yp = /^(\d+)\s*[- ]?year\s+propert(?:y|ies)/i.exec(target);
    if (yp) return `${yp[1]}-Year Property`;
    if (/office\s+park/i.test(target) || /^gardenia\b/i.test(target)) {
      return parent && /office\s+park|gardenia/i.test(parent) ? toTitleWords(parent) : toTitleWords(target);
    }
    if (/^improvements?\s*[-â€“â€”]\s*others?/i.test(target)) return 'Improvements';
    if (/^improvements?/i.test(target)) return 'Improvements';
    return toTitleWords(target);
  })();

  if (!assetName) return null;
  return `Accu Depreciation - ${assetName}`;
}

/**
 * Bank term loans tagged with an account number and the property they finance:
 *   "Independent Bank Loan (3759) - 4433 Punjab Way" → "Bank Loan - Punjab Way"
 *   "Independent Bank Loan (5999) - 26875 US Highway" → "Bank Loan - US Highway"
 *   "Independent Bank (1337) - 248 Howard Property" → "Bank Loan - Howard Property"
 * Each property keeps its own line, so these are renamed rather than clubbed.
 * Requires a parenthesised account number plus a property tail, so lender-only
 * lines ("Loan - Bank Ozk", "Great Plains Bank(7563)") are left alone.
 */
function normalizeBankLoanPropertyLabel(label: string): string | null {
  const s = label.trim();
  if (!/\bbank\b/i.test(s)) return null;
  if (/^total\s+(for\s+)?/i.test(s)) return null;
  // Cash / operating bank accounts never become Bank Loan lines.
  if (/\b(checking|savings|money\s*market|operating\s+account|cash\s+on\s+hand)\b/i.test(s)) return null;

  const m = /\(\s*\d{3,}\s*\)\s*[-–—:]\s*(.+)$/i.exec(s);
  if (!m) return null;

  // "4433 Punjab Way" / "248 Howard Property" → drop leading street number.
  const property = m[1]!.trim().replace(/^#?\d{2,}\s+/, '').trim();
  if (!property) return null;
  // Reject account-number tails ("- 330006890") — those are not properties.
  if (!/[a-z]/i.test(property)) return null;

  return `Bank Loan - ${property}`;
}

/** Strip QuickBooks "(A/P)" / "(A/R)" suffixes from payable / receivable lines. */
function stripApArAbbreviations(label: string): string {
  return label
    .replace(/\s*\(\s*A\s*\/\s*P\s*\)\s*/gi, ' ')
    .replace(/\s*\(\s*A\s*\/\s*R\s*\)\s*/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Clean display labels before merge â€” strip bank account refs, collapse duplicate colon paths.
 * e.g. "Improvements:Improvements" â†’ "Improvements"
 * e.g. "Long-term business loans:Loan from First Capital Bank" â†’ "Long-term business loans"
 */
function peelPartnerInvestmentColonLeaf(label: string): string | null {
  const n = normalizePartnerInvestLabel(label);
  if (/^total\s+(for\s+)?partner\s+investments?\b/i.test(n)) return null;
  if (!/^partner\s+investments?:/i.test(n)) return null;
  const idx = label.search(/[:\uFF1A\uFE55]/);
  if (idx < 0) return null;
  const leaf = label.slice(idx + 1).trim();
  return leaf || null;
}

/** Named partner equity rows ("Bhanu Pittampally - Capital") — keep even at $0 on BS. */
function isPartnerCapitalNameLine(label: string): boolean {
  const n = normLabel(label);
  if (!n || /^total\s+(for\s+)?/.test(n)) return false;
  if (/^partner\s+investments?$/i.test(n)) return false;
  return /\s[-–—]\s+(capital|equity)$/i.test(n);
}

export function sanitizeStatementLineLabel(label: string): string {
  const raw = label.trim();
  if (!raw) return raw;

  const partnerLeaf = peelPartnerInvestmentColonLeaf(raw);
  if (partnerLeaf) return stripApArAbbreviations(partnerLeaf);

  // Do not rename "Total for Taxes paid" → "Taxes paid". That turns the QBO
  // subtotal into a second board line next to Property taxes.

  // "31400 Shareholder Distribution" â†’ "Shareholder Distribution"
  if (/^\d{3,}\s+shareholders?\s+distributions?\b/i.test(raw)) {
    return SHAREHOLDER_DISTRIBUTION_CLUB_LABEL;
  }
  if (/^shareholders?\s+distributions?\b/i.test(normLabel(raw)) && !/^total\s+/i.test(normLabel(raw))) {
    return SHAREHOLDER_DISTRIBUTION_CLUB_LABEL;
  }

  // Do not strip "- 400" from parcel tax accounts like "P900â€¦ - B-400 Property Tax".
  if (/^[pr]\d{4,}[a-z0-9]*\b/i.test(raw) && (/\bproperty\s*tax/i.test(raw) || /\bb-?\d{3}\b/i.test(raw))) {
    return stripApArAbbreviations(raw);
  }

  const yearProp = collapseYearPropertyColonDetail(raw);
  if (yearProp) return yearProp;

  const accu = normalizeAccuDepreciationLabel(raw);
  if (accu) return accu;

  const bankLoan = normalizeBankLoanPropertyLabel(raw);
  if (bankLoan) return bankLoan;

  let s: string;
  if (raw.includes(':')) {
    const joined = raw.split(':').map(part => stripLoanAccountRef(part.trim())).join(':');
    const collapsed = collapseDuplicateColonSegments(joined);
    const clubKey = colonHierarchicalClubKey(collapsed);
    s = clubKey ? statementClubLabel(clubKey) : collapsed;
  } else {
    const cleaned = normalizeFixedAssetBandLabel(stripLoanAccountRef(raw));
    const clubKey = colonHierarchicalClubKey(cleaned);
    s = clubKey ? statementClubLabel(clubKey) : cleaned;
  }
  return stripApArAbbreviations(s);
}

/**
 * Map accounting / book-keeping / legal / office / miscellaneous variants to one club key
 * so YoY tables and expense breakdowns show a single line per category across all entities.
 */
export function expenseLineClubKey(label: string): string | null {
  const n = normLabel(label);
  if (!n || isTotalishLabel(label)) return null;
  for (const rule of EXPENSE_CLUB_RULES) {
    if (rule.test(n)) return rule.key;
  }
  return null;
}

/** Display label for P&L expense rows â€” clubs known variant families. */
export function canonicalExpenseLineLabel(label: string): string {
  const clean = sanitizeStatementLineLabel(label);
  const key = statementLineClubKey(clean);
  return key ? statementClubLabel(key) : clean;
}

/**
 * QuickBooks "Loans to others" band (and "Total for Loans to others") duplicates
 * "Loans & Advances" â€” drop these rows everywhere; keep Loans & Advances only.
 */
export function isLoansToOthersLabel(label: string): boolean {
  const n = normLabel(label);
  return n === 'loans to others'
    || n.startsWith('loans to others:')
    || /^total\s+(for\s+)?loans\s+to\s+others$/i.test(n);
}

/** P&L noise rows â€” roundoff penny adjustments and redundant other-expense subtotals. */
export function isDroppedStatementLineLabel(label: string): boolean {
  if (isLoansToOthersLabel(label)) return true;
  const n = normLabel(label);
  if (/^round\s*[- ]?off$/i.test(n) || n === 'roundoff') return true;
  if (/^total\s+(for\s+)?other\s+expenses?$/i.test(n)) return true;
  if (/^total\s+(for\s+)?other\s+operating\s+expenses?$/i.test(n)) return true;
  // Redundant after Insurance / Property / Business insurance are clubbed into one line.
  if (/^total\s+(for\s+)?(property\s+|business\s+)?insurance$/i.test(n)) return true;
  // Per-suite HOA dues club into "Suite HOA"; drop the per-property subtotals.
  if (/^total\s+(for\s+)?.*\bhoa\b/i.test(n) && !/\bpayables?\b/i.test(n)) return true;
  // Bank fee variants are clubbed into "Bank fees & service charges".
  if (/^total\s+(for\s+)?bank\s+(fees?|charges?)(\s*(&|and)?\s*service\s+charges?)?$/i.test(n)) return true;
  if (/^total\s+(for\s+)?credit\s+card\s+(charges?|fees?)$/i.test(n)) return true;
  // Interest variants are clubbed into "Interest paid on loans".
  if (/^total\s+(for\s+)?interest\s+paid(\s+on\s+loans?)?(\s*[-â€“â€”]\s*.+)?$/i.test(n)) return true;
  if (/^total\s+(for\s+)?interest\s+(expense|on\s+(?:commercial\s+)?loans?)(\s*[-â€“â€”]\s*.+)?$/i.test(n)) return true;
  // Cleaning / Janitorial club into "Janitorial expenses"; drop band totals.
  if (/^total\s+(for\s+)?cleaning\b/i.test(n)) return true;
  if (/^total\s+(for\s+)?janitorial\b/i.test(n)) return true;
  // Improvements + Improvements - Others club into one line; drop band total.
  if (/^total\s+(for\s+)?improvements?\b/i.test(n) && !/^total\s+(for\s+)?land\s+improvements?\b/i.test(n)) return true;
  // Land Improvements detail clubs into Land; drop band total.
  if (/^total\s+(for\s+)?land\s+improvements?\b/i.test(n)) return true;
  // Parcel + Total for Land club into one "Land" line — never keep the Total for row.
  if (/^total\s+(for\s+)?land$/i.test(n)) return true;
  // Partner / Owner investments Totals are absorbed by clubPartnerInvestmentRows /
  // clubOwnersInvestmentRows — do not drop them before those clubs run.
  // General / Other Business Expenses club to one line; drop band totals.
  if (/^total\s+(for\s+)?(general|other)\s+business\s+exp(ense)?s?$/i.test(n)) return true;
  // Water & sewer account detail clubs into one line; drop band total.
  if (/^total\s+(for\s+)?water\s*(&|and|\/)\s*sewers?\b/i.test(n)) return true;
  if (/^total\s+(for\s+)?water\s+and\s+sewer(age)?\b/i.test(n)) return true;
  // Riviera / Long Term Loans Others / Long Term Loan from Others club into one board line; drop band totals.
  if (/^total\s+(for\s+)?.*\briviera\b/i.test(n)) return true;
  if (/^total\s+(for\s+)?long[- ]?term\s+loans?\s+from\s+others?\b/i.test(n)) return true;
  if (/^total\s+(for\s+)?long[- ]?term\s+loans?\s+others?\b/i.test(n)) return true;
  if (/^total\s+(for\s+)?loans?\s*(&|and)?\s*advances?\s+from\s+others?\b/i.test(n)) return true;
  // Bank Ozk / Loan - No / Long Term Loans from Bank club into "Bank Loans".
  if (/^total\s+(for\s+)?long[- ]?term\s+loans?\s+from\s+banks?\b/i.test(n)) return true;
  if (/^total\s+(for\s+)?bank\s+loans?\b/i.test(n)) return true;
  // "Total for Loan on Property" / GPB Loan totals — redundant after property loans club into "Loan".
  if (/^total\s+(for\s+)?loans?\s+on\s+propert/i.test(n)) return true;
  if (/^total\s+(for\s+)?loans?$/i.test(n) && !/\b(advances?|others?|bank|partner|payable)\b/i.test(n)) return true;
  if (/^total\s+(for\s+)?g[pb]b\b.*\bloans?\b/i.test(n)) return true;
  // Building / Building Improvement / Boxwood CWIP / New Hope / FFE club into "Buildings"; drop band totals.
  if (/^total\s+(for\s+)?buildings?\b/i.test(n)) return true;
  if (/^total\s+(for\s+)?ffe\b/i.test(n)) return true;
  if (/^total\s+(for\s+)?furniture\b/i.test(n)) return true;
  if (/^total\s+(for\s+)?build(?:ing|ong)s?\b/i.test(n) && !/\binsurance|permit|maintenance|repair/i.test(n)) return true;
  if (/^total\s+(for\s+)?building\s+improvements?\b/i.test(n)) return true;
  if (/^total\s+(for\s+)?.*\bbuild(?:ing|ong)s?\b/i.test(n) && /\bimprov/i.test(n)) return true;
  if (/^total\s+(for\s+)?.*\bboxwood\b/i.test(n)) return true;
  if (/^total\s+(for\s+)?.*700\s*w?\s*new\s+hops?\b/i.test(n)) return true;
  // Hide Other Payables entirely (detail, clubbed line, and Total for …).
  if (/^other\s+payables?\b/i.test(n) || /^total\s+(for\s+)?other\s+payables?\b/i.test(n)) return true;
  // Hide Miscellaneous Expenses entirely (keep Miscellaneous Income).
  if (
    /^(misc(ellaneous|elleneous)?|miscellaneous)\s+(exp(ense)?s?|charges?|costs?)\b/i.test(n)
    || /^misc\.?\s+(exp(ense)?s?|charges?)\b/i.test(n)
    || /^total\s+(for\s+)?(misc(ellaneous|elleneous)?|miscellaneous)\s+(exp(ense)?s?|charges?|costs?)\b/i.test(n)
  ) return true;
  // Other Long Term Loans detail clubs into one line; drop band total.
  if (/^total\s+(for\s+)?other\s+long[- ]?term\s+loans?\b/i.test(n)) return true;
  // Short Term Loans & Liabilities detail clubs into one line; drop band total.
  if (/^total\s+(for\s+)?short[- ]?term\s+loans?\s*(&|and)\s*liabilit/i.test(n)) return true;
  // C-to-S conversion detail clubs into one line; drop band total.
  if (/^total\s+(for\s+)?re\s+from\s+conversion\s+of\s+c\s+to\s+s\b/i.test(n)) return true;
  // Unit rent clubs into Rental Income; drop band + per-property subtotals
  // ("Total for Rent - King plaza suite 410", "Total for Rent - 26875 US Highway").
  if (/^total\s+(for\s+)?rental\s*[-–—:]?\s*income(?:$|[\s_:\-–—#/])/i.test(n)) return true;
  if (/^total\s+(for\s+)?rent\s*[-–—:_]?\s*(suit|suite)/i.test(n)) return true;
  if (/^total\s+(for\s+)?sales\s*[-–—:]?\s*rental\s*[-–—:]?\s*income/i.test(n)) return true;
  if (/^total\s+(for\s+)?units?\s*[-–—:#]/i.test(n)) return true;
  if (/^total\s+(for\s+)?rents?$/i.test(n)) return true;
  // Any "Total for Rent …" property/suite subtotal (dash or space), never Rent Payable.
  if (/^total\s+(for\s+)?rents?\b/i.test(n) && !/\bpayables?\b/i.test(n)) return true;
  // Bare / band "Total for Sales" is redundant next to Sales / Rental Income.
  // Keep "Total for Sales- Rental Income" for the rental-income club (handled above / in club).
  if (
    /^total\s+(for\s+)?sales\b/i.test(n)
    && !/\brental\s*[-–—:]?\s*income\b/i.test(n)
  ) return true;
  // Utilities detail lines club into "Electricity and Internet services"; drop Utilities total.
  if (/^total\s+(for\s+)?utilit/i.test(n)) return true;
  if (/^total\s+(for\s+)?electricity(\s*(&|and)?\s*internet(\s+services?)?)?$/i.test(n)) return true;
  if (/^total\s+(for\s+)?internet\s*(&|and)?\s*tv\s+services?$/i.test(n)) return true;
  if (/^total\s+(for\s+)?internet(\s+services?)?$/i.test(n)) return true;
  // Other income variants club into "Other Income".
  if (/^total\s+(for\s+)?other\s+(miscellaneous\s+)?income\b/i.test(n)) return true;
  if (/^total\s+(for\s+)?miscellaneous\s+income\b/i.test(n)) return true;
  if (/^total\s+(for\s+)?other\s+misc\.?\s+income\b/i.test(n)) return true;
  // Vehicle / parking / fuel variants club into "Vehicle expenses".
  if (/^total\s+(for\s+)?vehicle\s+(expenses?|gas\s*(&|and)?\s*fuels?)\b/i.test(n)) return true;
  if (/^total\s+(for\s+)?(parking\s*(&|and)?\s*tolls?|tolls?\s*(&|and)?\s*parking|gas\s*(&|and)?\s*fuels?|automobile\s+expenses?|auto\s+expenses?)\b/i.test(n)) return true;
  // Bank account details club into one "Bank" line.
  if (/^total\s+(for\s+)?bank\s+accounts?$/i.test(n)) return true;
  if (/^total\s+(for\s+)?banks?$/i.test(n)) return true;
  // Empty Paychex shell under Bank Accounts â€” not a real cash account.
  if (/^paychex\s*[-â€“â€”:]\s*1099\s+payments?$/i.test(n)) return true;
  // AR details / Total for Accounts Receivable club into one "Accounts Receivable" line.
  if (/^total\s+(for\s+)?accounts?\s+receivables?\b/i.test(n)) return true;
  // AP details / Total for Accounts Payable club into one "Accounts Payable" line.
  if (/^total\s+(for\s+)?accounts?\s+payables?\b/i.test(n)) return true;
  // Credit card details / Total for Credit Cards club into one "Credit Cards" line.
  if (/^total\s+(for\s+)?credit\s+cards?\b/i.test(n)) return true;
  // Long-term loan Totals are demoted to normal "Long Term Loanâ€¦" lines (not dropped).
  // Per-person "Total for Loan to Ravi â€¦" noise â€” keep "Total for Loans and Advances".
  if (
    /^total\s+(for\s+)?loans?\s+(to|from)\b/i.test(n)
    && !/^total\s+(for\s+)?loans?\s*(&|and)?\s*advances?\b/i.test(n)
    && !/^total\s+(for\s+)?inter\s*[- ]?\s*company\s+loans?\b/i.test(n)
    && !/^total\s+(for\s+)?long[- ]?term\s+loans?\s+from\b/i.test(n)
  ) return true;
  // Rent Payable details club into "Rent Payable"; always drop the Total subtotal.
  if (/^total\s+(for\s+)?rent\s+payables?\b/i.test(n)) return true;
  if (/^total\s+(for\s+)?.*\brent\s+payables?\b/i.test(n)) return true;
  // Interest payable details club into "Interest Payable".
  if (/^total\s+(for\s+)?int(?:erest)?\.?\s+payables?\b/i.test(n)) return true;
  // Reimbursement details club into "Reimbursement"; drop Total for Reimbursements.
  if (/^total\s+(for\s+)?reimbursements?\b/i.test(n)) return true;
  // Legal/accounting / office / shipping details club into "Professional services".
  if (/^total\s+(for\s+)?legal\s*(&|and)?\s*accounting\s+services?$/i.test(n)) return true;
  if (/^total\s+(for\s+)?professional\s+(charges?|fees?|services?)$/i.test(n)) return true;
  if (/^total\s+(for\s+)?office\s+(exp(ense)?s?|costs?|supplies?)$/i.test(n)) return true;
  if (/^total\s+(for\s+)?(shipping\s*(&|and)?\s*postage|postage\s*(&|and)?\s*shipping|postage|shipping)$/i.test(n)) return true;
  // Salary / wage / per-diem variants club into "Other salaries and wages".
  if (/^total\s+(for\s+)?(other\s+)?salaries?\s*(&|and)?\s*wages?$/i.test(n)) return true;
  if (/^total\s+(for\s+)?per\s*[- ]?diems?$/i.test(n)) return true;
  // Safety net if a software Total slips past clubSoftwareSubscriptionsRows.
  if (/^total\s+(for\s+)?software\b/i.test(n)) return true;
  if (/^total\s+(for\s+)?memberships?\s*(&|and)?\s*subscriptions?$/i.test(n)) return true;
  // Parcel / account property-tax details club into "Property taxes".
  if (/^total\s+(for\s+)?property\s*tax(?:es)?\b/i.test(n)) return true;
  if (/^total\s+(for\s+)?.*\bproperty\s*tax(?:es)?\b/i.test(n)) return true;
  if (/^total\s+(for\s+)?taxes\s+paid$/i.test(n)) return true;
  // Require digits after P/R so "Property taxes" itself is never dropped.
  if (/^[pr]\d{4,}[a-z0-9]*\b/i.test(n) && /\btax/i.test(n)) return true;
  // Bare Denton CAD parcel ids club into Property taxes.
  if (/^\d{4,}den$/i.test(n)) return true;
  // Investment-in-entity detail clubs into "Investments".
  if (/^total\s+(for\s+)?investments?\b/i.test(n)) return true;
  if (/^total\s+(for\s+)?long[- ]?term\s+investments?\b/i.test(n)) return true;
  // Other Current Assets:… detail clubs into one "Other Current Assets" line.
  if (/^total\s+(for\s+)?other\s+current\s+assets?\b/i.test(n)) return true;
  // Owner's Investment:… detail clubs into "Owner's Investments" (Total absorbed by club).
  // Partner investments:… detail clubs into "Partner Investments" (Total absorbed by club).
  // Do not drop those Totals here — clubs need them for correct amounts before discarding detail.
  // Entity "… Equity" detail clubs into "Total Equity"; drop per-entity totals + QBO band total.
  // Keep the board line "Total Equity" itself (no "for").
  if (/^total\s+for\s+.+\sequity$/i.test(n)
    && !/^total\s+for\s+(owner'?s?|members?|stockholders?|shareholders?|opening\s+balance)\s+equity$/i.test(n)
    && !isPartnerOrOwnerInvestmentEquityLabel(label)) return true;
  if (/^total\s+for\s+equity$/i.test(n)) return true;
  // Shareholder distribution detail clubs into one line; drop the Total subtotal.
  if (/^total\s+(for\s+)?shareholders?\s+distributions?\b/i.test(n)) return true;
  if (/^total\s+(for\s+)?\d{3,}\s+shareholders?\s+distributions?\b/i.test(n)) return true;
  // Accu Dep detail clubs into "Accumulated Depreciation".
  if (/^total\s+(for\s+)?(?:accu(?:mulated)?\.?\s*dep(?:reciation)?|accumulated\s+depreciation)\b/i.test(n)) return true;
  // Payroll wages detail clubs into "Payroll wages and tax" â€” drop Total for.
  // Keep "Total for Loans and Advances" (section rollup); club absorbs Loan-to detail separately.
  if (/^total\s+(for\s+)?payroll\s+wages?\s*(and|&)?\s*tax(es)?(\s+to\s+pay)?\b/i.test(n)) return true;
  // Travel / hotel details club into "Travel and hotels".
  if (/^total\s+(for\s+)?travel(\s*(&|and)?\s*hotels?)?$/i.test(n)) return true;
  if (/^total\s+(for\s+)?hotels?$/i.test(n)) return true;
  // Vendor shell row with no meaningful spend (often $0 / dashes only).
  if (/^coats\s+rose\b/i.test(n)) return true;
  // Orphan account-number detail lines left after loan label sanitization.
  if (/^a\/?c\s*[-â€“â€”]?\s*\d[\d\s-]*$/i.test(n)) return true;
  if (/^\d{6,}$/.test(n.replace(/[\s-]/g, ''))) return true;
  return false;
}

/**
 * Related-party / intercompany loan lines on B/S and C/F.
 * Excludes bank term loans (Long-term business loans / Loan from â€¦ Bank â€¦).
 */
export function isIntercompanyLoanLabel(label: string): boolean {
  const n = normLabel(label);
  if (/^inter\s*[- ]?\s*company\s+loans?$/i.test(n)) return true;
  if (/^long[- ]?term\s+business\s+loans?/i.test(n)) return false;
  if (n.startsWith('long-term business loans:')) return false;
  // Bank / institutional term loans keep their own band â€” not related-party.
  if (isBankLenderName(n)) return false;
  return /^loan\s+from\b/i.test(n)
    || /^loan\s+to\b/i.test(n)
    || /\binter\s*[- ]?\s*company\b/i.test(n)
    || /^due\s+to\s+related\b/i.test(n)
    || /^due\s+from\s+related\b/i.test(n);
}

function isBareIntercompanyLoansLabel(label: string): boolean {
  return /^inter\s*[- ]?\s*company\s+loans?$/i.test(normLabel(label));
}

function isTotalForIntercompanyLoansLabel(label: string): boolean {
  const n = normLabel(label);
  return /^total\s+(for\s+)?inter\s*[- ]?\s*company\s+loans?$/i.test(n);
}

/** Per-counterparty subtotals like "Total for Loan to Ravi Polishetty" â€” noise once detail exists. */
function isTotalForNamedLoanCounterpartyLabel(label: string): boolean {
  const n = normLabel(label);
  // Keep the section rollup "Total for Loans and Advances" / "Total for Loans & Advances".
  if (/^total\s+(for\s+)?loans?\s*(&|and)?\s*advances?\b/i.test(n)) return false;
  if (isTotalForIntercompanyLoansLabel(label)) return false;
  return /^total\s+(for\s+)?loans?\s+(to|from)\b/i.test(n);
}

/**
 * Merge related-party Loan From/To rows into "Inter Company Loans".
 * Prefer an existing Inter Company Loans / Total for Inter Company Loans amount so
 * we do not double-count parent + "Loan to Ravi â€¦" detail.
 */
export function clubIntercompanyLoanRows<T extends FinItemLike>(items: T[]): T[] {
  if (!items.length) return items;

  // Drop per-person "Total for Loan to/from â€¦" noise; keep Loans & Advances total.
  const withoutNamedTotals = items.filter(item => !isTotalForNamedLoanCounterpartyLabel(item.label));

  const indices: number[] = [];
  const totalIcIdxs: number[] = [];
  for (let i = 0; i < withoutNamedTotals.length; i++) {
    const item = withoutNamedTotals[i]!;
    if (item.isNetIncome) continue;
    if (isTotalForIntercompanyLoansLabel(item.label)) {
      totalIcIdxs.push(i);
      continue;
    }
    if (item.isTotal || isTotalishLabel(item.label)) continue;
    if (isIntercompanyLoanLabel(item.label)) indices.push(i);
  }

  const bareIdxs = indices.filter(i => isBareIntercompanyLoansLabel(withoutNamedTotals[i]!.label));
  const detailIdxs = indices.filter(i => !isBareIntercompanyLoansLabel(withoutNamedTotals[i]!.label));

  // Already a single canonical Inter Company Loans line and no extras to fold in.
  if (bareIdxs.length === 1 && detailIdxs.length === 0 && totalIcIdxs.length === 0) {
    const i = bareIdxs[0]!;
    const row = withoutNamedTotals[i]!;
    if (normLabel(row.label) === normLabel(INTERCOMPANY_LOANS_CLUB_LABEL)) return withoutNamedTotals;
    const copy = withoutNamedTotals.slice();
    copy[i] = {
      ...row,
      label: INTERCOMPANY_LOANS_CLUB_LABEL,
      isSectionHeader: false,
      isTotal: false,
      isNetIncome: false,
    } as T;
    return copy;
  }

  if (!indices.length && !totalIcIdxs.length) return withoutNamedTotals;

  const anchor = bareIdxs[0] ?? detailIdxs[0] ?? totalIcIdxs[0] ?? indices[0]!;
  const base = withoutNamedTotals[anchor]!;
  const values: Record<number, number> = {};
  const monthlyValues: Record<string, number> = {};

  if (totalIcIdxs.length) {
    for (const i of totalIcIdxs) addRowValues(values, monthlyValues, withoutNamedTotals[i]!);
  } else if (bareIdxs.length) {
    // Prefer parent Inter Company Loans â€” do not re-add Loan to/from detail (avoids double-count).
    for (const i of bareIdxs) addRowValues(values, monthlyValues, withoutNamedTotals[i]!);
  } else {
    for (const i of detailIdxs) addRowValues(values, monthlyValues, withoutNamedTotals[i]!);
  }

  // When a bare Inter Company Loans parent exists, keep other Loan to/from rows as their
  // own lines under Loans & Advances (only the parent is normalized).
  const drop = new Set<number>([
    ...totalIcIdxs.filter(i => i !== anchor),
    ...(bareIdxs.length
      ? bareIdxs.filter(i => i !== anchor)
      : detailIdxs.filter(i => i !== anchor)),
  ]);

  const out: T[] = [];
  for (let i = 0; i < withoutNamedTotals.length; i++) {
    if (drop.has(i)) continue;
    if (i === anchor) {
      out.push({
        ...base,
        label: INTERCOMPANY_LOANS_CLUB_LABEL,
        values,
        monthlyValues: Object.keys(monthlyValues).length ? monthlyValues : undefined,
        isSectionHeader: false,
        isTotal: false,
        isNetIncome: false,
      } as T);
      continue;
    }
    out.push(withoutNamedTotals[i]!);
  }
  return out;
}

function isTotalForLandLabel(label: string): boolean {
  const n = normLabel(label).replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, '-');
  return /^total\s+(for\s+)?land$/i.test(n)
    || /^total\s+(for\s+)?land\s+improvements?\b/i.test(n);
}

/**
 * QBO Equity-section subtotal band \u2014 "Total for <Entity Name> - Capital" sums the
 * individual "<Partner Name> - Capital" sub-account lines directly above it into a
 * duplicate of the entity's own capital sub-ledger. Distinct from a real section
 * total like "Total Equity" / "Total Partners' Capital" (no "for \u2026 -" suffix), so
 * dropping this never touches a genuine total line.
 */
function isTotalForCapitalLabel(label: string): boolean {
  const n = normLabel(label).replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, '-');
  return /^total\s+(for\s+)?.+\s+-\s+capital$/i.test(n);
}

/**
 * QBO auto-generates a "Total for <sub-account group>" band under every account
 * hierarchy folder (Contract Expenses, Food & Welfare expenses, Employee benefits,
 * General business expenses, Insurance, Interest, \u2026). In a category-driven upload
 * these are pure noise \u2014 the Category rollup already groups and subtotals its own
 * categories, so these QBO account-hierarchy subtotals just duplicate that grouping
 * one level down and (being auto-generated) never carry a user-assigned Category,
 * which is exactly why they should follow the same blank-Category drop rule as any
 * other uncategorized row. Genuine statement-level grand totals ("Total for Income",
 * "Total for Expenses", "Total for Assets", \u2026) are excluded \u2014 those must always
 * survive regardless of Category.
 */
function isSubcategoryTotalForLabel(label: string): boolean {
  const n = normLabel(label).trim();
  const m = /^total\s+for\s+(.+)$/i.exec(n);
  if (!m) return false;
  return !isMajorPropDevStatementBanner(m[1]!);
}

function isExplicitLandLabel(label: string): boolean {
  const n = normLabel(label).replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, '-');
  // Expense/fee line items that happen to contain "land" are not parcel names.
  if (/sale\s+of\s+land|land\s+sales?|loan|payable|landscape|survey|\bfee\b|\bcharges?\b|\btax(?:es)?\b/i.test(n)) return false;
  // "Land Improvements" / "Land Improvements:Improvements - Others" → Land club.
  // Bare Improvements / Building Improvement stay on their own clubs.
  const isLandImprovements =
    /^land\s+improvements?\b/i.test(n)
    || /^land\s*[-–—:]\s*improvements?\b/i.test(n);
  if (/improvement/i.test(n) && !isLandImprovements) return false;
  return n === 'land'
    || isLandImprovements
    || n.startsWith('land:')
    || /^land\s*[-–—:]/i.test(n)
    || /wwbl/i.test(label)
    // Parcel names e.g. "Lago Vista - Land" (Montechino) — must club into Land
    || /\bland\b/i.test(label);
}

/**
 * Collapse QuickBooks land parcel rows (e.g. "AW0181 - Delaney CH - Williamson County")
 * and "Total for Land" into a single "Land" line across all entities.
 */
export function clubLandDetailRows<T extends FinItemLike>(items: T[]): T[] {
  if (!items.length) return items;

  const renameKnown = items.map(item => {
    if (item.isTotal || item.isNetIncome || isTotalishLabel(item.label)) return item;
    if (!isExplicitLandLabel(item.label)) return item;
    if (normLabel(item.label) === 'land') {
      return { ...item, label: LAND_CLUB_LABEL, isSectionHeader: false } as T;
    }
    return {
      ...item,
      label: LAND_CLUB_LABEL,
      isSectionHeader: false,
      isTotal: false,
      isNetIncome: false,
    } as T;
  });

  const drop = new Set<number>();
  const replace = new Map<number, T>();

  for (let tIdx = 0; tIdx < renameKnown.length; tIdx++) {
    if (!isTotalForLandLabel(renameKnown[tIdx]!.label)) continue;

    const band: number[] = [];
    for (let j = tIdx - 1; j >= 0; j--) {
      if (drop.has(j) || replace.has(j)) break;
      const row = renameKnown[j]!;
      if (row.isNetIncome) break;
      if (row.isTotal || isTotalishLabel(row.label)) break;
      if (isBareSectionHeaderLabel(row.label) || isStructuralSubHeaderLabel(row.label)) break;
      const n = normLabel(row.label);
      if (n === 'land' && row.isSectionHeader) {
        band.unshift(j);
        break;
      }
      band.unshift(j);
    }

    const totalRow = renameKnown[tIdx]!;
    const values: Record<number, number> = { ...(totalRow.values as Record<number, number>) };
    const monthlyValues: Record<string, number> = totalRow.monthlyValues
      ? { ...totalRow.monthlyValues }
      : {};

    // Prefer Total for Land amounts; if total is empty, sum parcel detail.
    const totalHasAmt = Object.keys(values).some(k => yearVal(values, Number(k)) !== 0)
      || Object.values(monthlyValues).some(v => (Number(v) || 0) !== 0);
    if (!totalHasAmt) {
      for (const idx of band) {
        const row = renameKnown[idx]!;
        for (const k of Object.keys(row.values ?? {})) {
          const y = Number(k);
          if (!Number.isFinite(y)) continue;
          values[y] = (values[y] ?? 0) + yearVal(row.values, y);
        }
        for (const [k, v] of Object.entries(row.monthlyValues ?? {})) {
          monthlyValues[k] = (monthlyValues[k] ?? 0) + (Number(v) || 0);
        }
      }
    }

    const anchorIdx = band[0] ?? tIdx;
    const source = renameKnown[anchorIdx]!;
    replace.set(anchorIdx, {
      ...source,
      label: LAND_CLUB_LABEL,
      values,
      monthlyValues: Object.keys(monthlyValues).length ? monthlyValues : undefined,
      isSectionHeader: false,
      isTotal: false,
      isNetIncome: false,
    } as T);
    for (const idx of band) {
      if (idx !== anchorIdx) drop.add(idx);
    }
    drop.add(tIdx);
  }

  const out: T[] = [];
  for (let i = 0; i < renameKnown.length; i++) {
    if (drop.has(i)) continue;
    out.push(replace.get(i) ?? renameKnown[i]!);
  }

  // A workbook may have no "Total for Land" row and instead carry values in
  // both "Land" and "Land - Improvement & Closing Cost". Merge those rows.
  const landIdxs = out
    .map((row, i) => ({ row, i }))
    .filter(({ row }) => normLabel(row.label) === 'land' && !row.isTotal)
    .map(({ i }) => i);
  if (landIdxs.length <= 1) return out;

  const anchor = landIdxs[0]!;
  const base = out[anchor]!;
  const values: Record<number, number> = {};
  const monthlyValues: Record<string, number> = {};
  for (const i of landIdxs) addRowValues(values, monthlyValues, out[i]!);

  const landDrop = new Set(landIdxs.slice(1));
  return out.flatMap((row, i) => {
    if (landDrop.has(i)) return [];
    if (i !== anchor) return [row];
    return [{
      ...base,
      label: LAND_CLUB_LABEL,
      values,
      monthlyValues: Object.keys(monthlyValues).length ? monthlyValues : undefined,
      isSectionHeader: false,
      isTotal: false,
      isNetIncome: false,
    } as T];
  });
}

function isInterestCapitalisedBoardLabel(label: string): boolean {
  const n = normLabel(label);
  if (/^total\s+(for\s+)?/.test(n)) return false;
  if (/\b(paid|expense|income|payable|receivable)\b/i.test(n)) return false;
  return /^int(?:erest)?\.?\s+capitali[sz]ed\b/i.test(n)
    || /^capitali[sz]ed\s+interest\b/i.test(n)
    // Category-column form: "Land - Interest Capitalised" / "Land: Interest Capitalized".
    || /^land\s*[-–—:]\s*int(?:erest)?\.?\s+capitali[sz]ed\b/i.test(n);
}

function isLandBoardLineLabel(label: string): boolean {
  return /^land$/i.test(normLabel(label));
}

function isImprovementsBoardLineLabel(label: string): boolean {
  const n = normLabel(label);
  return /^improvements?$/i.test(n)
    || /^improvements?\s*\/\s*wip$/i.test(n)
    // Category-column form: "Land - Improvements" / "Land: Improvements".
    || /^land\s*[-–—:]\s*improvements?\b/i.test(n);
}

/**
 * Fixed-asset cost stack: Land, then Improvements, then Interest Capitalised —
 * ahead of every other detail line in the section (e.g. "Capital WIP-MUD"), not
 * merely at the position wherever Land happened to appear in upload order.
 * Inserted at the start of the contiguous detail run containing the earliest
 * matched row (walking back to the nearest section header / total / net income).
 * Used for every module.
 */
export function orderLandImprovementsInterestCapRows<T extends FinItemLike>(items: T[]): T[] {
  if (items.length < 2) return items;
  const landIdx = items.findIndex(i => isLandBoardLineLabel(i.label) && !i.isTotal && !i.isNetIncome);
  const impIdx = items.findIndex(i => isImprovementsBoardLineLabel(i.label) && !i.isTotal && !i.isNetIncome);
  const intIdx = items.findIndex(i => isInterestCapitalisedBoardLabel(i.label) && !i.isTotal && !i.isNetIncome);
  const idxs = [landIdx, impIdx, intIdx].filter(i => i >= 0);
  if (idxs.length < 2) return items;

  const ordered = [landIdx, impIdx, intIdx].filter(i => i >= 0).map(i => items[i]!);
  const drop = new Set(idxs);
  let insertAt = Math.min(...idxs);
  while (
    insertAt > 0
    && !items[insertAt - 1]!.isTotal
    && !items[insertAt - 1]!.isNetIncome
    && !items[insertAt - 1]!.isSectionHeader
    && !isMajorPropDevStatementBanner(items[insertAt - 1]!.label)
  ) {
    insertAt -= 1;
  }
  const out: T[] = [];
  for (let i = 0; i < items.length; i++) {
    if (i === insertAt) out.push(...ordered);
    if (drop.has(i)) continue;
    out.push(items[i]!);
  }
  return out;
}

const isEarnestMoneyDepositLabel = (label: string) => /^earnest\s+money\s+deposit$/i.test(normLabel(label));
const isAllowanceForBadDebtsLabel = (label: string) => /^allowance\s+for\s+bad\s+debts?$/i.test(normLabel(label));

/**
 * Balance Sheet board order: Earnest Money Deposit leads, Allowance for Bad Debts
 * right after — both pinned to the start of the contiguous asset run they already
 * sit in (never crossing a total/net-income/section-header/major-banner boundary),
 * mirroring {@link orderLandImprovementsInterestCapRows}.
 */
export function orderEarnestMoneyAllowanceRows<T extends FinItemLike>(items: T[]): T[] {
  if (items.length < 2) return items;
  const earnestIdx = items.findIndex(i => isEarnestMoneyDepositLabel(i.label) && !i.isTotal && !i.isNetIncome);
  const allowanceIdx = items.findIndex(i => isAllowanceForBadDebtsLabel(i.label) && !i.isTotal && !i.isNetIncome);
  const idxs = [earnestIdx, allowanceIdx].filter(i => i >= 0);
  if (idxs.length < 2) return items;

  const ordered = [earnestIdx, allowanceIdx].map(i => items[i]!);
  const drop = new Set(idxs);
  let insertAt = Math.min(...idxs);
  while (
    insertAt > 0
    && !items[insertAt - 1]!.isTotal
    && !items[insertAt - 1]!.isNetIncome
    && !items[insertAt - 1]!.isSectionHeader
    && !isMajorPropDevStatementBanner(items[insertAt - 1]!.label)
  ) {
    insertAt -= 1;
  }
  const out: T[] = [];
  for (let i = 0; i < items.length; i++) {
    if (i === insertAt) out.push(...ordered);
    if (drop.has(i)) continue;
    out.push(items[i]!);
  }
  return out;
}

const CF_SECTION_HEADER_RE = /^(operating|investing|financing)\s+activities$/i;
const CF_SECTION_CLOSE_RE = /^net\s+cash\s+(provided by|used in)\s+(operating|investing|financing)\s+activities/i;

/** True for rows that bound a Cash Flow section (header, closing total, or the
 * statement-level "Net increase/decrease in cash" line) — reordering never crosses these. */
function isCfSectionBoundaryLabel(label: string): boolean {
  const n = normLabel(label);
  return CF_SECTION_HEADER_RE.test(n)
    || CF_SECTION_CLOSE_RE.test(n)
    || /^net\s+(increase|decrease|change)\s+in\s+cash/i.test(n);
}

function reorderRunByPin<T extends FinItemLike>(run: T[], pinTests: Array<(label: string) => boolean>): T[] {
  if (run.length < 2) return run;
  const used = new Set<number>();
  const pinned: T[] = [];
  for (const test of pinTests) {
    const idx = run.findIndex((r, j) => !used.has(j) && !r.isTotal && !r.isNetIncome && test(r.label));
    if (idx >= 0) {
      used.add(idx);
      pinned.push(run[idx]!);
    }
  }
  if (!pinned.length) return run;
  const rest = run.filter((_, j) => !used.has(j));
  return [...pinned, ...rest];
}

const isPropertyTaxPayableLabel = (label: string) => /^property\s*tax\s+payable$/i.test(normLabel(label));
const isAccountsPayableLabel = (label: string) => /^accounts?\s+payable(?:\s*\(a\/p\))?$/i.test(normLabel(label));

/**
 * Cash Flow board order: within Operating Activities, Property Tax Payable ranks
 * before Accounts Payable; within Investing Activities, Interest Capitalised leads
 * (matches both the bare label and the Category-column "Land - Interest Capitalised"
 * form). Applies to every Prop Dev company's CF — reorders within each section only,
 * never moves a line across a section boundary (header/closing total/Net Income).
 */
export function orderCfSectionLines<T extends FinItemLike>(items: T[]): T[] {
  if (items.length < 2) return items;
  const OPERATING_PIN = [isPropertyTaxPayableLabel, isAccountsPayableLabel];
  const INVESTING_PIN = [isInterestCapitalisedBoardLabel];

  const out: T[] = [];
  let section: 'operating' | 'investing' | null = null;
  let i = 0;
  while (i < items.length) {
    const item = items[i]!;
    const n = normLabel(item.label);
    if (CF_SECTION_HEADER_RE.test(n)) {
      const m = n.match(CF_SECTION_HEADER_RE)!;
      section = m[1] === 'operating' ? 'operating' : m[1] === 'investing' ? 'investing' : null;
      out.push(item);
      i += 1;
      continue;
    }
    if (isCfSectionBoundaryLabel(item.label) || item.isNetIncome) {
      section = null;
      out.push(item);
      i += 1;
      continue;
    }
    const run: T[] = [];
    while (i < items.length && !isCfSectionBoundaryLabel(items[i]!.label)
      && !CF_SECTION_HEADER_RE.test(normLabel(items[i]!.label)) && !items[i]!.isNetIncome) {
      run.push(items[i]!);
      i += 1;
    }
    if (section === 'operating') out.push(...reorderRunByPin(run, OPERATING_PIN));
    else if (section === 'investing') out.push(...reorderRunByPin(run, INVESTING_PIN));
    else out.push(...run);
  }
  return out;
}

function isTotalForRentalIncomeLabel(label: string): boolean {
  const n = normLabel(label);
  if (/\bpayables?\b/i.test(n)) return false;
  // Suffix class allows per-suite subtotals: "Total for Rental Income_Suite 202".
  return /^total\s+(for\s+)?rental\s*[-–—:]?\s*income(?:$|[\s_:\-–—#/])/i.test(n)
    || /^total\s+rental\s+income(?:$|[\s_:\-–—#/])/i.test(n)
    || /^total\s+(for\s+)?rent\s*[-–—:_]?\s*(suit|suite)/i.test(n)
    // "Total for Rent 1414 Marsh Lane Suit 102" (space-separated property, no dash).
    || /^total\s+(for\s+)?rents?\s+\S+/i.test(n)
    // "Total for Sales- Rental Income" / "Total for Unit - R"
    || /^total\s+(for\s+)?sales\s*[-–—:]?\s*rental\s*[-–—:]?\s*income/i.test(n)
    || /^total\s+(for\s+)?units?\s*[-–—:#]/i.test(n);
}

function isRentalIncomeBandLabel(label: string, sheet?: 'pl' | 'bs' | 'cf'): boolean {
  const n = normLabel(label).replace(/\u00a0/g, ' ');
  if (isTotalForRentalIncomeLabel(label)) return true;
  // P&L / CF: "26875 US Highway" / "Building 4601 old Shepard" → Rental Income.
  if ((sheet === 'pl' || sheet === 'cf') && isPropertyStreetAddressClubLabel(label)) return true;
  if (/^total\s+(for\s+)?/.test(n)) return false;
  // Balance-sheet rent liabilities must never fold into P&L "Rental Income".
  if (/\b(payable|payables|liabilit|deposit|prepaid)\b/i.test(n)) return false;
  return /^rental\s*[-–—:]?\s*income(?:$|[\s_:\-–—#/])/i.test(n)
    || /^rental\s+income(?:$|[\s_:\-–—#/])/i.test(n)
    // Unit rent lines: "Rent Suit 100 - Unit A" / "Rent - Suite 132" / "Rent: Unit A".
    || /^rent\s*[-–—:]?\s*(suit|suite)\b/i.test(n)
    || /^rent\s*[-–—:]/i.test(n)
    || /^rent\b(?!\s+payable)/i.test(n)
    // Colon paths: "Rental Income:Rent Suit 100 - Unit A"
    || /^rental\s*[-–—:]?\s*income\s*:/i.test(n)
    // "Sales- Rental Income" and any other prefixed rental income line.
    || /\brental\s*[-–—:]?\s*income(?:$|[\s_:\-–—#/])/i.test(n)
    // Bare unit rent lines: "Unit - R", "Unit B & C", "Unit#202".
    || /^units?\s*[-–—:#]/i.test(n);
}

/**
 * Club QuickBooks unit rent lines + "Total for Rent …" property subtotals into one
 * "Rental Income" row. Prefers the bare Rental Income parent when it has amounts
 * (property Totals often duplicate that rollup); fills $0 years from unit detail /
 * property Totals so early-year parent + later-year suite totals still combine.
 * On P&L / CF also absorbs bare street-address property lines.
 */
export function clubRentalIncomeRows<T extends FinItemLike>(
  items: T[],
  sheet?: 'pl' | 'bs' | 'cf',
): T[] {
  if (!items.length) return items;

  const idxs: number[] = [];
  for (let i = 0; i < items.length; i++) {
    if (isRentalIncomeBandLabel(items[i]!.label, sheet)) idxs.push(i);
  }
  if (!idxs.length) return items;

  const totalIdxs = idxs.filter(i => isTotalForRentalIncomeLabel(items[i]!.label));
  const detailIdxs = idxs.filter(i => !isTotalForRentalIncomeLabel(items[i]!.label));
  const bareIdxs = detailIdxs.filter(i =>
    /^rental\s*[-–—:]?\s*income$/i.test(normLabel(items[i]!.label)),
  );
  const unitIdxs = detailIdxs.filter(i => !bareIdxs.includes(i));
  const grandTotalIdxs = totalIdxs.filter(i =>
    /^total\s+(for\s+)?rental\s*[-–—:]?\s*income/i.test(normLabel(items[i]!.label))
    || /^total\s+(for\s+)?sales\s*[-–—:]?\s*rental\s*[-–—:]?\s*income/i.test(normLabel(items[i]!.label)),
  );
  const propertyTotalIdxs = totalIdxs.filter(i => !grandTotalIdxs.includes(i));

  const anchor = bareIdxs[0] ?? unitIdxs[0] ?? grandTotalIdxs[0] ?? propertyTotalIdxs[0] ?? idxs[0]!;
  const base = items[anchor]!;

  const values: Record<number, number> = {};
  const monthlyValues: Record<string, number> = {};

  const fillZerosFrom = (sourceIdxs: number[]) => {
    if (!sourceIdxs.length) return;
    const fill: Record<number, number> = {};
    const fillM: Record<string, number> = {};
    for (const i of sourceIdxs) addRowValues(fill, fillM, items[i]!);
    for (const [k, v] of Object.entries(fill)) {
      const y = Number(k);
      if (!Number.isFinite(y)) continue;
      if ((values[y] ?? 0) === 0) values[y] = v;
    }
    for (const [k, v] of Object.entries(fillM)) {
      if ((monthlyValues[k] ?? 0) === 0) monthlyValues[k] = v;
    }
  };

  // Prefer bare parent (board rollup). Property "Total for Rent …" lines often equal
  // that parent and must not be summed on top of it.
  if (bareIdxs.length) {
    for (const i of bareIdxs) addRowValues(values, monthlyValues, items[i]!);
    fillZerosFrom(unitIdxs);
    fillZerosFrom(propertyTotalIdxs);
    fillZerosFrom(grandTotalIdxs);
  } else if (unitIdxs.length) {
    for (const i of unitIdxs) addRowValues(values, monthlyValues, items[i]!);
    fillZerosFrom(propertyTotalIdxs);
    fillZerosFrom(grandTotalIdxs);
  } else if (propertyTotalIdxs.length) {
    for (const i of propertyTotalIdxs) addRowValues(values, monthlyValues, items[i]!);
    fillZerosFrom(grandTotalIdxs);
  } else {
    for (const i of grandTotalIdxs) addRowValues(values, monthlyValues, items[i]!);
  }

  const drop = new Set(idxs.filter(i => i !== anchor));
  const out: T[] = [];
  for (let i = 0; i < items.length; i++) {
    if (drop.has(i)) continue;
    if (i === anchor) {
      out.push({
        ...base,
        label: RENTAL_INCOME_CLUB_LABEL,
        values,
        monthlyValues: Object.keys(monthlyValues).length ? monthlyValues : undefined,
        isSectionHeader: false,
        isTotal: false,
        isNetIncome: false,
      } as T);
      continue;
    }
    out.push(items[i]!);
  }
  return out;
}

const ADVERTISING_MARKETING_CLUB_LABEL = 'Advertising & marketing';

function isTotalForAdvertisingMarketingLabel(label: string): boolean {
  const n = normLabel(label);
  return /^total\s+(for\s+)?advertising\s*(&|and)?\s*marketing$/i.test(n);
}

function isAdvertisingMarketingBandLabel(label: string): boolean {
  const n = normLabel(label);
  if (isTotalForAdvertisingMarketingLabel(label)) return true;
  if (/^total\s+(for\s+)?/.test(n)) return false;
  const leaf = n.includes(':') ? (n.split(':').pop() ?? n).trim() : n;
  return /^advertising\s*(&|and)?\s*marketing$/i.test(leaf)
    || /^advertising$/i.test(leaf)
    || /^marketing$/i.test(leaf)
    || /^social\s+media$/i.test(leaf)
    || /^advertising\s*(&|and)?\s*promotion/i.test(leaf)
    || /^business\s+promotions?$/i.test(leaf)
    || /^promotions?$/i.test(leaf);
}

function isTotalForBookKeepingLabel(label: string): boolean {
  const n = normLabel(label);
  const leaf = n.includes(':') ? (n.split(':').pop() ?? n).trim() : n;
  return /^total\s+(for\s+)?(book\s*[- ]?keep(ing)?(\s+charges?)?|accounting\s+(&|and)?\s*book\s*[- ]?keep(ing)?|accounting\s+fees?)$/i.test(n)
    || /^total\s+(for\s+)?(book\s*[- ]?keep(ing)?(\s+charges?)?|accounting\s+(&|and)?\s*book\s*[- ]?keep(ing)?|accounting\s+fees?)$/i.test(leaf);
}

function isBareBookKeepingChargesLabel(label: string): boolean {
  const n = normLabel(label);
  if (/^total\s+(for\s+)?/.test(n)) return false;
  const leaf = n.includes(':') ? (n.split(':').pop() ?? n).trim() : n;
  return /^book\s*[- ]?keep(ing)?(\s+charges?)?$/i.test(leaf)
    || /^accounting\s+(&|and)?\s*book\s*[- ]?keep(ing)?$/i.test(leaf);
}

function isAccountingFeesLabel(label: string): boolean {
  const n = normLabel(label);
  if (/^total\s+(for\s+)?/.test(n)) return false;
  const leaf = n.includes(':') ? (n.split(':').pop() ?? n).trim() : n;
  return /^accounting\s+fees?$/i.test(leaf)
    || /^accounting\s+charges?$/i.test(leaf);
}

function isBookKeepingBandLabel(label: string): boolean {
  return isTotalForBookKeepingLabel(label)
    || isBareBookKeepingChargesLabel(label)
    || isAccountingFeesLabel(label);
}

/**
 * Book Keeping Charges + Accounting fees (+ Total for Book Keeping) → one
 * "Book Keeping Charges" line. Sum detail rows (1,500 + 3,000 Category totals,
 * plus Accounting fees) so the board matches Excel Sum of Total. Use Total for
 * only when there is no detail amount.
 */
export function clubBookKeepingChargesRows<T extends FinItemLike>(items: T[]): T[] {
  if (!items.length) return items;

  const idxs: number[] = [];
  for (let i = 0; i < items.length; i++) {
    if (isBookKeepingBandLabel(items[i]!.label)) idxs.push(i);
  }
  if (!idxs.length) return items;

  const totalIdxs = idxs.filter(i => isTotalForBookKeepingLabel(items[i]!.label));
  const detailIdxs = idxs.filter(i => !isTotalForBookKeepingLabel(items[i]!.label));
  const bareIdxs = detailIdxs.filter(i => isBareBookKeepingChargesLabel(items[i]!.label));
  const feeIdxs = detailIdxs.filter(i => isAccountingFeesLabel(items[i]!.label));
  const anchor = bareIdxs[0] ?? feeIdxs[0] ?? totalIdxs[0] ?? idxs[0]!;
  const base = items[anchor]!;

  const values: Record<number, number> = {};
  const monthlyValues: Record<string, number> = {};

  if (detailIdxs.length) {
    for (const i of detailIdxs) addRowValues(values, monthlyValues, items[i]!);
  } else {
    for (const i of totalIdxs) addRowValues(values, monthlyValues, items[i]!);
  }

  const drop = new Set(idxs.filter(i => i !== anchor));
  const out: T[] = [];
  for (let i = 0; i < items.length; i++) {
    if (drop.has(i)) continue;
    if (i === anchor) {
      out.push({
        ...base,
        label: BOOK_KEEPING_CHARGES_CLUB_LABEL,
        values,
        monthlyValues: Object.keys(monthlyValues).length ? monthlyValues : undefined,
        isSectionHeader: false,
        isTotal: false,
        isNetIncome: false,
      } as T);
      continue;
    }
    out.push(items[i]!);
  }
  return out;
}

/**
 * Club Advertising & marketing detail + "Total for Advertising & marketing"
 * into one "Advertising & marketing" line (drop the Total for row).
 */
export function clubAdvertisingMarketingRows<T extends FinItemLike>(items: T[]): T[] {
  if (!items.length) return items;

  const idxs: number[] = [];
  for (let i = 0; i < items.length; i++) {
    if (isAdvertisingMarketingBandLabel(items[i]!.label)) idxs.push(i);
  }
  if (!idxs.length) return items;

  const totalIdxs = idxs.filter(i => isTotalForAdvertisingMarketingLabel(items[i]!.label));
  const bands: number[][] = [];
  if (totalIdxs.length) {
    for (const tIdx of totalIdxs) {
      const band = [tIdx];
      for (let j = tIdx - 1; j >= 0; j--) {
        if (!idxs.includes(j)) break;
        if (isTotalForAdvertisingMarketingLabel(items[j]!.label)) break;
        band.unshift(j);
      }
      bands.push(band);
    }
  } else {
    // No total row â€” still collapse advertising/marketing variants into one line.
    bands.push(idxs);
  }

  const drop = new Set<number>();
  const replace = new Map<number, T>();

  for (const band of bands) {
    const totalRow = [...band].reverse().find(i => isTotalForAdvertisingMarketingLabel(items[i]!.label));
    const detailIdxs = band.filter(i => !isTotalForAdvertisingMarketingLabel(items[i]!.label));
    const anchor = detailIdxs[0] ?? totalRow ?? band[0]!;
    const base = items[anchor]!;

    const values: Record<number, number> = {};
    const monthlyValues: Record<string, number> = {};
    if (totalRow != null) {
      addRowValues(values, monthlyValues, items[totalRow]!);
    } else {
      for (const i of detailIdxs) addRowValues(values, monthlyValues, items[i]!);
    }

    replace.set(anchor, {
      ...base,
      label: ADVERTISING_MARKETING_CLUB_LABEL,
      values,
      monthlyValues: Object.keys(monthlyValues).length ? monthlyValues : undefined,
      isSectionHeader: false,
      isTotal: false,
      isNetIncome: false,
    } as T);
    for (const i of band) {
      if (i !== anchor) drop.add(i);
    }
  }

  const out: T[] = [];
  for (let i = 0; i < items.length; i++) {
    if (drop.has(i)) continue;
    out.push(replace.get(i) ?? items[i]!);
  }
  return out;
}

const INTEREST_PAID_CLUB_LABEL = 'Interest paid on loans';
const BANK_FEES_CLUB_LABEL = 'Bank fees & service charges';

function isTotalForGeneralBusinessExpensesLabel(label: string): boolean {
  const n = normLabel(label);
  return /^total\s+(for\s+)?(general|other)\s+business\s+exp(ense)?s?$/i.test(n);
}

function isGeneralBusinessExpensesBandLabel(label: string): boolean {
  const n = normLabel(label);
  if (isTotalForGeneralBusinessExpensesLabel(label)) return true;
  if (/^total\s+(for\s+)?/.test(n)) return false;
  // Bank / credit-card fee lines club separately into "Bank fees & service charges".
  if (isBankFeesBandLabel(label)) return false;
  // Software / memberships club separately into "Software & Other Subscriptions".
  if (/^software\s*(&|and)?\s*other\s+subscriptions?$/i.test(n)) return false;
  if (/^software\s+subscriptions?$/i.test(n)) return false;
  if (/^memberships?\s*(&|and)?\s*subscriptions?$/i.test(n)) return false;
  // Plain Utilities (not Utilities:Electricity / Internet — those club separately).
  if (/^utilities?\s*[-–—:]\s*(electricity|internet)/i.test(n)) return false;
  if (isElectricityInternetBandLabel(label)) return false;
  // Water & sewer account lines club into their own board line.
  if (/^water\s*(&|and|\/)\s*sewers?\b/i.test(n)) return false;
  if (/^water\s+and\s+sewer(age)?\b/i.test(n)) return false;
  if (/^sewer\s*(&|and|\/)\s*water\b/i.test(n)) return false;
  const leaf = n.includes(':') ? (n.split(':').pop() ?? n).trim() : n;
  return /^general\s+business\s+exp(ense)?s?$/i.test(leaf)
    || /^other\s+business\s+exp(ense)?s?$/i.test(leaf)
    || /^late\s+fees?$/i.test(leaf)
    || /^impact\s+fees?$/i.test(leaf)
    || /^utilities?(\s+(exp(ense)?s?|charges?))?$/i.test(leaf)
    // Board: Commissions & fees + Engineering Services → General business expenses.
    || /^commissions?\s*(&|and)?\s*fees?$/i.test(leaf)
    || /^commissions?$/i.test(leaf)
    || /^commitment\s+fees?$/i.test(leaf)
    || /^engineering\s+services?$/i.test(leaf)
    || /^engineering$/i.test(leaf);
}

function isTotalForJanitorialExpensesLabel(label: string): boolean {
  const n = normLabel(label);
  return /^total\s+(for\s+)?cleaning\b/i.test(n)
    || /^total\s+(for\s+)?janitorial\b/i.test(n);
}

function isJanitorialExpensesBandLabel(label: string): boolean {
  const n = normLabel(label);
  if (isTotalForJanitorialExpensesLabel(label)) return true;
  if (/^total\s+(for\s+)?/.test(n)) return false;
  // Unit-coded QBO lines: "Janitorial Expenses_2812", "Cleaning - 2816".
  return /^cleaning(\s+(exp(ense)?s?|charges?|costs?|fees?))?\b/i.test(n)
    || /^janitorial(\s+(exp(ense)?s?|charges?|costs?|fees?|services?))?\b/i.test(n);
}

function isTotalForSuiteHoaLabel(label: string): boolean {
  const n = normLabel(label);
  return /^total\s+(for\s+)?.*\bhoa\b/i.test(n);
}

/**
 * Per-suite / per-property HOA dues ("4433 Punjabway Suit 400 HOA", "Suit - 410 /HOA")
 * roll into one "Suite HOA" line. Balance-sheet HOA balances stay put.
 */
function isSuiteHoaBandLabel(label: string): boolean {
  const n = normLabel(label);
  if (isTotalForSuiteHoaLabel(label)) return true;
  if (/^total\s+(for\s+)?/.test(n)) return false;
  if (!/\bhoa\b/i.test(n)) return false;
  // Keep HOA receivables / payables / prepaid / deposits out of the expense club.
  return !/\b(payable|payables|receivable|receivables|prepaid|deposit|deposits|liabilit)\b/i.test(n);
}

function isTotalForBankFeesLabel(label: string): boolean {
  const n = normLabel(label);
  return /^total\s+(for\s+)?bank\s+fees?\s*(&|and)?\s*service\s+charges?$/i.test(n)
    || /^total\s+(for\s+)?bank\s+charges?$/i.test(n)
    || /^total\s+(for\s+)?credit\s+card\s+charges?$/i.test(n);
}

function isBankFeesBandLabel(label: string): boolean {
  const n = normLabel(label);
  if (isTotalForBankFeesLabel(label)) return true;
  if (/^total\s+(for\s+)?/.test(n)) return false;
  return /^bank\s+fees?\s*(&|and)?\s*service\s+charges?$/i.test(n)
    || /^bank\s+charges?$/i.test(n)
    || /^bank\s+fees?$/i.test(n)
    || /^credit\s+card\s+charges?$/i.test(n)
    || /^credit\s+card\s+fees?$/i.test(n);
}

function isTotalForInterestPaidLabel(label: string): boolean {
  const n = normLabel(label);
  return /^total\s+(for\s+)?interest\s+paid(\s+on\s+loans?)?(\s*[-â€“â€”]\s*.+)?$/i.test(n)
    || /^total\s+(for\s+)?interest\s+(expense|on\s+(?:commercial\s+)?loans?)(\s*[-â€“â€”]\s*.+)?$/i.test(n);
}

/** P&L interest expense lines to roll into "Interest paid on loans" (not BS loan principals). */
function isInterestPaidBandLabel(label: string): boolean {
  const n = normLabel(label);
  if (isTotalForInterestPaidLabel(label)) return true;
  if (/^total\s+(for\s+)?/.test(n)) return false;
  // Keep balance-sheet loan principals out of the interest club.
  if (/^loan\s+from\b/i.test(n)) return false;
  if (/interest\s+income|income\s+from\s+interest/i.test(n)) return false;
  if (/^interest\s+paid(\s+on\s+loans?)?(\s*[-â€“â€”]\s*.+)?$/i.test(n)) return true;
  if (/^interest\s+expense$/i.test(n)) return true;
  if (/^interest\s+on\b/i.test(n)) return true; // Interest on Commercial Loan, Interest on Bank Loan, â€¦
  if (/\binterest\b/i.test(n) && /\b(loan|mortgage|gpb|bancorp)\b/i.test(n)) return true;
  if (/[-â€“â€”:]\s*interest\b/i.test(n)) return true; // GPB Loan 70640169- Interest
  // Lender-named P&L interest shells (e.g. "Bancorp South") â€” not "Loan from â€¦".
  if (/^bancorp\s*south\b/i.test(n)) return true;
  return false;
}

function clubExpenseCategoryBandRows<T extends FinItemLike>(
  items: T[],
  clubLabel: string,
  isTotal: (label: string) => boolean,
  isBand: (label: string) => boolean,
): T[] {
  if (!items.length) return items;

  const idxs: number[] = [];
  for (let i = 0; i < items.length; i++) {
    if (isBand(items[i]!.label)) idxs.push(i);
  }
  if (!idxs.length) return items;

  const totalIdxs = idxs.filter(i => isTotal(items[i]!.label));
  const bands: number[][] = [];
  if (totalIdxs.length) {
    for (const tIdx of totalIdxs) {
      const band = [tIdx];
      for (let j = tIdx - 1; j >= 0; j--) {
        if (!idxs.includes(j)) break;
        if (isTotal(items[j]!.label)) break;
        band.unshift(j);
      }
      bands.push(band);
    }
  } else {
    bands.push(idxs);
  }

  const drop = new Set<number>();
  const replace = new Map<number, T>();

  for (const band of bands) {
    const totalRow = [...band].reverse().find(i => isTotal(items[i]!.label));
    const detailIdxs = band.filter(i => !isTotal(items[i]!.label));
    const anchor = detailIdxs[0] ?? totalRow ?? band[0]!;
    const base = items[anchor]!;

    const values: Record<number, number> = {};
    const monthlyValues: Record<string, number> = {};
    if (totalRow != null) {
      addRowValues(values, monthlyValues, items[totalRow]!);
    } else {
      for (const i of detailIdxs) addRowValues(values, monthlyValues, items[i]!);
    }

    replace.set(anchor, {
      ...base,
      label: clubLabel,
      values,
      monthlyValues: Object.keys(monthlyValues).length ? monthlyValues : undefined,
      isSectionHeader: false,
      isTotal: false,
      isNetIncome: false,
    } as T);
    for (const i of band) {
      if (i !== anchor) drop.add(i);
    }
  }

  const out: T[] = [];
  for (let i = 0; i < items.length; i++) {
    if (drop.has(i)) continue;
    out.push(replace.get(i) ?? items[i]!);
  }
  return out;
}

/** Sale of Land + Sale of Lot + Sale of Property (+ Total for …) → one "Sale of Property" line. */
export function clubSaleOfPropertyRows<T extends FinItemLike>(items: T[]): T[] {
  return clubExpenseCategoryBandRows(
    items,
    SALE_OF_PROPERTY_CLUB_LABEL,
    isTotalForSaleOfPropertyLabel,
    isSaleOfPropertyBandLabel,
  );
}

const COMMISSIONS_FEES_CLUB_LABEL = 'Commissions & fees';

function isTotalForCommissionsFeesLabel(label: string): boolean {
  const n = normLabel(label);
  const leaf = n.includes(':') ? (n.split(':').pop() ?? n).trim() : n;
  return /^total\s+(for\s+)?commissions?\s*(&|and)?\s*fees?$/i.test(n)
    || /^total\s+(for\s+)?commissions?\s*(&|and)?\s*fees?$/i.test(leaf);
}

function isCommissionsFeesBandLabel(label: string): boolean {
  const n = normLabel(label);
  if (isTotalForCommissionsFeesLabel(label)) return true;
  if (/^total\s+(for\s+)?/.test(n)) return false;
  const leaf = n.includes(':') ? (n.split(':').pop() ?? n).trim() : n;
  return /^commissions?\s*(&|and)?\s*fees?$/i.test(leaf)
    || /^commissions?$/i.test(leaf)
    || /^commitment\s+fees?$/i.test(leaf);
}

/** Commissions & fees + Commitment Fee + Total for … → one "Commissions & fees" line. */
export function clubCommissionsFeesRows<T extends FinItemLike>(items: T[]): T[] {
  return clubExpenseCategoryBandRows(
    items,
    COMMISSIONS_FEES_CLUB_LABEL,
    isTotalForCommissionsFeesLabel,
    isCommissionsFeesBandLabel,
  );
}

/** Collapse General business expenses detail + Total for â€¦ into one line. */
export function clubGeneralBusinessExpensesRows<T extends FinItemLike>(items: T[]): T[] {
  return clubExpenseCategoryBandRows(
    items,
    GENERAL_BUSINESS_EXPENSES_CLUB_LABEL,
    isTotalForGeneralBusinessExpensesLabel,
    isGeneralBusinessExpensesBandLabel,
  );
}

/** Cleaning / Janitorial detail + Total for â€¦ → one "Janitorial expenses" line. */
export function clubJanitorialExpensesRows<T extends FinItemLike>(items: T[]): T[] {
  return clubExpenseCategoryBandRows(
    items,
    JANITORIAL_EXPENSES_CLUB_LABEL,
    isTotalForJanitorialExpensesLabel,
    isJanitorialExpensesBandLabel,
  );
}

/** "Improvements" + "Improvements - Others" (+ Total for …) → one "Improvements" line. */
export function clubImprovementsRows<T extends FinItemLike>(items: T[]): T[] {
  return clubExpenseCategoryBandRows(
    items,
    IMPROVEMENTS_CLUB_LABEL,
    isTotalForImprovementsLabel,
    isImprovementsBandLabel,
  );
}

/** Per-suite HOA dues + Total for â€¦ HOA â†’ one "Suite HOA" line. */
export function clubSuiteHoaRows<T extends FinItemLike>(items: T[]): T[] {
  return clubExpenseCategoryBandRows(
    items,
    SUITE_HOA_CLUB_LABEL,
    isTotalForSuiteHoaLabel,
    isSuiteHoaBandLabel,
  );
}

/** Bank charges + Credit Card Charges + Bank fees â†’ one "Bank fees & service charges" line. */
export function clubBankFeesRows<T extends FinItemLike>(items: T[]): T[] {
  return clubExpenseCategoryBandRows(
    items,
    BANK_FEES_CLUB_LABEL,
    isTotalForBankFeesLabel,
    isBankFeesBandLabel,
  );
}

function isTotalForSoftwareSubscriptionsLabel(label: string): boolean {
  const n = normLabel(label);
  return /^total\s+(for\s+)?software\b/i.test(n)
    || /^total\s+(for\s+)?memberships?\s*(&|and)?\s*subscriptions?$/i.test(n);
}

function isSoftwareSubscriptionsBandLabel(label: string): boolean {
  const n = normLabel(label);
  if (isTotalForSoftwareSubscriptionsLabel(label)) return true;
  if (/^total\s+(for\s+)?/.test(n)) return false;
  return /^software\s*(&|and)?\s*other\s+subscriptions?$/i.test(n)
    || /^software\s+subscriptions?$/i.test(n)
    || /^memberships?\s*(&|and)?\s*subscriptions?$/i.test(n)
    || /^subscriptions?\s*(&|and)?\s*memberships?$/i.test(n);
}

/**
 * Software & Other Subscription(s) + Memberships & subscriptions + Total for â€¦
 * â†’ one "Software & Other Subscriptions" line (prefer Total for amounts).
 */
export function clubSoftwareSubscriptionsRows<T extends FinItemLike>(items: T[]): T[] {
  return clubExpenseCategoryBandRows(
    items,
    SOFTWARE_SUBSCRIPTIONS_CLUB_LABEL,
    isTotalForSoftwareSubscriptionsLabel,
    isSoftwareSubscriptionsBandLabel,
  );
}

function isTotalForPropertyTaxesLabel(label: string): boolean {
  const n = normLabel(label);
  return /^total\s+(for\s+)?property\s*tax(?:es)?\b/i.test(n)
    || /^total\s+(for\s+)?.*\bproperty\s*tax(?:es)?\b/i.test(n)
    || /^total\s+(for\s+)?tax(es)?\s+paid$/i.test(n);
}

/** QBO / category-P&L rollup row for the Taxes paid band (keep amounts, drop the line). */
function isPropertyTaxRollupTotalRow<T extends FinItemLike>(item: T): boolean {
  if (isTotalForPropertyTaxesLabel(item.label)) return true;
  if (item.isTotal && (isBareTaxesPaidLabel(item.label) || isBarePropertyTaxesLabel(item.label))) return true;
  return false;
}

function isBarePropertyTaxesLabel(label: string): boolean {
  return /^property\s*tax(?:es)?$/i.test(normLabel(label));
}

/** Parcel / CAD account tax lines under Property taxes (with or without the words "Property Tax"). */
/**
 * Denton / county CAD parcel expense lines that lost an explicit "Property Tax" suffix:
 *   "307567DEN -5880 Clearwater Dr, The Colony, TX 75"
 *   "14C45260000010200 -2414 Marsh Lane, Suite-102, C"
 *   "38211DEN -201 Lloyd's Rd, Little Elm, TX"
 * Account id (digits/letters) + dash + street number + street/city words.
 */
function isCadParcelTaxAccountLabel(labelOrNorm: string): boolean {
  const n = normLabel(labelOrNorm);
  if (!n || /^total\s+(for\s+)?/.test(n)) return false;
  if (/\b(payable|payables|liabilit|insurance|loan|rent|hoa)\b/i.test(n)) return false;
  // P/R CAD ids already handled by the P/R branch; still accept here.
  if (/^[pr]\d{4,}[a-z0-9]*\b/i.test(n) && (/\btax(?:es)?\b/i.test(n) || /\bb-?\d{3}\b/i.test(n))) {
    return true;
  }
  // Bare Denton CAD id after address strip: "1015230DEN", "307567DEN", "38211DEN".
  if (/^\d{4,}den$/i.test(n)) return true;
  // "14C4526… -2414 Marsh Lane…" / "307567DEN -5880 Clearwater Dr…"
  return /^[0-9][0-9a-z]{4,}\s*[-–—]\s*#?\d{2,}\s+\S+/i.test(n)
    && /\b(lane|ln|dr|drive|rd|road|st|street|ave|avenue|blvd|way|ct|court|cir|circle|suite|suit|tx|texas|parkway|pkwy)\b/i.test(n);
}

function isBareTaxesPaidLabel(label: string): boolean {
  const n = normLabel(label);
  if (/^total\s+(for\s+)?/.test(n)) return false;
  const leaf = n.includes(':') ? (n.split(':').pop() ?? n).trim() : n;
  return /^tax(es)?\s+paid$/i.test(n) || /^tax(es)?\s+paid$/i.test(leaf);
}

/** Board must never show Taxes paid / Tax paid / Total for Taxes paid — amounts live on Property taxes. */
export function isTaxesPaidBoardLineLabel(label: string): boolean {
  const n = normLabel(label);
  const leaf = n.includes(':') ? (n.split(':').pop() ?? n).trim() : n;
  return /^(total\s+(for\s+)?)?tax(es)?\s+paid$/i.test(n)
    || /^(total\s+(for\s+)?)?tax(es)?\s+paid$/i.test(leaf);
}

function isShippingPostageLabel(label: string): boolean {
  const n = normLabel(label);
  return /^shipping\s*(&|and)?\s*postage$/i.test(n)
    || /^postage\s*(&|and)?\s*shipping$/i.test(n)
    || /^postage$/i.test(n)
    || /^shipping$/i.test(n);
}

function isPropertyTaxParcelAccountLabel(label: string): boolean {
  const n = normLabel(label);
  if (!n || /^total\s+(for\s+)?/.test(n) || isBarePropertyTaxesLabel(label)) return false;
  // Balance-sheet payables are not P&L property-tax expense.
  if (/\b(payable|payables|liabilit)\b/i.test(n)) return false;
  if (/property\s*tax(?:es)?\b/i.test(n) || /prop(?:erty)?\s*tax(?:es)?\b/i.test(n)) {
    return true;
  }
  if (/^[pr]\d{4,}[a-z0-9]*\b/i.test(n) && (/\btax(?:es)?\b/i.test(n) || /\bb-?\d{3}\b/i.test(n))) return true;
  return isCadParcelTaxAccountLabel(n);
}

function isPropertyTaxesBandLabel(label: string): boolean {
  if (isTotalForPropertyTaxesLabel(label)) return true;
  if (isBarePropertyTaxesLabel(label)) return true;
  // CF parent "Taxes paid" is the same band as Property taxes (identical rollup).
  if (isBareTaxesPaidLabel(label)) return true;
  return isPropertyTaxParcelAccountLabel(label);
}

function isPropertyTaxParentLabel(label: string): boolean {
  return isBarePropertyTaxesLabel(label) || isBareTaxesPaidLabel(label) || isTotalForPropertyTaxesLabel(label);
}

function collectPropertyTaxNeighborParcels<T extends FinItemLike>(
  items: T[],
  tIdx: number,
  idxs: number[],
): void {
  const pushParcelish = (j: number): boolean => {
    const row = items[j]!;
    if (row.isNetIncome) return false;
    if (row.isTotal || isTotalishLabel(row.label)) return false;
    if (isBareSectionHeaderLabel(row.label) || isStructuralSubHeaderLabel(row.label)) return false;
    if (isBarePropertyTaxesLabel(row.label) || isBareTaxesPaidLabel(row.label)) {
      if (!idxs.includes(j)) idxs.push(j);
      return false; // stop past the sibling parent
    }
    const n = normLabel(row.label);
    // Category P&L maps shipping under Taxes paid → Property taxes.
    if (isShippingPostageLabel(row.label)) {
      if (!idxs.includes(j)) idxs.push(j);
      return true;
    }
    if (/^[pr]\d{4,}[a-z0-9]*\b/i.test(n) || isPropertyTaxParcelAccountLabel(row.label) || isCadParcelTaxAccountLabel(n)) {
      if (!idxs.includes(j)) idxs.push(j);
      return true;
    }
    return false;
  };

  // Walk upward from Total / bare Property taxes / Taxes paid.
  for (let j = tIdx - 1; j >= 0; j--) {
    if (!pushParcelish(j)) break;
  }
  // Walk downward — parcel rows often sit under the parent ("Property taxes" then "1015230DEN").
  for (let j = tIdx + 1; j < items.length; j++) {
    if (!pushParcelish(j)) break;
  }
}

/**
 * Parcel / account property-tax lines + Total for / parent Property taxes / Taxes paid
 * into one "Property taxes" line.
 * Prefer Total for, else the bare "Property taxes" rolled-up row (avoids double-counting
 * parcel detail that already feeds the parent), else "Taxes paid", else sum parcel lines.
 */
export function clubPropertyTaxesRows<T extends FinItemLike>(items: T[]): T[] {
  if (!items.length) return items;

  const idxs: number[] = [];
  for (let i = 0; i < items.length; i++) {
    if (isPropertyTaxesBandLabel(items[i]!.label)) idxs.push(i);
  }
  // Also pull indented neighbors around bare Property taxes / Taxes paid / Total for …
  // (covers parcel rows whose labels lost the "Property Tax" suffix after sanitize).
  for (let tIdx = 0; tIdx < items.length; tIdx++) {
    if (!isPropertyTaxParentLabel(items[tIdx]!.label)) continue;
    collectPropertyTaxNeighborParcels(items, tIdx, idxs);
  }
  idxs.sort((a, b) => a - b);
  if (!idxs.length) return items;

  const totalIdxs = idxs.filter(i => isPropertyTaxRollupTotalRow(items[i]!));
  const detailIdxs = idxs.filter(i => !isPropertyTaxRollupTotalRow(items[i]!));
  const barePropIdxs = detailIdxs.filter(i => isBarePropertyTaxesLabel(items[i]!.label));
  const taxesPaidIdxs = detailIdxs.filter(i => isBareTaxesPaidLabel(items[i]!.label));
  const bareIdxs = barePropIdxs.length ? barePropIdxs : taxesPaidIdxs;
  const parcelIdxs = detailIdxs.filter(
    i => !isBarePropertyTaxesLabel(items[i]!.label) && !isBareTaxesPaidLabel(items[i]!.label),
  );
  // Prefer "Property taxes" as the kept board line when both parents exist.
  // Amounts prefer Total for Taxes paid / isTotal rollup so shipping-only leaves
  // do not hide the real tax total.
  const anchor = barePropIdxs[0] ?? taxesPaidIdxs[0] ?? detailIdxs[0] ?? totalIdxs[0] ?? idxs[0]!;
  const base = items[anchor]!;

  const values: Record<number, number> = {};
  const monthlyValues: Record<string, number> = {};

  const shippingInBand = parcelIdxs.some(i => isShippingPostageLabel(items[i]!.label));

  if (totalIdxs.length) {
    for (const i of totalIdxs) addRowValues(values, monthlyValues, items[i]!);
  } else if (shippingInBand) {
    // Taxes paid + shipping & postage + Property taxes were mapped as one board line.
    for (const i of detailIdxs) addRowValues(values, monthlyValues, items[i]!);
  } else if (bareIdxs.length) {
    for (const i of bareIdxs) addRowValues(values, monthlyValues, items[i]!);
    // If we kept Property taxes but Taxes paid has years the prop row left at $0, fill those.
    if (barePropIdxs.length && taxesPaidIdxs.length) {
      const paidYears: Record<number, number> = {};
      const paidMonths: Record<string, number> = {};
      for (const i of taxesPaidIdxs) addRowValues(paidYears, paidMonths, items[i]!);
      for (const [yk, v] of Object.entries(paidYears)) {
        const y = Number(yk);
        if (!Number.isFinite(y)) continue;
        if ((values[y] ?? 0) === 0 && v !== 0) values[y] = v;
      }
      for (const [k, v] of Object.entries(paidMonths)) {
        if ((monthlyValues[k] ?? 0) === 0 && v !== 0) monthlyValues[k] = v;
      }
    }
    const parcelYears: Record<number, number> = {};
    const parcelMonths: Record<string, number> = {};
    for (const i of parcelIdxs) addRowValues(parcelYears, parcelMonths, items[i]!);
    for (const [yk, v] of Object.entries(parcelYears)) {
      const y = Number(yk);
      if (!Number.isFinite(y)) continue;
      // Prefer parent rollup; fill years the parent left at $0 from parcel detail.
      if ((values[y] ?? 0) === 0 && v !== 0) values[y] = v;
    }
    for (const [k, v] of Object.entries(parcelMonths)) {
      if ((monthlyValues[k] ?? 0) === 0 && v !== 0) monthlyValues[k] = v;
    }
  } else {
    for (const i of parcelIdxs) addRowValues(values, monthlyValues, items[i]!);
  }

  const drop = new Set(idxs.filter(i => i !== anchor));
  const out: T[] = [];
  for (let i = 0; i < items.length; i++) {
    if (drop.has(i)) continue;
    if (i === anchor) {
      out.push({
        ...base,
        label: PROPERTY_TAXES_CLUB_LABEL,
        values,
        monthlyValues: Object.keys(monthlyValues).length ? monthlyValues : undefined,
        isSectionHeader: false,
        isTotal: false,
        isNetIncome: false,
      } as T);
      continue;
    }
    out.push(items[i]!);
  }
  return out;
}

/**
 * Last-resort guarantee for board tables/PDF export: if a bare "Taxes paid" row is still
 * sitting next to "Property taxes" after {@link clubPropertyTaxesRows} (e.g. the QBO label
 * carried an account-number prefix or trailing punctuation that earlier regexes missed),
 * fold its amounts into Property taxes and drop it. The board must never show both.
 * No-op unless both labels are present, so it is safe to call unconditionally.
 */
export function ensureTaxesPaidFoldedIntoPropertyTaxes<T extends FinItemLike>(items: T[]): T[] {
  const bareLabel = (label: string) =>
    normLabel(label).replace(/^\d+\s+/, '').replace(/[:.]+$/, '').trim();
  const propIdx = items.findIndex(i => /^property\s*tax(?:es)?$/i.test(bareLabel(i.label)));
  const paidIdx = items.findIndex(i => /^tax(?:es)?\s+paid$/i.test(bareLabel(i.label)));
  if (propIdx === -1 || paidIdx === -1 || propIdx === paidIdx) return items;

  const prop = items[propIdx]!;
  const paid = items[paidIdx]!;
  const values: Record<number, number> = { ...prop.values };
  for (const [yStr, v] of Object.entries(paid.values ?? {})) {
    const y = Number(yStr);
    if (!Number.isFinite(y)) continue;
    values[y] = (values[y] ?? 0) + (typeof v === 'number' ? v : 0);
  }
  const monthlyValues = prop.monthlyValues || paid.monthlyValues
    ? { ...(paid.monthlyValues ?? {}), ...(prop.monthlyValues ?? {}) }
    : undefined;
  const merged = { ...prop, label: PROPERTY_TAXES_CLUB_LABEL, values, monthlyValues } as T;

  return items
    .filter((_, i) => i !== paidIdx)
    .map(item => (item === prop ? merged : item));
}

function isTotalForTravelHotelsLabel(label: string): boolean {
  const n = normLabel(label);
  return /^total\s+(for\s+)?travel(\s*(&|and)?\s*hotels?)?$/i.test(n)
    || /^total\s+(for\s+)?hotels?$/i.test(n);
}

function isTravelHotelsBandLabel(label: string): boolean {
  const n = normLabel(label);
  if (isTotalForTravelHotelsLabel(label)) return true;
  if (/^total\s+(for\s+)?/.test(n)) return false;
  return /^travel(\s*(&|and)?\s*hotels?)?$/i.test(n)
    || /^hotels?$/i.test(n)
    || /^travel\s*(&|and)?\s*(lodging|meals|entertainment)$/i.test(n);
}

/** Travel + Hotels + Total for Travel â†’ one "Travel and hotels" line. */
export function clubTravelHotelsRows<T extends FinItemLike>(items: T[]): T[] {
  return clubExpenseCategoryBandRows(
    items,
    TRAVEL_HOTELS_CLUB_LABEL,
    isTotalForTravelHotelsLabel,
    isTravelHotelsBandLabel,
  );
}

function isTotalForElectricityInternetLabel(label: string): boolean {
  const n = normLabel(label);
  return /^total\s+(for\s+)?utilit/i.test(n)
    || /^total\s+(for\s+)?electricity(\s*(&|and)?\s*internet(\s+services?)?)?$/i.test(n)
    || /^total\s+(for\s+)?internet\s*(&|and)?\s*tv\s+services?$/i.test(n)
    || /^total\s+(for\s+)?internet(\s+services?)?$/i.test(n);
}

function isElectricityInternetBandLabel(label: string): boolean {
  const n = normLabel(label);
  if (isTotalForElectricityInternetLabel(label)) return true;
  if (/^total\s+(for\s+)?/.test(n)) return false;
  return /^electricity(\s*(&|and)?\s*internet(\s+services?)?)?$/i.test(n)
    || /^electricity\s+account(\s+no\.?)?$/i.test(n)
    || /^internet\s*(&|and)?\s*tv\s+services?$/i.test(n)
    || /^internet(\s+services?)?$/i.test(n)
    // "Internet (# 8260130091748957)" after account-number sanitize may still carry (#…).
    || /^internet\s*[#(]/i.test(n)
    || /^utilities?\s*[-–—:]\s*(electricity|internet)/i.test(n);
}

/**
 * Electricity + Internet account lines (+ Total for Utilities) →
 * one "Electricity and Internet services" line.
 * Sums account detail when present; does not add the bare parent on top of detail
 * (avoids double-counting when both exist).
 */
export function clubElectricityInternetRows<T extends FinItemLike>(items: T[]): T[] {
  if (!items.length) return items;

  const idxs: number[] = [];
  for (let i = 0; i < items.length; i++) {
    if (isElectricityInternetBandLabel(items[i]!.label)) idxs.push(i);
  }
  if (!idxs.length) return items;

  const totalIdxs = idxs.filter(i => isTotalForElectricityInternetLabel(items[i]!.label));
  const detailIdxs = idxs.filter(i => !isTotalForElectricityInternetLabel(items[i]!.label));
  // Only the combined parent rollup — not bare "Electricity" (that is detail).
  const bareIdxs = detailIdxs.filter(i =>
    /^electricity\s*(&|and)\s*internet(\s+services?)?$/i.test(normLabel(items[i]!.label)),
  );
  const accountIdxs = detailIdxs.filter(i => !bareIdxs.includes(i));
  const anchor = bareIdxs[0] ?? accountIdxs[0] ?? totalIdxs[0] ?? idxs[0]!;
  const base = items[anchor]!;

  const values: Record<number, number> = {};
  const monthlyValues: Record<string, number> = {};
  // Prefer account detail (Electricity Account No, Internet #…) over the bare parent /
  // Utilities total — those rollups often include unrelated lines (e.g. Suite HOA).
  const sourceIdxs = accountIdxs.length
    ? accountIdxs
    : (bareIdxs.length ? bareIdxs : totalIdxs);
  for (const i of sourceIdxs) addRowValues(values, monthlyValues, items[i]!);

  const drop = new Set(idxs.filter(i => i !== anchor));
  const out: T[] = [];
  for (let i = 0; i < items.length; i++) {
    if (drop.has(i)) continue;
    if (i === anchor) {
      out.push({
        ...base,
        label: ELECTRICITY_INTERNET_CLUB_LABEL,
        values,
        monthlyValues: Object.keys(monthlyValues).length ? monthlyValues : undefined,
        isSectionHeader: false,
        isTotal: false,
        isNetIncome: false,
      } as T);
      continue;
    }
    out.push(items[i]!);
  }
  return out;
}

function isTotalForOtherIncomeLabel(label: string): boolean {
  const n = normLabel(label);
  return /^total\s+(for\s+)?other\s+(miscellaneous\s+)?income\b/i.test(n)
    || /^total\s+(for\s+)?miscellaneous\s+income\b/i.test(n)
    || /^total\s+(for\s+)?other\s+misc\.?\s+income\b/i.test(n);
}

function isOtherIncomeBandLabel(label: string): boolean {
  const n = normLabel(label);
  if (isTotalForOtherIncomeLabel(label)) return true;
  if (/^total\s+(for\s+)?/.test(n)) return false;
  return /^other\s+income$/i.test(n)
    || /^other\s+miscellaneous\s+income$/i.test(n)
    || /^miscellaneous\s+income$/i.test(n)
    || /^other\s+misc\.?\s+income$/i.test(n);
}

/** Other Income + Other Miscellaneous Income + Total for â€¦ â†’ one "Other Income" line. */
export function clubOtherIncomeRows<T extends FinItemLike>(items: T[]): T[] {
  if (!items.length) return items;

  const idxs: number[] = [];
  for (let i = 0; i < items.length; i++) {
    if (isOtherIncomeBandLabel(items[i]!.label)) idxs.push(i);
  }
  if (!idxs.length) return items;

  const totalIdxs = idxs.filter(i => isTotalForOtherIncomeLabel(items[i]!.label));
  const detailIdxs = idxs.filter(i => !isTotalForOtherIncomeLabel(items[i]!.label));
  const anchor = detailIdxs[0] ?? totalIdxs[0] ?? idxs[0]!;
  const base = items[anchor]!;

  const values: Record<number, number> = {};
  const monthlyValues: Record<string, number> = {};
  // Prefer Total for Other Income (includes all other-income details).
  const sourceIdxs = totalIdxs.length ? totalIdxs : detailIdxs;
  for (const i of sourceIdxs) addRowValues(values, monthlyValues, items[i]!);

  const drop = new Set(idxs.filter(i => i !== anchor));
  const out: T[] = [];
  for (let i = 0; i < items.length; i++) {
    if (drop.has(i)) continue;
    if (i === anchor) {
      out.push({
        ...base,
        label: OTHER_INCOME_CLUB_LABEL,
        values,
        monthlyValues: Object.keys(monthlyValues).length ? monthlyValues : undefined,
        isSectionHeader: false,
        isTotal: false,
        isNetIncome: false,
      } as T);
      continue;
    }
    out.push(items[i]!);
  }
  return out;
}

function isTotalForVehicleExpensesLabel(label: string): boolean {
  const n = normLabel(label);
  return /^total\s+(for\s+)?vehicle\s+(expenses?|gas\s*(&|and)?\s*fuels?)\b/i.test(n)
    || /^total\s+(for\s+)?(parking\s*(&|and)?\s*tolls?|tolls?\s*(&|and)?\s*parking|gas\s*(&|and)?\s*fuels?|automobile\s+expenses?|auto\s+expenses?)\b/i.test(n);
}

function isVehicleExpensesBandLabel(label: string): boolean {
  const n = normLabel(label);
  if (isTotalForVehicleExpensesLabel(label)) return true;
  if (/^total\s+(for\s+)?/.test(n)) return false;
  return /^vehicle\s+expenses?$/i.test(n)
    || /^vehicle\s+gas\s*(&|and)?\s*fuels?$/i.test(n)
    || /^gas\s*(&|and)?\s*fuels?$/i.test(n)
    || /^parking\s*(&|and)?\s*tolls?$/i.test(n)
    || /^tolls?\s*(&|and)?\s*parking$/i.test(n)
    || /^automobile\s+expenses?$/i.test(n)
    || /^auto\s+expenses?$/i.test(n);
}

/** Vehicle expenses + Parking & tolls + Vehicle gas & fuel â†’ one "Vehicle expenses" line. */
export function clubVehicleExpensesRows<T extends FinItemLike>(items: T[]): T[] {
  if (!items.length) return items;

  const idxs: number[] = [];
  for (let i = 0; i < items.length; i++) {
    if (isVehicleExpensesBandLabel(items[i]!.label)) idxs.push(i);
  }
  if (!idxs.length) return items;

  const totalIdxs = idxs.filter(i => isTotalForVehicleExpensesLabel(items[i]!.label));
  const detailIdxs = idxs.filter(i => !isTotalForVehicleExpensesLabel(items[i]!.label));
  const anchor = detailIdxs[0] ?? totalIdxs[0] ?? idxs[0]!;
  const base = items[anchor]!;

  const values: Record<number, number> = {};
  const monthlyValues: Record<string, number> = {};
  // Sum vehicle / parking / fuel details (a category Total may omit sibling lines).
  const sourceIdxs = detailIdxs.length ? detailIdxs : totalIdxs;
  for (const i of sourceIdxs) addRowValues(values, monthlyValues, items[i]!);

  const drop = new Set(idxs.filter(i => i !== anchor));
  const out: T[] = [];
  for (let i = 0; i < items.length; i++) {
    if (drop.has(i)) continue;
    if (i === anchor) {
      out.push({
        ...base,
        label: VEHICLE_EXPENSES_CLUB_LABEL,
        values,
        monthlyValues: Object.keys(monthlyValues).length ? monthlyValues : undefined,
        isSectionHeader: false,
        isTotal: false,
        isNetIncome: false,
      } as T);
      continue;
    }
    out.push(items[i]!);
  }
  return out;
}

/**
 * Collapse all interest-expense variants (GPB / commercial / Bancorp South / Interest paid)
 * into one "Interest paid on loans" line. Sums detail rows so lender lines outside a
 * "Total for Interest paid" band are still included (totals alone used only as fallback).
 */
export function clubInterestPaidRows<T extends FinItemLike>(items: T[]): T[] {
  if (!items.length) return items;

  const idxs: number[] = [];
  for (let i = 0; i < items.length; i++) {
    if (isInterestPaidBandLabel(items[i]!.label)) idxs.push(i);
  }
  if (!idxs.length) return items;

  const totalIdxs = idxs.filter(i => isTotalForInterestPaidLabel(items[i]!.label));
  const detailIdxs = idxs.filter(i => !isTotalForInterestPaidLabel(items[i]!.label));
  const anchor = detailIdxs[0] ?? totalIdxs[0] ?? idxs[0]!;
  const base = items[anchor]!;

  const values: Record<number, number> = {};
  const monthlyValues: Record<string, number> = {};
  const sourceIdxs = detailIdxs.length ? detailIdxs : totalIdxs;
  for (const i of sourceIdxs) addRowValues(values, monthlyValues, items[i]!);

  const drop = new Set(idxs.filter(i => i !== anchor));
  const out: T[] = [];
  for (let i = 0; i < items.length; i++) {
    if (drop.has(i)) continue;
    if (i === anchor) {
      out.push({
        ...base,
        label: INTEREST_PAID_CLUB_LABEL,
        values,
        monthlyValues: Object.keys(monthlyValues).length ? monthlyValues : undefined,
        isSectionHeader: false,
        isTotal: false,
        isNetIncome: false,
      } as T);
      continue;
    }
    out.push(items[i]!);
  }
  return out;
}

const BUSINESS_LOANS_CLUB_LABEL = 'Business loans';

function isTotalForBusinessLoansLabel(label: string): boolean {
  const n = normLabel(label);
  return /^total\s+(for\s+)?(?:short[- ]?term|long[- ]?term)\s+business\s+loans?$/i.test(n)
    || /^total\s+(for\s+)?business\s+loans?$/i.test(n);
}

function isBusinessLoanBandLabel(label: string): boolean {
  const n = normLabel(label);
  if (/partner|shareholder/i.test(n)) return false;
  if (isTotalForBusinessLoansLabel(label)) return true;
  if (/^total\s+(for\s+)?/.test(n)) return false;
  return /^(?:short[- ]?term|long[- ]?term)\s+business\s+loans?\b/i.test(n)
    || /^business\s+loans?\b/i.test(n);
}

/**
 * Club Short-term + Long-term business loans (and their Total for rows)
 * into a single "Business loans" line. Partner loans stay separate.
 */
export function clubBusinessLoanRows<T extends FinItemLike>(items: T[]): T[] {
  if (!items.length) return items;

  const idxs: number[] = [];
  for (let i = 0; i < items.length; i++) {
    if (isBusinessLoanBandLabel(items[i]!.label)) idxs.push(i);
  }
  if (!idxs.length) return items;

  const totalIdxs = idxs.filter(i => isTotalForBusinessLoansLabel(items[i]!.label));
  const detailIdxs = idxs.filter(i => !isTotalForBusinessLoansLabel(items[i]!.label));
  const anchor = detailIdxs[0] ?? totalIdxs[0] ?? idxs[0]!;
  const base = items[anchor]!;

  const values: Record<number, number> = {};
  const monthlyValues: Record<string, number> = {};

  if (totalIdxs.length) {
    for (const i of totalIdxs) addRowValues(values, monthlyValues, items[i]!);
  } else {
    for (const i of detailIdxs) addRowValues(values, monthlyValues, items[i]!);
  }

  const drop = new Set(idxs.filter(i => i !== anchor));
  const out: T[] = [];
  for (let i = 0; i < items.length; i++) {
    if (drop.has(i)) continue;
    if (i === anchor) {
      out.push({
        ...base,
        label: BUSINESS_LOANS_CLUB_LABEL,
        values,
        monthlyValues: Object.keys(monthlyValues).length ? monthlyValues : undefined,
        isSectionHeader: false,
        isTotal: false,
        isNetIncome: false,
      } as T);
      continue;
    }
    out.push(items[i]!);
  }
  return out;
}

/** @deprecated use clubBusinessLoanRows â€” kept as alias for older call sites. */
export function clubShortTermBusinessLoanRows<T extends FinItemLike>(items: T[]): T[] {
  return clubBusinessLoanRows(items);
}

/** "Total for Assets" / "Total Assets" closes the "Assets" section. */
function isTotalRowForSection(label: string, sectionLabel: string): boolean {
  const section = normLabel(sectionLabel);
  const norm = normLabel(label);
  return norm === `total for ${section}` || norm === `total ${section}`;
}

function isTotalishLabel(label: string): boolean {
  return /^total\s+(for\s+)?/i.test(label.trim());
}

/** BS / P&L structural bands that should stay when they have non-zero children. */
function isStructuralSubHeaderLabel(label: string): boolean {
  return /^(current assets?|other current assets?|fixed assets?|other assets?|bank accounts?|accounts receivable|accounts payable|credit cards?|long[- ]term liabilit(?:y|ies)|current liabilit(?:y|ies))$/i.test(
    normLabel(label),
  );
}

/**
 * Club same-name header + detail into one row (e.g. Improvements under Improvements).
 * Sums year amounts; prefers a non-header row for the kept label. Leaves "Total for â€¦" alone.
 */
export function clubDuplicateStatementDetailRows<T extends FinItemLike>(
  items: T[],
  sheet?: 'pl' | 'bs' | 'cf',
): T[] {
  if (!items.length) return items;
  const out: T[] = [];
  const indexByKey = new Map<string, number>();

  for (const item of items) {
    const sanitizedLabel = sanitizeStatementLineLabel(item.label);
    const demoteTaxTotal = sanitizedLabel === 'Taxes paid'
      && /^total\s+(for\s+)?taxes\s+paid$/i.test(normLabel(item.label));
    const row = sanitizedLabel === item.label && !demoteTaxTotal
      ? item
      : {
          ...item,
          label: sanitizedLabel,
          ...(demoteTaxTotal ? { isTotal: false, isSectionHeader: false } : {}),
        } as T;

    if (row.isTotal || row.isNetIncome || isTotalishLabel(row.label)) {
      out.push(row);
      indexByKey.clear();
      continue;
    }
    if (row.isSectionHeader && (isBareSectionHeaderLabel(row.label) || isStructuralSubHeaderLabel(row.label))) {
      out.push(row);
      indexByKey.clear();
      continue;
    }

    const clubKey = statementLineClubKey(row.label, sheet);
    // Club expense families, Improvements, Long-term business loans, and Intercompany Loans.
    const key = clubKey ? `club:${clubKey}` : normLabel(row.label);
    if (!key) {
      out.push(row);
      continue;
    }

    const existingIdx = indexByKey.get(key);
    if (existingIdx == null) {
      indexByKey.set(key, out.length);
      out.push({
        ...row,
        label: clubKey ? statementClubLabel(clubKey) : row.label,
        values: { ...(row.values as Record<number, number>) },
        monthlyValues: row.monthlyValues ? { ...row.monthlyValues } : undefined,
      });
      continue;
    }

    const existing = out[existingIdx];
    const values: Record<number, number> = { ...(existing.values as Record<number, number>) };
    for (const [k] of Object.entries(row.values ?? {})) {
      const y = Number(k);
      if (!Number.isFinite(y)) continue;
      values[y] = (values[y] ?? 0) + yearVal(row.values, y);
    }
    let monthlyValues = existing.monthlyValues ? { ...existing.monthlyValues } : undefined;
    if (row.monthlyValues) {
      monthlyValues = monthlyValues ?? {};
      for (const [k, v] of Object.entries(row.monthlyValues)) {
        monthlyValues[k] = (monthlyValues[k] ?? 0) + (Number(v) || 0);
      }
    }
    // Prefer the detail (non-header) label/indent when merging a blank band into a value row.
    const preferIncoming = existing.isSectionHeader && !row.isSectionHeader;
    const mergedClub = clubKey || statementLineClubKey(existing.label, sheet);
    out[existingIdx] = {
      ...(preferIncoming ? row : existing),
      values,
      monthlyValues,
      isSectionHeader: false,
      isTotal: false,
      isNetIncome: false,
      label: mergedClub ? statementClubLabel(mergedClub) : (preferIncoming ? row.label : existing.label),
      indent: preferIncoming ? row.indent : existing.indent,
    } as T;
  }

  return out;
}

function shouldClubFixedAssetTotal(label: string): boolean {
  const n = normLabel(label);
  return /^total\s+for\s+improvements?\b/i.test(n)
    || /^total\s+for\s+.*\bproperty\s+total\b/i.test(n)
    || /^total\s+for\s+\d+\s*[- ]?\s*year\s+property\b/i.test(n)
    || /^total\s+for\s+.*\boffice\s+park\b/i.test(n);
}

function propertyLineFromTotalLabel(label: string): string | null {
  const s = label.trim();
  const yearBand = /^total\s+for\s+(\d+)\s*[- ]?\s*year\s+property\b/i.exec(s);
  if (yearBand) return `${yearBand[1]}-Year Property`;
  const namedProperty = /^total\s+for\s+(.+\b(?:office\s+park|property(?:\s+total)?))$/i.exec(s);
  if (namedProperty?.[1]) return namedProperty[1].trim();
  return null;
}

/**
 * Merge repeated fixed-asset total rows split by year buckets into one total row.
 * e.g. "Total for Improvements - 2018/2019/Others" -> "Total for Improvements".
 */
export function clubFixedAssetTotalRows<T extends FinItemLike>(items: T[]): T[] {
  if (!items.length) return items;
  const out: T[] = [];
  const totalIndexByLabel = new Map<string, number>();

  for (const item of items) {
    const sanitizedLabel = sanitizeStatementLineLabel(item.label);
    const row = sanitizedLabel === item.label ? item : { ...item, label: sanitizedLabel };

    if (!(row.isTotal || isTotalishLabel(row.label)) || !shouldClubFixedAssetTotal(row.label)) {
      out.push(row);
      continue;
    }

    const key = normLabel(row.label);
    const existingIdx = totalIndexByLabel.get(key);
    if (existingIdx == null) {
      const propertyLabel = propertyLineFromTotalLabel(row.label);
      totalIndexByLabel.set(key, out.length);
      out.push({
        ...row,
        label: propertyLabel ?? row.label,
        values: { ...(row.values as Record<number, number>) },
        monthlyValues: row.monthlyValues ? { ...row.monthlyValues } : undefined,
        isTotal: propertyLabel ? false : row.isTotal,
        isSectionHeader: false,
        isNetIncome: false,
      });
      continue;
    }

    const existing = out[existingIdx]!;
    const values: Record<number, number> = { ...(existing.values as Record<number, number>) };
    for (const [k] of Object.entries(row.values ?? {})) {
      const y = Number(k);
      if (!Number.isFinite(y)) continue;
      values[y] = (values[y] ?? 0) + yearVal(row.values, y);
    }
    let monthlyValues = existing.monthlyValues ? { ...existing.monthlyValues } : undefined;
    if (row.monthlyValues) {
      monthlyValues = monthlyValues ?? {};
      for (const [k, v] of Object.entries(row.monthlyValues)) {
        monthlyValues[k] = (monthlyValues[k] ?? 0) + (Number(v) || 0);
      }
    }
    const propertyLabel = propertyLineFromTotalLabel(row.label) ?? propertyLineFromTotalLabel(existing.label);
    out[existingIdx] = {
      ...existing,
      values,
      monthlyValues,
      label: propertyLabel ?? row.label,
      isTotal: propertyLabel ? false : true,
      isSectionHeader: false,
      isNetIncome: false,
    } as T;
  }
  return out;
}

/** Matches "Security deposit", "Security -Deposit - Rent", "Security: Deposit", â€¦ */
function isSecurityDepositLabel(label: string): boolean {
  return /^security\s*[-â€“â€”:]?\s*deposits?\b/i.test(normLabel(label));
}

function isTotalForSecurityDepositLabel(label: string): boolean {
  return /^total\s+(for\s+)?security\s*[-â€“â€”:]?\s*deposits?\b/i.test(normLabel(label));
}

const BANK_ACCOUNTS_CLUB_LABEL = 'Bank';
const ACCOUNTS_RECEIVABLE_CLUB_LABEL = 'Accounts Receivable';
const ACCOUNTS_PAYABLE_CLUB_LABEL = 'Accounts Payable';
const CREDIT_CARDS_CLUB_LABEL = 'Credit Cards';
const INTEREST_PAYABLE_CLUB_LABEL = 'Interest Payable';
const LEEZA_RECEIVABLE_CLUB_LABEL = 'Receivable from LeezaSpace';
const RELATED_PARTY_RECEIVABLE_CLUB_LABEL = 'Receivable';
const RELATED_PARTY_PAYABLE_CLUB_LABEL = 'Payable';

/** Related-party AR for LeezaSpace â€” keep as its own line, never fold into Accounts Receivable. */
export function isLeezaSpaceReceivableLabel(label: string): boolean {
  const n = normLabel(label);
  if (!/leeza/.test(n)) return false;
  return /receiv/.test(n) || /^receivable\s+from\s+leeza/i.test(n);
}

/**
 * Related-party "Receivable from …" lines (e.g. Texas Green Realty) — not A/R, not LeezaSpace.
 */
function isRelatedPartyReceivableLabel(label: string): boolean {
  if (isLeezaSpaceReceivableLabel(label)) return false;
  if (isAccountsReceivableHeaderLabel(label) || isTotalForAccountsReceivableLabel(label)) return false;
  const n = normLabel(stripApArAbbreviations(label));
  if (!n || /^total\s+(for\s+)?/.test(n)) return false;
  if (/^accounts?\s+receivables?\b/i.test(n)) return false;
  return /^receivables?\s+from\b/i.test(n)
    || /^receivables?\s*[-–—:]\s*/i.test(n)
    || /^receivables?$/i.test(n);
}

/**
 * "Payable to Sandhya Konda" / other related-party payable lines — not Accounts Payable,
 * Interest/Rent/Property Tax Payable, or Other Payables colon paths.
 */
function isRelatedPartyPayableLabel(label: string): boolean {
  const n = normLabel(stripApArAbbreviations(label));
  if (!n || /^total\s+(for\s+)?/.test(n)) return false;
  if (/^accounts?\s+payables?\b/i.test(n)) return false;
  if (/^other\s+payables?\b/i.test(n)) return false;
  if (/^(interest|rent|property\s*tax(?:es)?)\s+payables?\b/i.test(n)) return false;
  if (/^paychex\s+invoice\s+payables?\b/i.test(n)) return false;
  return /^payables?\s+to\b/i.test(n)
    || /^payables?\s*[-–—:]\s*/i.test(n)
    || /^payables?$/i.test(n);
}

function isBankAccountsHeaderLabel(label: string): boolean {
  const n = normLabel(label);
  return /^bank\s+accounts?$/i.test(n) || /^banks?$/i.test(n);
}

function isTotalForBankAccountsLabel(label: string): boolean {
  const n = normLabel(label);
  return /^total\s+(for\s+)?bank\s+accounts?$/i.test(n)
    || /^total\s+(for\s+)?banks?$/i.test(n);
}

/** Individual bank / cash account lines under the Bank Accounts band. */
function isBankAccountDetailLabel(label: string): boolean {
  const n = normLabel(label);
  if (isBankAccountsHeaderLabel(label) || isTotalForBankAccountsLabel(label)) return false;
  if (/^total\s+(for\s+)?/.test(n)) return false;
  if (isStructuralSubHeaderLabel(label) || isBareSectionHeaderLabel(label)) return false;
  // Liabilities / loans that share a bank name must never fold into cash Bank.
  if (/\bloan\b/i.test(n) || /\binstallment\b/i.test(n) || /\bpayable\b/i.test(n)) return false;
  if (/^undeposited\s+funds$/i.test(n)) return true;
  // Paychex 1099 shell is dropped separately â€” never fold into Bank.
  if (/^paychex\s*[-â€“â€”:]\s*1099\s+payments?$/i.test(n)) return false;
  return /\b(checking|savings|money\s*market|bofa|bank\s+of\s+america|gpb|great\s+plains|wells\s*fargo|chase|pnc|regions|bancorp|credit\s*union|operating\s+account|cash\s+on\s+hand)\b/i.test(n)
    || /\(deleted\)/i.test(n);
}

function isAccountsReceivableHeaderLabel(label: string): boolean {
  const n = normLabel(stripApArAbbreviations(label));
  return /^accounts?\s+receivables?$/i.test(n);
}

function isTotalForAccountsReceivableLabel(label: string): boolean {
  const n = normLabel(stripApArAbbreviations(label));
  return /^total\s+(for\s+)?accounts?\s+receivables?\b/i.test(n);
}

function isAccountsReceivableBandLabel(label: string): boolean {
  if (isLeezaSpaceReceivableLabel(label)) return false;
  if (isRelatedPartyReceivableLabel(label)) return false;
  if (isTotalForAccountsReceivableLabel(label)) return true;
  const n = normLabel(stripApArAbbreviations(label));
  if (/^total\s+(for\s+)?/.test(n)) return false;
  // Header, "Accounts Receivable (A/R)", and QBO "Accounts Receivable:â€¦" children
  return /^accounts?\s+receivables?\b/i.test(n);
}

/**
 * Collapse header â†’ detail â†’ "Total for â€¦" into one line.
 * Prefers Total for amounts when present. Rows matching `exclude` stay untouched.
 */
function clubHeaderToTotalBandRows<T extends FinItemLike>(
  items: T[],
  clubLabel: string,
  isHeader: (label: string) => boolean,
  isTotal: (label: string) => boolean,
  exclude?: (label: string) => boolean,
  isExtraBand?: (label: string) => boolean,
): T[] {
  if (!items.length) return items;

  const drop = new Set<number>();
  const replace = new Map<number, T>();

  const applyBand = (band: number[]) => {
    if (!band.length) return;
    const totalRow = [...band].reverse().find(i => isTotal(items[i]!.label));
    const detailIdxs = band.filter(i => !isTotal(items[i]!.label));
    const anchor = (detailIdxs.find(i => isHeader(items[i]!.label)) ?? detailIdxs[0] ?? totalRow)!;
    const base = items[anchor]!;

    const detailValues: Record<number, number> = {};
    const detailMonthly: Record<string, number> = {};
    const totalValues: Record<number, number> = {};
    const totalMonthly: Record<string, number> = {};
    for (const i of band) {
      const row = items[i]!;
      if (isTotal(row.label)) addRowValues(totalValues, totalMonthly, row);
      else addRowValues(detailValues, detailMonthly, row);
    }

    const years = new Set<number>([
      ...Object.keys(detailValues).map(Number).filter(Number.isFinite),
      ...Object.keys(totalValues).map(Number).filter(Number.isFinite),
    ]);
    const values: Record<number, number> = {};
    for (const y of years) {
      const t = totalValues[y] ?? 0;
      const d = detailValues[y] ?? 0;
      values[y] = t !== 0 ? t : d;
    }
    const monthKeys = new Set<string>([...Object.keys(detailMonthly), ...Object.keys(totalMonthly)]);
    const monthlyValues: Record<string, number> = {};
    for (const k of monthKeys) {
      const t = totalMonthly[k] ?? 0;
      const d = detailMonthly[k] ?? 0;
      monthlyValues[k] = t !== 0 ? t : d;
    }

    replace.set(anchor, {
      ...base,
      label: clubLabel,
      values,
      monthlyValues: Object.keys(monthlyValues).length ? monthlyValues : undefined,
      isSectionHeader: false,
      isTotal: false,
      isNetIncome: false,
    } as T);
    for (const i of band) {
      if (i !== anchor) drop.add(i);
    }
  };

  // Prefer contiguous headerâ€¦Total bands (includes bank / AR detail lines in between).
  for (let tIdx = 0; tIdx < items.length; tIdx++) {
    if (!isTotal(items[tIdx]!.label)) continue;
    let hIdx = -1;
    for (let j = tIdx; j >= 0; j--) {
      if (exclude?.(items[j]!.label)) continue;
      if (isHeader(items[j]!.label)) {
        hIdx = j;
        break;
      }
    }
    const start = hIdx >= 0 ? hIdx : tIdx;
    const band: number[] = [];
    for (let i = start; i <= tIdx; i++) {
      if (exclude?.(items[i]!.label)) continue;
      band.push(i);
    }
    applyBand(band);
  }

  // Fallback: no Total for row â€” club header + matching band labels only.
  if (!replace.size) {
    const idxs: number[] = [];
    for (let i = 0; i < items.length; i++) {
      const lab = items[i]!.label;
      if (exclude?.(lab)) continue;
      if (isHeader(lab) || isTotal(lab) || isExtraBand?.(lab)) idxs.push(i);
    }
    if (idxs.length) applyBand(idxs);
  }

  if (!replace.size) return items;
  const out: T[] = [];
  for (let i = 0; i < items.length; i++) {
    if (drop.has(i)) continue;
    out.push(replace.get(i) ?? items[i]!);
  }
  return out;
}

/**
 * Bank Accounts header + detail lines + Total for Bank Accounts → one "Bank" line.
 *
 * Uses only contiguous header…Total bands (prefers Total amounts). Never runs a
 * global “all bank-named rows” fallback — after sanitize, term loans become bare
 * bank names ("Loan from Great Plains Bank" → "Great Plains Bank") and would
 * incorrectly inflate cash Bank.
 */
export function clubBankAccountsRows<T extends FinItemLike>(items: T[]): T[] {
  if (!items.length) return items;

  const drop = new Set<number>();
  const replace = new Map<number, T>();

  for (let tIdx = 0; tIdx < items.length; tIdx++) {
    if (!isTotalForBankAccountsLabel(items[tIdx]!.label)) continue;
    let hIdx = -1;
    for (let j = tIdx; j >= 0; j--) {
      if (isBankAccountsHeaderLabel(items[j]!.label)) {
        hIdx = j;
        break;
      }
      // Stop if we leave the bank band (another section total / structural header).
      if (j < tIdx && (isBareSectionHeaderLabel(items[j]!.label) || isStructuralSubHeaderLabel(items[j]!.label))) {
        break;
      }
    }
    const start = hIdx >= 0 ? hIdx : tIdx;
    const band: number[] = [];
    for (let i = start; i <= tIdx; i++) band.push(i);

    const totalRow = items[tIdx]!;
    const anchor = (hIdx >= 0 ? hIdx : tIdx);
    const base = items[anchor]!;
    const values: Record<number, number> = { ...(totalRow.values as Record<number, number>) };
    const monthlyValues = totalRow.monthlyValues ? { ...totalRow.monthlyValues } : undefined;
    // If Total cells are empty for a year, fall back to summing in-band cash details only.
    const years = new Set<number>([
      ...Object.keys(values).map(Number).filter(Number.isFinite),
      ...band.flatMap(i => Object.keys(items[i]!.values ?? {}).map(Number).filter(Number.isFinite)),
    ]);
    for (const y of years) {
      if ((values[y] ?? 0) !== 0) continue;
      let sum = 0;
      for (const i of band) {
        if (i === tIdx) continue;
        if (isBankAccountsHeaderLabel(items[i]!.label)) continue;
        if (!isBankAccountDetailLabel(items[i]!.label) && i !== hIdx) continue;
        if (isBankAccountDetailLabel(items[i]!.label)) sum += yearVal(items[i]!.values, y);
      }
      if (sum !== 0) values[y] = sum;
    }

    replace.set(anchor, {
      ...base,
      label: BANK_ACCOUNTS_CLUB_LABEL,
      values,
      monthlyValues,
      isSectionHeader: false,
      isTotal: false,
      isNetIncome: false,
    } as T);
    for (const i of band) {
      if (i !== anchor) drop.add(i);
    }
  }

  if (!replace.size) return items;
  const out: T[] = [];
  for (let i = 0; i < items.length; i++) {
    if (drop.has(i)) continue;
    out.push(replace.get(i) ?? items[i]!);
  }
  return out;
}

/**
 * Keep only Total for Accounts Receivable amounts, shown as one "Accounts Receivable" line.
 * Drops empty AR shells and (A/R) detail duplicates. Leaves LeezaSpace receivable alone.
 */
export function clubAccountsReceivableRows<T extends FinItemLike>(items: T[]): T[] {
  if (!items.length) return items;

  const idxs: number[] = [];
  for (let i = 0; i < items.length; i++) {
    if (isAccountsReceivableBandLabel(items[i]!.label)) idxs.push(i);
  }
  if (!idxs.length) return items;

  const totalIdxs = idxs.filter(i => isTotalForAccountsReceivableLabel(items[i]!.label));
  const detailIdxs = idxs.filter(i => !isTotalForAccountsReceivableLabel(items[i]!.label));
  const anchor = detailIdxs[0] ?? totalIdxs[0] ?? idxs[0]!;
  const base = items[anchor]!;

  const values: Record<number, number> = {};
  const monthlyValues: Record<string, number> = {};
  // Always prefer Total for Accounts Receivable when present.
  const sourceIdxs = totalIdxs.length ? totalIdxs : detailIdxs;
  for (const i of sourceIdxs) addRowValues(values, monthlyValues, items[i]!);

  const drop = new Set(idxs.filter(i => i !== anchor));
  const out: T[] = [];
  for (let i = 0; i < items.length; i++) {
    if (drop.has(i)) continue;
    if (i === anchor) {
      out.push({
        ...base,
        label: ACCOUNTS_RECEIVABLE_CLUB_LABEL,
        values,
        monthlyValues: Object.keys(monthlyValues).length ? monthlyValues : undefined,
        isSectionHeader: false,
        isTotal: false,
        isNetIncome: false,
      } as T);
      continue;
    }
    out.push(items[i]!);
  }
  return out;
}

function isTotalForAccountsPayableLabel(label: string): boolean {
  const n = normLabel(stripApArAbbreviations(label));
  return /^total\s+(for\s+)?accounts?\s+payables?\b/i.test(n);
}

function isAccountsPayableBandLabel(label: string): boolean {
  if (isTotalForAccountsPayableLabel(label)) return true;
  const n = normLabel(stripApArAbbreviations(label));
  if (/^total\s+(for\s+)?/.test(n)) return false;
  // Header, "Accounts Payable (A/P)", "Accounts Payable to TSC - Rent", Paychex Invoice payable, etc.
  return /^accounts?\s+payables?\b/i.test(n)
    || /^paychex\s+invoice\s+payables?\b/i.test(n)
    || /\binvoice\s+payables?\b/i.test(n);
}

/**
 * Keep only Total for Accounts Payable amounts, shown as one "Accounts Payable" line.
 * Clubs the full headerâ†’Total band (all vendor AP lines in between) so amounts aren't lost.
 */
export function clubAccountsPayableRows<T extends FinItemLike>(items: T[]): T[] {
  if (!items.length) return items;

  const isHeader = (label: string) => {
    const n = normLabel(stripApArAbbreviations(label));
    return /^accounts?\s+payables?$/i.test(n);
  };

  // Prefer contiguous Accounts Payable â†’ Total for Accounts Payable bands.
  const drop = new Set<number>();
  const replace = new Map<number, T>();

  for (let tIdx = 0; tIdx < items.length; tIdx++) {
    if (!isTotalForAccountsPayableLabel(items[tIdx]!.label)) continue;
    let hIdx = -1;
    for (let j = tIdx; j >= 0; j--) {
      if (isHeader(items[j]!.label) || isAccountsPayableBandLabel(items[j]!.label)) {
        // Walk further for the bare section header when present.
        if (isHeader(items[j]!.label)) {
          hIdx = j;
          break;
        }
        if (hIdx < 0) hIdx = j;
      }
      // Stop if we hit another major BS section.
      if (j < tIdx && isStructuralSubHeaderLabel(items[j]!.label) && !isHeader(items[j]!.label)) break;
    }
    const start = hIdx >= 0 ? hIdx : tIdx;
    const band: number[] = [];
    for (let i = start; i <= tIdx; i++) band.push(i);

    const totalRow = items[tIdx]!;
    const anchor = band.find(i => isHeader(items[i]!.label)) ?? tIdx;
    const values: Record<number, number> = {};
    const monthlyValues: Record<string, number> = {};
    addRowValues(values, monthlyValues, totalRow);

    replace.set(anchor, {
      ...items[anchor]!,
      label: ACCOUNTS_PAYABLE_CLUB_LABEL,
      values,
      monthlyValues: Object.keys(monthlyValues).length ? monthlyValues : undefined,
      isSectionHeader: false,
      isTotal: false,
      isNetIncome: false,
    } as T);
    for (const i of band) {
      if (i !== anchor) drop.add(i);
    }
  }

  if (!replace.size) {
    // Fallback: no Total row â€” sum matching AP labels.
    const idxs: number[] = [];
    for (let i = 0; i < items.length; i++) {
      if (isAccountsPayableBandLabel(items[i]!.label)) idxs.push(i);
    }
    if (!idxs.length) return items;
    const anchor = idxs[0]!;
    const values: Record<number, number> = {};
    const monthlyValues: Record<string, number> = {};
    for (const i of idxs) addRowValues(values, monthlyValues, items[i]!);
    replace.set(anchor, {
      ...items[anchor]!,
      label: ACCOUNTS_PAYABLE_CLUB_LABEL,
      values,
      monthlyValues: Object.keys(monthlyValues).length ? monthlyValues : undefined,
      isSectionHeader: false,
      isTotal: false,
      isNetIncome: false,
    } as T);
    for (const i of idxs) {
      if (i !== anchor) drop.add(i);
    }
  }

  const out: T[] = [];
  for (let i = 0; i < items.length; i++) {
    if (drop.has(i)) continue;
    out.push(replace.get(i) ?? items[i]!);
  }
  return out;
}

function isTotalForCreditCardsLabel(label: string): boolean {
  return /^total\s+(for\s+)?credit\s+cards?\b/i.test(normLabel(label));
}

function isCreditCardsHeaderLabel(label: string): boolean {
  return /^credit\s+cards?$/i.test(normLabel(label));
}

function isCreditCardDetailLabel(label: string): boolean {
  const n = normLabel(label);
  if (isTotalForCreditCardsLabel(label) || isCreditCardsHeaderLabel(label)) return false;
  if (/^total\s+(for\s+)?/.test(n)) return false;
  if (isStructuralSubHeaderLabel(label) || isBareSectionHeaderLabel(label)) return false;
  // Amex / BOFA CC / Visa / Mastercard account lines under Credit Cards
  return /\b(amex|american\s+express|bofa\s+cc|credit\s+card|\bcc\b|visa|mastercard|discover)\b/i.test(n)
    || /\bcc\s+\d{3,}/i.test(n);
}

/**
 * Credit Cards header + card lines + Total for Credit Cards â†’ one "Credit Cards" line
 * (prefer Total for amounts; drop the subtotal label).
 */
export function clubCreditCardsRows<T extends FinItemLike>(items: T[]): T[] {
  if (!items.length) return items;

  const drop = new Set<number>();
  const replace = new Map<number, T>();

  for (let tIdx = 0; tIdx < items.length; tIdx++) {
    if (!isTotalForCreditCardsLabel(items[tIdx]!.label)) continue;
    let hIdx = -1;
    for (let j = tIdx; j >= 0; j--) {
      if (isCreditCardsHeaderLabel(items[j]!.label)) {
        hIdx = j;
        break;
      }
      if (j < tIdx && isStructuralSubHeaderLabel(items[j]!.label) && !isCreditCardsHeaderLabel(items[j]!.label)) break;
    }
    const start = hIdx >= 0 ? hIdx : tIdx;
    const band: number[] = [];
    for (let i = start; i <= tIdx; i++) band.push(i);

    const totalRow = items[tIdx]!;
    const anchor = band.find(i => isCreditCardsHeaderLabel(items[i]!.label)) ?? band[0]!;
    const values: Record<number, number> = {};
    const monthlyValues: Record<string, number> = {};
    addRowValues(values, monthlyValues, totalRow);

    replace.set(anchor, {
      ...items[anchor]!,
      label: CREDIT_CARDS_CLUB_LABEL,
      values,
      monthlyValues: Object.keys(monthlyValues).length ? monthlyValues : undefined,
      isSectionHeader: false,
      isTotal: false,
      isNetIncome: false,
    } as T);
    for (const i of band) {
      if (i !== anchor) drop.add(i);
    }
  }

  if (!replace.size) {
    const idxs: number[] = [];
    for (let i = 0; i < items.length; i++) {
      const lab = items[i]!.label;
      if (isCreditCardsHeaderLabel(lab) || isTotalForCreditCardsLabel(lab) || isCreditCardDetailLabel(lab)) {
        idxs.push(i);
      }
    }
    if (!idxs.length) return items;
    const totalIdxs = idxs.filter(i => isTotalForCreditCardsLabel(items[i]!.label));
    const detailIdxs = idxs.filter(i => !isTotalForCreditCardsLabel(items[i]!.label));
    const anchor = detailIdxs.find(i => isCreditCardsHeaderLabel(items[i]!.label)) ?? detailIdxs[0] ?? idxs[0]!;
    const values: Record<number, number> = {};
    const monthlyValues: Record<string, number> = {};
    const sourceIdxs = totalIdxs.length ? totalIdxs : detailIdxs;
    for (const i of sourceIdxs) addRowValues(values, monthlyValues, items[i]!);
    replace.set(anchor, {
      ...items[anchor]!,
      label: CREDIT_CARDS_CLUB_LABEL,
      values,
      monthlyValues: Object.keys(monthlyValues).length ? monthlyValues : undefined,
      isSectionHeader: false,
      isTotal: false,
      isNetIncome: false,
    } as T);
    for (const i of idxs) {
      if (i !== anchor) drop.add(i);
    }
  }

  const out: T[] = [];
  for (let i = 0; i < items.length; i++) {
    if (drop.has(i)) continue;
    out.push(replace.get(i) ?? items[i]!);
  }
  return out;
}

function isTotalForInterestPayableLabel(label: string): boolean {
  return /^total\s+(for\s+)?int(?:erest)?\.?\s+payables?\b/i.test(normLabel(label));
}

function isInterestPayableBandLabel(label: string): boolean {
  const n = normLabel(label);
  if (isTotalForInterestPayableLabel(label)) return true;
  if (/^total\s+(for\s+)?/.test(n)) return false;
  // "Interest Payable", "Int Payable on Vara Holdings Loan", etc.
  return /^int(?:erest)?\.?\s+payables?\b/i.test(n);
}

/**
 * Interest Payable + Int Payable on â€¦ + Total for Interest Payable â†’
 * one "Interest Payable" line (prefer Total for amounts).
 */
export function clubInterestPayableRows<T extends FinItemLike>(items: T[]): T[] {
  if (!items.length) return items;

  const idxs: number[] = [];
  for (let i = 0; i < items.length; i++) {
    if (isInterestPayableBandLabel(items[i]!.label)) idxs.push(i);
  }
  if (!idxs.length) return items;

  const totalIdxs = idxs.filter(i => isTotalForInterestPayableLabel(items[i]!.label));
  const detailIdxs = idxs.filter(i => !isTotalForInterestPayableLabel(items[i]!.label));
  const anchor = detailIdxs[0] ?? totalIdxs[0] ?? idxs[0]!;
  const base = items[anchor]!;

  const values: Record<number, number> = {};
  const monthlyValues: Record<string, number> = {};
  const sourceIdxs = totalIdxs.length ? totalIdxs : detailIdxs;
  for (const i of sourceIdxs) addRowValues(values, monthlyValues, items[i]!);

  const drop = new Set(idxs.filter(i => i !== anchor));
  const out: T[] = [];
  for (let i = 0; i < items.length; i++) {
    if (drop.has(i)) continue;
    if (i === anchor) {
      out.push({
        ...base,
        label: INTEREST_PAYABLE_CLUB_LABEL,
        values,
        monthlyValues: Object.keys(monthlyValues).length ? monthlyValues : undefined,
        isSectionHeader: false,
        isTotal: false,
        isNetIncome: false,
      } as T);
      continue;
    }
    out.push(items[i]!);
  }
  return out;
}

function isTotalForReimbursementLabel(label: string): boolean {
  return /^total\s+(for\s+)?reimbursements?\b/i.test(normLabel(label));
}

function isReimbursementBandLabel(label: string): boolean {
  const n = normLabel(label);
  if (isTotalForReimbursementLabel(label)) return true;
  if (/^total\s+(for\s+)?/.test(n)) return false;
  return /^reimbursements?$/i.test(n)
    || /^reimbursements?\s*[-:]/i.test(n)
    || /\breimbursements?\b/i.test(n);
}

/**
 * Reimbursement detail + Total for Reimbursements â†’ one "Reimbursement" line
 * (prefer Total for amounts so the subtotal is not shown twice).
 */
export function clubReimbursementRows<T extends FinItemLike>(items: T[]): T[] {
  if (!items.length) return items;

  const idxs: number[] = [];
  for (let i = 0; i < items.length; i++) {
    if (isReimbursementBandLabel(items[i]!.label)) idxs.push(i);
  }
  if (!idxs.length) return items;

  const totalIdxs = idxs.filter(i => isTotalForReimbursementLabel(items[i]!.label));
  const detailIdxs = idxs.filter(i => !isTotalForReimbursementLabel(items[i]!.label));
  const anchor = detailIdxs[0] ?? totalIdxs[0] ?? idxs[0]!;
  const base = items[anchor]!;

  const values: Record<number, number> = {};
  const monthlyValues: Record<string, number> = {};
  const sourceIdxs = totalIdxs.length ? totalIdxs : detailIdxs;
  for (const i of sourceIdxs) addRowValues(values, monthlyValues, items[i]!);

  const drop = new Set(idxs.filter(i => i !== anchor));
  const out: T[] = [];
  for (let i = 0; i < items.length; i++) {
    if (drop.has(i)) continue;
    if (i === anchor) {
      out.push({
        ...base,
        label: REIMBURSEMENT_CLUB_LABEL,
        values,
        monthlyValues: Object.keys(monthlyValues).length ? monthlyValues : undefined,
        isSectionHeader: false,
        isTotal: false,
        isNetIncome: false,
      } as T);
      continue;
    }
    out.push(items[i]!);
  }
  return out;
}

/** Equity "Partner investments" / "Owner's Investments" bands — never fold into asset Investments. */
function isPartnerOrOwnerInvestmentEquityLabel(label: string): boolean {
  const n = normLabel(label);
  return /^(?:partner\s+investments?|owner'?s?\s+investments?)\b/i.test(n)
    || /^total\s+(for\s+)?(?:partner\s+investments?|owner'?s?\s+investments?)\b/i.test(n);
}

function isTotalForInvestmentsLabel(label: string): boolean {
  const n = normLabel(label);
  if (isPartnerOrOwnerInvestmentEquityLabel(label)) return false;
  return /^total\s+(for\s+)?investments?\b/i.test(n)
    || /^total\s+(for\s+)?long[- ]?term\s+investments?\b/i.test(n);
}

function isBareInvestmentsLabel(label: string): boolean {
  const n = normLabel(label);
  if (isPartnerOrOwnerInvestmentEquityLabel(label)) return false;
  return /^investments?$/i.test(n);
}

/**
 * Asset investment lines — "Investments", "Investment in …", "Investment towards …".
 * Excludes equity Partner / Owner's Investments sections only (not entity names containing "Partners").
 */
function isInvestmentsBandLabel(label: string): boolean {
  const n = normLabel(label);
  if (!n || isPartnerOrOwnerInvestmentEquityLabel(label)) return false;
  if (isTotalForInvestmentsLabel(label)) return true;
  if (/^total\s+(for\s+)?/.test(n)) return false;
  if (isBareInvestmentsLabel(label)) return true;
  // "Long-term investments" parent rolls into the same Investments board line.
  if (/^long[- ]?term\s+investments?$/i.test(n)) return true;
  // "Investment in VR Estates", "Investment towards Ravi …", "Investments:…", "Investments - Other"
  if (/^investments?\s*(?:[-–—:]\s*)?(?:in|towards?|to)\b/i.test(n)) return true;
  if (/^investments?\s*:\s*/i.test(n)) return true;
  if (/\binvestments?\s*(?:[-–—:]\s*)?(?:in|towards?|to)\b/i.test(n)) return true;
  return false;
}

/**
 * "Investment in VR Estates" / Investments detail + Total for Investments
 * â†’ one "Investments" line (prefer Total for when present).
 */
export function clubInvestmentsRows<T extends FinItemLike>(items: T[]): T[] {
  if (!items.length) return items;

  const idxs: number[] = [];
  for (let i = 0; i < items.length; i++) {
    if (isInvestmentsBandLabel(items[i]!.label)) idxs.push(i);
  }
  if (!idxs.length) return items;

  const totalIdxs = idxs.filter(i => isTotalForInvestmentsLabel(items[i]!.label));
  const detailIdxs = idxs.filter(i => !isTotalForInvestmentsLabel(items[i]!.label));
  const bareIdxs = detailIdxs.filter(i => isBareInvestmentsLabel(items[i]!.label));
  const otherIdxs = detailIdxs.filter(i => !isBareInvestmentsLabel(items[i]!.label));
  const anchor = bareIdxs[0] ?? detailIdxs[0] ?? totalIdxs[0] ?? idxs[0]!;
  const base = items[anchor]!;

  const values: Record<number, number> = {};
  const monthlyValues: Record<string, number> = {};

  if (totalIdxs.length) {
    for (const i of totalIdxs) addRowValues(values, monthlyValues, items[i]!);
  } else if (bareIdxs.length) {
    for (const i of bareIdxs) addRowValues(values, monthlyValues, items[i]!);
    const otherYears: Record<number, number> = {};
    const otherMonths: Record<string, number> = {};
    for (const i of otherIdxs) addRowValues(otherYears, otherMonths, items[i]!);
    for (const [yk, v] of Object.entries(otherYears)) {
      const y = Number(yk);
      if (!Number.isFinite(y)) continue;
      if ((values[y] ?? 0) === 0 && v !== 0) values[y] = v;
    }
    for (const [k, v] of Object.entries(otherMonths)) {
      if ((monthlyValues[k] ?? 0) === 0 && v !== 0) monthlyValues[k] = v;
    }
  } else {
    for (const i of otherIdxs) addRowValues(values, monthlyValues, items[i]!);
  }

  const drop = new Set(idxs.filter(i => i !== anchor));
  const out: T[] = [];
  for (let i = 0; i < items.length; i++) {
    if (drop.has(i)) continue;
    if (i === anchor) {
      out.push({
        ...base,
        label: INVESTMENTS_CLUB_LABEL,
        values,
        monthlyValues: Object.keys(monthlyValues).length ? monthlyValues : undefined,
        isSectionHeader: false,
        isTotal: false,
        isNetIncome: false,
      } as T);
      continue;
    }
    out.push(items[i]!);
  }
  return out;
}

function isTotalForShareholderDistributionLabel(label: string): boolean {
  const n = normLabel(label);
  return /^total\s+(for\s+)?(?:\d{3,}\s+)?shareholders?\s+distributions?\b/i.test(n);
}

function isShareholderDistributionBandLabel(label: string): boolean {
  const n = normLabel(label);
  if (!n) return false;
  if (isTotalForShareholderDistributionLabel(label)) return true;
  if (/^total\s+(for\s+)?/.test(n)) return false;
  // "Shareholder Distribution", "31400 Shareholder Distribution"
  return /^(?:\d{3,}\s+)?shareholders?\s+distributions?\b/i.test(n);
}

/**
 * "31400 Shareholder Distribution" / variants + Total â†’ one "Shareholder Distribution" line.
 */
export function clubShareholderDistributionRows<T extends FinItemLike>(items: T[]): T[] {
  if (!items.length) return items;

  const idxs: number[] = [];
  for (let i = 0; i < items.length; i++) {
    if (isShareholderDistributionBandLabel(items[i]!.label)) idxs.push(i);
  }
  if (!idxs.length) return items;

  const totalIdxs = idxs.filter(i => isTotalForShareholderDistributionLabel(items[i]!.label));
  const detailIdxs = idxs.filter(i => !isTotalForShareholderDistributionLabel(items[i]!.label));

  // Orphan Total only â€” drop (isDropped also catches it).
  if (!detailIdxs.length && totalIdxs.length) {
    const dropOnly = new Set(totalIdxs);
    return items.filter((_, i) => !dropOnly.has(i));
  }

  const anchor = detailIdxs[0] ?? idxs[0]!;
  const base = items[anchor]!;
  const values: Record<number, number> = {};
  const monthlyValues: Record<string, number> = {};
  const sourceIdxs = totalIdxs.length ? totalIdxs : detailIdxs;
  for (const i of sourceIdxs) addRowValues(values, monthlyValues, items[i]!);

  const drop = new Set(idxs.filter(i => i !== anchor));
  const out: T[] = [];
  for (let i = 0; i < items.length; i++) {
    if (drop.has(i)) continue;
    if (i === anchor) {
      out.push({
        ...base,
        label: SHAREHOLDER_DISTRIBUTION_CLUB_LABEL,
        values,
        monthlyValues: Object.keys(monthlyValues).length ? monthlyValues : undefined,
        isSectionHeader: false,
        isTotal: false,
        isNetIncome: false,
      } as T);
      continue;
    }
    out.push(items[i]!);
  }
  return out;
}

function isTotalForLoansAndAdvancesLabel(label: string): boolean {
  const n = normLabel(label);
  // Liability club "Loans and Advances from Others" is not the asset-side Loans & Advances total.
  if (/\bfrom\s+others?\b/i.test(n)) return false;
  return /^total\s+(for\s+)?loans?\s*(&|and)?\s*advances?\b/i.test(n);
}

function isLoansAndAdvancesBandLabel(label: string): boolean {
  const n = normLabel(label);
  if (!n) return false;
  if (isTotalForLoansAndAdvancesLabel(label)) return true;
  if (/^total\s+(for\s+)?/.test(n)) return false;
  // Asset-side "Loans & Advances" only — never the liability "… from Others" club.
  if (/\bfrom\s+others?\b/i.test(n)) return false;
  // Bare + QuickBooks "Loans & Advances:Loan to …" paths
  return /^loans?\s*(&|and)?\s*advances?\b/i.test(n)
    || /^loans?\s*(&|and)?\s*advances?\s*:/i.test(n);
}

/**
 * "Loans & Advances:Loan to â€¦" detail (+ Total for) â†’ one "Loans & Advances" line.
 * Prefers Total for Loans and Advances amounts when present.
 */
export function clubLoansAndAdvancesRows<T extends FinItemLike>(items: T[]): T[] {
  if (!items.length) return items;

  const idxs: number[] = [];
  for (let i = 0; i < items.length; i++) {
    if (isLoansAndAdvancesBandLabel(items[i]!.label)) idxs.push(i);
  }
  if (!idxs.length) return items;

  const totalIdxs = idxs.filter(i => isTotalForLoansAndAdvancesLabel(items[i]!.label));
  const detailIdxs = idxs.filter(i => !isTotalForLoansAndAdvancesLabel(items[i]!.label));
  const bareIdxs = detailIdxs.filter(i => /^loans?\s*(&|and)?\s*advances?$/i.test(normLabel(items[i]!.label)));
  const otherIdxs = detailIdxs.filter(i => !/^loans?\s*(&|and)?\s*advances?$/i.test(normLabel(items[i]!.label)));
  const anchor = bareIdxs[0] ?? detailIdxs[0] ?? totalIdxs[0] ?? idxs[0]!;
  const base = items[anchor]!;

  const values: Record<number, number> = {};
  const monthlyValues: Record<string, number> = {};

  if (totalIdxs.length) {
    for (const i of totalIdxs) addRowValues(values, monthlyValues, items[i]!);
  } else if (bareIdxs.length) {
    for (const i of bareIdxs) addRowValues(values, monthlyValues, items[i]!);
    const otherYears: Record<number, number> = {};
    const otherMonths: Record<string, number> = {};
    for (const i of otherIdxs) addRowValues(otherYears, otherMonths, items[i]!);
    for (const [yk, v] of Object.entries(otherYears)) {
      const y = Number(yk);
      if (!Number.isFinite(y)) continue;
      if ((values[y] ?? 0) === 0 && v !== 0) values[y] = v;
    }
    for (const [k, v] of Object.entries(otherMonths)) {
      if ((monthlyValues[k] ?? 0) === 0 && v !== 0) monthlyValues[k] = v;
    }
  } else {
    for (const i of otherIdxs) addRowValues(values, monthlyValues, items[i]!);
  }

  const drop = new Set(idxs.filter(i => i !== anchor));
  const out: T[] = [];
  for (let i = 0; i < items.length; i++) {
    if (drop.has(i)) continue;
    if (i === anchor) {
      out.push({
        ...base,
        label: LOANS_AND_ADVANCES_CLUB_LABEL,
        values,
        monthlyValues: Object.keys(monthlyValues).length ? monthlyValues : undefined,
        isSectionHeader: false,
        isTotal: false,
        isNetIncome: false,
      } as T);
      continue;
    }
    out.push(items[i]!);
  }
  return out;
}

function isTotalForPayrollWagesAndTaxLabel(label: string): boolean {
  const n = normLabel(label);
  return /^total\s+(for\s+)?payroll\s+wages?\s*(and|&)?\s*tax(es)?(\s+to\s+pay)?\b/i.test(n);
}

function isPayrollWagesAndTaxBandLabel(label: string): boolean {
  const n = normLabel(label);
  if (!n) return false;
  if (isTotalForPayrollWagesAndTaxLabel(label)) return true;
  if (/^total\s+(for\s+)?/.test(n)) return false;
  // "Payroll wages and tax to pay:Salaries Payable", "Payroll Tax Payable", etc.
  return /^payroll\s+wages?\s*(and|&)?\s*tax(es)?(\s+to\s+pay)?\b/i.test(n)
    || /^payroll\s+tax\s+(liabilit(?:y|ies)|payables?)\b/i.test(n);
}

/**
 * Payroll wages and tax to pay:* detail â†’ one "Payroll wages and tax" line.
 */
export function clubPayrollWagesAndTaxRows<T extends FinItemLike>(items: T[]): T[] {
  if (!items.length) return items;

  const idxs: number[] = [];
  for (let i = 0; i < items.length; i++) {
    if (isPayrollWagesAndTaxBandLabel(items[i]!.label)) idxs.push(i);
  }
  if (!idxs.length) return items;

  const totalIdxs = idxs.filter(i => isTotalForPayrollWagesAndTaxLabel(items[i]!.label));
  const detailIdxs = idxs.filter(i => !isTotalForPayrollWagesAndTaxLabel(items[i]!.label));
  const bareIdxs = detailIdxs.filter(i =>
    /^payroll\s+wages?\s*(and|&)?\s*tax(es)?$/i.test(normLabel(items[i]!.label)));
  const otherIdxs = detailIdxs.filter(i =>
    !/^payroll\s+wages?\s*(and|&)?\s*tax(es)?$/i.test(normLabel(items[i]!.label)));
  const anchor = bareIdxs[0] ?? detailIdxs[0] ?? totalIdxs[0] ?? idxs[0]!;
  const base = items[anchor]!;

  const values: Record<number, number> = {};
  const monthlyValues: Record<string, number> = {};

  if (totalIdxs.length) {
    for (const i of totalIdxs) addRowValues(values, monthlyValues, items[i]!);
  } else {
    for (const i of [...bareIdxs, ...otherIdxs]) addRowValues(values, monthlyValues, items[i]!);
  }

  const drop = new Set(idxs.filter(i => i !== anchor));
  const out: T[] = [];
  for (let i = 0; i < items.length; i++) {
    if (drop.has(i)) continue;
    if (i === anchor) {
      out.push({
        ...base,
        label: PAYROLL_WAGES_AND_TAX_CLUB_LABEL,
        values,
        monthlyValues: Object.keys(monthlyValues).length ? monthlyValues : undefined,
        isSectionHeader: false,
        isTotal: false,
        isNetIncome: false,
      } as T);
      continue;
    }
    out.push(items[i]!);
  }
  return out;
}

/** Merge LeezaSpace receivable variants into one "Receivable from LeezaSpace" line. */
export function clubLeezaSpaceReceivableRows<T extends FinItemLike>(items: T[]): T[] {
  if (!items.length) return items;
  const idxs: number[] = [];
  for (let i = 0; i < items.length; i++) {
    if (isLeezaSpaceReceivableLabel(items[i]!.label)) idxs.push(i);
  }
  if (!idxs.length) return items;

  const anchor = idxs[0]!;
  const base = items[anchor]!;
  const values: Record<number, number> = {};
  const monthlyValues: Record<string, number> = {};
  for (const i of idxs) addRowValues(values, monthlyValues, items[i]!);

  const drop = new Set(idxs.filter(i => i !== anchor));
  const out: T[] = [];
  for (let i = 0; i < items.length; i++) {
    if (drop.has(i)) continue;
    if (i === anchor) {
      out.push({
        ...base,
        label: LEEZA_RECEIVABLE_CLUB_LABEL,
        values,
        monthlyValues: Object.keys(monthlyValues).length ? monthlyValues : undefined,
        isSectionHeader: false,
        isTotal: false,
        isNetIncome: false,
      } as T);
      continue;
    }
    out.push(items[i]!);
  }
  return out;
}

/**
 * "Receivable from Texas Green Realty" / other related-party receivable lines
 * → one "Receivable" row (Accounts Receivable and LeezaSpace stay separate).
 */
export function clubRelatedPartyReceivableRows<T extends FinItemLike>(items: T[]): T[] {
  if (!items.length) return items;
  const idxs: number[] = [];
  for (let i = 0; i < items.length; i++) {
    if (isRelatedPartyReceivableLabel(items[i]!.label)) idxs.push(i);
  }
  if (!idxs.length) return items;

  const anchor = idxs[0]!;
  const base = items[anchor]!;
  const values: Record<number, number> = {};
  const monthlyValues: Record<string, number> = {};
  for (const i of idxs) addRowValues(values, monthlyValues, items[i]!);

  const drop = new Set(idxs.filter(i => i !== anchor));
  const out: T[] = [];
  for (let i = 0; i < items.length; i++) {
    if (drop.has(i)) continue;
    if (i === anchor) {
      out.push({
        ...base,
        label: RELATED_PARTY_RECEIVABLE_CLUB_LABEL,
        values,
        monthlyValues: Object.keys(monthlyValues).length ? monthlyValues : undefined,
        isSectionHeader: false,
        isTotal: false,
        isNetIncome: false,
      } as T);
      continue;
    }
    out.push(items[i]!);
  }
  return out;
}

/**
 * "Payable to Sandhya Konda" / other related-party payable lines → one "Payable" row.
 * Accounts Payable, Interest/Rent/Tax Payable, and Other Payables stay separate.
 */
export function clubRelatedPartyPayableRows<T extends FinItemLike>(items: T[]): T[] {
  if (!items.length) return items;
  const idxs: number[] = [];
  for (let i = 0; i < items.length; i++) {
    if (isRelatedPartyPayableLabel(items[i]!.label)) idxs.push(i);
  }
  if (!idxs.length) return items;

  const anchor = idxs[0]!;
  const base = items[anchor]!;
  const values: Record<number, number> = {};
  const monthlyValues: Record<string, number> = {};
  for (const i of idxs) addRowValues(values, monthlyValues, items[i]!);

  const drop = new Set(idxs.filter(i => i !== anchor));
  const out: T[] = [];
  for (let i = 0; i < items.length; i++) {
    if (drop.has(i)) continue;
    if (i === anchor) {
      out.push({
        ...base,
        label: RELATED_PARTY_PAYABLE_CLUB_LABEL,
        values,
        monthlyValues: Object.keys(monthlyValues).length ? monthlyValues : undefined,
        isSectionHeader: false,
        isTotal: false,
        isNetIncome: false,
      } as T);
      continue;
    }
    out.push(items[i]!);
  }
  return out;
}

/**
 * Collapse security-deposit header/detail/total into a single line.
 * Example:
 * - Security deposit
 * - Security Deposit - Rear Unit
 * - Security Deposit - Unit B & C
 * - Total for Security deposit
 * =>
 * - Security deposit (single summed row; Total for row dropped)
 */
export function clubSecurityDepositRows<T extends FinItemLike>(items: T[]): T[] {
  if (!items.length) return items;

  const idxs: number[] = [];
  for (let i = 0; i < items.length; i++) {
    const row = items[i]!;
    if (isSecurityDepositLabel(row.label) || isTotalForSecurityDepositLabel(row.label)) idxs.push(i);
  }
  if (!idxs.length) return items;

  const headerOrDetail = idxs.find(i => !isTotalForSecurityDepositLabel(items[i]!.label));
  const anchor = headerOrDetail ?? idxs[0]!;
  const base = items[anchor]!;

  const detailValues: Record<number, number> = {};
  const detailMonthly: Record<string, number> = {};
  const totalValues: Record<number, number> = {};
  const totalMonthly: Record<string, number> = {};

  const addYearVals = (into: Record<number, number>, row: T) => {
    for (const k of Object.keys(row.values ?? {})) {
      const y = Number(k);
      if (!Number.isFinite(y)) continue;
      into[y] = (into[y] ?? 0) + yearVal(row.values, y);
    }
  };
  const addMonthlyVals = (into: Record<string, number>, row: T) => {
    for (const [k, v] of Object.entries(row.monthlyValues ?? {})) {
      into[k] = (into[k] ?? 0) + (Number(v) || 0);
    }
  };

  for (const i of idxs) {
    const row = items[i]!;
    if (isTotalForSecurityDepositLabel(row.label)) {
      addYearVals(totalValues, row);
      addMonthlyVals(totalMonthly, row);
    } else {
      addYearVals(detailValues, row);
      addMonthlyVals(detailMonthly, row);
    }
  }

  const years = new Set<number>([
    ...Object.keys(detailValues).map(Number).filter(Number.isFinite),
    ...Object.keys(totalValues).map(Number).filter(Number.isFinite),
  ]);
  const values: Record<number, number> = {};
  for (const y of years) {
    const t = totalValues[y] ?? 0;
    const d = detailValues[y] ?? 0;
    values[y] = t !== 0 ? t : d;
  }

  const monthKeys = new Set<string>([
    ...Object.keys(detailMonthly),
    ...Object.keys(totalMonthly),
  ]);
  const monthlyValues: Record<string, number> = {};
  for (const k of monthKeys) {
    const t = totalMonthly[k] ?? 0;
    const d = detailMonthly[k] ?? 0;
    monthlyValues[k] = t !== 0 ? t : d;
  }

  const drop = new Set(idxs);
  const out: T[] = [];
  for (let i = 0; i < items.length; i++) {
    if (i !== anchor && drop.has(i)) continue;
    if (i === anchor) {
      out.push({
        ...base,
        label: 'Security deposit',
        values,
        monthlyValues: Object.keys(monthlyValues).length ? monthlyValues : undefined,
        isSectionHeader: false,
        isTotal: false,
        isNetIncome: false,
      } as T);
      continue;
    }
    out.push(items[i]!);
  }
  return out;
}

function isShortTermPartnerLoanLabel(label: string): boolean {
  const n = normLabel(label);
  // Bank / institutional term loans are not partner borrowings.
  if (isBankLenderName(n)) return false;
  // Short Term Loans & Liabilities band has its own club — do not fold into partners.
  if (/^short[- ]?term\s+loans?\s*(&|and)\s*liabilit/i.test(n)) return false;
  return /^short[- ]?term\s+loans?\s+from\s+partners?\b/i.test(n)
    || /^loan\s+from\s+shareholders?\b/i.test(n)
    || /^loan\s+from\s+[^:]+$/i.test(n);
}

function isTotalForShortTermPartnerLoanLabel(label: string): boolean {
  return /^total\s+(for\s+)?loan\s+from\s+shareholders?\b/i.test(normLabel(label))
    || /^total\s+(for\s+)?short[- ]?term\s+loans?\s+from\s+partners?\b/i.test(normLabel(label));
}

/** Collapse short-term partner/shareholder loan sections into one line. */
export function clubShortTermPartnerLoanRows<T extends FinItemLike>(items: T[]): T[] {
  if (!items.length) return items;
  const idxs: number[] = [];
  for (let i = 0; i < items.length; i++) {
    const row = items[i]!;
    if (isShortTermPartnerLoanLabel(row.label) || isTotalForShortTermPartnerLoanLabel(row.label)) idxs.push(i);
  }
  if (!idxs.length) return items;

  const anchor = idxs.find(i => !isTotalForShortTermPartnerLoanLabel(items[i]!.label)) ?? idxs[0]!;
  const base = items[anchor]!;
  const values: Record<number, number> = {};
  const monthlyValues: Record<string, number> = {};

  for (const i of idxs) {
    const row = items[i]!;
    for (const k of Object.keys(row.values ?? {})) {
      const y = Number(k);
      if (!Number.isFinite(y)) continue;
      values[y] = (values[y] ?? 0) + yearVal(row.values, y);
    }
    for (const [k, v] of Object.entries(row.monthlyValues ?? {})) {
      monthlyValues[k] = (monthlyValues[k] ?? 0) + (Number(v) || 0);
    }
  }

  const drop = new Set(idxs);
  const out: T[] = [];
  for (let i = 0; i < items.length; i++) {
    if (i !== anchor && drop.has(i)) continue;
    if (i === anchor) {
      out.push({
        ...base,
        label: 'Short-term loans from partners',
        values,
        monthlyValues: Object.keys(monthlyValues).length ? monthlyValues : undefined,
        isSectionHeader: false,
        isTotal: false,
        isNetIncome: false,
      } as T);
      continue;
    }
    out.push(items[i]!);
  }
  return out;
}

function toTitleWords(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map(w => (w.length ? `${w[0]!.toUpperCase()}${w.slice(1).toLowerCase()}` : w))
    .join(' ');
}

function addRowValues<T extends FinItemLike>(
  accYears: Record<number, number>,
  accMonths: Record<string, number>,
  row: T,
): void {
  for (const k of Object.keys(row.values ?? {})) {
    const y = Number(k);
    if (!Number.isFinite(y)) continue;
    accYears[y] = (accYears[y] ?? 0) + yearVal(row.values, y);
  }
  for (const [k, v] of Object.entries(row.monthlyValues ?? {})) {
    accMonths[k] = (accMonths[k] ?? 0) + (Number(v) || 0);
  }
}

/**
 * Board correction: move Services revenue for the given year onto Sales
 * (e.g. 2025 $3,589,113 booked under Services belongs in Sales).
 */
export function reclassServicesToSalesForYear<T extends FinItemLike>(items: T[], year: number): T[] {
  if (!items.length || !Number.isFinite(year)) return items;

  const isSales = (label: string) => /^sales$/i.test(normLabel(label));
  const isServices = (label: string) => /^services?$/i.test(normLabel(label));

  let salesIdx = -1;
  let servicesIdx = -1;
  for (let i = 0; i < items.length; i++) {
    const row = items[i]!;
    if (row.isTotal || row.isNetIncome) continue;
    if (salesIdx < 0 && isSales(row.label)) salesIdx = i;
    if (servicesIdx < 0 && isServices(row.label)) servicesIdx = i;
  }
  if (salesIdx < 0 || servicesIdx < 0) return items;

  const sales = items[salesIdx]!;
  const services = items[servicesIdx]!;
  const moveAmt = yearVal(services.values, year);
  const hasMonthly = Object.keys(services.monthlyValues ?? {}).some(k => k.startsWith(`${year}-`));
  if (moveAmt === 0 && !hasMonthly) return items;

  const salesValues = { ...(sales.values as Record<number, number>) };
  const svcValues = { ...(services.values as Record<number, number>) };
  salesValues[year] = yearVal(salesValues, year) + moveAmt;
  svcValues[year] = 0;

  const salesMonthly = { ...(sales.monthlyValues ?? {}) };
  const svcMonthly = { ...(services.monthlyValues ?? {}) };
  for (const [k, v] of Object.entries(svcMonthly)) {
    if (!k.startsWith(`${year}-`)) continue;
    salesMonthly[k] = (salesMonthly[k] ?? 0) + (Number(v) || 0);
    delete svcMonthly[k];
  }

  return items.map((row, i) => {
    if (i === salesIdx) {
      return {
        ...row,
        values: salesValues,
        monthlyValues: Object.keys(salesMonthly).length ? salesMonthly : undefined,
      } as T;
    }
    if (i === servicesIdx) {
      return {
        ...row,
        values: svcValues,
        monthlyValues: Object.keys(svcMonthly).length ? svcMonthly : undefined,
      } as T;
    }
    return row;
  });
}

/**
 * Hard rewrite Fixed Assets band to the exact board format:
 *   5-Year Property
 *   7-Year Property
 *   Gardenia Village Office Park
 *   Improvements   ← includes former "Improvements - Others"
 * Fixed Assets   ← was "Total for Fixed Assets" (amounts kept, normal weight; section header dropped)
 * (Total for Assets stays after this band)
 */
export function clubFixedAssetPropertyImprovementRows<T extends FinItemLike>(items: T[]): T[] {
  if (!items.length) return items;

  const isFixedAssetsHeader = (label: string) => /^fixed\s+assets?$/i.test(normLabel(label));
  const isTotalFixedAssets = (label: string) => /^total\s+(for\s+)?fixed\s+assets?$/i.test(normLabel(label));
  const isTotalAssets = (label: string) => /^total\s+(for\s+)?assets$/i.test(normLabel(label));
  const isLiabEquityCloser = (label: string) =>
    /^(liabilit(?:y|ies)|liabilities\s+and\s+equity|equity|current\s+liabilit)/i.test(normLabel(label));

  const start = items.findIndex(i => isFixedAssetsHeader(i.label) || isTotalFixedAssets(i.label)
    || /^total\s+for\s+\d+\s*[- ]?year\s+property/i.test(i.label)
    || /^\d+\s*[- ]?year\s+property$/i.test(normLabel(i.label)));
  if (start < 0) return items;

  let end = start;
  for (let i = start; i < items.length; i++) {
    const lab = items[i]!.label;
    if (i > start && (isTotalAssets(lab) || isLiabEquityCloser(lab))) {
      end = i - 1;
      break;
    }
    end = i;
    if (isTotalFixedAssets(lab)) break;
  }

  const band = items.slice(start, end + 1);
  const after = items.slice(end + 1);
  const before = items.slice(0, start);

  type Acc = { values: Record<number, number>; monthly: Record<string, number>; anchor: T };
  const buckets = new Map<string, Acc>();
  let totalFixed: T | null = null;
  let fixedHeader: T | null = null;

  const take = (key: string, row: T) => {
    const ex = buckets.get(key);
    if (!ex) {
      const values: Record<number, number> = {};
      const monthly: Record<string, number> = {};
      addRowValues(values, monthly, row);
      buckets.set(key, { values, monthly, anchor: row });
      return;
    }
    addRowValues(ex.values, ex.monthly, row);
  };

  for (const raw of band) {
    // Match on the original label so year buckets ("- 2018") are not stripped away.
    const label = raw.label.trim();
    const n = normLabel(label);

    if (isFixedAssetsHeader(label)) {
      fixedHeader = raw;
      continue;
    }
    if (isTotalFixedAssets(label)) {
      totalFixed = raw;
      continue;
    }

    // Accu Dep / Accumulated Depreciation â€” net known asset targets; otherwise club
    // furniture/vehicle/etc. Acc Dep into one "Accumulated Depreciation" line.
    const isAccuDep = /^(?:accu(?:mulated)?\.?\s*dep(?:reciation)?|accum\.?\s*dep(?:reciation)?|accumulated\s+depreciation)\b/i.test(n);
    if (isAccuDep) {
      const target =
        /^(?:accu(?:mulated)?\.?\s*dep(?:reciation)?|accum\.?\s*dep(?:reciation)?|accumulated\s+depreciation)\s*[-â€“â€”:]\s*(.+)$/i.exec(label)?.[1]?.trim()
        ?? null;
      if (target && /office\s+park/i.test(target)) {
        take(toTitleWords(target), raw);
      } else if (target) {
        const yp = /^(\d+)\s*[- ]?year\s+property/i.exec(target);
        if (yp) take(`${yp[1]}-Year Property`, raw);
        else if (/^improvements?\s*[-â€“â€”]\s*others?/i.test(target)) take('Improvements', raw);
        else if (/^improvements?/i.test(target) && !/^acc\s*dep\b/i.test(target)) take('Improvements', raw);
        else take(ACCUMULATED_DEPRECIATION_CLUB_LABEL, raw);
      } else {
        take(ACCUMULATED_DEPRECIATION_CLUB_LABEL, raw);
      }
      continue;
    }

    // Prefer total rows for amounts; ignore empty section headers.
    const yearProp = /^(?:total\s+for\s+)?(\d+)\s*[- ]?year\s+property(?:\s+total)?$/i.exec(label);
    if (yearProp) {
      if (/^total\s+for\s+/i.test(label) || !raw.isSectionHeader) {
        take(`${yearProp[1]}-Year Property`, raw);
      }
      continue;
    }

    const office = /^(?:total\s+for\s+)?(.+\boffice\s+park)$/i.exec(label);
    if (office) {
      if (/^total\s+for\s+/i.test(label) || !raw.isSectionHeader) {
        take(toTitleWords(office[1]!), raw);
      }
      continue;
    }

    if (/^(?:total\s+for\s+)?improvements?\s*[-â€“â€”]\s*others?$/i.test(n)) {
      if (/^total\s+for\s+/i.test(label) || !raw.isSectionHeader) take('Improvements', raw);
      continue;
    }
    if (/^(?:total\s+for\s+)?improvements?\s*[-â€“â€”]\s*(?:19|20)\d{2}$/i.test(n)) {
      if (/^total\s+for\s+/i.test(label) || !raw.isSectionHeader) take('Improvements', raw);
      continue;
    }
    if (/^total\s+for\s+improvements?$/i.test(n)) {
      // Use grand total only when year-bucket totals are absent.
      if (!buckets.has('Improvements')) take('Improvements', raw);
      continue;
    }
    if (/^improvements?$/i.test(n)) {
      // Empty Improvements header only.
      continue;
    }
  }

  const orderedLabels = [
    '5-Year Property',
    '7-Year Property',
    'Gardenia Village Office Park',
    'Improvements',
  ];

  // Also emit any other office-park / N-Year Property keys not in the preferred list.
  for (const key of buckets.keys()) {
    if (!orderedLabels.includes(key)) orderedLabels.push(key);
  }

  const reshaped: T[] = [];
  // Do not emit the "FIXED ASSETS" section header â€” the rolled-up total becomes "Fixed Assets".

  for (const lab of orderedLabels) {
    const b = buckets.get(lab);
    if (!b) continue;
    const hasAmt = Object.values(b.values).some(v => v !== 0)
      || Object.values(b.monthly).some(v => v !== 0);
    if (!hasAmt) continue;
    reshaped.push({
      ...b.anchor,
      label: lab,
      values: b.values,
      monthlyValues: Object.keys(b.monthly).length ? b.monthly : undefined,
      isSectionHeader: false,
      isTotal: false,
      isNetIncome: false,
    } as T);
  }

  if (totalFixed) {
    reshaped.push({
      ...totalFixed,
      label: 'Fixed Assets',
      isSectionHeader: false,
      isTotal: false,
      isNetIncome: false,
    } as T);
  } else if (fixedHeader) {
    // No Total row â€” keep a single non-bold Fixed Assets line from the old header if it has amounts.
    const values: Record<number, number> = { ...(fixedHeader.values as Record<number, number>) };
    const monthlyValues = fixedHeader.monthlyValues ? { ...fixedHeader.monthlyValues } : undefined;
    reshaped.push({
      ...fixedHeader,
      label: 'Fixed Assets',
      values,
      monthlyValues,
      isSectionHeader: false,
      isTotal: false,
      isNetIncome: false,
    } as T);
  }

  return [...before, ...reshaped, ...after];
}

function isFixedAssetDisplayNoise(label: string): boolean {
  const n = normLabel(label);
  // Drop only pre-reshape leftovers (year-split totals / empty year headers).
  // Keep final board lines: 5-Year Property, Improvements, etc.
  if (/^(?:\d+-year\s+property|gardenia\s+village\s+office\s+park|improvements|fixed\s+assets|accumulated\s+depreciation)$/i.test(n)) {
    return false;
  }
  // Detail Accu Dep lines are clubbed into Accumulated Depreciation â€” drop leftovers.
  if (/^(?:accu(?:mulated)?\.?\s*[-–—]?\s*dep|accum\.?\s*[-–—]?\s*dep|accumulated\s+depreciation)\b/i.test(n)
    || /:\s*(?:accu(?:mulated)?\.?\s*[-–—]?\s*dep|accum\.?\s*[-–—]?\s*dep|accumulated\s+depreciation)/i.test(n)) {
    return !/^accumulated\s+depreciation$/i.test(n);
  }
  // Year-bucket Fixed Assets detail ("2013 Fixed Assets:Furnitureâ€¦") clubbed into Fixed Assets.
  if (/^\d{4}\s+fixed\s+assets?\b/i.test(n)) return true;
  if (/^fixed\s+assets?\s*:/i.test(n)) return true;
  return /^total\s+for\s+\d+\s*[- ]?year\s+property$/i.test(n)
    || /^total\s+for\s+gardenia\s+village\s+office\s+park$/i.test(n)
    || /^improvements?\s*[-â€“â€”]\s*(?:19|20)\d{2}$/i.test(n)
    || /^total\s+for\s+improvements?\s*[-â€“â€”]\s*(?:19|20)\d{2}$/i.test(n)
    || /^total\s+for\s+improvements?$/i.test(n)
    || /^total\s+(for\s+)?fixed\s+assets?$/i.test(n);
}


function isTotalForFixedAssetsLabel(label: string): boolean {
  return /^total\s+(for\s+)?fixed\s+assets?\b/i.test(normLabel(label));
}

function isFixedAssetsDetailBandLabel(label: string): boolean {
  const n = normLabel(label);
  if (!n) return false;
  if (isTotalForFixedAssetsLabel(label)) return true;
  if (/^total\s+(for\s+)?/.test(n)) return false;
  // "Fixed Assets", "Fixed Assets:Furniture", "2013 Fixed Assets:Furniture -2013_1"
  return /^fixed\s+assets?\b/i.test(n) || /^\d{4}\s+fixed\s+assets?\b/i.test(n);
}

/**
 * Club every Fixed Assets / "YYYY Fixed Assets:…" detail line into one "Fixed Assets" row.
 * Keeps Land / Improvements / Accu Dep as their own clubs.
 */
export function clubFixedAssetsDetailRows<T extends FinItemLike>(items: T[]): T[] {
  if (!items.length) return items;

  const idxs: number[] = [];
  for (let i = 0; i < items.length; i++) {
    if (isFixedAssetsDetailBandLabel(items[i]!.label)) idxs.push(i);
  }
  if (!idxs.length) return items;

  const totalIdxs = idxs.filter(i => isTotalForFixedAssetsLabel(items[i]!.label));
  const detailIdxs = idxs.filter(i => !isTotalForFixedAssetsLabel(items[i]!.label));
  const bareIdxs = detailIdxs.filter(i => /^fixed\s+assets?$/i.test(normLabel(items[i]!.label)));
  const otherIdxs = detailIdxs.filter(i => !/^fixed\s+assets?$/i.test(normLabel(items[i]!.label)));
  const anchor = bareIdxs[0] ?? detailIdxs[0] ?? totalIdxs[0] ?? idxs[0]!;
  const base = items[anchor]!;

  const values: Record<number, number> = {};
  const monthlyValues: Record<string, number> = {};

  if (totalIdxs.length) {
    for (const i of totalIdxs) addRowValues(values, monthlyValues, items[i]!);
  } else {
    for (const i of [...bareIdxs, ...otherIdxs]) addRowValues(values, monthlyValues, items[i]!);
  }

  const drop = new Set(idxs.filter(i => i !== anchor));
  const out: T[] = [];
  for (let i = 0; i < items.length; i++) {
    if (drop.has(i)) continue;
    if (i === anchor) {
      out.push({
        ...base,
        label: FIXED_ASSETS_CLUB_LABEL,
        values,
        monthlyValues: Object.keys(monthlyValues).length ? monthlyValues : undefined,
        isSectionHeader: false,
        isTotal: false,
        isNetIncome: false,
      } as T);
      continue;
    }
    out.push(items[i]!);
  }
  return out;
}
function isTotalForAccumulatedDepreciationLabel(label: string): boolean {
  const n = normLabel(label);
  return /^total\s+(for\s+)?(?:accu(?:mulated)?\.?\s*[-–—]?\s*dep(?:reciation|reciat)?|accum\.?\s*[-–—]?\s*dep(?:reciation|reciat)?|accumulated\s+depreciation)\b/i.test(n);
}

function isAccumulatedDepreciationBandLabel(label: string): boolean {
  const n = normLabel(label);
  if (!n) return false;
  if (isTotalForAccumulatedDepreciationLabel(label)) return true;
  if (/^total\s+(for\s+)?/.test(n)) return false;
  // Bare / prefix Accu Dep lines, including "Accu - Depreciation" and truncated "Accu-Depreciat".
  if (/^(?:accu(?:mulated)?\.?\s*[-–—]?\s*dep(?:reciation|reciat)?|accum\.?\s*[-–—]?\s*dep(?:reciation|reciat)?|accumulated\s+depreciation)\b/i.test(n)) {
    return true;
  }
  // Colon paths: "Closing Cost:Accu - Depreciation…" / "Land …:Accu-Depreciat"
  return /:\s*(?:accu(?:mulated)?\.?\s*[-–—]?\s*dep|accum\.?\s*[-–—]?\s*dep|accumulated\s+depreciation)/i.test(n);
}

/**
 * Club every Accu Dep / Accumulated Depreciation detail line into one
 * "Accumulated Depreciation" row (all rental companies).
 */
export function clubAccumulatedDepreciationRows<T extends FinItemLike>(items: T[]): T[] {
  if (!items.length) return items;

  const idxs: number[] = [];
  for (let i = 0; i < items.length; i++) {
    if (isAccumulatedDepreciationBandLabel(items[i]!.label)) idxs.push(i);
  }
  if (!idxs.length) return items;

  const totalIdxs = idxs.filter(i => isTotalForAccumulatedDepreciationLabel(items[i]!.label));
  const detailIdxs = idxs.filter(i => !isTotalForAccumulatedDepreciationLabel(items[i]!.label));
  const bareIdxs = detailIdxs.filter(i => /^accumulated\s+depreciation$/i.test(normLabel(items[i]!.label)));
  const otherIdxs = detailIdxs.filter(i => !/^accumulated\s+depreciation$/i.test(normLabel(items[i]!.label)));
  const anchor = bareIdxs[0] ?? detailIdxs[0] ?? totalIdxs[0] ?? idxs[0]!;
  const base = items[anchor]!;

  const values: Record<number, number> = {};
  const monthlyValues: Record<string, number> = {};

  if (totalIdxs.length) {
    for (const i of totalIdxs) addRowValues(values, monthlyValues, items[i]!);
  } else {
    for (const i of [...bareIdxs, ...otherIdxs]) addRowValues(values, monthlyValues, items[i]!);
  }

  const drop = new Set(idxs.filter(i => i !== anchor));
  const out: T[] = [];
  for (let i = 0; i < items.length; i++) {
    if (drop.has(i)) continue;
    if (i === anchor) {
      out.push({
        ...base,
        label: ACCUMULATED_DEPRECIATION_CLUB_LABEL,
        values,
        monthlyValues: Object.keys(monthlyValues).length ? monthlyValues : undefined,
        isSectionHeader: false,
        isTotal: false,
        isNetIncome: false,
      } as T);
      continue;
    }
    out.push(items[i]!);
  }
  return out;
}

/**
 * Drop section headers (e.g. CONSULTING EXP / ENGINEERING SERVICES) when the header
 * and all rows under it sum to $0 across the given years. Keeps headers that have
 * non-zero children (or a non-zero amount on the header itself).
 */
export function dropEmptyStatementSectionHeaders<T extends FinItemLike>(
  items: T[],
  years?: number[],
): T[] {
  if (!items.length) return items;
  const ys = years?.length ? years : yearsFromItems(items);
  // QuickBooks exports that indent via cell formatting (not leading spaces) arrive flat,
  // so indent cannot delimit a section â€” use label hierarchy instead.
  const flatIndents = items.every(i => (i.indent ?? 0) === 0);

  const isStructural = (label: string) =>
    isBareSectionHeaderLabel(label) || isStructuralSubHeaderLabel(label);

  const drop = new Set<number>();
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!isEmptySectionHeaderRow(item, ys)) continue;
    if (ys.length && absYearSum(item, ys) !== 0) continue;

    const indent = item.indent ?? 0;
    const itemIsStructural = isStructural(item.label);

    // Misc empty bands (A/P, Earnest Money, Consulting Exp, Adjustments shell, â€¦)
    // never carry amounts â€” QuickBooks puts money on the detail / Total rows.
    if (!itemIsStructural) {
      drop.add(i);
      continue;
    }

    let childSum = 0;

    for (let j = i + 1; j < items.length; j++) {
      const next = items[j];
      const nextIsHeader = isEmptySectionHeaderRow(next, ys);
      const nextIndent = next.indent ?? 0;

      if (flatIndents) {
        // Net Income sits under Operating Activities on CF â€” count it, don't close.
        if (next.isNetIncome) {
          childSum += absYearSum(next, ys);
          continue;
        }
        if (isTotalishLabel(next.label) || next.isTotal) {
          childSum += absYearSum(next, ys);
          if (isTotalRowForSection(next.label, item.label)) break;
          continue;
        }
        if (nextIsHeader) {
          // Keep scanning through nested empty category bands until the next structural band.
          if (isStructural(next.label)) break;
          continue;
        }
      } else {
        // Mixed / nested indents â€” same Net Income rule as flat CF.
        if (next.isNetIncome) {
          childSum += absYearSum(next, ys);
          continue;
        }
        if (nextIsHeader && nextIndent <= indent) {
          if (isStructural(next.label)) break;
          // Same-level misc empty band under a structural parent â€” skip and keep scanning.
          if (itemIsStructural) continue;
          break;
        }
        if ((next.isTotal || isTotalishLabel(next.label)) && nextIndent <= indent) {
          childSum += absYearSum(next, ys);
          if (isTotalRowForSection(next.label, item.label)) break;
          continue;
        }
        if (nextIsHeader) continue;
      }

      childSum += absYearSum(next, ys);
    }

    if (childSum === 0) drop.add(i);
  }

  if (!drop.size) return items;
  return items.filter((_, i) => !drop.has(i));
}

function normPartnerLabel(label: string): string {
  return label
    .replace(/\u00a0/g, ' ')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function isPartnerInvestmentsSectionLabel(label: string): boolean {
  return /^(?:partner\s+investments?|owner'?s?\s+investments?)$/i.test(normPartnerLabel(label));
}

function isTotalForPartnerInvestmentsLabel(label: string): boolean {
  return /^total\s+(for\s+)?(?:partner\s+investments?|owner'?s?\s+investments?)$/i.test(normPartnerLabel(label));
}

function investmentSectionClubLabel(label: string): string {
  return /^owner'?s?\s+investments?/i.test(normPartnerLabel(label))
    ? OWNERS_INVESTMENTS_CLUB_LABEL
    : PARTNER_INVESTMENTS_CLUB_LABEL;
}

/**
 * Equity "Owner's Investment" / "Owner's Investments" — bare parent or colon detail
 * ("Owner's Investment:Assure Life LLC (Anil)").
 */
function isOwnersInvestmentBandLabel(label: string): boolean {
  const n = normLabel(label);
  if (!n) return false;
  if (/^total\s+(for\s+)?owner'?s?\s+investments?\b/i.test(n)) return true;
  if (/^total\s+(for\s+)?/.test(n)) return false;
  return /^owner'?s?\s+investments?(?::|$)/i.test(n);
}

function normalizePartnerInvestLabel(label: string): string {
  return normLabel(label)
    .replace(/[\uFF1A\uFE55]/g, ':')
    .replace(/\s*:\s*/g, ':');
}

/**
 * Equity / CF "Partner investment(s)" — bare parent or colon detail
 * ("Partner investments:Sandhya Konda", "Partner investments:VR Estates - Equity:Ravi Pol").
 */
function isPartnerInvestmentBandLabel(label: string): boolean {
  const n = normalizePartnerInvestLabel(label);
  if (!n) return false;
  if (/^total\s+(for\s+)?partner\s+investments?\b/i.test(n)) return true;
  if (/^total\s+(for\s+)?/.test(n)) return false;
  // Any Partner investment(s) line (colon detail, spaced colon, or bare parent).
  return /^partner\s+investments?\b/i.test(n);
}

/** True when `parent` is a QBO colon-path ancestor of `child`. */
function isColonPathParent(parentLabel: string, childLabel: string): boolean {
  const p = normalizePartnerInvestLabel(parentLabel);
  const c = normalizePartnerInvestLabel(childLabel);
  if (!p || !c || p === c) return false;
  return c.startsWith(`${p}:`);
}

/**
 * Entity / company equity contribution lines under Equity
 * ("Texas Spark Constructions Equity", "VR Estates Equity").
 * Keeps partner personal-name capital, Owner's Equity, and Retained Earnings alone.
 */
function isEntityEquityBandLabel(label: string): boolean {
  const n = normLabel(label);
  if (!n) return false;
  // Already-clubbed board line.
  if (/^total\s+equity$/i.test(n)) return true;
  // QBO section rollup — absorbed then dropped; never a partner name line.
  if (/^total\s+for\s+equity$/i.test(n)) return true;
  if (/^total\s+(for\s+)?/.test(n)) {
    const rest = n.replace(/^total\s+(for\s+)?/, '');
    if (/^(owner'?s?|members?|stockholders?|shareholders?|opening\s+balance)\s+equity$/i.test(rest)) {
      return false;
    }
    return /^.+\sequity$/i.test(rest);
  }
  // Bare Equity section header.
  if (/^equity$/i.test(n)) return false;
  if (/^(owner'?s?|members?|stockholders?|shareholders?|opening\s+balance)\s+equity$/i.test(n)) {
    return false;
  }
  if (isPartnerOrOwnerInvestmentEquityLabel(label)) return false;
  // "Texas Spark Constructions Equity" / "VR Estates Equity" / "… LLC Equity".
  return /^.+\sequity$/i.test(n);
}

/**
 * Club every Owner's Investment:… detail (+ bare parent / Total) into one
 * "Owner's Investments" line when there is no empty section header for
 * clubPartnerInvestmentSectionRows to latch onto.
 */
export function clubOwnersInvestmentRows<T extends FinItemLike>(items: T[]): T[] {
  if (!items.length) return items;

  const idxs: number[] = [];
  for (let i = 0; i < items.length; i++) {
    if (isOwnersInvestmentBandLabel(items[i]!.label)) idxs.push(i);
  }
  if (!idxs.length) return items;

  const totalIdxs = idxs.filter(i => /^total\s+(for\s+)?/.test(normLabel(items[i]!.label)));
  const detailIdxs = idxs.filter(i => !/^total\s+(for\s+)?/.test(normLabel(items[i]!.label)));
  const bareIdxs = detailIdxs.filter(i => /^owner'?s?\s+investments?$/i.test(normLabel(items[i]!.label)));
  const otherIdxs = detailIdxs.filter(i => !/^owner'?s?\s+investments?$/i.test(normLabel(items[i]!.label)));

  // Nothing to merge — leave a lone already-clubbed line alone.
  if (detailIdxs.length + totalIdxs.length <= 1
    && bareIdxs.length === 1
    && normLabel(items[bareIdxs[0]!]!.label) === normLabel(OWNERS_INVESTMENTS_CLUB_LABEL)) {
    return items;
  }
  if (detailIdxs.length + totalIdxs.length <= 1 && otherIdxs.length === 0 && totalIdxs.length === 0) {
    // Single bare/detail row — still rename to the canonical label.
    const i = idxs[0]!;
    if (normLabel(items[i]!.label) === normLabel(OWNERS_INVESTMENTS_CLUB_LABEL)) return items;
    return items.map((item, idx) =>
      idx === i
        ? ({
            ...item,
            label: OWNERS_INVESTMENTS_CLUB_LABEL,
            isSectionHeader: false,
            isTotal: false,
            isNetIncome: false,
          } as T)
        : item,
    );
  }

  const anchor = bareIdxs[0] ?? detailIdxs[0] ?? totalIdxs[0] ?? idxs[0]!;
  const base = items[anchor]!;
  const values: Record<number, number> = {};
  const monthlyValues: Record<string, number> = {};

  if (totalIdxs.length) {
    for (const i of totalIdxs) addRowValues(values, monthlyValues, items[i]!);
    // Fill years the Total left at $0 from detail (parent often holds early years only).
    for (const i of detailIdxs) {
      const row = items[i]!;
      for (const k of Object.keys(row.values ?? {})) {
        const y = Number(k);
        if (!Number.isFinite(y)) continue;
        if ((values[y] ?? 0) === 0) values[y] = yearVal(row.values, y);
      }
      for (const [k, v] of Object.entries(row.monthlyValues ?? {})) {
        if ((monthlyValues[k] ?? 0) === 0) monthlyValues[k] = Number(v) || 0;
      }
    }
  } else {
    // Sum every detail / bare row (orphan colon paths with no Total).
    for (const i of detailIdxs) addRowValues(values, monthlyValues, items[i]!);
  }

  const drop = new Set(idxs.filter(i => i !== anchor));
  const out: T[] = [];
  for (let i = 0; i < items.length; i++) {
    if (drop.has(i)) continue;
    if (i === anchor) {
      out.push({
        ...base,
        label: OWNERS_INVESTMENTS_CLUB_LABEL,
        values,
        monthlyValues: Object.keys(monthlyValues).length ? monthlyValues : undefined,
        isSectionHeader: false,
        isTotal: false,
        isNetIncome: false,
      } as T);
      continue;
    }
    out.push(items[i]!);
  }
  return out;
}

/**
 * Club every Partner investments:… detail (+ bare parent / Total) into one
 * "Partner Investments" line when there is no empty section header for
 * clubPartnerInvestmentSectionRows to latch onto.
 */
export function clubPartnerInvestmentRows<T extends FinItemLike>(
  items: T[],
  sheet?: 'pl' | 'bs' | 'cf',
): T[] {
  // Balance Sheet: keep every partner name line (Bhanu Pittampally - Capital, …).
  if (sheet === 'bs') return items;
  if (!items.length) return items;

  const idxs: number[] = [];
  for (let i = 0; i < items.length; i++) {
    if (isPartnerInvestmentBandLabel(items[i]!.label)) idxs.push(i);
  }
  if (!idxs.length) return items;

  const totalIdxs = idxs.filter(i => /^total\s+(for\s+)?/.test(normalizePartnerInvestLabel(items[i]!.label)));
  const detailIdxs = idxs.filter(i => !/^total\s+(for\s+)?/.test(normalizePartnerInvestLabel(items[i]!.label)));
  const bareIdxs = detailIdxs.filter(i => /^partner\s+investments?$/i.test(normalizePartnerInvestLabel(items[i]!.label)));
  const otherIdxs = detailIdxs.filter(i => !/^partner\s+investments?$/i.test(normalizePartnerInvestLabel(items[i]!.label)));

  // Nothing to merge — leave a lone already-clubbed line alone.
  if (detailIdxs.length + totalIdxs.length <= 1
    && bareIdxs.length === 1
    && normLabel(items[bareIdxs[0]!]!.label) === normLabel(PARTNER_INVESTMENTS_CLUB_LABEL)) {
    return items;
  }
  if (detailIdxs.length + totalIdxs.length <= 1 && otherIdxs.length === 0 && totalIdxs.length === 0) {
    const i = idxs[0]!;
    if (normLabel(items[i]!.label) === normLabel(PARTNER_INVESTMENTS_CLUB_LABEL)) return items;
    return items.map((item, idx) =>
      idx === i
        ? ({
            ...item,
            label: PARTNER_INVESTMENTS_CLUB_LABEL,
            isSectionHeader: false,
            isTotal: false,
            isNetIncome: false,
          } as T)
        : item,
    );
  }

  const anchor = bareIdxs[0] ?? detailIdxs[0] ?? totalIdxs[0] ?? idxs[0]!;
  const base = items[anchor]!;
  const values: Record<number, number> = {};
  const monthlyValues: Record<string, number> = {};

  // Prefer Total for Partner investments when present.
  // Otherwise sum LEAF colon details only — parent paths like
  // "Partner investments:VR Estates - Equity" often already include child amounts.
  const leafDetailIdxs = detailIdxs.filter(i =>
    !detailIdxs.some(j => j !== i && isColonPathParent(items[i]!.label, items[j]!.label)),
  );
  const sumIdxs = leafDetailIdxs.length ? leafDetailIdxs : detailIdxs;

  if (totalIdxs.length) {
    for (const i of totalIdxs) addRowValues(values, monthlyValues, items[i]!);
    for (const i of sumIdxs) {
      const row = items[i]!;
      for (const k of Object.keys(row.values ?? {})) {
        const y = Number(k);
        if (!Number.isFinite(y)) continue;
        if ((values[y] ?? 0) === 0) values[y] = yearVal(row.values, y);
      }
      for (const [k, v] of Object.entries(row.monthlyValues ?? {})) {
        if ((monthlyValues[k] ?? 0) === 0) monthlyValues[k] = Number(v) || 0;
      }
    }
  } else {
    for (const i of sumIdxs) addRowValues(values, monthlyValues, items[i]!);
  }

  const drop = new Set(idxs.filter(i => i !== anchor));
  const out: T[] = [];
  for (let i = 0; i < items.length; i++) {
    if (drop.has(i)) continue;
    if (i === anchor) {
      out.push({
        ...base,
        label: PARTNER_INVESTMENTS_CLUB_LABEL,
        values,
        monthlyValues: Object.keys(monthlyValues).length ? monthlyValues : undefined,
        isSectionHeader: false,
        isTotal: false,
        isNetIncome: false,
      } as T);
      continue;
    }
    out.push(items[i]!);
  }
  return out;
}

/**
 * Club every entity "… Equity" line into one "Total Equity" board line.
 * Partner personal-name rows (Ravi Polishetty, …) are left alone.
 * Applies to every company via tidyStatementRows.
 */
export function clubEntityEquityRows<T extends FinItemLike>(items: T[]): T[] {
  if (!items.length) return items;

  const idxs: number[] = [];
  for (let i = 0; i < items.length; i++) {
    if (isEntityEquityBandLabel(items[i]!.label)) idxs.push(i);
  }
  if (!idxs.length) return items;

  const bandTotalIdxs = idxs.filter(i =>
    /^total\s+(for\s+)?equity$/i.test(normLabel(items[i]!.label)),
  );
  const entityIdxs = idxs.filter(i => !bandTotalIdxs.includes(i));
  const bareBoardIdxs = entityIdxs.filter(i =>
    /^total\s+equity$/i.test(normLabel(items[i]!.label)),
  );
  const detailIdxs = entityIdxs.filter(i => !bareBoardIdxs.includes(i));

  // Nothing to merge — leave a lone already-clubbed line alone.
  if (detailIdxs.length + bandTotalIdxs.length <= 1
    && bareBoardIdxs.length === 1
    && normLabel(items[bareBoardIdxs[0]!]!.label) === normLabel(TOTAL_EQUITY_CLUB_LABEL)) {
    return items;
  }
  if (detailIdxs.length + bandTotalIdxs.length + bareBoardIdxs.length <= 1 && detailIdxs.length === 0) {
    const i = idxs[0]!;
    if (normLabel(items[i]!.label) === normLabel(TOTAL_EQUITY_CLUB_LABEL)) return items;
    if (bandTotalIdxs.length === 1 || bareBoardIdxs.length === 1) {
      return items.map((item, idx) =>
        idx === i
          ? ({
              ...item,
              label: TOTAL_EQUITY_CLUB_LABEL,
              isSectionHeader: false,
              isTotal: false,
              isNetIncome: false,
            } as T)
          : item,
      );
    }
    return items;
  }

  const anchor = bareBoardIdxs[0] ?? detailIdxs[0] ?? bandTotalIdxs[0] ?? idxs[0]!;
  const base = items[anchor]!;
  const values: Record<number, number> = {};
  const monthlyValues: Record<string, number> = {};

  // Sum entity "… Equity" details only — QBO "Total for Equity" often includes partners.
  const sourceIdxs = detailIdxs.length
    ? detailIdxs
    : (bareBoardIdxs.length ? bareBoardIdxs : bandTotalIdxs);
  for (const i of sourceIdxs) addRowValues(values, monthlyValues, items[i]!);

  const drop = new Set(idxs.filter(i => i !== anchor));
  const out: T[] = [];
  for (let i = 0; i < items.length; i++) {
    if (drop.has(i)) continue;
    if (i === anchor) {
      out.push({
        ...base,
        label: TOTAL_EQUITY_CLUB_LABEL,
        values,
        monthlyValues: Object.keys(monthlyValues).length ? monthlyValues : undefined,
        isSectionHeader: false,
        isTotal: false,
        isNetIncome: false,
      } as T);
      continue;
    }
    out.push(items[i]!);
  }
  return out;
}

/** Rows that end a Partner Investments band when the workbook has no "Total for Partner Investments". */
function isPartnerSectionCloserLabel(label: string): boolean {
  const n = normPartnerLabel(label);
  if (isPartnerInvestmentsSectionLabel(label) || isTotalForPartnerInvestmentsLabel(label)) return false;
  return /^(retained earnings|net income|opening balance equity|owner'?s?\s+equity|members?\s+(capital|equity)|common stock|additional paid[- ]in capital|distributions?|drawings?|loan draws?|notes payable|long[- ]term debt)$/i.test(n)
    || isBareSectionHeaderLabel(label)
    || isStructuralSubHeaderLabel(label);
}

/**
 * Club a Partner / Owner investments section (header + one row per investor, possibly with
 * inner per-investor subtotals) into a single canonical line. Handles workbooks where
 * investor rows are plain names instead of prefixed labels. Applies to every company.
 */
export function clubPartnerInvestmentSectionRows<T extends FinItemLike>(
  items: T[],
  sheet?: 'pl' | 'bs' | 'cf',
): T[] {
  if (sheet === 'bs') return items;
  const headerIdx = items.findIndex(i =>
    isPartnerInvestmentsSectionLabel(i.label)
    && !i.isTotal && !i.isNetIncome
    && !Object.keys(i.values ?? {}).some(k => {
      const y = Number(k);
      return Number.isFinite(y) && yearVal(i.values, y) !== 0;
    }),
  );
  if (headerIdx === -1) return items;

  const headerIndent = items[headerIdx].indent ?? 0;
  const flatIndents = items.every(i => (i.indent ?? 0) === 0);
  const detailKeys = new Set<string>();
  const details: T[] = [];
  let sectionTotal: T | null = null;
  let end = headerIdx; // last consumed index

  for (let j = headerIdx + 1; j < items.length; j++) {
    const row = items[j];
    const norm = normPartnerLabel(row.label);

    if (isTotalForPartnerInvestmentsLabel(row.label)) {
      sectionTotal = row;
      end = j;
      break;
    }

    if (row.isNetIncome || isPartnerSectionCloserLabel(row.label)) break;

    const totalish = row.isTotal || /^total\s+(for\s+)?/i.test(row.label.trim());
    if (totalish) {
      // Inner per-partner subtotal (Total for Ravi Polisetti - Equity) â€” duplicate of
      // rows already collected; skip it but stay inside the section.
      const inner = norm.replace(/^total\s+(for\s+)?/, '');
      if ([...detailKeys].some(k => inner === k || inner.startsWith(`${k} `) || k.startsWith(inner))) {
        end = j;
        continue;
      }
      break; // closes an enclosing section â€” stop before it
    }

    if (row.isSectionHeader) break;
    if (!flatIndents && (row.indent ?? 0) <= headerIndent) break;

    details.push(row);
    detailKeys.add(norm);
    end = j;
  }

  if (!details.length && !sectionTotal) return items;

  const values: Record<number, number> = {};
  let monthlyValues: Record<string, number> = {};
  if (sectionTotal) {
    for (const k of Object.keys(sectionTotal.values ?? {})) {
      const y = Number(k);
      if (Number.isFinite(y)) values[y] = yearVal(sectionTotal.values, y);
    }
    monthlyValues = sectionTotal.monthlyValues ? { ...sectionTotal.monthlyValues } : {};
  } else {
    for (const row of details) {
      for (const k of Object.keys(row.values ?? {})) {
        const y = Number(k);
        if (!Number.isFinite(y)) continue;
        values[y] = (values[y] ?? 0) + yearVal(row.values, y);
      }
      for (const [k, v] of Object.entries(row.monthlyValues ?? {})) {
        monthlyValues[k] = (monthlyValues[k] ?? 0) + (Number(v) || 0);
      }
    }
  }

  const clubbed = {
    ...(details[0] ?? sectionTotal ?? items[headerIdx]),
    label: investmentSectionClubLabel(items[headerIdx].label),
    values,
    monthlyValues: Object.keys(monthlyValues).length ? monthlyValues : undefined,
    indent: items[headerIdx].indent ?? 0,
    isTotal: false,
    isSectionHeader: false,
    isNetIncome: false,
  } as T;

  const out = [...items.slice(0, headerIdx), clubbed, ...items.slice(end + 1)];
  // Multiple partner sections (rare) â€” club the next one too.
  return clubPartnerInvestmentSectionRows(out, sheet);
}

/**
 * Club partner / duplicate rows, drop empty subcategory headers, then hide $0 lines.
 * Runs for every rental / prop-dev / construction / consultancy company
 * (and portfolio after per-company tidy) — P&L, Balance Sheet, and Cash Flow
 * (live UI + PDF). Same clubbing rules apply on all three sheets.
 *
 * @param sheet When `'pl'`, a lone "Bank" expense line is shown as "Bank charges"
 *   (Balance Sheet / Cash Flow keep the cash "Bank" label).
 */

const LONG_TERM_LOAN_OTHERS_CLUB_LABEL = LOANS_AND_ADVANCES_FROM_OTHERS_CLUB_LABEL;
const LONG_TERM_LOANS_BANK_CLUB_LABEL = BANK_LOANS_CLUB_LABEL;
const RENT_PAYABLE_CLUB_LABEL = 'Rent Payable';

function isTotalForLongTermLoanOthersLabel(label: string): boolean {
  const n = normLabel(label);
  return /^total\s+(for\s+)?long[- ]?term\s+loans?\s+from\s+others?\b/i.test(n)
    || /^total\s+(for\s+)?long[- ]?term\s+loans?\s+others?\b/i.test(n)
    || /^total\s+(for\s+)?loans?\s*(&|and)?\s*advances?\s+from\s+others?\b/i.test(n);
}

function isLongTermLoanOthersHeaderLabel(label: string): boolean {
  const n = normLabel(label);
  return /^long[- ]?term\s+loans?\s+from\s+others?\b/i.test(n)
    || /^long[- ]?term\s+loans?\s+others?\b/i.test(n)
    || /^loans?\s*(&|and)?\s*advances?\s+from\s+others?\b/i.test(n);
}

function isTotalForLongTermLoansBankLabel(label: string): boolean {
  const n = normLabel(label);
  return /^total\s+(for\s+)?long[- ]?term\s+loans?\s+from\s+banks?\b/i.test(n)
    || /^total\s+(for\s+)?bank\s+loans?\b/i.test(n);
}

function isLongTermLoansBankHeaderLabel(label: string): boolean {
  const n = normLabel(label);
  return /^long[- ]?term\s+loans?\s+from\s+banks?\b/i.test(n)
    || /^bank\s+loans?$/i.test(n);
}

function isTotalForRentPayableLabel(label: string): boolean {
  return /^total\s+(for\s+)?rent\s+payables?\b/i.test(normLabel(label));
}

function isRentPayableBandLabel(label: string): boolean {
  const n = normLabel(label);
  if (isTotalForRentPayableLabel(label)) return true;
  if (/^total\s+(for\s+)?/.test(n)) return false;
  return /^rent\s+payables?\b/i.test(n);
}

/**
 * Collapse a header → detail → Total for band into one line using Total amounts.
 * Riviera loan rows in this band are included (board line: Loans and Advances from Others).
 */
function clubHeaderTotalPreferTotalRows<T extends FinItemLike>(
  items: T[],
  clubLabel: string,
  isHeader: (label: string) => boolean,
  isTotal: (label: string) => boolean,
): T[] {
  if (!items.length) return items;

  const drop = new Set<number>();
  const replace = new Map<number, T>();

  for (let tIdx = 0; tIdx < items.length; tIdx++) {
    if (!isTotal(items[tIdx]!.label)) continue;
    let start = tIdx;
    for (let j = tIdx - 1; j >= 0; j--) {
      const lab = items[j]!.label;
      if (isHeader(lab)) {
        start = j;
        break;
      }
      if (isTotal(lab)) break;
      if (isStructuralSubHeaderLabel(lab) || isBareSectionHeaderLabel(lab)) break;
      if (/^total\s+(for\s+)?/i.test(normLabel(lab))) break;
      // Do not absorb a sibling long-term loan band already clubbed/normalized.
      const n = normLabel(lab);
      if (/^long[- ]?term\s+loans?\s+from\b/i.test(n) && !isHeader(lab)) break;
      // Include detail rows above the Total (Car Loan, Loan for Office Space, …).
      start = j;
    }

    const bandAll: number[] = [];
    for (let i = start; i <= tIdx; i++) bandAll.push(i);
    // Keep Other Long Term Loans as its own club; Riviera stays inside Long Term Loan from Others.
    const keepOutOfBand = (lab: string) =>
      /^other\s+long[- ]?term\s+loans?\b/i.test(normLabel(lab));
    const excludedInBand = bandAll.filter(i => keepOutOfBand(items[i]!.label));
    const band = bandAll.filter(i => !keepOutOfBand(items[i]!.label));
    if (!band.length) continue;

    const values: Record<number, number> = {};
    const monthlyValues: Record<string, number> = {};
    if (excludedInBand.length) {
      // Total may include Riviera / Other Long Term Loans — sum only remaining detail.
      const detailIdxs = band.filter(i => !isHeader(items[i]!.label) && !isTotal(items[i]!.label));
      const sourceIdxs = detailIdxs.length ? detailIdxs : band.filter(i => isTotal(items[i]!.label));
      for (const i of sourceIdxs) addRowValues(values, monthlyValues, items[i]!);
    } else {
      addRowValues(values, monthlyValues, items[tIdx]!);
    }

    const anchor = band.find(i => isHeader(items[i]!.label)) ?? band[band.length - 1]!;
    replace.set(anchor, {
      ...items[anchor]!,
      label: clubLabel,
      values,
      monthlyValues: Object.keys(monthlyValues).length ? monthlyValues : undefined,
      isSectionHeader: false,
      isTotal: false,
      isNetIncome: false,
    } as T);
    for (const i of band) {
      if (i !== anchor) drop.add(i);
    }
  }

  if (!replace.size) return items;
  const out: T[] = [];
  for (let i = 0; i < items.length; i++) {
    if (drop.has(i)) continue;
    out.push(replace.get(i) ?? items[i]!);
  }
  return out;
}

/** Demote leftover "Total for Long Term Loanâ€¦" rows to normal (non-subtotal) lines. */
function demoteLongTermLoanTotalRows<T extends FinItemLike>(items: T[]): T[] {
  if (!items.length) return items;
  return items.map(item => {
    if (isTotalForLongTermLoanOthersLabel(item.label)) {
      return {
        ...item,
        label: LONG_TERM_LOAN_OTHERS_CLUB_LABEL,
        isSectionHeader: false,
        isTotal: false,
        isNetIncome: false,
      } as T;
    }
    if (isTotalForLongTermLoansBankLabel(item.label)) {
      return {
        ...item,
        label: LONG_TERM_LOANS_BANK_CLUB_LABEL,
        isSectionHeader: false,
        isTotal: false,
        isNetIncome: false,
      } as T;
    }
    return item;
  });
}

/** Long Term Loans Others detail (+ Riviera / property Loans) + Total → one board line. */
export function clubLongTermLoanOthersRows<T extends FinItemLike>(items: T[]): T[] {
  const afterBand = clubHeaderTotalPreferTotalRows(
    items,
    LONG_TERM_LOAN_OTHERS_CLUB_LABEL,
    isLongTermLoanOthersHeaderLabel,
    isTotalForLongTermLoanOthersLabel,
  );
  // Cash-flow / orphan detail: no Total band — merge every matching row (incl. Riviera / Loans).
  return clubLongTermLoanOthersDetailRows(afterBand);
}

/**
 * Sum every Long Term Loans Others / Riviera detail into one board line when
 * they are scattered (typical on Cash Flow / BS) rather than a contiguous Total band.
 * Property / GPB "Loan" lines stay on their own club.
 */
function clubLongTermLoanOthersDetailRows<T extends FinItemLike>(items: T[]): T[] {
  if (!items.length) return items;

  const idxs: number[] = [];
  for (let i = 0; i < items.length; i++) {
    const lab = items[i]!.label;
    const n = normLabel(lab);
    if (/^total\s+(for\s+)?/.test(n)) continue;
    if (isLongTermLoanOthersHeaderLabel(lab) || isRivieraLoanLabel(lab)) {
      idxs.push(i);
    }
  }
  if (idxs.length <= 1) {
    // Still rename a lone matching header/detail to the board label.
    if (idxs.length === 1) {
      const i = idxs[0]!;
      const lab = items[i]!.label;
      if (normLabel(lab) === normLabel(LOANS_AND_ADVANCES_FROM_OTHERS_CLUB_LABEL)) return items;
      return items.map((item, idx) =>
        idx === i
          ? ({
              ...item,
              label: LOANS_AND_ADVANCES_FROM_OTHERS_CLUB_LABEL,
              isSectionHeader: false,
              isTotal: false,
              isNetIncome: false,
            } as T)
          : item,
      );
    }
    return items;
  }

  const anchor = idxs[0]!;
  const base = items[anchor]!;
  const values: Record<number, number> = {};
  const monthlyValues: Record<string, number> = {};
  for (const i of idxs) addRowValues(values, monthlyValues, items[i]!);

  const drop = new Set(idxs.filter(i => i !== anchor));
  const out: T[] = [];
  for (let i = 0; i < items.length; i++) {
    if (drop.has(i)) continue;
    if (i === anchor) {
      out.push({
        ...base,
        label: LOANS_AND_ADVANCES_FROM_OTHERS_CLUB_LABEL,
        values,
        monthlyValues: Object.keys(monthlyValues).length ? monthlyValues : undefined,
        isSectionHeader: false,
        isTotal: false,
        isNetIncome: false,
      } as T);
      continue;
    }
    out.push(items[i]!);
  }
  return out;
}

/** Long Term Loans from Bank detail + Total → one "Bank Loans" line. */
export function clubLongTermLoansBankRows<T extends FinItemLike>(items: T[]): T[] {
  const afterBand = clubHeaderTotalPreferTotalRows(
    items,
    LONG_TERM_LOANS_BANK_CLUB_LABEL,
    isLongTermLoansBankHeaderLabel,
    isTotalForLongTermLoansBankLabel,
  );
  // Orphan lender-only lines (Bank Ozk, "No") with no Total band — merge globally.
  return clubPropertyLoansRows(clubBankLoansDetailRows(afterBand));
}

/**
 * Sum property / GPB–GBP / loan-account lines into one "Loan" board line
 * ("GPB Loan", "GPB Suite 120 Loan", "Loan on Property", "5880 Loan Account …", …).
 */
export function clubPropertyLoansRows<T extends FinItemLike>(items: T[]): T[] {
  if (!items.length) return items;

  const idxs: number[] = [];
  for (let i = 0; i < items.length; i++) {
    const lab = items[i]!.label;
    if (/^total\s+(for\s+)?/.test(normLabel(lab))) continue;
    if (isPropertyLoansClubLabel(lab)) idxs.push(i);
  }
  if (idxs.length <= 1) {
    if (idxs.length === 1) {
      const i = idxs[0]!;
      if (normLabel(items[i]!.label) === normLabel(LOANS_CLUB_LABEL)) return items;
      return items.map((item, idx) =>
        idx === i
          ? ({
              ...item,
              label: LOANS_CLUB_LABEL,
              isSectionHeader: false,
              isTotal: false,
              isNetIncome: false,
            } as T)
          : item,
      );
    }
    return items;
  }

  const anchor = idxs[0]!;
  const base = items[anchor]!;
  const values: Record<number, number> = {};
  const monthlyValues: Record<string, number> = {};
  for (const i of idxs) addRowValues(values, monthlyValues, items[i]!);

  const drop = new Set(idxs.filter(i => i !== anchor));
  const out: T[] = [];
  for (let i = 0; i < items.length; i++) {
    if (drop.has(i)) continue;
    if (i === anchor) {
      out.push({
        ...base,
        label: LOANS_CLUB_LABEL,
        values,
        monthlyValues: Object.keys(monthlyValues).length ? monthlyValues : undefined,
        isSectionHeader: false,
        isTotal: false,
        isNetIncome: false,
      } as T);
      continue;
    }
    out.push(items[i]!);
  }
  return out;
}

/**
 * Sum every institutional bank loan detail into one "Bank Loans" line when
 * they sit as sanitized lender names under Long-term Liabilities (no Total band).
 */
function clubBankLoansDetailRows<T extends FinItemLike>(items: T[]): T[] {
  if (!items.length) return items;

  const idxs: number[] = [];
  for (let i = 0; i < items.length; i++) {
    const lab = items[i]!.label;
    if (/^total\s+(for\s+)?/.test(normLabel(lab))) continue;
    if (isBankLoansClubLabel(lab)) idxs.push(i);
  }
  if (idxs.length <= 1) {
    if (idxs.length === 1) {
      const i = idxs[0]!;
      if (normLabel(items[i]!.label) === normLabel(BANK_LOANS_CLUB_LABEL)) return items;
      return items.map((item, idx) =>
        idx === i
          ? ({
              ...item,
              label: BANK_LOANS_CLUB_LABEL,
              isSectionHeader: false,
              isTotal: false,
              isNetIncome: false,
            } as T)
          : item,
      );
    }
    return items;
  }

  const anchor = idxs[0]!;
  const base = items[anchor]!;
  const values: Record<number, number> = {};
  const monthlyValues: Record<string, number> = {};
  for (const i of idxs) addRowValues(values, monthlyValues, items[i]!);

  const drop = new Set(idxs.filter(i => i !== anchor));
  const out: T[] = [];
  for (let i = 0; i < items.length; i++) {
    if (drop.has(i)) continue;
    if (i === anchor) {
      out.push({
        ...base,
        label: BANK_LOANS_CLUB_LABEL,
        values,
        monthlyValues: Object.keys(monthlyValues).length ? monthlyValues : undefined,
        isSectionHeader: false,
        isTotal: false,
        isNetIncome: false,
      } as T);
      continue;
    }
    out.push(items[i]!);
  }
  return out;
}

/** Rent Payable + Rent Payable - Office + Total â†’ one "Rent Payable" line. */
export function clubRentPayableRows<T extends FinItemLike>(items: T[]): T[] {
  if (!items.length) return items;
  const idxs: number[] = [];
  for (let i = 0; i < items.length; i++) {
    if (isRentPayableBandLabel(items[i]!.label)) idxs.push(i);
  }
  if (!idxs.length) return items;

  const totalIdxs = idxs.filter(i => isTotalForRentPayableLabel(items[i]!.label));
  const detailIdxs = idxs.filter(i => !isTotalForRentPayableLabel(items[i]!.label));

  // Orphan "Total for Rent Payable" with no detail â€” drop it (do not rename to Rent Payable).
  if (!detailIdxs.length && totalIdxs.length) {
    const dropOnly = new Set(totalIdxs);
    return items.filter((_, i) => !dropOnly.has(i));
  }

  const anchor = detailIdxs[0] ?? idxs[0]!;
  const base = items[anchor]!;

  const values: Record<number, number> = {};
  const monthlyValues: Record<string, number> = {};
  const sourceIdxs = totalIdxs.length ? totalIdxs : detailIdxs;
  for (const i of sourceIdxs) addRowValues(values, monthlyValues, items[i]!);

  const drop = new Set(idxs.filter(i => i !== anchor));
  const out: T[] = [];
  for (let i = 0; i < items.length; i++) {
    if (drop.has(i)) continue;
    if (i === anchor) {
      out.push({
        ...base,
        label: RENT_PAYABLE_CLUB_LABEL,
        values,
        monthlyValues: Object.keys(monthlyValues).length ? monthlyValues : undefined,
        isSectionHeader: false,
        isTotal: false,
        isNetIncome: false,
      } as T);
      continue;
    }
    out.push(items[i]!);
  }
  return out;
}

export function tidyStatementRows<T extends FinItemLike>(
  items: T[],
  years?: number[],
  sheet?: 'pl' | 'bs' | 'cf',
): T[] {
  const ys = years?.length ? years : yearsFromItems(items);
  // 2025 Services revenue ($3,589,113) belongs under Sales on the board view.
  const reclassed = reclassServicesToSalesForYear(items, 2025);
  // Club software/subscription + property-tax + travel bands first so Total-for amounts are kept.
  // Demote leftover "Total for Long Term Loanâ€¦" to normal lines (keep amounts, drop subtotal style).
  // Club Rental Income before dropping "Total for Rent …" so property subtotals
  // are absorbed into the parent rather than merely deleted.
  const preClubbed = demoteLongTermLoanTotalRows(
    clubLongTermLoansBankRows(
      clubLongTermLoanOthersRows(
        clubRentPayableRows(
          clubInterestPayableRows(
            clubCreditCardsRows(
              clubAccountsPayableRows(
                clubReimbursementRows(
                  clubInvestmentsRows(
                    clubShareholderDistributionRows(
                      clubLoansAndAdvancesRows(
                        clubPayrollWagesAndTaxRows(
                          clubAccountsReceivableRows(
                            clubBankAccountsRows(
                              clubVehicleExpensesRows(
                                clubOtherIncomeRows(
                                  clubSaleOfPropertyRows(
                                    clubElectricityInternetRows(
                                      clubTravelHotelsRows(clubPropertyTaxesRows(clubSoftwareSubscriptionsRows(
                                        clubRentalIncomeRows(clubRivieraLoanRows(reclassed), sheet),
                                      ))),
                                    ),
                                  ),
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
  const withoutDropped = preClubbed.filter(item => !isDroppedStatementLineLabel(item.label));
  const tidied = dropEmptyStatementSectionHeaders(
    clubBusinessLoanRows(
      clubInterestPaidRows(
        clubBankFeesRows(
          clubGeneralBusinessExpensesRows(
            clubJanitorialExpensesRows(
              clubCommissionsFeesRows(
                clubAdvertisingMarketingRows(
                  clubBookKeepingChargesRows(
                    clubRentalIncomeRows(
                      clubImprovementsRows(
                        clubLandDetailRows(
                          clubInvestmentsRows(
                            clubShareholderDistributionRows(
                              clubLoansAndAdvancesRows(
                                clubPayrollWagesAndTaxRows(
                                  clubIntercompanyLoanRows(
                                    clubShortTermPartnerLoanRows(
                                      clubSecurityDepositRows(
                                        clubRelatedPartyPayableRows(
                                          clubRelatedPartyReceivableRows(
                                            clubLeezaSpaceReceivableRows(
                                              clubAccountsReceivableRows(
                                                clubFixedAssetsDetailRows(
                                                  clubAccumulatedDepreciationRows(
                                                    clubFixedAssetTotalRows(
                                                      clubFixedAssetPropertyImprovementRows(
                                                        clubDuplicateStatementDetailRows(
                                                          clubEntityEquityRows(
                                                            clubPartnerInvestmentRows(
                                                              clubOwnersInvestmentRows(
                                                                clubPartnerInvestmentSectionRows(withoutDropped, sheet),
                                                              ),
                                                              sheet,
                                                            ),
                                                          ),
                                                          sheet,
                                                        ),
                                                      ),
                                                    ),
                                                  ),
                                                ),
                                              ),
                                            ),
                                          ),
                                        ),
                                      ),
                                    ),
                                  ),
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),
                      sheet,
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
    ys,
  ).filter(item => !isFixedAssetDisplayNoise(item.label));
  // Re-run property-tax club after other tidy passes so parcel lines still collapse.
  // Suite HOA runs here too: per-suite dues are scattered, not a contiguous band.
  const afterTaxClub = clubSuiteHoaRows(clubPropertyTaxesRows(tidied));
  // Drop remaining rows with no amounts across the active years.
  // Keep Net Income even at $0; empty section headers stay for the child-check pass.
  const withoutZeros = afterTaxClub.filter(item => {
    if (item.isNetIncome) return true;
    if (isEmptySectionHeaderRow(item, ys)) return true;
    if (sheet === 'bs' && isPartnerCapitalNameLine(item.label)) return true;
    return hasNonZeroStatementAmount(item, ys.length ? ys : yearsFromItems([item]));
  });
  // Second pass: drop bare/structural headers whose children were all zeroed out.
  const cleaned = dropEmptyStatementSectionHeaders(withoutZeros, ys)
    .filter(item => !isDroppedStatementLineLabel(item.label));
  const landOrdered = orderLandImprovementsInterestCapRows(cleaned);
  // P&L: show expense "Bank" as "Bank charges" (BS cash line stays "Bank").
  if (sheet === 'pl') {
    return landOrdered.map(item => {
      if (!/^banks?$/i.test(normLabel(item.label))) return item;
      return { ...item, label: 'Bank charges', isSectionHeader: false, isTotal: false } as T;
    });
  }
  return landOrdered;
}

/**
 * Prop Dev P&L: drop intermediate QBO subcategory subtotals
 * ("Total for Interest paid", "Total for Office expenses", …) and the
 * parent "Taxes paid" band (often renamed from "Total for Taxes paid").
 * Keep section rollups: Total for Income / Expenses / COGS / Other Income|Expenses.
 */
export function isPropDevDroppedPlSubtotalLabel(label: string): boolean {
  const n = normLabel(label);
  // Bare / renamed parent — detail lives under Property taxes (never show both).
  if (isTaxesPaidBoardLineLabel(label)) return true;
  if (!/^total\s+(for\s+)?/i.test(n)) return false;
  if (/^total\s+(for\s+)?(income|expenses?|cost of goods sold|cogs|other\s+income|other\s+expenses?|gross\s+profit|operating\s+expenses?)$/i.test(n)) {
    return false;
  }
  return true;
}

function isPropDevPlExpenseSectionStart(label: string): boolean {
  return /^(expenses?|other\s+expenses?|cost of goods sold|cogs|operating\s+expenses?)$/i.test(normLabel(label));
}

const PROP_DEV_PINNED_EXPENSES: Array<{ label: string; test: (n: string) => boolean }> = [
  { label: 'Interest paid', test: n => /^interest\s+paid(\s+on\s+loans?)?$/i.test(n) },
  { label: 'Loan Processing Fee', test: n => /^loan\s+processing\s+fees?$/i.test(n) },
  { label: 'Management Fee', test: n => /^management\s+fees?$/i.test(n) },
  { label: 'General business expenses', test: n => /^general\s+business\s+exp(ense)?s?$/i.test(n) },
];

function isPropDevPinnedExpenseLabel(label: string): boolean {
  const n = normLabel(label);
  return PROP_DEV_PINNED_EXPENSES.some(p => p.test(n));
}

function emptyYearValues(years: number[]): Record<number, number> {
  const values: Record<number, number> = {};
  for (const y of years) values[y] = 0;
  return values;
}

/**
 * Interest paid → Loan Processing Fee → Management Fee → GBE, then other expenses.
 * With synthesizeMissing (default true, legacy behavior), a pinned label that has no
 * matching row gets invented as a $0 placeholder. Category-driven data must never do
 * this — it shows only categories that actually exist, so callers pass false there.
 */
function arrangePropDevPinnedExpenses<T extends FinItemLike>(
  items: T[],
  years: number[],
  opts: { synthesizeMissing?: boolean } = {},
): T[] {
  const synthesizeMissing = opts.synthesizeMissing !== false;
  if (!items.length) return items;
  const ys = years.length ? years : yearsFromItems(items);

  let detailStart = 0;
  const expBanner = items.findIndex(i =>
    isPropDevPlExpenseSectionStart(i.label) && !i.isTotal && !i.isNetIncome,
  );
  if (expBanner >= 0) {
    detailStart = expBanner + 1;
  } else {
    for (let i = 0; i < items.length; i++) {
      const n = normLabel(items[i]!.label);
      if (
        /^(income|other\s+income|gross\s+profit)$/i.test(n)
        || /^total\s+(for\s+)?(income|other\s+income|gross\s+profit)/i.test(n)
      ) {
        detailStart = i + 1;
      }
    }
  }
  let detailEnd = items.length;
  for (let i = detailStart; i < items.length; i++) {
    if (isPropDevPlSortAnchor(items[i]!)) {
      detailEnd = i;
      break;
    }
  }

  const head = items.slice(0, detailStart);
  const mid = items.slice(detailStart, detailEnd);
  const tail = items.slice(detailEnd);
  const template = mid.find(i => !i.isTotal && !i.isNetIncome)
    ?? items.find(i => !i.isSectionHeader && !i.isTotal && !i.isNetIncome);

  const used = new Set<number>();
  const pinned: T[] = [];
  for (const p of PROP_DEV_PINNED_EXPENSES) {
    const idx = mid.findIndex((row, j) => !used.has(j) && p.test(normLabel(row.label)));
    if (idx >= 0) {
      used.add(idx);
      const row = mid[idx]!;
      pinned.push({ ...row, label: p.label, isSectionHeader: false, isTotal: false, isNetIncome: false } as T);
    } else if (synthesizeMissing) {
      pinned.push({
        ...(template ?? { indent: 0 }),
        label: p.label,
        values: emptyYearValues(ys),
        monthlyValues: undefined,
        indent: template?.indent ?? 0,
        isTotal: false,
        isSectionHeader: false,
        isNetIncome: false,
      } as T);
    }
  }
  const rest = mid.filter((_, j) => !used.has(j));
  return [...head, ...pinned, ...rest, ...tail];
}

/** Totals / banners stay put; everything else is a sortable P&L detail line. */
function isPropDevPlSortAnchor<T extends FinItemLike>(item: T): boolean {
  if (item.isTotal || item.isNetIncome) return true;
  const n = normLabel(item.label);
  if (isMajorPropDevStatementBanner(item.label)) return true;
  if (isPropDevPlExpenseSectionStart(item.label)) return true;
  if (/^total\s+(for\s+)?/i.test(n)) return true;
  if (/^net\s+(income|loss|operating|profit|other)/i.test(n)) return true;
  if (/^(income|other\s+income|gross\s+profit|cogs|cost of goods sold)$/i.test(n)) return true;
  return false;
}

/**
 * Rank P&L detail lines by the last year column (highest |amount| first).
 * Expense lines that are $0 across every displayed year are dropped; a line stays
 * visible as long as at least one displayed year has activity (e.g. a category-merged
 * line whose latest-year net happens to be $0 due to an in-year reversal still shows).
 */
export function sortPropDevPlExpenseRowsByAmount<T extends FinItemLike>(
  items: T[],
  years: number[],
  opts: { synthesizeMissingPinned?: boolean } = {},
): T[] {
  items = items.filter(i => !isTaxesPaidBoardLineLabel(i.label));
  if (items.length < 2) return items;
  const ys = [...(years.length ? years : yearsFromItems(items))].sort((a, b) => a - b);
  if (!ys.length) return items;
  const lastY = ys[ys.length - 1]!;

  const sorted: T[] = [];
  let i = 0;
  while (i < items.length) {
    const item = items[i]!;
    if (isPropDevPlSortAnchor(item)) {
      sorted.push(item);
      i += 1;
      continue;
    }
    const run: T[] = [];
    while (i < items.length && !isPropDevPlSortAnchor(items[i]!)) {
      run.push(items[i]!);
      i += 1;
    }
    run.sort((a, b) => {
      const d = Math.abs(yearVal(b.values, lastY)) - Math.abs(yearVal(a.values, lastY));
      if (Math.abs(d) > STATEMENT_AMOUNT_EPS) return d;
      return absYearSum(b, ys) - absYearSum(a, ys);
    });
    sorted.push(...run);
  }

  let inExpenses = false;
  const hasBanner = sorted.some(it =>
    isPropDevPlExpenseSectionStart(it.label) && !/^total\s+/i.test(normLabel(it.label)),
  );
  let pastIncome = !sorted.some(it => /^(income|other\s+income|gross\s+profit)$/i.test(normLabel(it.label)));

  const kept = sorted.filter(item => {
    const n = normLabel(item.label);
    if (isPropDevPlExpenseSectionStart(item.label) && !/^total\s+/i.test(n)) {
      inExpenses = true;
      pastIncome = true;
      return true;
    }
    if ((item.isTotal && /expenses?/i.test(n)) || item.isNetIncome || /^net\s+/i.test(n)) {
      inExpenses = false;
      return true;
    }
    if (
      /^(income|other\s+income|gross\s+profit)$/i.test(n)
      || /^total\s+(for\s+)?(income|other\s+income|gross\s+profit)/i.test(n)
    ) {
      pastIncome = item.isTotal || /^total\s+/i.test(n);
      return true;
    }
    if (isMajorPropDevStatementBanner(item.label) && !isPropDevPlExpenseSectionStart(item.label)) {
      inExpenses = false;
      return true;
    }
    if (isPropDevPlSortAnchor(item)) return true;
    if (isPropDevPinnedExpenseLabel(item.label)) return true;
    const expenseRow = hasBanner ? inExpenses : pastIncome;
    if (!expenseRow) return true;
    return ys.some(y => Math.abs(yearVal(item.values, y)) > STATEMENT_AMOUNT_EPS);
  });
  return arrangePropDevPinnedExpenses(kept, ys, { synthesizeMissing: opts.synthesizeMissingPinned });
}

/**
 * Construction Co statement tables. Mirrors the {@link tidyPropDevStatementRows}
 * category-driven fast path: when the upload has a Category column, that column is
 * already the single source of truth (label = category, blanks dropped, duplicates
 * summed at parse time), so the legacy label-pattern "club*" pipeline in
 * {@link tidyStatementRows} is skipped entirely — it exists only to guess categories
 * out of raw, uncategorized QBO account text and would otherwise re-split, re-tag, or
 * silently drop rows that are already correct. Falls back to {@link tidyStatementRows}
 * unchanged for uploads with no Category column.
 */
export function tidyConstructionStatementRows<T extends FinItemLike>(
  items: T[],
  years?: number[],
  sheet?: 'pl' | 'bs' | 'cf',
): T[] {
  if (!items.length) return items;
  if (!isCategoryDrivenDataset(items)) return tidyStatementRows(items, years, sheet);
  const ys = years?.length ? years : yearsFromItems(items);
  const withoutNoise = items.filter(item =>
    !/^round\s*[- ]?off$/i.test(normLabel(item.label)) && !isSubcategoryTotalForLabel(item.label),
  );
  const withoutZeros = withoutNoise.filter(item => {
    if (item.isNetIncome || item.isTotal) return true;
    if (isMajorPropDevStatementBanner(item.label)) return true;
    return ys.length
      ? ys.some(y => Math.abs(yearVal(item.values, y)) > STATEMENT_AMOUNT_EPS)
      : hasNonZeroStatementAmount(item, ys);
  });
  return orderEarnestMoneyAllowanceRows(dropEmptyStatementSectionHeaders(withoutZeros, ys));
}

/**
 * Prop Dev YoY / statement tables — keep every QBO detail line that has any amount.
 * Skips rental board clubbing (janitorial units, water & sewer → GBE, etc.) so
 * Properties / Rental companies stay on {@link tidyStatementRows} unchanged.
 */
/**
 * Generic "Total for X" QBO subtotal dedup: drop a "Total for <label>" row when
 * there's exactly one other (non-total, non-section) row in the statement whose
 * label matches <label> and whose values are identical across every year -- i.e.
 * the subtotal is purely repeating its own single child (e.g. "Loan to PVR
 * Ventures" + a redundant "Total for Loan to PVR Ventures" row), not summarizing
 * several lines. Genuine multi-child subtotals, and Total-for rows whose values
 * diverge from their single child, are left untouched.
 */
function dropRedundantTotalForRows<T extends FinItemLike>(items: T[], years: number[]): T[] {
  const totalForRe = /^total\s+for\s+(.+)$/i;
  const detailByLabel = new Map<string, T[]>();
  for (const item of items) {
    if (item.isTotal || item.isSectionHeader || item.isNetIncome) continue;
    const key = normLabel(item.label);
    const bucket = detailByLabel.get(key);
    if (bucket) bucket.push(item); else detailByLabel.set(key, [item]);
  }
  return items.filter(item => {
    const m = totalForRe.exec(item.label.trim());
    if (!m) return true;
    const matches = detailByLabel.get(normLabel(m[1]!));
    if (!matches || matches.length !== 1) return true;
    const child = matches[0]!;
    const sameValues = years.every(
      y => Math.abs(yearVal(item.values, y) - yearVal(child.values, y)) <= STATEMENT_AMOUNT_EPS,
    );
    return !sameValues;
  });
}

export function tidyPropDevStatementRows<T extends FinItemLike>(
  items: T[],
  years?: number[],
  sheet?: 'pl' | 'bs' | 'cf',
): T[] {
  if (!items.length) return items;
  const ys = years?.length ? years : yearsFromItems(items);

  // Category-driven upload: the Category column is already the single source of
  // truth (label = category, blanks dropped, duplicates summed — all done at parse
  // time). Skip the legacy label-pattern "club*" pipeline entirely; it exists only
  // to guess categories out of raw, uncategorized QBO account text and would just
  // re-split or re-tag rows that are already correct.
  if (isCategoryDrivenDataset(items)) {
    const withoutNoise = items.filter(item =>
      !/^round\s*[- ]?off$/i.test(normLabel(item.label))
      && !isTotalForCapitalLabel(item.label)
      && !isSubcategoryTotalForLabel(item.label),
    );
    const withoutZeros = withoutNoise.filter(item => {
      if (item.isNetIncome || item.isTotal) return true;
      if (isMajorPropDevStatementBanner(item.label)) return true;
      return ys.length
        ? ys.some(y => Math.abs(yearVal(item.values, y)) > STATEMENT_AMOUNT_EPS)
        : hasNonZeroStatementAmount(item, ys);
    });
    const cleaned = orderEarnestMoneyAllowanceRows(
      orderLandImprovementsInterestCapRows(
        dropEmptyStatementSectionHeaders(withoutZeros, ys),
      ),
    );
    if (sheet === 'cf') return orderCfSectionLines(cleaned);
    if (sheet !== 'pl') return cleaned;
    const sortYears = yearsFromItemsWithNonZeroValues(cleaned);
    // Never invent $0 placeholder rows for categories the company doesn't have.
    return sortPropDevPlExpenseRowsByAmount(
      cleaned, sortYears.length ? sortYears : ys, { synthesizeMissingPinned: false },
    );
  }

  const withoutNoise = items.filter(item => {
    if (isLoansToOthersLabel(item.label)) return false;
    const n = normLabel(item.label);
    if (/^round\s*[- ]?off$/i.test(n) || n === 'roundoff') return false;
    return true;
  });

  // Sanitize labels first so Income:Sale of Lot… can club with Sale of Property.
  const sanitized = withoutNoise.map(item => {
    const label = sanitizeStatementLineLabel(item.label);
    return label === item.label ? item : ({ ...item, label } as T);
  });

  // Partner / Owner capital + Sale of Property + Advertising + Commissions → GBE;
  // Property taxes absorbs Taxes paid / shipping-in-band / parcel tax detail.
  // Book Keeping Charges absorbs Accounting fees + Total for Book Keeping before
  // P&L "Total for …" rows are dropped.
  const clubbed = clubGeneralBusinessExpensesRows(
    clubCommissionsFeesRows(
      clubAdvertisingMarketingRows(
        clubBookKeepingChargesRows(
          clubPropertyTaxesRows(
            clubImprovementsRows(
              clubLandDetailRows(
                clubSaleOfPropertyRows(
                  clubPartnerInvestmentRows(
                    clubOwnersInvestmentRows(
                      clubPartnerInvestmentSectionRows(sanitized, sheet),
                    ),
                    sheet,
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );

  // Always drop Taxes paid / Total for Taxes paid (QBO band subtotal).
  // P&L also strips other subcategory "Total for …" noise.
  const withoutTaxPaidBand = clubbed.filter(item =>
    !isTaxesPaidBoardLineLabel(item.label)
    && !isTotalForLandLabel(item.label)
    && !isTotalForCapitalLabel(item.label),
  );
  // "Total for Loan to <Related Entity>" is always a single-account QBO subtotal band
  // (same family as "Total for Loans to others", already unconditionally dropped via
  // isLoansToOthersLabel) -- unlike "Total for Loans & Advances", which is a real
  // section total summing several distinct "Loan to X" lines, so it must stay.
  // Value-matched dropRedundantTotalForRows below still catches the rest (Other
  // Current Assets, Sound Making Device, …) when their single sibling line matches.
  const withoutBsSubtotals = sheet === 'bs'
    ? withoutTaxPaidBand.filter(item => !/^total\s+for\s+loans?\s+to\s+/i.test(normLabel(item.label)))
    : withoutTaxPaidBand;
  const withoutPlSubtotals = sheet === 'pl' || sheet == null
    ? withoutBsSubtotals.filter(item => !isPropDevDroppedPlSubtotalLabel(item.label))
    : withoutBsSubtotals;

  // Hard rule: if every active year would print "—", drop the line.
  // Do NOT keep empty QBO isSectionHeader shells (Loan Consulting fee, Escrow, …) just
  // because a later expense has amounts — those looked like blank rows for hours.
  const withoutZeros = withoutPlSubtotals.filter(item => {
    if (item.isNetIncome) return true;
    if (isMajorPropDevStatementBanner(item.label)) return true;
    if (sheet === 'bs' && isPartnerCapitalNameLine(item.label)) return true;
    if ((sheet === 'pl' || sheet == null) && isPropDevPinnedExpenseLabel(item.label)) return true;
    if (ys.length) return rowHasMeaningfulYearAmount(item, ys);
    return hasNonZeroStatementAmount(item, ys);
  });

  // Drop "Total for X" rows that just repeat their own single child line verbatim
  // (e.g. "Loan to PVR Ventures" + a redundant "Total for Loan to PVR Ventures").
  const withoutRedundantTotals = dropRedundantTotalForRows(withoutZeros, ys);

  // Drop major banners (Income / Expenses / …) that have no amount-bearing children left.
  const cleaned = orderLandImprovementsInterestCapRows(
    dropEmptyStatementSectionHeaders(withoutRedundantTotals, ys),
  );
  if (sheet === 'cf') return orderCfSectionLines(cleaned);
  if (sheet !== 'pl') return cleaned;
  const sortYears = yearsFromItemsWithNonZeroValues(cleaned);
  return sortPropDevPlExpenseRowsByAmount(cleaned, sortYears.length ? sortYears : ys);
}

/** Coerce string year keys to numbers so lookups are consistent after API round-trip. */
export function normalizeFinItem<T extends FinItemLike>(item: T): T {
  const values: Record<number, number> = {};
  for (const [k, v] of Object.entries(item.values ?? {})) {
    const y = Number(k);
    if (Number.isFinite(y) && y >= 1990 && y <= 2100) values[y] = yearVal(item.values, y);
  }
  return { ...item, values };
}

export function normalizeFinItems<T extends FinItemLike>(items: T[] | undefined): T[] {
  return (items ?? []).map(normalizeFinItem);
}

export interface MergeUploadedFinInput<T extends FinItemLike> {
  base: {
    companyName: string;
    years: number[];
    plFile: string;
    bsFile: string;
    cfFile?: string;
    uploadedAt: string;
    pl: T[];
    bs: T[];
    cf?: T[];
  } | null;
  parsed: {
    companyName: string;
    uploadedAt: string;
    years: number[];
    pl: T[];
    bs: T[];
    cf: T[];
  };
  hintType?: 'pl' | 'bs' | 'cf';
  fileName: string;
  companyName: string;
}

/** Replace the uploaded statement type; recompute years from actual line items (no stale year merge). */
export function mergeUploadedFinancials<T extends FinItemLike>(
  input: MergeUploadedFinInput<T>,
): MergeUploadedFinInput<T>['base'] & { pl: T[]; bs: T[]; cf: T[] } {
  const empty = {
    companyName: input.companyName,
    years: [] as number[],
    plFile: '',
    bsFile: '',
    cfFile: '',
    uploadedAt: '',
    pl: [] as T[],
    bs: [] as T[],
    cf: [] as T[],
  };
  const b = input.base ?? empty;
  const { parsed, hintType, fileName, companyName } = input;

  const plReplaced = (hintType === 'pl' || !hintType) && parsed.pl.length > 0;
  const bsReplaced = (hintType === 'bs' || !hintType) && parsed.bs.length > 0;
  const cfReplaced = (hintType === 'cf' || !hintType) && parsed.cf.length > 0;

  const pl = plReplaced ? normalizeFinItems(parsed.pl) : normalizeFinItems(b.pl);
  const bs = bsReplaced ? normalizeFinItems(parsed.bs) : normalizeFinItems(b.bs);
  const cf = cfReplaced ? normalizeFinItems(parsed.cf) : normalizeFinItems(b.cf ?? []);

  const fromItems = yearsFromItems([...pl, ...bs, ...cf]);
  const years = fromItems.length
    ? fromItems
    : [...new Set(parsed.years)].sort((a, b) => a - b);

  return {
    ...b,
    years,
    companyName: parsed.companyName || companyName,
    uploadedAt: parsed.uploadedAt || new Date().toISOString(),
    plFile: plReplaced ? fileName : b.plFile,
    bsFile: bsReplaced ? fileName : b.bsFile,
    cfFile: cfReplaced ? fileName : b.cfFile,
    pl,
    bs,
    cf,
  };
}
