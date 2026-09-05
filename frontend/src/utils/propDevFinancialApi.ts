/** Shared PropDev financial statement types + API mapping (Financials tab + Command Center). */

export interface PropDevFinItem {
  label: string;
  values: Record<number, number>;
  indent: number;
  monthlyValues?: Record<string, number>;
  isTotal: boolean;
  isSectionHeader: boolean;
  isNetIncome: boolean;
}

export interface PropDevUploadedFinancials {
  companyName: string;
  years: number[];
  plFile: string;
  bsFile: string;
  cfFile?: string;
  uploadedAt: string;
  pl: PropDevFinItem[];
  bs: PropDevFinItem[];
  cf?: PropDevFinItem[];
}

export const PROPDEV_FIN_LS_KEY = (companyId: string) => `propdev_upload_${companyId}`;

function shortFilename(name: string | undefined): string {
  if (!name) return '';
  const first = name.split(' + ')[0]?.split(' | ')[0]?.trim() ?? '';
  return first.length > 240 ? `${first.slice(0, 237)}…` : first;
}

export function apiFinToPropDevUploaded(fin: {
  company_name: string;
  years: number[];
  pl: PropDevFinItem[];
  bs: PropDevFinItem[];
  cf?: PropDevFinItem[];
  filename?: string;
  pl_filename?: string | null;
  bs_filename?: string | null;
  cf_filename?: string | null;
  uploaded_at?: string;
}): PropDevUploadedFinancials {
  const legacy = shortFilename(fin.filename);
  return {
    companyName: fin.company_name,
    years: fin.years,
    plFile: shortFilename(fin.pl_filename ?? undefined) || (fin.pl?.length ? legacy : ''),
    bsFile: shortFilename(fin.bs_filename ?? undefined) || (fin.bs?.length ? legacy : ''),
    cfFile: shortFilename(fin.cf_filename ?? undefined) || (fin.cf?.length ? legacy : undefined),
    uploadedAt: fin.uploaded_at || new Date().toISOString(),
    pl: fin.pl,
    bs: fin.bs,
    cf: fin.cf,
  };
}
