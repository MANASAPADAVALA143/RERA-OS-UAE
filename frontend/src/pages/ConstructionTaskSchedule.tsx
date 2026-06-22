import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, ChevronDown, ChevronUp, Plus, Trash2,
  ShieldAlert, CheckCircle2, Clock, CircleDot,
} from 'lucide-react';
import api from '../services/api';
import { Card, KpiCard } from '../components/ui/Card';
import { LoadingSkeleton } from '../components/ui/Table';
import { useAuth } from '../contexts/AuthContext';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface TaskRow {
  id: string;
  task_name: string;
  vendor_name: string | null;
  division: string | null;
  line_item_code: string | null;
  line_item_name: string | null;
  planned_start: string | null;
  planned_end: string | null;
  planned_duration_days: number | null;
  actual_start: string | null;
  actual_end: string | null;
  actual_duration_days: number | null;
  pct_complete: number;
  status: string;
  status_override_reason: string | null;
  is_critical: boolean;
  is_milestone: boolean;
  notes: string | null;
  has_inconsistency: boolean;
  inconsistency_detail: string | null;
  is_late: boolean;
  days_late: number;
}

interface DivisionGroup {
  division: string;
  task_count: number;
  completed_count: number;
  in_progress_count: number;
  late_count: number;
  inconsistency_count: number;
  tasks: TaskRow[];
}

interface Summary {
  total_tasks: number;
  completed: number;
  in_progress: number;
  not_started: number;
  late: number;
  inconsistencies: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function pctBar(pct: number) {
  const w = Math.round(pct * 100);
  const color = w === 100 ? 'bg-green-500' : w >= 50 ? 'bg-blue-500' : 'bg-amber-400';
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${w}%` }} />
      </div>
      <span className="text-xs text-gray-600">{w}%</span>
    </div>
  );
}

const STATUS_META: Record<string, { bg: string; text: string; label: string; Icon: typeof CheckCircle2 }> = {
  not_started: { bg: 'bg-gray-100',    text: 'text-gray-600',   label: 'Not Started', Icon: CircleDot },
  in_progress: { bg: 'bg-blue-100',    text: 'text-blue-700',   label: 'In Progress', Icon: Clock },
  complete:    { bg: 'bg-green-100',   text: 'text-green-700',  label: 'Completed',   Icon: CheckCircle2 },
  late:        { bg: 'bg-red-100',     text: 'text-red-700',    label: 'Late',        Icon: AlertTriangle },
  override:    { bg: 'bg-purple-100',  text: 'text-purple-700', label: 'Override',    Icon: ShieldAlert },
};

function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] ?? STATUS_META.not_started;
  const Icon = m.Icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${m.bg} ${m.text}`}>
      <Icon size={11} /> {m.label}
    </span>
  );
}

const STATUS_OPTIONS = ['not_started', 'in_progress', 'complete', 'late'];

const BLANK_FORM = {
  task_name: '',
  vendor_name: '',
  division: '',
  line_item_code: '',
  line_item_name: '',
  planned_start: '',
  planned_end: '',
  planned_duration_days: '',
  actual_start: '',
  actual_end: '',
  pct_complete: '0',
  status: 'not_started',
  is_critical: false,
  is_milestone: false,
  notes: '',
};

// ─────────────────────────────────────────────────────────────────────────────
// Override Panel (inline reason entry)
// ─────────────────────────────────────────────────────────────────────────────

function OverridePanel({
  task,
  onSave,
  onCancel,
}: {
  task: TaskRow;
  onSave: (taskId: string, reason: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) { setErr('Reason is required to override status.'); return; }
    setSaving(true);
    try {
      await onSave(task.id, reason.trim());
    } catch {
      setErr('Failed to save override.');
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-2 p-3 bg-purple-50 border border-purple-200 rounded-lg space-y-2">
      <p className="text-xs font-semibold text-purple-800">Override Status — "{task.task_name}"</p>
      {task.has_inconsistency && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-1.5">
          <AlertTriangle size={11} className="inline mr-1" />
          {task.inconsistency_detail}
        </p>
      )}
      <p className="text-xs text-purple-700">
        This will force the task status to <strong>Override</strong> and log your reason. Required field.
      </p>
      <textarea
        rows={2}
        value={reason}
        onChange={e => setReason(e.target.value)}
        placeholder="Reason for manual status override (e.g. inspected on-site, system data lag)"
        className="w-full px-2.5 py-1.5 text-xs border border-purple-300 rounded-lg focus:ring-2 focus:ring-purple-400/30 outline-none resize-none"
      />
      {err && <p className="text-xs text-red-600">{err}</p>}
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel}
          className="px-2.5 py-1 text-xs border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-100">
          Cancel
        </button>
        <button type="submit" disabled={saving}
          className="px-2.5 py-1 text-xs font-medium bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50">
          {saving ? 'Saving…' : 'Save Override'}
        </button>
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Task Row
// ─────────────────────────────────────────────────────────────────────────────

function TaskRowItem({
  task,
  canWrite,
  onOverrideSave,
  onDelete,
}: {
  task: TaskRow;
  canWrite: boolean;
  onOverrideSave: (taskId: string, reason: string) => Promise<void>;
  onDelete: (taskId: string) => void;
}) {
  const [showOverride, setShowOverride] = useState(false);

  const rowBorder = task.has_inconsistency
    ? 'border-l-4 border-l-amber-400 bg-amber-50/40'
    : task.is_late
    ? 'border-l-4 border-l-red-400 bg-red-50/20'
    : '';

  const varianceDays =
    task.actual_duration_days != null && task.planned_duration_days != null
      ? task.actual_duration_days - task.planned_duration_days
      : null;

  return (
    <div className={`px-4 py-3 ${rowBorder}`}>
      <div className="grid grid-cols-[1fr_80px_80px_60px_60px_60px_80px_110px_auto] gap-2 items-center text-sm">
        {/* Task name + line item */}
        <div className="min-w-0">
          <div className="font-medium text-gray-800 truncate flex items-center gap-1.5">
            {task.is_critical && <span className="text-red-500 text-xs font-bold">CRIT</span>}
            {task.is_milestone && <span className="text-purple-500 text-xs font-bold">MS</span>}
            {task.task_name}
          </div>
          {(task.line_item_code || task.line_item_name) && (
            <div className="text-xs text-gray-400 truncate mt-0.5">
              {task.line_item_code && <span className="font-mono">{task.line_item_code} </span>}
              {task.line_item_name}
            </div>
          )}
          {task.vendor_name && (
            <div className="text-xs text-gray-400 truncate">{task.vendor_name}</div>
          )}
        </div>
        {/* Planned start */}
        <div className="text-xs text-gray-500 whitespace-nowrap">{fmtDate(task.planned_start)}</div>
        {/* Planned end */}
        <div className="text-xs text-gray-500 whitespace-nowrap">{fmtDate(task.planned_end)}</div>
        {/* Planned days */}
        <div className="text-xs text-center text-gray-500">{task.planned_duration_days ?? '—'}</div>
        {/* Actual start */}
        <div className="text-xs text-gray-500 whitespace-nowrap">{fmtDate(task.actual_start)}</div>
        {/* Actual days */}
        <div className={`text-xs text-center font-medium ${
          varianceDays != null && varianceDays > 0 ? 'text-red-600' :
          varianceDays != null && varianceDays < 0 ? 'text-green-600' : 'text-gray-500'
        }`}>
          {task.actual_duration_days != null ? (
            <>
              {task.actual_duration_days}
              {varianceDays != null && varianceDays !== 0 && (
                <span className="ml-1 text-xs">({varianceDays > 0 ? '+' : ''}{varianceDays})</span>
              )}
            </>
          ) : '—'}
        </div>
        {/* % Done */}
        <div>{pctBar(task.pct_complete)}</div>
        {/* Status */}
        <div className="flex flex-col gap-1">
          <StatusBadge status={task.status} />
          {task.status === 'override' && task.status_override_reason && (
            <span className="text-xs text-purple-600 italic truncate max-w-[110px]" title={task.status_override_reason}>
              "{task.status_override_reason}"
            </span>
          )}
        </div>
        {/* Actions */}
        <div className="flex items-center gap-1 justify-end">
          {task.has_inconsistency && (
            <span title={task.inconsistency_detail ?? ''}>
              <AlertTriangle size={14} className="text-amber-500 shrink-0" />
            </span>
          )}
          {canWrite && (
            <>
              <button
                onClick={() => setShowOverride(v => !v)}
                className="text-xs px-2 py-0.5 border border-purple-300 rounded text-purple-700 hover:bg-purple-50 whitespace-nowrap"
                title="Override status with a logged reason"
              >
                Override
              </button>
              <button
                onClick={() => onDelete(task.id)}
                className="text-gray-300 hover:text-red-500 transition-colors ml-1"
              >
                <Trash2 size={13} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Inconsistency flag */}
      {task.has_inconsistency && !showOverride && (
        <div className="mt-1.5 flex items-start gap-1.5 text-xs text-amber-700">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span>{task.inconsistency_detail}</span>
        </div>
      )}

      {/* Override panel */}
      {showOverride && (
        <OverridePanel
          task={task}
          onSave={async (id, reason) => {
            await onOverrideSave(id, reason);
            setShowOverride(false);
          }}
          onCancel={() => setShowOverride(false)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Division Group (collapsible)
// ─────────────────────────────────────────────────────────────────────────────

function DivisionSection({
  group,
  canWrite,
  onOverrideSave,
  onDelete,
}: {
  group: DivisionGroup;
  canWrite: boolean;
  onOverrideSave: (taskId: string, reason: string) => Promise<void>;
  onDelete: (taskId: string) => void;
}) {
  const [expanded, setExpanded] = useState(group.task_count <= 12);

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
        onClick={() => setExpanded(e => !e)}
      >
        <span className="flex items-center gap-3 flex-wrap">
          <span className="font-semibold text-gray-800">{group.division}</span>
          <span className="text-xs text-gray-500 bg-white border border-gray-200 rounded-full px-2 py-0.5">
            {group.task_count} task{group.task_count !== 1 ? 's' : ''}
          </span>
          {group.completed_count > 0 && (
            <span className="text-xs bg-green-100 text-green-700 rounded-full px-2 py-0.5">
              {group.completed_count} done
            </span>
          )}
          {group.late_count > 0 && (
            <span className="text-xs bg-red-100 text-red-700 rounded-full px-2 py-0.5">
              {group.late_count} late
            </span>
          )}
          {group.inconsistency_count > 0 && (
            <span className="text-xs bg-amber-100 text-amber-700 rounded-full px-2 py-0.5 flex items-center gap-1">
              <AlertTriangle size={10} /> {group.inconsistency_count} flagged
            </span>
          )}
        </span>
        {expanded ? <ChevronUp size={16} className="text-gray-400 shrink-0" /> : <ChevronDown size={16} className="text-gray-400 shrink-0" />}
      </button>

      {expanded && (
        <>
          {/* Column header */}
          <div className="grid grid-cols-[1fr_80px_80px_60px_60px_60px_80px_110px_auto] gap-2 px-4 py-2 bg-gray-50 border-t border-gray-100 text-xs font-semibold text-gray-400 uppercase tracking-wide">
            <div>Task / Line Item</div>
            <div>Pln Start</div>
            <div>Pln End</div>
            <div className="text-center">Pln d</div>
            <div>Act Start</div>
            <div className="text-center">Act d</div>
            <div>% Done</div>
            <div>Status</div>
            <div />
          </div>
          <div className="divide-y divide-gray-100">
            {group.tasks.map(t => (
              <TaskRowItem
                key={t.id}
                task={t}
                canWrite={canWrite}
                onOverrideSave={onOverrideSave}
                onDelete={onDelete}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Gantt chart
// ─────────────────────────────────────────────────────────────────────────────

const PX_PER_DAY = 5;          // pixels per calendar day
const LABEL_W = 230;           // sticky label column width
const ROW_H = 46;              // height per task row
const GROUP_H = 32;            // height of division group header rows
const HEADER_H = 40;           // month axis height at top
const BAR_PLAN_Y = 8;          // planned bar top offset within row
const BAR_PLAN_H = 14;         // planned bar height
const BAR_ACT_Y = 26;          // actual bar top offset within row
const BAR_ACT_H = 12;          // actual bar height

// Status → fill color for planned bars
const STATUS_FILL: Record<string, string> = {
  not_started: '#cbd5e1',   // slate-300
  in_progress:  '#3b82f6',  // blue-500
  complete:     '#22c55e',  // green-500
  late:         '#ef4444',  // red-500
  override:     '#a855f7',  // purple-500
};

function toDay(isoStr: string | null | undefined): Date | null {
  if (!isoStr) return null;
  return new Date(isoStr + 'T00:00:00');
}

function daysFrom(a: Date, b: Date) {
  return (b.getTime() - a.getTime()) / 86_400_000;
}

function addDays(d: Date, n: number) {
  return new Date(d.getTime() + n * 86_400_000);
}

/** Generate monthly tick marks between start and end */
function monthTicks(start: Date, end: Date): { x: number; label: string }[] {
  const ticks: { x: number; label: string }[] = [];
  const cur = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cur <= end) {
    const x = daysFrom(start, cur) * PX_PER_DAY;
    ticks.push({
      x,
      label: cur.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
    });
    cur.setMonth(cur.getMonth() + 1);
  }
  return ticks;
}

// ── Tooltip state ─────────────────────────────────────────────────────────────
interface GanttTooltip {
  task: TaskRow;
  x: number;
  y: number;
}

// ── GanttView ─────────────────────────────────────────────────────────────────

function GanttView({ groups }: { groups: DivisionGroup[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [tooltip, setTooltip] = useState<GanttTooltip | null>(null);

  // Determine total date range across all tasks
  const allTasks = groups.flatMap(g => g.tasks);
  let minDate: Date | null = null;
  let maxDate: Date | null = null;
  for (const t of allTasks) {
    for (const d of [t.planned_start, t.planned_end, t.actual_start, t.actual_end]) {
      const dt = toDay(d);
      if (!dt) continue;
      if (!minDate || dt < minDate) minDate = dt;
      if (!maxDate || dt > maxDate) maxDate = dt;
    }
  }
  if (!minDate || !maxDate) {
    return <p className="text-sm text-gray-400 py-8 text-center">No dated tasks to display.</p>;
  }

  // Add padding
  const chartStart = addDays(minDate, -7);
  const chartEnd   = addDays(maxDate, 14);
  const totalDays  = Math.ceil(daysFrom(chartStart, chartEnd));
  const svgW = totalDays * PX_PER_DAY;

  function xOf(d: Date) {
    return Math.round(daysFrom(chartStart, d) * PX_PER_DAY);
  }

  const ticks = monthTicks(chartStart, chartEnd);

  // Build rows with group headers
  type GanttRow =
    | { kind: 'group'; group: DivisionGroup }
    | { kind: 'task'; task: TaskRow; groupDiv: string };

  const rows: GanttRow[] = [];
  for (const g of groups) {
    rows.push({ kind: 'group', group: g });
    if (!collapsed[g.division]) {
      for (const t of g.tasks) rows.push({ kind: 'task', task: t, groupDiv: g.division });
    }
  }

  const svgH = HEADER_H + rows.reduce((h, r) => h + (r.kind === 'group' ? GROUP_H : ROW_H), 0);

  // Compute y offsets
  const yOf: number[] = [];
  let y = HEADER_H;
  for (const r of rows) {
    yOf.push(y);
    y += r.kind === 'group' ? GROUP_H : ROW_H;
  }

  function handleBarClick(task: TaskRow, evt: React.MouseEvent) {
    const rect = (evt.currentTarget as SVGElement).closest('.gantt-scroll-container')?.getBoundingClientRect();
    setTooltip(prev => prev?.task.id === task.id ? null : {
      task,
      x: evt.clientX - (rect?.left ?? 0) + (scrollRef.current?.scrollLeft ?? 0),
      y: evt.clientY - (rect?.top ?? 0) + HEADER_H,
    });
  }

  return (
    <div className="relative rounded-xl border border-gray-200 overflow-hidden bg-white">
      <div
        ref={scrollRef}
        className="gantt-scroll-container overflow-x-auto"
        style={{ position: 'relative' }}
        onClick={e => {
          // Close tooltip when clicking outside a bar
          if ((e.target as SVGElement).tagName !== 'rect') setTooltip(null);
        }}
      >
        <div style={{ display: 'flex', minWidth: LABEL_W + svgW }}>
          {/* ── Sticky label column ── */}
          <div
            style={{
              position: 'sticky', left: 0, zIndex: 10,
              width: LABEL_W, minWidth: LABEL_W, flexShrink: 0,
              background: 'white', borderRight: '1px solid #e5e7eb',
            }}
          >
            {/* Header cell */}
            <div
              style={{ height: HEADER_H, borderBottom: '2px solid #e5e7eb' }}
              className="flex items-end px-3 pb-1"
            >
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Division / Task</span>
            </div>

            {/* Label rows */}
            {rows.map((r, i) => {
              const h = r.kind === 'group' ? GROUP_H : ROW_H;
              if (r.kind === 'group') {
                return (
                  <button
                    key={`g-${r.group.division}`}
                    style={{ height: h, display: 'flex', alignItems: 'center', width: '100%' }}
                    className="px-3 bg-gray-50 hover:bg-gray-100 border-b border-gray-200 text-left gap-2"
                    onClick={() => setCollapsed(c => ({ ...c, [r.group.division]: !c[r.group.division] }))}
                  >
                    {collapsed[r.group.division]
                      ? <ChevronDown size={13} className="text-gray-400 shrink-0" />
                      : <ChevronUp size={13} className="text-gray-400 shrink-0" />
                    }
                    <span className="text-xs font-semibold text-gray-700 truncate">{r.group.division}</span>
                    <span className="text-xs text-gray-400 ml-auto shrink-0">{r.group.task_count}</span>
                  </button>
                );
              }
              const t = r.task;
              return (
                <div
                  key={`l-${t.id}`}
                  style={{ height: h, borderBottom: '1px solid #f3f4f6', display: 'flex', alignItems: 'center' }}
                  className={`px-3 gap-1 ${t.has_inconsistency ? 'bg-amber-50' : ''}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-gray-700 truncate flex items-center gap-1">
                      {t.is_critical && <span className="text-red-500 font-bold text-[10px]">C</span>}
                      {t.is_milestone && <span className="text-purple-500 font-bold text-[10px]">M</span>}
                      {t.has_inconsistency && <AlertTriangle size={11} className="text-amber-500 shrink-0" />}
                      <span className="truncate">{t.task_name}</span>
                    </div>
                    {t.line_item_code && (
                      <div className="text-[10px] text-gray-400 font-mono truncate">{t.line_item_code}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── SVG Gantt bars ── */}
          <svg
            width={svgW}
            height={svgH}
            style={{ flexShrink: 0, display: 'block' }}
          >
            {/* ── Month grid lines and labels ── */}
            {ticks.map((tick, i) => (
              <g key={i}>
                <line
                  x1={tick.x} y1={0} x2={tick.x} y2={svgH}
                  stroke="#e5e7eb" strokeWidth={1}
                />
                <text
                  x={tick.x + 4} y={HEADER_H - 8}
                  fontSize={10} fill="#9ca3af" fontFamily="sans-serif"
                >
                  {tick.label}
                </text>
              </g>
            ))}

            {/* Header bottom border */}
            <line x1={0} y1={HEADER_H} x2={svgW} y2={HEADER_H} stroke="#e5e7eb" strokeWidth={2} />

            {/* ── Today line ── */}
            {(() => {
              const todayX = xOf(new Date());
              return todayX >= 0 && todayX <= svgW ? (
                <g>
                  <line x1={todayX} y1={HEADER_H} x2={todayX} y2={svgH} stroke="#f97316" strokeWidth={1.5} strokeDasharray="4 3" />
                  <text x={todayX + 3} y={HEADER_H + 12} fontSize={9} fill="#f97316" fontFamily="sans-serif">Today</text>
                </g>
              ) : null;
            })()}

            {/* ── Rows ── */}
            {rows.map((r, i) => {
              const rowY = yOf[i];
              const h = r.kind === 'group' ? GROUP_H : ROW_H;

              if (r.kind === 'group') {
                return (
                  <rect key={`gr-${r.group.division}`}
                    x={0} y={rowY} width={svgW} height={h}
                    fill="#f9fafb"
                  />
                );
              }

              const t = r.task;
              const ps = toDay(t.planned_start);
              const pe = toDay(t.planned_end);
              const as_ = toDay(t.actual_start);
              const ae = toDay(t.actual_end);

              const fill = STATUS_FILL[t.status] ?? STATUS_FILL.not_started;
              const inconsistentFill = t.has_inconsistency ? '#fbbf24' : fill; // amber if flagged

              return (
                <g key={`r-${t.id}`}>
                  {/* Row stripe */}
                  <rect x={0} y={rowY} width={svgW} height={h}
                    fill={t.has_inconsistency ? '#fffbeb' : i % 2 === 0 ? '#ffffff' : '#fafafa'}
                  />
                  <line x1={0} y1={rowY + h} x2={svgW} y2={rowY + h} stroke="#f3f4f6" strokeWidth={1} />

                  {/* ── Planned bar ── */}
                  {ps && pe && (() => {
                    const x1 = xOf(ps);
                    const x2 = xOf(pe);
                    const w = Math.max(x2 - x1, 4);
                    return (
                      <g>
                        <rect
                          x={x1} y={rowY + BAR_PLAN_Y}
                          width={w} height={BAR_PLAN_H}
                          rx={3}
                          fill={inconsistentFill}
                          opacity={0.9}
                          style={{ cursor: 'pointer' }}
                          onClick={e => handleBarClick(t, e)}
                        />
                        {/* Progress overlay */}
                        {t.pct_complete > 0 && (
                          <rect
                            x={x1} y={rowY + BAR_PLAN_Y}
                            width={Math.max(w * t.pct_complete, 2)} height={BAR_PLAN_H}
                            rx={3}
                            fill="white" opacity={0.25}
                          />
                        )}
                        {/* Inconsistency triangle marker */}
                        {t.has_inconsistency && (
                          <polygon
                            points={`${x1},${rowY + BAR_PLAN_Y} ${x1 + 8},${rowY + BAR_PLAN_Y} ${x1},${rowY + BAR_PLAN_Y + 8}`}
                            fill="#ef4444"
                          />
                        )}
                        {/* Label inside bar if wide enough */}
                        {w > 60 && (
                          <text
                            x={x1 + 5} y={rowY + BAR_PLAN_Y + BAR_PLAN_H - 3}
                            fontSize={9} fill="white" fontFamily="sans-serif"
                            clipPath={`inset(0 0 0 0)`}
                          >
                            {`${Math.round(t.pct_complete * 100)}%`}
                          </text>
                        )}
                      </g>
                    );
                  })()}

                  {/* ── Actual bar (shown only when actual dates exist) ── */}
                  {as_ && ae && (() => {
                    const x1 = xOf(as_);
                    const x2 = xOf(ae);
                    const w = Math.max(x2 - x1, 4);
                    return (
                      <rect
                        x={x1} y={rowY + BAR_ACT_Y}
                        width={w} height={BAR_ACT_H}
                        rx={2}
                        fill="none"
                        stroke={fill}
                        strokeWidth={2}
                        opacity={0.85}
                        style={{ cursor: 'pointer' }}
                        onClick={e => handleBarClick(t, e)}
                      />
                    );
                  })()}

                  {/* Actual start only (in progress) */}
                  {as_ && !ae && (() => {
                    const x1 = xOf(as_);
                    const todayX = xOf(new Date());
                    const w = Math.max(todayX - x1, 4);
                    return (
                      <rect
                        x={x1} y={rowY + BAR_ACT_Y}
                        width={w} height={BAR_ACT_H}
                        rx={2}
                        fill="none"
                        stroke={fill}
                        strokeWidth={2}
                        strokeDasharray="4 2"
                        opacity={0.75}
                      />
                    );
                  })()}
                </g>
              );
            })}
          </svg>
        </div>

        {/* ── Tooltip ── */}
        {tooltip && (
          <div
            style={{
              position: 'absolute',
              left: Math.min(tooltip.x + 12, (scrollRef.current?.scrollLeft ?? 0) + (scrollRef.current?.clientWidth ?? 600) - 240),
              top: tooltip.y + 8,
              zIndex: 50,
            }}
            className="bg-gray-900 text-white text-xs rounded-lg shadow-xl p-3 w-56 pointer-events-none"
          >
            <p className="font-semibold mb-1">{tooltip.task.task_name}</p>
            {tooltip.task.line_item_code && (
              <p className="text-gray-400 font-mono mb-1">{tooltip.task.line_item_code} · {tooltip.task.line_item_name}</p>
            )}
            <div className="space-y-0.5 mt-1 border-t border-gray-700 pt-1">
              <p><span className="text-gray-400">Planned:</span> {fmtDate(tooltip.task.planned_start)} → {fmtDate(tooltip.task.planned_end)}</p>
              {tooltip.task.actual_start && (
                <p><span className="text-gray-400">Actual:</span> {fmtDate(tooltip.task.actual_start)} → {fmtDate(tooltip.task.actual_end) ?? 'ongoing'}</p>
              )}
              <p><span className="text-gray-400">% Done:</span> {Math.round(tooltip.task.pct_complete * 100)}%</p>
              {tooltip.task.is_late && (
                <p className="text-red-400">{tooltip.task.days_late}d behind schedule</p>
              )}
              {tooltip.task.has_inconsistency && (
                <p className="text-amber-400 mt-1">{tooltip.task.inconsistency_detail}</p>
              )}
              {tooltip.task.status_override_reason && (
                <p className="text-purple-300 italic">Override: "{tooltip.task.status_override_reason}"</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 px-4 py-2 border-t border-gray-100 bg-gray-50 text-xs text-gray-500">
        <span className="font-medium text-gray-600">Legend:</span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-8 h-3 rounded" style={{ background: STATUS_FILL.complete }} /> Completed
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-8 h-3 rounded" style={{ background: STATUS_FILL.in_progress }} /> In Progress
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-8 h-3 rounded" style={{ background: STATUS_FILL.not_started }} /> Not Started
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-8 h-3 rounded" style={{ background: STATUS_FILL.late }} /> Late
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded border-2" style={{ borderColor: STATUS_FILL.complete }} /> Actual dates
        </span>
        <span className="flex items-center gap-1.5 text-amber-600">
          <AlertTriangle size={11} /> Inconsistency flag
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-8 h-0.5 bg-orange-400" style={{ borderTop: '1.5px dashed #f97316' }} /> Today
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

export default function ConstructionTaskSchedule({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const canWrite = user?.role === 'admin' || user?.role === 'write';

  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<DivisionGroup[]>([]);
  const [summary, setSummary] = useState<Summary>({
    total_tasks: 0, completed: 0, in_progress: 0, not_started: 0, late: 0, inconsistencies: 0,
  });
  const [divisions, setDivisions] = useState<string[]>([]);
  const [error, setError] = useState('');

  const [view, setView] = useState<'table' | 'gantt'>('table');

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...BLANK_FORM });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.get(`/api/real-estate/construction/projects/${projectId}/task-schedule`);
      setGroups(res.data.groups ?? []);
      setSummary(res.data.summary ?? {});
    } catch {
      setError('Failed to load task schedule.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  // Load divisions from SOV for cascading
  useEffect(() => {
    if (!projectId) return;
    api.get('/api/real-estate/costs/trades', { params: { project_id: projectId } })
      .then(res => {
        const divs = Array.from(new Set(
          (res.data as { division_label: string | null }[])
            .map(t => t.division_label).filter(Boolean)
        )) as string[];
        setDivisions(divs);
      })
      .catch(() => {});
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  async function handleOverrideSave(taskId: string, reason: string) {
    await api.put(`/api/real-estate/construction/task-schedule/${taskId}`, { override_reason: reason });
    await load();
  }

  async function handleDelete(taskId: string) {
    if (!confirm('Delete this task?')) return;
    await api.delete(`/api/real-estate/construction/task-schedule/${taskId}`);
    await load();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    if (!form.task_name.trim()) { setFormError('Task name is required.'); return; }

    setSaving(true);
    try {
      await api.post(`/api/real-estate/construction/projects/${projectId}/task-schedule`, {
        task_name: form.task_name.trim(),
        vendor_name: form.vendor_name.trim() || null,
        division: form.division || null,
        line_item_code: form.line_item_code.trim() || null,
        line_item_name: form.line_item_name.trim() || null,
        planned_start: form.planned_start || null,
        planned_end: form.planned_end || null,
        planned_duration_days: form.planned_duration_days ? parseInt(form.planned_duration_days) : null,
        actual_start: form.actual_start || null,
        actual_end: form.actual_end || null,
        pct_complete: parseFloat(form.pct_complete) / 100,
        status: form.status,
        is_critical: form.is_critical,
        is_milestone: form.is_milestone,
        notes: form.notes.trim() || null,
      });
      setForm({ ...BLANK_FORM });
      setShowForm(false);
      await load();
    } catch (err: any) {
      setFormError(err?.response?.data?.detail || 'Failed to create task.');
    } finally {
      setSaving(false);
    }
  }

  if (!projectId) return <p className="text-gray-400 text-sm">Select a project to view task schedule.</p>;

  return (
    <div className="space-y-6">
      {/* KPI strip + view toggle */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 flex-1 min-w-0">
          <KpiCard label="Total Tasks" value={String(summary.total_tasks)} />
          <KpiCard label="Completed" value={String(summary.completed)} />
          <KpiCard label="In Progress" value={String(summary.in_progress)} />
          <KpiCard label="Not Started" value={String(summary.not_started)} />
          <KpiCard label="Late" value={String(summary.late)} accent={summary.late > 0} />
          <KpiCard label="Flagged" value={String(summary.inconsistencies)} accent={summary.inconsistencies > 0} />
        </div>

        {/* View toggle */}
        <div className="flex items-center gap-1 p-1 bg-gray-100 rounded-lg shrink-0 self-start mt-1">
          <button
            onClick={() => setView('table')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              view === 'table'
                ? 'bg-white text-gray-800 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Table
          </button>
          <button
            onClick={() => setView('gantt')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              view === 'gantt'
                ? 'bg-white text-gray-800 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Gantt
          </button>
        </div>
      </div>

      {summary.inconsistencies > 0 && (
        <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
          <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-800">
              {summary.inconsistencies} task{summary.inconsistencies !== 1 ? 's' : ''} with status inconsistency
            </p>
            <p className="text-xs text-amber-700 mt-0.5">
              Tasks marked Completed without 100% done or an actual end date are flagged in amber.
              Use <strong>Override Status</strong> with a reason to force a state, or update the task data.
            </p>
          </div>
        </div>
      )}

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}

      {/* Create form */}
      <Card
        title="Task Schedule"
        action={canWrite ? (
          <button
            onClick={() => setShowForm(v => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
          >
            <Plus size={13} /> Add Task
          </button>
        ) : undefined}
      >
        {showForm && (
          <form onSubmit={handleSubmit} className="mb-6 p-4 bg-gray-50 border border-gray-200 rounded-xl space-y-4">
            <h3 className="text-sm font-semibold text-gray-700">New Task</h3>
            {formError && <p className="text-xs text-red-600">{formError}</p>}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Task Name *</label>
                <input value={form.task_name} onChange={e => setForm(f => ({ ...f, task_name: e.target.value }))}
                  placeholder="e.g. Pour Level 3 Slab"
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary/30 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Vendor</label>
                <input value={form.vendor_name} onChange={e => setForm(f => ({ ...f, vendor_name: e.target.value }))}
                  placeholder="Subcontractor name"
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary/30 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Division (SOV)</label>
                <select value={form.division} onChange={e => setForm(f => ({ ...f, division: e.target.value }))}
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary/30 outline-none">
                  <option value="">— None —</option>
                  {divisions.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Line Item Code</label>
                <input value={form.line_item_code} onChange={e => setForm(f => ({ ...f, line_item_code: e.target.value }))}
                  placeholder="e.g. 5.13.5"
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary/30 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Line Item Name</label>
                <input value={form.line_item_name} onChange={e => setForm(f => ({ ...f, line_item_name: e.target.value }))}
                  placeholder="e.g. Erection of steel members"
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary/30 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Planned Start</label>
                <input type="date" value={form.planned_start} onChange={e => setForm(f => ({ ...f, planned_start: e.target.value }))}
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary/30 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Planned End</label>
                <input type="date" value={form.planned_end} onChange={e => setForm(f => ({ ...f, planned_end: e.target.value }))}
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary/30 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Planned Days (override)</label>
                <input type="number" min="1" value={form.planned_duration_days}
                  onChange={e => setForm(f => ({ ...f, planned_duration_days: e.target.value }))}
                  placeholder="Auto from dates"
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary/30 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Actual Start</label>
                <input type="date" value={form.actual_start} onChange={e => setForm(f => ({ ...f, actual_start: e.target.value }))}
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary/30 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Actual End</label>
                <input type="date" value={form.actual_end} onChange={e => setForm(f => ({ ...f, actual_end: e.target.value }))}
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary/30 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">% Done</label>
                <input type="number" min="0" max="100" step="1" value={form.pct_complete}
                  onChange={e => setForm(f => ({ ...f, pct_complete: e.target.value }))}
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary/30 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
                <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary/30 outline-none">
                  {STATUS_OPTIONS.map(s => (
                    <option key={s} value={s}>{STATUS_META[s]?.label ?? s}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-4 pt-5">
                <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                  <input type="checkbox" checked={form.is_critical}
                    onChange={e => setForm(f => ({ ...f, is_critical: e.target.checked }))}
                    className="rounded" />
                  Critical Path
                </label>
                <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                  <input type="checkbox" checked={form.is_milestone}
                    onChange={e => setForm(f => ({ ...f, is_milestone: e.target.checked }))}
                    className="rounded" />
                  Milestone
                </label>
              </div>
              <div className="sm:col-span-3">
                <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
                <textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary/30 outline-none resize-none" />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button type="button"
                onClick={() => { setShowForm(false); setFormError(''); setForm({ ...BLANK_FORM }); }}
                className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-100">
                Cancel
              </button>
              <button type="submit" disabled={saving}
                className="px-3 py-1.5 text-xs font-medium bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50">
                {saving ? 'Saving…' : 'Add Task'}
              </button>
            </div>
          </form>
        )}

        {loading ? (
          <LoadingSkeleton rows={6} />
        ) : groups.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-400 text-sm">No task schedule entries yet.</p>
            {canWrite && (
              <button onClick={() => setShowForm(true)}
                className="mt-3 text-xs text-primary hover:underline">
                + Add your first task
              </button>
            )}
          </div>
        ) : view === 'gantt' ? (
          <GanttView groups={groups} />
        ) : (
          <div className="space-y-3">
            {groups.map(g => (
              <DivisionSection
                key={g.division}
                group={g}
                canWrite={canWrite}
                onOverrideSave={handleOverrideSave}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
