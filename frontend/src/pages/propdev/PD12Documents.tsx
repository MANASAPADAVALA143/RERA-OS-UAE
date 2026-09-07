import { useState, useRef, useCallback } from 'react';
import { usePropDev } from '../../contexts/PropertyDevContext';
import type { ComplianceDoc } from '../../contexts/PropertyDevContext';
import {
  CheckCircle2, AlertCircle, Clock, XCircle,
  Plus, X, Search, Eye, Download, Trash2, Edit2,
  ChevronRight, ChevronDown, Folder, FolderOpen, Upload,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DocItem {
  id: string; name: string; folder: string; subfolder: string;
  company: string; docType: string; uploadDate: string; uploadedBy: string;
  fileSize: string; fileType: 'pdf' | 'excel' | 'word' | 'image' | 'other';
  expiryDate: string | null;
  status: 'Valid' | 'Expiring Soon' | 'Expired' | 'Pending Review' | 'Missing';
  notes: string; isCompliance?: boolean; complianceId?: string;
}

type FolderPath = { folder: string; subfolder: string | null };

// ─── Static config ────────────────────────────────────────────────────────────

const FOLDER_TREE: { id: string; name: string; subfolders: string[] }[] = [
  { id: 'agreements', name: 'Agreements',  subfolders: ['Partner Agreements','JV Agreements','Loan Agreements','Sale Agreements'] },
  { id: 'financials', name: 'Financials',  subfolders: ['P&L Statements','Balance Sheets','Tax Returns','Audit Reports'] },
  { id: 'sales',      name: 'Sales',       subfolders: ['Sale Deeds','Purchase Contracts','Commission Invoices','Closing Statements'] },
  { id: 'legal',      name: 'Legal',       subfolders: ['Title Documents','NOCs','Plot Approvals','Legal Opinions'] },
  { id: 'loans',      name: 'Loans',       subfolders: ['Sanction Letters','Amortisation Schedules','Bank Statements'] },
  { id: 'other',      name: 'Other',       subfolders: ['Miscellaneous'] },
];

const DOC_TYPES = ['Agreement','Financial','Legal','Loan','Sale','Other'];

const STATUS_CFG: Record<DocItem['status'], { color: string; bg: string; border: string; Icon: typeof CheckCircle2 }> = {
  'Valid':          { color:'text-green-700',  bg:'bg-green-100',  border:'border-green-200',  Icon: CheckCircle2 },
  'Expiring Soon':  { color:'text-amber-700',  bg:'bg-amber-100',  border:'border-amber-200',  Icon: Clock },
  'Expired':        { color:'text-red-700',    bg:'bg-red-100',    border:'border-red-200',    Icon: XCircle },
  'Pending Review': { color:'text-blue-700',   bg:'bg-blue-100',   border:'border-blue-200',   Icon: Clock },
  'Missing':        { color:'text-gray-600',   bg:'bg-gray-100',   border:'border-gray-200',   Icon: AlertCircle },
};

const FILE_ICON: Record<DocItem['fileType'], { emoji: string; color: string }> = {
  pdf:   { emoji: '📄', color: 'text-red-600'    },
  excel: { emoji: '📊', color: 'text-green-600'  },
  word:  { emoji: '📝', color: 'text-blue-600'   },
  image: { emoji: '🖼️', color: 'text-purple-600' },
  other: { emoji: '📁', color: 'text-gray-500'   },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mapTypeToPath(type: string): { folder: string; subfolder: string } {
  const t = type.toLowerCase();
  if (t.includes('title'))                           return { folder:'Legal',      subfolder:'Title Documents'      };
  if (t.includes('noc'))                             return { folder:'Legal',      subfolder:'NOCs'                 };
  if (t.includes('approval') || t.includes('plot'))  return { folder:'Legal',      subfolder:'Plot Approvals'       };
  if (t.includes('legal') || t.includes('opinion'))  return { folder:'Legal',      subfolder:'Legal Opinions'       };
  if (t.includes('partner'))                         return { folder:'Agreements', subfolder:'Partner Agreements'   };
  if (t.includes('jv') || t.includes('joint'))       return { folder:'Agreements', subfolder:'JV Agreements'        };
  if (t.includes('loan') && t.includes('agree'))     return { folder:'Agreements', subfolder:'Loan Agreements'      };
  if (t.includes('sale') && t.includes('agree'))     return { folder:'Agreements', subfolder:'Sale Agreements'      };
  if (t.includes('purchase'))                        return { folder:'Agreements', subfolder:'Sale Agreements'      };
  if (t.includes('sale deed'))                       return { folder:'Sales',      subfolder:'Sale Deeds'           };
  if (t.includes('closing'))                         return { folder:'Sales',      subfolder:'Closing Statements'   };
  if (t.includes('commission'))                      return { folder:'Sales',      subfolder:'Commission Invoices'  };
  if (t.includes('balance'))                         return { folder:'Financials', subfolder:'Balance Sheets'       };
  if (t.includes('tax'))                             return { folder:'Financials', subfolder:'Tax Returns'          };
  if (t.includes('audit'))                           return { folder:'Financials', subfolder:'Audit Reports'        };
  if (t.includes('p&l') || t.includes('income'))    return { folder:'Financials', subfolder:'P&L Statements'       };
  if (t.includes('sanction'))                        return { folder:'Loans',      subfolder:'Sanction Letters'     };
  if (t.includes('amort'))                           return { folder:'Loans',      subfolder:'Amortisation Schedules'};
  if (t.includes('bank statement'))                  return { folder:'Loans',      subfolder:'Bank Statements'      };
  return { folder:'Other', subfolder:'Miscellaneous' };
}

function inferFileType(name: string): DocItem['fileType'] {
  const n = name.toLowerCase();
  if (n.endsWith('.pdf')) return 'pdf';
  if (n.match(/\.xlsx?$/)) return 'excel';
  if (n.match(/\.(doc|docx)$/)) return 'word';
  if (n.match(/\.(jpg|jpeg|png|gif|webp)$/)) return 'image';
  return 'other';
}

function daysUntil(date: string | null): number | null {
  if (!date) return null;
  return Math.floor((new Date(date).getTime() - Date.now()) / 86400000);
}

function complianceToDocItem(d: ComplianceDoc): DocItem {
  const { folder, subfolder } = mapTypeToPath(d.type);
  const days = daysUntil(d.expiryDate);
  let status: DocItem['status'] = d.status === 'Missing' ? 'Missing' : d.status === 'Pending' ? 'Pending Review' : d.status;
  if (d.expiryDate && days !== null) {
    if (days < 0) status = 'Expired';
    else if (days <= 30) status = 'Expiring Soon';
  }
  return {
    id: d.id, name: d.type, folder, subfolder,
    company: d.property ?? 'Unknown', docType: 'Legal',
    uploadDate: d.issueDate, uploadedBy: 'System',
    fileSize: '—', fileType: 'other',
    expiryDate: d.expiryDate,
    status, notes: `Counterparty: ${d.counterparty}`,
    isCompliance: true, complianceId: d.id,
  };
}

// ─── Main Component ───────────────────────────────────────────────────────────

const BLANK_FORM = { name:'', folder:'Legal', subfolder:'Title Documents', company:'', docType:'Legal', expiryDate:'', notes:'' };

export default function PD12Documents() {
  const { docs, setDocs, companies, selectedCompanyId } = usePropDev();

  // Folder navigation
  const [selectedPath, setSelectedPath] = useState<FolderPath>({ folder:'All Documents', subfolder:null });
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['legal','agreements']));
  const [customFolders, setCustomFolders] = useState<string[]>([]);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  // Uploaded docs (local state — richer than ComplianceDoc)
  const [uploadedDocs, setUploadedDocs] = useState<DocItem[]>([]);

  // Upload modal
  const [showUpload, setShowUpload] = useState(false);
  const [uploadForm, setUploadForm] = useState({ ...BLANK_FORM });
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Rename
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Search / filter
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | DocItem['status']>('all');
  const [statFilter, setStatFilter] = useState<'all' | 'expiring' | 'expired' | 'pending'>('all');

  const scopedCompanyName = selectedCompanyId !== 'all'
    ? companies.find(c => c.id === selectedCompanyId)?.name
    : null;

  // Existing compliance docs mapped into DocItem format
  const complianceDocs: DocItem[] = docs.map(complianceToDocItem);

  // All documents combined
  const allDocs: DocItem[] = [...complianceDocs, ...uploadedDocs];

  // Folder counts helper
  const countIn = useCallback((folder: string, subfolder?: string) =>
    allDocs.filter(d => d.folder === folder && (!subfolder || d.subfolder === subfolder)).length,
    [allDocs]);

  // Stat counts
  const statCounts = {
    total:   allDocs.length,
    expiring: allDocs.filter(d => d.status === 'Expiring Soon').length,
    expired: allDocs.filter(d => d.status === 'Expired').length,
    pending: allDocs.filter(d => d.status === 'Pending Review').length,
  };

  // Right-panel filtered docs
  const visibleDocs = allDocs.filter(d => {
    if (statFilter === 'expiring' && d.status !== 'Expiring Soon') return false;
    if (statFilter === 'expired'  && d.status !== 'Expired')       return false;
    if (statFilter === 'pending'  && d.status !== 'Pending Review') return false;

    if (selectedPath.folder !== 'All Documents') {
      if (d.folder !== selectedPath.folder) return false;
      if (selectedPath.subfolder && d.subfolder !== selectedPath.subfolder) return false;
    }
    if (scopedCompanyName && d.company !== scopedCompanyName) return false;
    if (filterStatus  !== 'all' && d.status   !== filterStatus)  return false;

    if (search) {
      const q = search.toLowerCase();
      if (!d.name.toLowerCase().includes(q) &&
          !d.notes.toLowerCase().includes(q) &&
          !d.company.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  // Expiry alerts (docs expiring in ≤30 days)
  const expiryAlerts = allDocs.filter(d => {
    const days = daysUntil(d.expiryDate);
    return days !== null && days >= 0 && days <= 30;
  });

  // Folder toggle
  const toggleFolder = (id: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // Upload handler
  const handleUpload = () => {
    if (!uploadForm.name || !uploadForm.folder) return;
    const ft = uploadFile ? inferFileType(uploadFile.name) : 'other';
    const newDoc: DocItem = {
      id: `ud-${Date.now()}`,
      name: uploadForm.name,
      folder: uploadForm.folder,
      subfolder: uploadForm.subfolder || 'Miscellaneous',
      company: uploadForm.company || 'All Companies',
      docType: uploadForm.docType,
      uploadDate: new Date().toISOString().split('T')[0],
      uploadedBy: 'Current User',
      fileSize: uploadFile ? `${(uploadFile.size / 1024).toFixed(1)} KB` : '—',
      fileType: ft,
      expiryDate: uploadForm.expiryDate || null,
      status: 'Pending Review',
      notes: uploadForm.notes,
    };
    setUploadedDocs(prev => [...prev, newDoc]);
    setShowUpload(false);
    setUploadFile(null);
    setUploadForm({ ...BLANK_FORM });
  };

  const handleDeleteDoc = (id: string) => {
    if (uploadedDocs.find(d => d.id === id)) {
      setUploadedDocs(prev => prev.filter(d => d.id !== id));
    } else {
      setDocs(docs.filter(d => d.id !== id));
    }
  };

  const handleRenameConfirm = (id: string) => {
    setUploadedDocs(prev => prev.map(d => d.id === id ? { ...d, name: renameValue } : d));
    setRenamingId(null);
    setRenameValue('');
  };

  const openUploadInFolder = () => {
    setUploadForm(f => ({
      ...f,
      folder: selectedPath.folder === 'All Documents' ? 'Legal' : selectedPath.folder,
      subfolder: selectedPath.subfolder ?? '',
    }));
    setShowUpload(true);
  };

  const addCustomFolder = () => {
    if (!newFolderName.trim()) return;
    setCustomFolders(prev => [...prev, newFolderName.trim()]);
    setNewFolderName('');
    setShowNewFolder(false);
  };

  // Path breadcrumb string
  const breadcrumb = selectedPath.folder === 'All Documents'
    ? 'All Documents'
    : selectedPath.subfolder
      ? `${selectedPath.folder} / ${selectedPath.subfolder}`
      : selectedPath.folder;

  const allFolderNames = [...FOLDER_TREE.map(f => f.name), ...customFolders];
  const subfolderOptions = FOLDER_TREE.find(f => f.name === uploadForm.folder)?.subfolders ?? [];
  const companyNames = companies.map(c => c.name);

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div>
        <PropDevPageHeader title="Documents & Compliance" />
        <p className="text-sm text-gray-500 mt-0.5">Organised document library with folder structure</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { key:'all',      label:'Total Docs',    value: statCounts.total,    color:'text-gray-900',   bg:'bg-white',          border:'border-gray-200'  },
          { key:'expiring', label:'Expiring Soon', value: statCounts.expiring, color:'text-amber-700',  bg:'bg-amber-50',        border:'border-amber-200' },
          { key:'expired',  label:'Expired',       value: statCounts.expired,  color:'text-red-700',    bg:'bg-red-50',          border:'border-red-200'   },
          { key:'pending',  label:'Pending Review',value: statCounts.pending,  color:'text-blue-700',   bg:'bg-blue-50',         border:'border-blue-200'  },
        ].map(({ key, label, value, color, bg, border }) => (
          <button
            key={key}
            onClick={() => setStatFilter(prev => prev === key ? 'all' : key as typeof statFilter)}
            className={`rounded-xl border-2 p-4 text-left transition-all hover:shadow-sm ${bg} ${border} ${statFilter === key ? 'ring-2 ring-offset-1 ring-amber-400' : ''}`}
          >
            <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
            <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
          </button>
        ))}
      </div>

      {/* Expiry alerts */}
      {expiryAlerts.length > 0 && (
        <div className="space-y-1.5">
          {expiryAlerts.map(d => {
            const days = daysUntil(d.expiryDate)!;
            return (
              <div key={d.id} className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                <Clock size={14} className="shrink-0" />
                <span>⚠️ <strong>{d.name}</strong> expires in {days} day{days !== 1 ? 's' : ''} ({d.expiryDate})</span>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Split layout ──────────────────────────────────────────────────── */}
      <div className="flex gap-4 min-h-[600px]">

        {/* LEFT PANEL — Folder Tree */}
        <div className="hidden md:flex flex-col w-60 shrink-0 bg-gray-50 rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 bg-white">
            <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">📁 Document Library</p>
          </div>

          <div className="flex-1 overflow-y-auto py-2">
            {/* All Documents */}
            <button
              onClick={() => setSelectedPath({ folder:'All Documents', subfolder:null })}
              className={`w-full flex items-center gap-2 px-4 py-2 text-sm transition-colors ${
                selectedPath.folder === 'All Documents' && !selectedPath.subfolder
                  ? 'bg-amber-100 text-amber-900 font-semibold'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              <Folder size={14} className="text-amber-600 shrink-0" />
              <span className="flex-1 text-left">All Documents</span>
              <span className="text-xs bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded-full">{allDocs.length}</span>
            </button>

            <div className="mt-1 border-t border-gray-200 pt-1">
              {FOLDER_TREE.map(folder => {
                const isExpanded = expandedFolders.has(folder.id);
                const isFolderActive = selectedPath.folder === folder.name && !selectedPath.subfolder;
                const folderCount = countIn(folder.name);
                return (
                  <div key={folder.id}>
                    {/* Top-level folder */}
                    <div className="flex items-center">
                      <button
                        onClick={() => { toggleFolder(folder.id); setSelectedPath({ folder: folder.name, subfolder: null }); }}
                        className={`flex-1 flex items-center gap-2 px-4 py-2 text-sm transition-colors ${
                          isFolderActive ? 'bg-amber-100 text-amber-900 font-semibold' : 'text-gray-700 hover:bg-gray-100'
                        }`}
                      >
                        {isExpanded
                          ? <FolderOpen size={14} className="text-amber-600 shrink-0" />
                          : <Folder     size={14} className="text-amber-600 shrink-0" />
                        }
                        <span className="flex-1 text-left">{folder.name}</span>
                        <span className="text-xs bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded-full mr-1">{folderCount}</span>
                        {isExpanded ? <ChevronDown size={12} className="text-gray-400" /> : <ChevronRight size={12} className="text-gray-400" />}
                      </button>
                    </div>

                    {/* Subfolders */}
                    {isExpanded && (
                      <div className="ml-4 border-l border-gray-200">
                        {folder.subfolders.map(sub => {
                          const isSubActive = selectedPath.folder === folder.name && selectedPath.subfolder === sub;
                          const subCount = countIn(folder.name, sub);
                          return (
                            <button
                              key={sub}
                              onClick={() => setSelectedPath({ folder: folder.name, subfolder: sub })}
                              className={`w-full flex items-center gap-2 pl-3 pr-4 py-1.5 text-xs transition-colors ${
                                isSubActive ? 'bg-amber-100 text-amber-800 font-semibold' : 'text-gray-600 hover:bg-gray-100'
                              }`}
                            >
                              <span className="text-gray-400">📄</span>
                              <span className="flex-1 text-left">{sub}</span>
                              {subCount > 0 && (
                                <span className="text-xs bg-gray-200 text-gray-500 px-1.5 py-0.5 rounded-full">{subCount}</span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Custom folders */}
              {customFolders.map(cf => (
                <button
                  key={cf}
                  onClick={() => setSelectedPath({ folder: cf, subfolder: null })}
                  className={`w-full flex items-center gap-2 px-4 py-2 text-sm transition-colors ${
                    selectedPath.folder === cf ? 'bg-amber-100 text-amber-900 font-semibold' : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <Folder size={14} className="text-amber-600 shrink-0" />
                  <span className="flex-1 text-left">{cf}</span>
                </button>
              ))}
            </div>
          </div>

          {/* New folder */}
          <div className="border-t border-gray-200 p-3">
            {showNewFolder ? (
              <div className="flex gap-1">
                <input
                  autoFocus
                  value={newFolderName}
                  onChange={e => setNewFolderName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addCustomFolder(); if (e.key === 'Escape') setShowNewFolder(false); }}
                  className="flex-1 border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400"
                  placeholder="Folder name…"
                />
                <button onClick={addCustomFolder} className="text-amber-700 hover:text-amber-900 px-1.5">✓</button>
                <button onClick={() => setShowNewFolder(false)} className="text-gray-400 hover:text-gray-600 px-1"><X size={12} /></button>
              </div>
            ) : (
              <button
                onClick={() => setShowNewFolder(true)}
                className="w-full flex items-center gap-1.5 text-xs text-gray-500 hover:text-amber-700 py-1 transition-colors"
              >
                <Plus size={13} /> New Folder
              </button>
            )}
          </div>
        </div>

        {/* Mobile folder dropdown */}
        <div className="md:hidden w-full mb-2">
          <select
            value={selectedPath.subfolder ? `${selectedPath.folder}/${selectedPath.subfolder}` : selectedPath.folder}
            onChange={e => {
              const val = e.target.value;
              if (val === 'All Documents') { setSelectedPath({ folder:'All Documents', subfolder:null }); return; }
              const [f, s] = val.split('/');
              setSelectedPath({ folder: f, subfolder: s ?? null });
            }}
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
          >
            <option value="All Documents">📁 All Documents ({allDocs.length})</option>
            {FOLDER_TREE.map(f => (
              <optgroup key={f.id} label={`📁 ${f.name}`}>
                {f.subfolders.map(s => (
                  <option key={s} value={`${f.name}/${s}`}>{s}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        {/* RIGHT PANEL — File content area */}
        <div className="flex-1 flex flex-col gap-4 min-w-0">

          {/* Panel header */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex-1">
              <p className="text-sm text-gray-500">📁 {breadcrumb}</p>
              <p className="text-xs text-gray-400 mt-0.5">{visibleDocs.length} document{visibleDocs.length !== 1 ? 's' : ''}</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={openUploadInFolder}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0E3B36] text-white rounded-lg text-xs font-medium hover:bg-[#1A5249] transition-colors"
              >
                <Upload size={13} /> Upload File
              </button>
            </div>
          </div>

          {/* Search + filters */}
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search documents…"
                className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value as typeof filterStatus)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400"
            >
              <option value="all">All Statuses</option>
              <option value="Valid">✅ Valid</option>
              <option value="Expiring Soon">⚠️ Expiring Soon</option>
              <option value="Expired">🔴 Expired</option>
              <option value="Pending Review">📋 Pending Review</option>
            </select>
          </div>

          {/* Empty state / upload zone */}
          {visibleDocs.length === 0 ? (
            <div
              className={`border-2 border-dashed rounded-xl py-16 flex flex-col items-center justify-center gap-3 cursor-pointer transition-colors ${
                isDragOver ? 'border-amber-400 bg-amber-50' : 'border-gray-200 bg-gray-50 hover:border-gray-300'
              }`}
              onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={e => {
                e.preventDefault(); setIsDragOver(false);
                const file = e.dataTransfer.files[0];
                if (file) { setUploadFile(file); setUploadForm(f => ({ ...f, name: file.name.replace(/\.[^.]+$/, '') })); setShowUpload(true); }
              }}
              onClick={openUploadInFolder}
            >
              <p className="text-5xl">📎</p>
              <div className="text-center">
                <p className="text-gray-700 font-medium">Drop files here</p>
                <p className="text-gray-400 text-sm mt-1">or click to browse</p>
              </div>
              <p className="text-xs text-gray-400 bg-white border border-gray-200 px-3 py-1 rounded-full">
                PDF · DOC · XLSX · JPG accepted
              </p>
            </div>
          ) : (
            /* File list table */
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                      <th className="px-4 py-3 text-left">File Name</th>
                      <th className="px-4 py-3 text-left">Type</th>
                      <th className="px-4 py-3 text-left">Folder</th>
                      <th className="px-4 py-3 text-left">Company</th>
                      <th className="px-4 py-3 text-left">Date</th>
                      <th className="px-4 py-3 text-left">Expiry</th>
                      <th className="px-4 py-3 text-center">Status</th>
                      <th className="px-4 py-3 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {visibleDocs.map(doc => {
                      const fi = FILE_ICON[doc.fileType];
                      const sc = STATUS_CFG[doc.status];
                      const days = daysUntil(doc.expiryDate);
                      const isRenaming = renamingId === doc.id;
                      return (
                        <tr key={doc.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className={`text-base shrink-0 ${fi.color}`}>{fi.emoji}</span>
                              {isRenaming ? (
                                <input
                                  autoFocus
                                  value={renameValue}
                                  onChange={e => setRenameValue(e.target.value)}
                                  onKeyDown={e => { if (e.key === 'Enter') handleRenameConfirm(doc.id); if (e.key === 'Escape') setRenamingId(null); }}
                                  className="border-b border-amber-400 bg-transparent text-sm focus:outline-none w-full"
                                />
                              ) : (
                                <span className="font-medium text-gray-900 truncate">{doc.name}</span>
                              )}
                            </div>
                            {doc.notes && <p className="text-xs text-gray-400 mt-0.5 pl-6 truncate">{doc.notes}</p>}
                          </td>
                          <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{doc.docType}</td>
                          <td className="px-4 py-3">
                            <div className="flex flex-col gap-0.5">
                              <span className="text-xs text-gray-600">{doc.folder}</span>
                              <span className="text-xs text-gray-400">{doc.subfolder}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-gray-600 whitespace-nowrap text-xs">{doc.company}</td>
                          <td className="px-4 py-3 text-gray-500 whitespace-nowrap text-xs">{doc.uploadDate}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-xs">
                            {doc.expiryDate ? (
                              <span className={days !== null && days <= 30 ? 'text-amber-600 font-medium' : days !== null && days < 0 ? 'text-red-600 font-medium' : 'text-gray-500'}>
                                {doc.expiryDate}
                                {days !== null && days >= 0 && days <= 30 && <span className="ml-1 text-amber-600">({days}d)</span>}
                              </span>
                            ) : (
                              <span className="text-gray-300">No expiry</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${sc.bg} ${sc.color}`}>
                              <sc.Icon size={10} />
                              {doc.status}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5 justify-center">
                              <button title="View" className="text-gray-400 hover:text-blue-600 transition-colors"><Eye size={14} /></button>
                              <button title="Download" className="text-gray-400 hover:text-green-600 transition-colors"><Download size={14} /></button>
                              {!doc.isCompliance && (
                                <button
                                  title="Rename"
                                  onClick={() => { setRenamingId(doc.id); setRenameValue(doc.name); }}
                                  className="text-gray-400 hover:text-amber-600 transition-colors"
                                ><Edit2 size={14} /></button>
                              )}
                              <button
                                title="Delete"
                                onClick={() => handleDeleteDoc(doc.id)}
                                className="text-gray-400 hover:text-red-600 transition-colors"
                              ><Trash2 size={14} /></button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-2 border-t border-gray-100 bg-gray-50 text-xs text-gray-500">
                {visibleDocs.length} of {allDocs.length} document{allDocs.length !== 1 ? 's' : ''}
                {statFilter !== 'all' && <button onClick={() => setStatFilter('all')} className="ml-2 text-amber-600 hover:underline">Clear filter</button>}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Upload Modal ───────────────────────────────────────────────────── */}
      {showUpload && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b">
              <h3 className="font-bold text-gray-900 text-lg">Upload Document</h3>
              <button onClick={() => { setShowUpload(false); setUploadFile(null); }}><X size={18} className="text-gray-400 hover:text-gray-600" /></button>
            </div>
            <div className="p-5 space-y-4">
              {/* Folder selectors */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Folder</label>
                  <select
                    value={uploadForm.folder}
                    onChange={e => setUploadForm(f => ({ ...f, folder: e.target.value, subfolder: '' }))}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  >
                    {allFolderNames.map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Sub-folder</label>
                  <select
                    value={uploadForm.subfolder}
                    onChange={e => setUploadForm(f => ({ ...f, subfolder: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  >
                    <option value="">— Select —</option>
                    {subfolderOptions.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              {/* Company */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Company</label>
                <select
                  value={uploadForm.company}
                  onChange={e => setUploadForm(f => ({ ...f, company: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                >
                  <option value="">All Companies</option>
                  {companyNames.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>

              {/* Drop zone */}
              <div
                className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                  isDragOver ? 'border-amber-400 bg-amber-50' : uploadFile ? 'border-green-300 bg-green-50' : 'border-gray-200 bg-gray-50 hover:border-gray-300'
                }`}
                onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={e => {
                  e.preventDefault(); setIsDragOver(false);
                  const file = e.dataTransfer.files[0];
                  if (file) { setUploadFile(file); setUploadForm(f => ({ ...f, name: file.name.replace(/\.[^.]+$/, '') })); }
                }}
                onClick={() => fileInputRef.current?.click()}
              >
                <input ref={fileInputRef} type="file" className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (file) { setUploadFile(file); setUploadForm(f => ({ ...f, name: file.name.replace(/\.[^.]+$/, '') })); }
                  }}
                />
                {uploadFile ? (
                  <div className="flex items-center justify-center gap-2 text-green-700">
                    <span className="text-2xl">{FILE_ICON[inferFileType(uploadFile.name)].emoji}</span>
                    <div className="text-left">
                      <p className="font-medium text-sm">{uploadFile.name}</p>
                      <p className="text-xs text-gray-500">{(uploadFile.size / 1024).toFixed(1)} KB</p>
                    </div>
                    <button onClick={e => { e.stopPropagation(); setUploadFile(null); }} className="ml-2 text-gray-400 hover:text-red-500"><X size={16} /></button>
                  </div>
                ) : (
                  <>
                    <p className="text-3xl mb-2">📎</p>
                    <p className="text-gray-600 text-sm font-medium">Drop file here or click to browse</p>
                    <p className="text-gray-400 text-xs mt-1">PDF · DOC · XLSX · JPG accepted</p>
                  </>
                )}
              </div>

              {/* Doc name */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Document Name <span className="text-red-500">*</span></label>
                <input
                  value={uploadForm.name}
                  onChange={e => setUploadForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  placeholder="e.g. Partner Agreement — 2025"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* Doc type */}
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Document Type</label>
                  <select
                    value={uploadForm.docType}
                    onChange={e => setUploadForm(f => ({ ...f, docType: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  >
                    {DOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                {/* Expiry date */}
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Expiry Date <span className="text-gray-400">(optional)</span></label>
                  <input
                    type="date"
                    value={uploadForm.expiryDate}
                    onChange={e => setUploadForm(f => ({ ...f, expiryDate: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
                <textarea
                  rows={2}
                  value={uploadForm.notes}
                  onChange={e => setUploadForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
                  placeholder="Optional notes about this document…"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 p-5 border-t bg-gray-50">
              <button onClick={() => { setShowUpload(false); setUploadFile(null); }} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-100">Cancel</button>
              <button
                onClick={handleUpload}
                disabled={!uploadForm.name}
                className="px-5 py-2 text-sm bg-[#0E3B36] text-white rounded-lg hover:bg-[#1A5249] disabled:opacity-50 font-medium"
              >
                Upload Document
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
