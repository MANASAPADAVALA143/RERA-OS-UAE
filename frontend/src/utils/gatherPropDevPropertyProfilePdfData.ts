/**
 * Property Dev → Property Profile detail page → Export PDF.
 * Single-property identity/land/tax/ownership/improvements/loans snapshot.
 */
import type { CompanyData } from '../contexts/PropertyDevContext';
import type { SectionPdfBlock, SectionPdfPayload } from './gatherSectionPdfData';

function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  }).format(n);
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  const parsed = new Date(d);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function buildPropDevPropertyProfilePdfPayload(company: CompanyData): SectionPdfPayload {
  const p = company.property;

  const blocks: SectionPdfBlock[] = [{
    heading: 'Property Snapshot',
    kpis: [
      { label: 'Acres', value: p.totalAcres ? p.totalAcres.toFixed(1) : '—' },
      { label: 'Lots', value: String(p.totalLots ?? 0) },
      { label: 'Land Use', value: p.landUseType || '—' },
      { label: 'Status', value: p.currentStatus || '—' },
      { label: 'Annual Property Tax', value: fmtUsd(p.propertyTaxAnnual) },
    ],
    tables: [{
      title: 'Property Identity',
      headers: ['Field', 'Value'],
      rows: [
        ['Property Name', p.name || company.name],
        ['Address', p.address || '—'],
        ['City / State / ZIP', [p.city, p.state, p.zipCode].filter(Boolean).join(', ') || '—'],
        ['County', p.county || '—'],
        ['Zoning', p.zoning || '—'],
        ['Legal Description', p.legalDescription || '—'],
        ['Entity', company.name],
      ],
    }],
  }];

  blocks.push({
    heading: 'Tax Information',
    tables: [{
      title: 'Tax Information',
      headers: ['Field', 'Value'],
      rows: [
        ['Tax Parcel ID', p.taxParcelId || '—'],
        ['Annual Property Tax', fmtUsd(p.propertyTaxAnnual)],
        ['Assessment Year', p.taxAssessmentYear != null ? String(p.taxAssessmentYear) : '—'],
        ['Assessed Value', fmtUsd(p.taxAssessedValue)],
        ['Exemptions', p.taxExemptions || '—'],
        ['Due Date', fmtDate(p.taxDueDate)],
      ],
    }],
  });

  blocks.push({
    heading: 'Ownership History',
    tables: [{
      title: 'Ownership History',
      headers: ['Field', 'Value'],
      rows: [
        ['Previous Owner', p.previousOwnerName || '—'],
        ['Previous Owner Entity', p.previousOwnerEntity || '—'],
        ['Acquisition Date', fmtDate(p.acquisitionDate)],
        ['Acquisition Price', fmtUsd(p.acquisitionPrice)],
        ['Acquisition Type', p.acquisitionType || '—'],
        ['Title Company', p.titleCompany || '—'],
        ['Deed Reference', p.deedReference || '—'],
      ],
    }],
  });

  if (company.propertyImprovements.length) {
    blocks.push({
      heading: 'Improvement Log',
      tables: [{
        title: 'Improvement Log',
        headers: ['Type', 'Cost', 'Date', 'Contractor'],
        rows: company.propertyImprovements.map(i => [
          i.improvementType, fmtUsd(i.improvementCost), fmtDate(i.improvementDate), i.contractorName || '—',
        ]),
      }],
    });
  }

  if (company.loans.length) {
    blocks.push({
      heading: 'Linked Loans',
      tables: [{
        title: 'Linked Loans',
        headers: ['Lender', 'Outstanding', 'Rate', 'EMI', 'Maturity', 'Status'],
        rows: company.loans.map(l => [
          l.bank, fmtUsd(l.balance), l.interestRate ? `${(l.interestRate * 100).toFixed(2)}%` : '—',
          fmtUsd(l.emi), fmtDate(l.maturityDate), l.status,
        ]),
      }],
    });
  }

  return {
    tab: 'propdev-property-profile',
    sectionTitle: 'Property Profile',
    fileSectionName: 'PropertyProfile',
    entityLabel: p.name || company.name,
    periodLabel: 'Current',
    generatedAt: new Date().toISOString(),
    sourceNote: `Property Dev → Properties → ${company.name}`,
    kpis: [],
    charts: [],
    blocks,
  };
}
