import { LocaleType, mergeLocales, Univer, UniverInstanceType } from '@univerjs/core';
import { FUniver } from '@univerjs/core/facade';
import DesignZhCN from '@univerjs/design/locale/zh-CN';
import { UniverDocsPlugin } from '@univerjs/docs';
import { UniverDocsUIPlugin } from '@univerjs/docs-ui';
import DocsUIZhCN from '@univerjs/docs-ui/locale/zh-CN';
import { UniverFormulaEnginePlugin } from '@univerjs/engine-formula';
import { UniverRenderEnginePlugin } from '@univerjs/engine-render';
import { UniverSheetsPlugin } from '@univerjs/sheets';
import { UniverSheetsFilterPlugin } from '@univerjs/sheets-filter';
import { UniverSheetsFilterUIPlugin } from '@univerjs/sheets-filter-ui';
import SheetsFilterUIZhCN from '@univerjs/sheets-filter-ui/locale/zh-CN';
import { UniverSheetsFormulaPlugin } from '@univerjs/sheets-formula';
import SheetsZhCN from '@univerjs/sheets/locale/zh-CN';
import { UniverSheetsNumfmtPlugin } from '@univerjs/sheets-numfmt';
import { UniverSheetsSortPlugin } from '@univerjs/sheets-sort';
import { UniverSheetsSortUIPlugin } from '@univerjs/sheets-sort-ui';
import SheetsSortUIZhCN from '@univerjs/sheets-sort-ui/locale/zh-CN';
import { UniverSheetsTablePlugin } from '@univerjs/sheets-table';
import { UniverSheetsUIPlugin } from '@univerjs/sheets-ui';
import SheetsUIZhCN from '@univerjs/sheets-ui/locale/zh-CN';
import { UniverUIPlugin } from '@univerjs/ui';
import UIZhCN from '@univerjs/ui/locale/zh-CN';

import '@univerjs/design/lib/index.css';
import '@univerjs/ui/lib/index.css';
import '@univerjs/docs-ui/lib/index.css';
import '@univerjs/sheets-ui/lib/index.css';
import '@univerjs/sheets-filter-ui/lib/index.css';
import '@univerjs/sheets-sort-ui/lib/index.css';
import '@univerjs/sheets/facade';
import '@univerjs/ui/facade';
import '@univerjs/sheets-ui/facade';
import '@univerjs/engine-formula/facade';
import '@univerjs/sheets-numfmt/facade';
import '@univerjs/sheets-filter/facade';
import '@univerjs/sheets-sort/facade';
import '@univerjs/sheets-table/facade';
import xlsxHeaderTemplate from '../xlsx_headers.json';

type Patient = Record<string, string>;
type DrugRow = Record<string, string>;
type FollowupRow = Record<string, string>;
type RawRow = Record<string, string>;

interface RawTable {
  name: string;
  columns: string[];
  rows: RawRow[];
}

interface FollowupPayload {
  generated_at: string;
  xlsx_headers?: string[];
  patients: Patient[];
  drug_sensitivity: DrugRow[];
  followups: FollowupRow[];
  raw_tables?: RawTable[];
  changed_raw_tables?: string[];
}

const HEADER_ROWS = 3;
const EXTRA_EMPTY_ROWS = 5;
const HIDDEN_COLUMNS_KEY = 'hidden_columns_v2';
const REMOTE_POLL_INTERVAL_MS = 15000;
const SELF_SAVE_GRACE_MS = 12000;
const RAW_HEADER_ROWS = 1;
const RAW_SHEET_PREFIX = 'seatable-raw-';
const expanded = localStorage.getItem('drug_columns_collapsed') === '0';

const summaryEl = document.getElementById('summary')!;
const statusEl = document.getElementById('status')!;
const toggleEl = document.getElementById('toggleDrugs') as HTMLButtonElement;
const reloadEl = document.getElementById('reloadFull') as HTMLButtonElement;
const saveSyncEl = document.getElementById('saveSync') as HTMLButtonElement;
const refreshSyncEl = document.getElementById('refreshSync') as HTMLButtonElement;
const expandAllEl = document.getElementById('expandAll') as HTMLButtonElement;
const collapseAllEl = document.getElementById('collapseAll') as HTMLButtonElement;
const toggleClinicalGroupEl = document.getElementById('toggleClinicalGroup') as HTMLButtonElement;
const togglePathologyGroupEl = document.getElementById('togglePathologyGroup') as HTMLButtonElement;
const toggleMolecularGroupEl = document.getElementById('toggleMolecularGroup') as HTMLButtonElement;
const toggleImagingGroupEl = document.getElementById('toggleImagingGroup') as HTMLButtonElement;
const toggleDrugGroupEl = document.getElementById('toggleDrugGroup') as HTMLButtonElement;
const toggleFollowupGroupEl = document.getElementById('toggleFollowupGroup') as HTMLButtonElement;
const columnPanelToggleEl = document.getElementById('columnPanelToggle') as HTMLButtonElement;
const columnPanelEl = document.getElementById('columnPanel')!;

let currentPayload: FollowupPayload | null = null;
let isSaving = false;
let isRefreshing = false;
let lastSavedWorkbookHash = '';
let lastRemoteSignature = '';
let lastLocalSaveAt = 0;

const xlsxHeaders = xlsxHeaderTemplate as string[];
const headerAliases: Record<string, string> = {
  '类器官样本号': 'patient_id',
  '取样时间 (年-月-日）': '取样时间',
  '分子分型 （基因检测结果）': '分子分型',
  '初治/复发': '病程',
  '如复发-->治疗史': '治疗史',
  '术后治疗方案 （年月日：方案，疗程，备注）': '术后治疗方案',
  '用药后疗效评估结果 （年月日：增大/缩小/...）如多次复查，直至修改方案或直至临床结局描述日期': '疗效评估',
  '临床结局 （年月日：失访/调整方案（+如非疗效原因，备注原因）/死亡/...）': '临床结局',
  '疗效评估结果所需MR/CT评估结果 （用药后评估时间+评估意见）2': '影像评估',
  '药敏结果': '药敏结果原文',
};

interface ColumnMeta {
  key: string;
  label: string;
  group: ColumnGroup;
  groupLabel: string;
  sourceKey?: string;
  drugName?: string;
  drugField?: string;
}

type ColumnGroup = 'basic' | 'clinical' | 'pathology' | 'molecular' | 'imaging' | 'drug' | 'followup';
interface DetailColumn {
  key: string;
  label: string;
  sourceKey?: string;
  patterns?: string[];
  width?: number;
}

const baseColumns = ['患者ID', '姓名', '性别', '年龄', '取样时间', '取样方式', '癌种'];
const clinicalColumns: DetailColumn[] = [
  { key: 'clinical-diagnosis', label: '临床诊断', sourceKey: '临床诊断结果', width: 140 },
  { key: 'course', label: '病程', sourceKey: '病程', width: 96 },
  { key: 'treatment-history', label: '治疗史', sourceKey: '治疗史', width: 260 },
];
const pathologyColumns: DetailColumn[] = [
  { key: 'pathology-diagnosis', label: '病理诊断', sourceKey: '病理诊断结果', width: 160 },
  { key: 'ihc-raw', label: '免疫组化原文', sourceKey: '免疫组化结果', width: 260 },
];
const molecularColumns: DetailColumn[] = [
  { key: 'molecular-subtype', label: '分子分型', sourceKey: '分子分型', width: 160 },
  { key: 'idh', label: 'IDH', patterns: ['IDH-1', 'IDH1', 'IDH-2', 'IDH2'], width: 120 },
  { key: 'mgmt', label: 'MGMT', patterns: ['MGMT'], width: 120 },
  { key: 'tert', label: 'TERT', patterns: ['TERT'], width: 120 },
  { key: '1p19q', label: '1p/19q', patterns: ['1p/19q', '1p', '19q'], width: 120 },
  { key: 'atrx', label: 'ATRX', patterns: ['ATRX'], width: 120 },
  { key: 'p53', label: 'P53', patterns: ['P53', 'TP53'], width: 120 },
  { key: 'ki67', label: 'Ki67', patterns: ['Ki67'], width: 120 },
  { key: 'h3k27m', label: 'H3K27M', patterns: ['H3K27M'], width: 120 },
  { key: 'braf', label: 'BRAF', patterns: ['BRAF'], width: 120 },
];
const imagingColumns: DetailColumn[] = [
  { key: 'imaging', label: '影像评估', sourceKey: '影像评估', width: 260 },
];
const detailColumns = [...clinicalColumns, ...pathologyColumns, ...molecularColumns, ...imagingColumns];
const globalColumns = ['随访条数', '随访摘要', '药敏结果原文'];
const drugTypes = [
  '阿霉素',
  '阿霉素,磷酰胺氮芥',
  '艾日布林',
  '安罗替尼',
  '安罗替尼,阿托伐他汀',
  '安罗替尼,替莫唑胺',
  '安罗替尼,替尼泊苷',
  '伯瑞替尼',
  '多西他赛,吉西他滨',
  '甲基苄肼',
  '卡博替尼',
  '洛莫司汀',
  '曲贝替定',
  '顺铂,吉西他滨',
  '替莫唑胺',
  '替莫唑胺,阿司匹林',
  '替莫唑胺,阿托伐他汀',
  '替莫唑胺,伯瑞替尼',
  '替莫唑胺,加巴喷丁',
  '替莫唑胺,洛莫司汀',
  '替莫唑胺,替尼泊苷',
  '替尼泊苷',
  '伊立替康',
  '依托泊苷',
  '依维莫司',
  '依维莫司,奥曲肽',
  '紫杉醇,替尼泊苷',
  'VAL-083',
];
const drugTypeColumns = [
  { key: 'ic50', label: 'IC50' },
  { key: 'inhibition', label: '抑制率' },
  { key: 'plan', label: '术后方案' },
  { key: 'efficacy', label: '疗效评估' },
  { key: 'outcome', label: '临床结局' },
  { key: 'followup', label: '随访' },
];
const groupLabels = {
  basic: '基本信息',
  clinical: '临床信息',
  pathology: '病理/IHC',
  molecular: '分子标志',
  imaging: '影像评估',
  drug: '按药物类型',
  followup: '全局记录',
} as const;
const groupOrder: ColumnMeta['group'][] = ['basic', 'clinical', 'pathology', 'molecular', 'imaging', 'drug', 'followup'];
const droppedXlsxHeaders = new Set(['序号']);

const colors = {
  basic: '#DCEBFF',
  clinical: '#E0F2FE',
  pathology: '#FFE7C2',
  molecular: '#F3E8FF',
  imaging: '#E5E7EB',
  drug: '#DCFCE7',
  followup: '#E0F2FE',
  header: '#F8FAFC',
  high: '#D1FAE5',
  warn: '#FEF3C7',
};

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function slug(value: string) {
  return value.replace(/\s+/g, '-').toLowerCase();
}

function detailMeta(group: ColumnGroup, columns: DetailColumn[]) {
  return columns.map((column) => ({
    key: `${group}.${column.key}`,
    label: column.label,
    group,
    groupLabel: groupLabels[group],
    sourceKey: column.sourceKey,
  }));
}

function workbookHeaders(payload: FollowupPayload | null = currentPayload) {
  const headers = payload?.xlsx_headers;
  const sourceHeaders = Array.isArray(headers) && headers.length ? headers : xlsxHeaders;
  return sourceHeaders.filter((header) => !droppedXlsxHeaders.has(String(header).trim()));
}

function groupForXlsxHeader(header: string): ColumnGroup {
  if (header.startsWith('药敏_')) return 'drug';
  if (header.startsWith('临床诊断_') || header.startsWith('病程_')) return 'clinical';
  if (header.startsWith('病理诊断_') || header.startsWith('免疫组化_')) return 'pathology';
  if (header.startsWith('临床结局/疗效_') || header.includes('随访')) return 'followup';
  if (header.includes('分子分型')) return 'molecular';
  if (header.includes('MR/CT') || header.includes('影像')) return 'imaging';
  if (['临床诊断结果', '初治/复发', '如复发-->治疗史'].includes(header)) return 'clinical';
  if (['病理诊断结果', '免疫组化结果'].includes(header)) return 'pathology';
  return 'basic';
}

function buildColumnMeta() {
  const headers = workbookHeaders();
  if (headers.length) {
    return headers.map((header) => {
      const group = groupForXlsxHeader(header);
      return {
        key: `xlsx.${slug(header)}`,
        label: header,
        group,
        groupLabel: groupLabels[group],
        sourceKey: header,
        drugName: header.startsWith('药敏_') ? header.slice(3) : undefined,
      };
    });
  }
  const metas: ColumnMeta[] = [];
  baseColumns.forEach((label) => metas.push({ key: `basic.${slug(label)}`, label, group: 'basic', groupLabel: groupLabels.basic }));
  metas.push(...detailMeta('clinical', clinicalColumns));
  metas.push(...detailMeta('pathology', pathologyColumns));
  metas.push(...detailMeta('molecular', molecularColumns));
  metas.push(...detailMeta('imaging', imagingColumns));
  if (expanded) {
    drugTypes.forEach((drug) => {
      drugTypeColumns.forEach((field) => {
        metas.push({
          key: `drug.${slug(drug)}.${field.key}`,
          label: `${drug} ${field.label}`,
          group: 'drug',
          groupLabel: groupLabels.drug,
          drugName: drug,
          drugField: field.label,
        });
      });
    });
  } else {
    ['药敏条目数', '高抑制药物', '最高抑制率'].forEach((label) => {
      metas.push({ key: `drug.summary.${slug(label)}`, label, group: 'drug', groupLabel: groupLabels.drug });
    });
  }
  globalColumns.forEach((label) => metas.push({ key: `followup.${slug(label)}`, label, group: 'followup', groupLabel: groupLabels.followup }));
  return metas;
}

function markerText(patient: Patient, patterns: string[]) {
  const source = [
    patient['分子分型'],
    patient['免疫组化结果'],
    patient['治疗史'],
  ].filter(Boolean).join('；');
  const parts = source
    .replace(/\r?\n/g, '，')
    .split(/[，,；;。]/)
    .map((item) => item.trim())
    .filter(Boolean);
  const matches = parts.filter((part) => patterns.some((pattern) => part.toLowerCase().includes(pattern.toLowerCase())));
  return [...new Set(matches)].join('；');
}

function detailValue(patient: Patient, column: DetailColumn) {
  if (column.sourceKey) return patient[column.sourceKey] || '';
  if (column.patterns) return markerText(patient, column.patterns);
  return '';
}

function applyDetailSnapshot(patient: Patient, columns: DetailColumn[], cells: any, row: number, startCol: number) {
  let col = startCol;
  columns.forEach((column) => {
    const value = cellText(cells[row]?.[col++]);
    if (column.sourceKey) patient[column.sourceKey] = value;
  });
  return col;
}

function getHiddenColumnKeys() {
  try {
    const keys = JSON.parse(localStorage.getItem(HIDDEN_COLUMNS_KEY) || '[]');
    return new Set(Array.isArray(keys) ? keys.filter((key) => typeof key === 'string') : []);
  } catch {
    return new Set<string>();
  }
}

function setHiddenColumnKeys(keys: Set<string>) {
  localStorage.setItem(HIDDEN_COLUMNS_KEY, JSON.stringify([...keys]));
}

function reloadForColumns() {
  statusEl.textContent = '正在应用列显示';
  window.location.reload();
}

function setGroupCollapsed(group: ColumnGroup, collapsed: boolean) {
  const hidden = getHiddenColumnKeys();
  buildColumnMeta().filter((meta) => meta.group === group).forEach((meta) => {
    if (collapsed) hidden.add(meta.key);
    else hidden.delete(meta.key);
  });
  setHiddenColumnKeys(hidden);
  reloadForColumns();
}

function toggleColumnGroup(group: ColumnGroup) {
  const metas = buildColumnMeta().filter((meta) => meta.group === group);
  const hidden = getHiddenColumnKeys();
  const visibleCount = metas.filter((meta) => !hidden.has(meta.key)).length;
  setGroupCollapsed(group, visibleCount > 0);
}

function showAllGroups() {
  setHiddenColumnKeys(new Set());
  reloadForColumns();
}

function collapseAllGroups() {
  const hidden = new Set<string>();
  buildColumnMeta().forEach((meta) => {
    if (meta.group !== 'basic') hidden.add(meta.key);
  });
  setHiddenColumnKeys(hidden);
  reloadForColumns();
}

function renderColumnPanel() {
  const metas = buildColumnMeta();
  const hidden = getHiddenColumnKeys();
  const hiddenCount = metas.filter((meta) => hidden.has(meta.key)).length;
  const groupHtml = groupOrder.map((group) => {
    const groupMetas = metas.filter((meta) => meta.group === group);
    const visibleCount = groupMetas.filter((meta) => !hidden.has(meta.key)).length;
    const allVisible = visibleCount === groupMetas.length;
    const itemHtml = group === 'drug' && expanded && !workbookHeaders().length
      ? drugTypes.map((drug) => {
        const drugMetas = groupMetas.filter((meta) => meta.drugName === drug);
        const drugVisibleCount = drugMetas.filter((meta) => !hidden.has(meta.key)).length;
        const drugAllVisible = drugVisibleCount === drugMetas.length;
        const fieldHtml = drugMetas.map((meta) => `
          <div class="column-item">
            <label title="${escapeHtml(meta.label)}">
              <input type="checkbox" data-column-key="${escapeHtml(meta.key)}" ${hidden.has(meta.key) ? '' : 'checked'} />
              <span class="column-label">${escapeHtml(meta.drugField || meta.label)}</span>
            </label>
          </div>
        `).join('');
        return `
          <section class="drug-column-group">
            <div class="drug-column-head">
              <label title="${escapeHtml(drug)}">
                <input type="checkbox" data-drug-name="${escapeHtml(drug)}" ${drugAllVisible ? 'checked' : ''} />
                <span class="drug-column-name">${escapeHtml(drug)}</span>
              </label>
              <span class="column-count">${drugVisibleCount}/${drugMetas.length}</span>
            </div>
            <div class="drug-column-items">${fieldHtml}</div>
          </section>
        `;
      }).join('')
      : groupMetas.map((meta) => `
      <div class="column-item">
        <label title="${escapeHtml(meta.label)}">
          <input type="checkbox" data-column-key="${escapeHtml(meta.key)}" ${hidden.has(meta.key) ? '' : 'checked'} />
          <span class="column-label">${escapeHtml(meta.label)}</span>
        </label>
      </div>
    `).join('');
    return `
      <section class="column-group">
        <div class="column-group-head">
          <label>
            <input type="checkbox" data-column-group="${group}" ${allVisible ? 'checked' : ''} />
            <span class="column-group-name">${groupLabels[group]}</span>
          </label>
          <span class="column-count">${visibleCount}/${groupMetas.length}</span>
        </div>
        <div class="column-items">${itemHtml}</div>
      </section>
    `;
  }).join('');

  columnPanelEl.innerHTML = `
    <div class="column-panel-header">
      <div>
        <div class="column-panel-title">列显示</div>
        <div class="column-panel-summary">${metas.length - hiddenCount}/${metas.length} 列显示</div>
      </div>
      <div class="column-panel-tools">
        <button type="button" data-column-action="apply">应用</button>
        <button type="button" data-column-action="show-all">全部显示</button>
        <button type="button" data-column-action="clinical">只看基本+药敏</button>
        <button type="button" data-column-action="hide-drug">隐藏药敏</button>
        <button type="button" data-column-action="close">关闭</button>
      </div>
    </div>
    <div class="column-groups">${groupHtml}</div>
  `;
}

function byPatient<T extends Record<string, string>>(items: T[]) {
  return items.reduce<Record<string, T[]>>((acc, item) => {
    const id = item.patient_id || '';
    acc[id] ||= [];
    acc[id].push(item);
    return acc;
  }, {});
}

function cellText(cell: any) {
  const value = cell?.v ?? cell?.p?.body?.dataStream ?? '';
  return String(value ?? '').replace(/\r?\n\u0002?$/, '').trim();
}

function linesToText(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].join('\n');
}

function splitDrugClinical(value: string, drug: string) {
  if (!value) return '';
  return value.includes('\n') || value.includes('【') ? value : `【${drug}】${value}`;
}

function parseAssayRaw(raw: string) {
  let ic50 = '';
  let inhibition = '';
  let match = raw.match(/IC50\s*=\s*([^;；,)]+)/i);
  if (match) ic50 = match[1].trim();
  match = raw.match(/抑制率\s*=\s*([0-9.Ee+\-]+%?)/);
  if (match) inhibition = match[1].trim();
  if (!ic50 || !inhibition) {
    match = raw.match(/\(([^,，)]+)[,，]\s*([0-9.Ee+\-]+%?)\)/);
    if (match) {
      ic50 ||= match[1].trim();
      inhibition ||= match[2].trim();
    }
  }
  return { ic50, inhibition };
}

function xlsxValue(patient: Patient, header: string, drugs: DrugRow[], followups: FollowupRow[]) {
  if (patient[header]) return patient[header];
  const alias = headerAliases[header];
  if (alias && patient[alias]) return patient[alias];
  if (header.startsWith('药敏_')) {
    const drugName = header.slice(3);
    const drug = drugs.find((item) => item['药物组合'] === drugName);
    if (!drug) return '';
    return drug['原始值'] || `IC50=${drug.IC50 || ''}; 抑制率=${drug['抑制率'] || ''}`;
  }
  if (['4-17随访', '4-3随访', '3-24/25随访'].includes(header)) {
    return followups.find((item) => item['随访节点'] === header)?.['内容'] || '';
  }
  return '';
}

function applyXlsxAliases(patient: Patient) {
  patient.patient_id = patient['类器官样本号'] || patient.patient_id || '';
  patient['类器官样本号'] = patient.patient_id;
  Object.entries(headerAliases).forEach(([header, alias]) => {
    if (patient[header] !== undefined) patient[alias] = patient[header] || '';
  });
}

function payloadFromXlsxSnapshot(snapshot: any, original: FollowupPayload): FollowupPayload {
  const headers = workbookHeaders(original);
  const sheet = snapshot?.sheets?.['followup-sheet'];
  const cells = sheet?.cellData || {};
  const patientsById = Object.fromEntries(original.patients.map((patient) => [patient.patient_id, patient]));
  const nextPatients: Patient[] = [];
  const nextDrugs: DrugRow[] = [];
  const nextFollowups: FollowupRow[] = [];

  for (let row = HEADER_ROWS; row < (sheet?.rowCount || 0); row += 1) {
    const values = Object.fromEntries(headers.map((header, col) => [header, cellText(cells[row]?.[col])]));
    const patientId = values['类器官样本号'] || cellText(cells[row]?.[0]);
    if (!patientId) continue;
    const patient: Patient = {
      ...(patientsById[patientId] || {}),
      ...values,
      patient_id: patientId,
      source_row: String(patientsById[patientId]?.source_row || row - HEADER_ROWS + 2),
    };
    applyXlsxAliases(patient);
    headers.filter((header) => header.startsWith('药敏_')).forEach((header) => {
      const raw = values[header] || '';
      if (!raw) return;
      const { ic50, inhibition } = parseAssayRaw(raw);
      nextDrugs.push({
        patient_id: patientId,
        source_row: String(patient.source_row || row - HEADER_ROWS + 2),
        '药物组合': header.slice(3),
        IC50: ic50,
        '抑制率': inhibition,
        原始值: raw,
      });
    });
    ['4-17随访', '4-3随访', '3-24/25随访'].forEach((node) => {
      const content = values[node] || '';
      if (content) {
        nextFollowups.push({
          patient_id: patientId,
          source_row: String(patient.source_row || row - HEADER_ROWS + 2),
          随访节点: node,
          内容: content,
        });
      }
    });
    nextPatients.push(patient);
  }

  return {
    ...original,
    generated_at: new Date().toISOString(),
    xlsx_headers: headers,
    patients: nextPatients,
    drug_sensitivity: nextDrugs,
    followups: nextFollowups,
  };
}

function comparableRawRows(rows: RawRow[], columns: string[]) {
  return JSON.stringify(rows.map((row) => {
    const normalized: RawRow = { _id: String(row._id || '') };
    columns.forEach((column) => {
      normalized[column] = String(row[column] ?? '').trim();
    });
    return normalized;
  }));
}

function payloadFromRawSnapshot(snapshot: any, original: FollowupPayload): FollowupPayload {
  const rawTables = original.raw_tables || [];
  const nextTables: RawTable[] = [];
  const changedTables: string[] = [];

  rawTables.forEach((table, tableIndex) => {
    const sheet = snapshot?.sheets?.[rawSheetId(tableIndex)];
    const cells = sheet?.cellData || {};
    const columns = table.columns || [];
    const originalRowsByID = Object.fromEntries((table.rows || []).map((row) => [String(row._id || ''), row]));
    const nextRows: RawRow[] = [];
    const rowCount = sheet?.rowCount || 0;

    for (let row = RAW_HEADER_ROWS; row < rowCount; row += 1) {
      const rowID = cellText(cells[row]?.[0]);
      const values: RawRow = { ...(rowID ? originalRowsByID[rowID] || {} : {}), _id: rowID };
      let hasValue = Boolean(rowID);
      columns.forEach((column, index) => {
        const value = cellText(cells[row]?.[index + 1]);
        values[column] = value;
        if (value) hasValue = true;
      });
      if (hasValue) nextRows.push(values);
    }

    if (comparableRawRows(nextRows, columns) !== comparableRawRows(table.rows || [], columns)) {
      changedTables.push(table.name);
    }
    nextTables.push({ ...table, rows: nextRows });
  });

  return {
    ...original,
    generated_at: new Date().toISOString(),
    raw_tables: nextTables,
    changed_raw_tables: changedTables,
  };
}

function payloadFromSnapshot(snapshot: any, original: FollowupPayload): FollowupPayload {
  if (hasRawTables(original)) return payloadFromRawSnapshot(snapshot, original);
  if (workbookHeaders(original).length) return payloadFromXlsxSnapshot(snapshot, original);
  if (!expanded) {
    throw new Error('请先展开药敏明细后再保存联动');
  }
  const sheet = snapshot?.sheets?.['followup-sheet'];
  const cells = sheet?.cellData || {};
  const drugMap = byPatient(original.drug_sensitivity);
  const followupMap = byPatient(original.followups);
  const patientsById = Object.fromEntries(original.patients.map((patient) => [patient.patient_id, patient]));
  const nextPatients: Patient[] = [];
  const nextDrugs: DrugRow[] = [];
  const nextFollowups: FollowupRow[] = [];

  for (let row = HEADER_ROWS; row < (sheet?.rowCount || 0); row += 1) {
    const patientId = cellText(cells[row]?.[0]);
    if (!patientId) continue;
    const originalPatient = patientsById[patientId] || { patient_id: patientId, source_row: String(row - HEADER_ROWS + 2) };
    const patient: Patient = { ...originalPatient, patient_id: patientId };
    let col = 0;
    const baseValues = baseColumns.map(() => cellText(cells[row]?.[col++]));
    [
      patient.patient_id,
      patient['患者姓名'],
      patient['性别'],
      patient['年龄'],
      patient['取样时间'],
      patient['取样方式'],
      patient['癌种'],
    ] = baseValues;
    col = applyDetailSnapshot(patient, clinicalColumns, cells, row, col);
    col = applyDetailSnapshot(patient, pathologyColumns, cells, row, col);
    col = applyDetailSnapshot(patient, molecularColumns, cells, row, col);
    col = applyDetailSnapshot(patient, imagingColumns, cells, row, col);

    const planParts: string[] = [];
    const efficacyParts: string[] = [];
    const outcomeParts: string[] = [];
    const followupParts: string[] = [];
    const originalDrugs = drugMap[patientId] || [];
    const originalByDrug = Object.fromEntries(originalDrugs.map((drug) => [drug['药物组合'], drug]));

    drugTypes.forEach((drug) => {
      const ic50 = cellText(cells[row]?.[col++]);
      const inhibition = cellText(cells[row]?.[col++]);
      const plan = cellText(cells[row]?.[col++]);
      const efficacy = cellText(cells[row]?.[col++]);
      const outcome = cellText(cells[row]?.[col++]);
      const followup = cellText(cells[row]?.[col++]);

      if (ic50 || inhibition) {
        nextDrugs.push({
          ...(originalByDrug[drug] || {}),
          patient_id: patientId,
          source_row: String(patient.source_row || row - HEADER_ROWS + 2),
          '药物组合': drug,
          IC50: ic50,
          '抑制率': inhibition,
          原始值: `IC50=${ic50}; 抑制率=${inhibition}`,
        });
      }
      if (plan) planParts.push(splitDrugClinical(plan, drug));
      if (efficacy) efficacyParts.push(splitDrugClinical(efficacy, drug));
      if (outcome) outcomeParts.push(splitDrugClinical(outcome, drug));
      if (followup) followupParts.push(splitDrugClinical(followup, drug));
    });

    col += 1;
    col += 1;
    patient['药敏结果原文'] = cellText(cells[row]?.[col++]);
    patient['术后治疗方案'] = linesToText(planParts) || patient['术后治疗方案'] || '';
    patient['疗效评估'] = linesToText(efficacyParts) || patient['疗效评估'] || '';
    patient['临床结局'] = linesToText(outcomeParts) || patient['临床结局'] || '';
    nextFollowups.push(...(followupMap[patientId] || []));
    nextPatients.push(patient);
  }

  return {
    ...original,
    generated_at: new Date().toISOString(),
    patients: nextPatients,
    drug_sensitivity: nextDrugs,
    followups: nextFollowups,
  };
}

function percentNumber(value: string | undefined) {
  const number = Number.parseFloat(String(value || '').replace('%', ''));
  return Number.isFinite(number) ? number : null;
}

function put(cells: any, row: number, col: number, value: string | number, style: string) {
  cells[row] ||= {};
  cells[row][col] = { v: value ?? '', s: style };
}

function merge(startRow: number, endRow: number, startColumn: number, endColumn: number) {
  return { startRow, endRow, startColumn, endColumn };
}

const groupStyle: Record<ColumnGroup, string> = {
  basic: 'groupBasic',
  clinical: 'groupClinical',
  pathology: 'groupPathology',
  molecular: 'groupMolecular',
  imaging: 'groupImaging',
  drug: 'groupDrug',
  followup: 'groupFollowup',
};

function putDetailHeader(cells: any, merges: any[], startCol: number, group: ColumnGroup, columns: DetailColumn[]) {
  put(cells, 0, startCol, groupLabels[group], groupStyle[group]);
  merges.push(merge(0, 0, startCol, startCol + columns.length - 1));
  columns.forEach((column, index) => {
    put(cells, 1, startCol + index, column.label, 'header');
    merges.push(merge(1, 2, startCol + index, startCol + index));
  });
  return startCol + columns.length;
}

function putDetailRow(cells: any, row: number, startCol: number, patient: Patient, columns: DetailColumn[]) {
  let col = startCol;
  columns.forEach((column) => put(cells, row, col++, detailValue(patient, column), 'wrap'));
  return col;
}

function rawSheetId(index: number) {
  return `${RAW_SHEET_PREFIX}${index}`;
}

function hasRawTables(payload: FollowupPayload) {
  return Array.isArray(payload.raw_tables) && payload.raw_tables.length > 0;
}

function rawPayloadHasNewRows(payload: FollowupPayload) {
  const changed = new Set(payload.changed_raw_tables || []);
  return (payload.raw_tables || []).some((table) => {
    return changed.has(table.name) && (table.rows || []).some((row) => !String(row._id || '').trim());
  });
}

function rawCellStyle(value: string) {
  return value.length > 36 || value.includes('\n') ? 'wrap' : 'body';
}

function makeRawWorkbook(payload: FollowupPayload) {
  const sheets: Record<string, any> = {};
  const sheetOrder: string[] = [];
  const rawTables = payload.raw_tables || [];

  rawTables.forEach((table, tableIndex) => {
    const id = rawSheetId(tableIndex);
    const columns = ['_id', ...(table.columns || [])];
    const cells: any = {};
    const columnData: any = { 0: { w: 80, hd: 1 } };
    const rowData: any = { 0: { h: 34 } };

    columns.forEach((column, col) => {
      put(cells, 0, col, column, 'header');
      if (col > 0) {
        const width = column.length > 12 || column.includes('诊断') || column.includes('结果') || column.includes('记录') ? 220 : 132;
        columnData[col] = { w: width };
      }
    });

    (table.rows || []).forEach((row, rowIndex) => {
      const sheetRow = RAW_HEADER_ROWS + rowIndex;
      rowData[sheetRow] = { h: 36 };
      columns.forEach((column, col) => {
        const value = String(row[column] ?? '');
        put(cells, sheetRow, col, value, rawCellStyle(value));
      });
    });

    sheetOrder.push(id);
    sheets[id] = {
      id,
      name: table.name || `SeaTable ${tableIndex + 1}`,
      rowCount: (table.rows?.length || 0) + RAW_HEADER_ROWS + EXTRA_EMPTY_ROWS,
      columnCount: columns.length,
      defaultColumnWidth: 132,
      defaultRowHeight: 28,
      freeze: { xSplit: 0, ySplit: 1, startRow: 1, startColumn: 0 },
      cellData: cells,
      rowData,
      columnData,
      showGridlines: 1,
    };
  });

  return {
    id: 'clinical-followup-workbook',
    name: 'SeaTable Raw Sheets',
    appVersion: '0.25.0',
    locale: LocaleType.ZH_CN,
    sheetOrder,
    styles: {
      header: { bg: { rgb: colors.header }, bl: 1, ht: 2, vt: 2, fs: 11, tb: 2 },
      body: { fs: 11, vt: 2 },
      wrap: { fs: 11, vt: 1, tb: 2 },
    },
    sheets,
  };
}

function buildDrugSummary(drugs: DrugRow[]) {
  const high = drugs.filter((row) => (percentNumber(row['抑制率']) || 0) >= 80);
  const top = drugs.reduce<DrugRow | null>((best, row) => {
    const value = percentNumber(row['抑制率']);
    const bestValue = percentNumber(best?.['抑制率']);
    if (value === null) return best;
    return best === null || bestValue === null || value > bestValue ? row : best;
  }, null);
  return [
    `${drugs.length} 条`,
    high.map((row) => row['药物组合']).filter(Boolean).join('、') || '无 >=80%',
    top ? `${top['药物组合']} ${top['抑制率']}` : '',
  ];
}

function drugParts(drug: string) {
  return drug.split(/[,，、]/).map((part) => part.trim()).filter(Boolean);
}

function textMatchesDrug(text: string, drug: string) {
  if (!text) return false;
  const normalized = text.toLowerCase();
  if (normalized.includes(drug.toLowerCase())) return true;
  const parts = drugParts(drug);
  if (!parts.length) return false;
  return parts.every((part) => normalized.includes(part.toLowerCase()));
}

function drugClinicalText(text: string, drug: string) {
  return textMatchesDrug(text, drug) ? text : '';
}

function makeXlsxWorkbook(payload: FollowupPayload) {
  const headers = workbookHeaders(payload);
  const drugMap = byPatient(payload.drug_sensitivity);
  const followupMap = byPatient(payload.followups);
  const columnMeta = buildColumnMeta();
  const hiddenColumns = getHiddenColumnKeys();
  const cells: any = {};
  const merges: any[] = [];
  const columnData: any = {};
  const rowData: any = {
    0: { h: 34 },
    1: { h: 32 },
    2: { h: 32 },
  };

  let start = 0;
  while (start < headers.length) {
    const group = groupForXlsxHeader(headers[start]);
    let end = start;
    while (end + 1 < headers.length && groupForXlsxHeader(headers[end + 1]) === group) end += 1;
    put(cells, 0, start, groupLabels[group], groupStyle[group]);
    merges.push(merge(0, 0, start, end));
    start = end + 1;
  }

  headers.forEach((header, index) => {
    put(cells, 1, index, header, 'header');
    merges.push(merge(1, 2, index, index));
    const meta = columnMeta[index];
    let width = 126;
    if (header.includes('诊断') || header.includes('免疫组化') || header.includes('分子分型')) width = 180;
    if (header.includes('随访') || header.includes('方案') || header.includes('结局') || header.includes('MR/CT')) width = 240;
    if (header.startsWith('药敏_')) width = 150;
    columnData[index] = { w: width, hd: meta && hiddenColumns.has(meta.key) ? 1 : 0 };
  });

  payload.patients.forEach((patient, index) => {
    const row = HEADER_ROWS + index;
    const drugs = drugMap[patient.patient_id] || [];
    const followups = followupMap[patient.patient_id] || [];
    rowData[row] = { h: 42 };
    headers.forEach((header, col) => {
      const value = xlsxValue(patient, header, drugs, followups);
      const style = header.startsWith('药敏_') && (percentNumber(parseAssayRaw(value).inhibition) || 0) >= 80 ? 'high' : value.length > 36 ? 'wrap' : 'body';
      put(cells, row, col, value || '', style);
    });
  });

  return {
    id: 'clinical-followup-workbook',
    name: 'SeaTable Sheet',
    appVersion: '0.25.0',
    locale: LocaleType.ZH_CN,
    sheetOrder: ['followup-sheet'],
    styles: {
      groupBasic: { bg: { rgb: colors.basic }, bl: 1, ht: 2, vt: 2, fs: 12 },
      groupClinical: { bg: { rgb: colors.clinical }, bl: 1, ht: 2, vt: 2, fs: 12 },
      groupPathology: { bg: { rgb: colors.pathology }, bl: 1, ht: 2, vt: 2, fs: 12 },
      groupMolecular: { bg: { rgb: colors.molecular }, bl: 1, ht: 2, vt: 2, fs: 12 },
      groupImaging: { bg: { rgb: colors.imaging }, bl: 1, ht: 2, vt: 2, fs: 12 },
      groupDrug: { bg: { rgb: colors.drug }, bl: 1, ht: 2, vt: 2, fs: 12 },
      groupFollowup: { bg: { rgb: colors.followup }, bl: 1, ht: 2, vt: 2, fs: 12 },
      subDrug: { bg: { rgb: '#BBF7D0' }, bl: 1, ht: 2, vt: 2, fs: 11 },
      header: { bg: { rgb: colors.header }, bl: 1, ht: 2, vt: 2, fs: 11, tb: 2 },
      body: { fs: 11, vt: 2 },
      wrap: { fs: 11, vt: 1, tb: 2 },
      high: { bg: { rgb: colors.high }, fs: 11, vt: 2 },
      warn: { bg: { rgb: colors.warn }, fs: 11, vt: 2 },
    },
    sheets: {
      'followup-sheet': {
        id: 'followup-sheet',
        name: `随访总表-xlsx ${headers.length}列`,
        rowCount: payload.patients.length + HEADER_ROWS + EXTRA_EMPTY_ROWS,
        columnCount: headers.length,
        defaultColumnWidth: 126,
        defaultRowHeight: 28,
        mergeData: merges,
        cellData: cells,
        rowData,
        columnData,
        showGridlines: 1,
      },
    },
  };
}

function makeWorkbook(payload: FollowupPayload) {
  if (hasRawTables(payload)) return makeRawWorkbook(payload);
  if (workbookHeaders(payload).length) return makeXlsxWorkbook(payload);
  const drugMap = byPatient(payload.drug_sensitivity);
  const followupMap = byPatient(payload.followups);
  const columnMeta = buildColumnMeta();
  const hiddenColumns = getHiddenColumnKeys();
  const cells: any = {};
  const merges: any[] = [];
  const columnData: any = {};
  const rowData: any = {
    0: { h: 34 },
    1: { h: 32 },
    2: { h: 32 },
  };

  let col = 0;
  put(cells, 0, col, groupLabels.basic, 'groupBasic');
  merges.push(merge(0, 0, col, col + baseColumns.length - 1));
  baseColumns.forEach((label, index) => {
    put(cells, 1, col + index, label, 'header');
    merges.push(merge(1, 2, col + index, col + index));
  });
  col += baseColumns.length;
  col = putDetailHeader(cells, merges, col, 'clinical', clinicalColumns);
  col = putDetailHeader(cells, merges, col, 'pathology', pathologyColumns);
  col = putDetailHeader(cells, merges, col, 'molecular', molecularColumns);
  col = putDetailHeader(cells, merges, col, 'imaging', imagingColumns);

  const drugStart = col;
  if (expanded) {
    const drugSpan = drugTypes.length * drugTypeColumns.length;
    put(cells, 0, drugStart, '按药物类型', 'groupDrug');
    merges.push(merge(0, 0, drugStart, drugStart + drugSpan - 1));
    drugTypes.forEach((drug, drugIndex) => {
      const slotCol = drugStart + drugIndex * drugTypeColumns.length;
      put(cells, 1, slotCol, drug, 'subDrug');
      merges.push(merge(1, 1, slotCol, slotCol + drugTypeColumns.length - 1));
      drugTypeColumns.forEach((field, fieldIndex) => put(cells, 2, slotCol + fieldIndex, field.label, 'header'));
    });
    col += drugSpan;
  } else {
    const drugColumns = ['药敏条目数', '高抑制药物', '最高抑制率'];
    put(cells, 0, drugStart, '药物类型摘要', 'groupDrug');
    merges.push(merge(0, 0, drugStart, drugStart + drugColumns.length - 1));
    drugColumns.forEach((label, index) => {
      put(cells, 1, drugStart + index, label, 'header');
      merges.push(merge(1, 2, drugStart + index, drugStart + index));
    });
    col += drugColumns.length;
  }

  put(cells, 0, col, '全局记录', 'groupFollowup');
  merges.push(merge(0, 0, col, col + globalColumns.length - 1));
  globalColumns.forEach((label, index) => {
    put(cells, 1, col + index, label, 'header');
    merges.push(merge(1, 2, col + index, col + index));
  });

  const totalColumns = col + globalColumns.length;
  for (let i = 0; i < totalColumns; i += 1) {
    const meta = columnMeta[i];
    let width = 120;
    const detailColumn = detailColumns.find((column) => meta?.key.endsWith(`.${column.key}`));
    if (detailColumn?.width) width = detailColumn.width;
    if (meta?.key.endsWith('.ic50') || meta?.key.endsWith('.inhibition')) width = 92;
    if (meta?.key.endsWith('.plan') || meta?.key.endsWith('.efficacy') || meta?.key.endsWith('.outcome') || meta?.key.endsWith('.followup')) width = 184;
    columnData[i] = { w: width, hd: meta && hiddenColumns.has(meta.key) ? 1 : 0 };
  }
  columnData[0] = { ...columnData[0], w: 128 };
  columnData[1] = { ...columnData[1], w: 88 };

  payload.patients.forEach((patient, index) => {
    const row = HEADER_ROWS + index;
    const drugs = drugMap[patient.patient_id] || [];
    const drugsByName = drugs.reduce<Record<string, DrugRow>>((acc, item) => {
      acc[item['药物组合']] = item;
      return acc;
    }, {});
    const followups = followupMap[patient.patient_id] || [];
    const followupText = followups.map((item) => `${item['随访节点'] || ''} ${item['内容'] || ''}`.trim()).filter(Boolean).join('\n');
    rowData[row] = { h: 42 };

    const base = [
      patient.patient_id,
      patient['患者姓名'],
      patient['性别'],
      patient['年龄'],
      patient['取样时间'],
      patient['取样方式'],
      patient['癌种'],
    ];
    let dataCol = 0;
    base.forEach((value) => put(cells, row, dataCol++, value || '', 'body'));
    dataCol = putDetailRow(cells, row, dataCol, patient, clinicalColumns);
    dataCol = putDetailRow(cells, row, dataCol, patient, pathologyColumns);
    dataCol = putDetailRow(cells, row, dataCol, patient, molecularColumns);
    dataCol = putDetailRow(cells, row, dataCol, patient, imagingColumns);

    if (expanded) {
      drugTypes.forEach((drug) => {
        const item = drugsByName[drug];
        const high = (percentNumber(item?.['抑制率']) || 0) >= 80;
        put(cells, row, dataCol++, item?.IC50 || '', 'body');
        put(cells, row, dataCol++, item?.['抑制率'] || '', high ? 'high' : 'body');
        put(cells, row, dataCol++, drugClinicalText(patient['术后治疗方案'] || '', drug), 'wrap');
        put(cells, row, dataCol++, drugClinicalText(patient['疗效评估'] || '', drug), 'wrap');
        put(cells, row, dataCol++, drugClinicalText(patient['临床结局'] || '', drug), 'wrap');
        put(cells, row, dataCol++, drugClinicalText(followupText, drug), 'wrap');
      });
    } else {
      buildDrugSummary(drugs).forEach((value, idx) => put(cells, row, dataCol++, value, idx === 1 ? 'warn' : 'body'));
    }
    put(cells, row, dataCol++, followups.length, followups.length ? 'body' : 'warn');
    put(cells, row, dataCol++, followupText, 'wrap');
    put(cells, row, dataCol++, patient['药敏结果原文'] || '', 'wrap');
  });

  const columnCount = totalColumns;
  return {
    id: 'clinical-followup-workbook',
    name: 'SeaTable Sheet',
    appVersion: '0.25.0',
    locale: LocaleType.ZH_CN,
    sheetOrder: ['followup-sheet'],
    styles: {
      groupBasic: { bg: { rgb: colors.basic }, bl: 1, ht: 2, vt: 2, fs: 12 },
      groupClinical: { bg: { rgb: colors.clinical }, bl: 1, ht: 2, vt: 2, fs: 12 },
      groupPathology: { bg: { rgb: colors.pathology }, bl: 1, ht: 2, vt: 2, fs: 12 },
      groupMolecular: { bg: { rgb: colors.molecular }, bl: 1, ht: 2, vt: 2, fs: 12 },
      groupImaging: { bg: { rgb: colors.imaging }, bl: 1, ht: 2, vt: 2, fs: 12 },
      groupDrug: { bg: { rgb: colors.drug }, bl: 1, ht: 2, vt: 2, fs: 12 },
      groupFollowup: { bg: { rgb: colors.followup }, bl: 1, ht: 2, vt: 2, fs: 12 },
      subDrug: { bg: { rgb: '#BBF7D0' }, bl: 1, ht: 2, vt: 2, fs: 11 },
      header: { bg: { rgb: colors.header }, bl: 1, ht: 2, vt: 2, fs: 11 },
      body: { fs: 11, vt: 2 },
      wrap: { fs: 11, vt: 1, tb: 2 },
      high: { bg: { rgb: colors.high }, fs: 11, vt: 2 },
      warn: { bg: { rgb: colors.warn }, fs: 11, vt: 2 },
    },
    sheets: {
      'followup-sheet': {
        id: 'followup-sheet',
        name: expanded ? '随访总表-药敏展开' : '随访总表-药敏摘要',
        rowCount: payload.patients.length + HEADER_ROWS + EXTRA_EMPTY_ROWS,
        columnCount,
        defaultColumnWidth: 118,
        defaultRowHeight: 28,
        mergeData: merges,
        cellData: cells,
        rowData,
        columnData,
        showGridlines: 1,
      },
    },
  };
}

function activeWorkbook() {
  const api = (window as any).univerAPI;
  return api?.getActiveWorkbook?.();
}

function facadeValueToText(value: any) {
  if (value === null || value === undefined) return '';
  if (typeof value?.toPlainText === 'function') return value.toPlainText().trim();
  return String(value).trim();
}

function ensureDataFilter(sheet: any, selectedColumn: number) {
  const rawMode = currentPayload ? hasRawTables(currentPayload) : false;
  const rawIndex = rawMode ? Number(String(sheet.getSheetId?.() || '').replace(RAW_SHEET_PREFIX, '')) : -1;
  const rawTable = Number.isInteger(rawIndex) ? currentPayload?.raw_tables?.[rawIndex] : undefined;
  const rows = rawMode ? Math.max((rawTable?.rows?.length || 0) + 1, 1) : Math.max((currentPayload?.patients.length || 0) + 1, 1);
  const columns = rawMode ? Math.max((rawTable?.columns?.length || 0) + 1, selectedColumn + 1) : buildColumnMeta().length;
  const tableRange = sheet.getRange(rawMode ? 0 : HEADER_ROWS - 1, rawMode ? 1 : 0, rows, columns);
  let filter = sheet.getFilter?.();
  const filterRange = filter?.getRange?.().getRange?.();
  const coversSelectedColumn = filterRange
    && selectedColumn >= filterRange.startColumn
    && selectedColumn <= filterRange.endColumn;

  if (filter && !coversSelectedColumn) {
    filter.remove?.();
    filter = null;
  }
  return filter || tableRange.createFilter?.();
}

function quickFilterByActiveCell() {
  try {
    const workbook = activeWorkbook();
    const sheet = workbook?.getActiveSheet?.();
    const activeRange = workbook?.getActiveRange?.();
    const range = activeRange?.getRange?.();
    if (!sheet || !range) {
      statusEl.textContent = '请先选中一个数据单元格';
      return;
    }
    const row = range.startRow;
    const column = range.startColumn;
    const rawMode = currentPayload ? hasRawTables(currentPayload) : false;
    const headerRows = rawMode ? RAW_HEADER_ROWS : HEADER_ROWS;
    if (row < headerRows) {
      statusEl.textContent = '请在数据行右键快速筛选';
      return;
    }
    if (!rawMode && row >= HEADER_ROWS + (currentPayload?.patients.length || 0)) {
      statusEl.textContent = '请在患者数据区域内快速筛选';
      return;
    }

    const cell = sheet.getRange(row, column);
    const value = facadeValueToText(cell.getValue?.(true) ?? cell.getValue?.());
    const filter = ensureDataFilter(sheet, column);
    if (!filter) {
      statusEl.textContent = '快速筛选初始化失败';
      return;
    }

    filter.setColumnFilterCriteria(column, {
      colId: column,
      filters: value ? { filters: [value] } : { blank: true },
    });
    statusEl.textContent = value ? `已按当前值筛选：${value}` : '已筛选当前列空白值';
  } catch (error) {
    statusEl.textContent = error instanceof Error ? `快速筛选失败：${error.message}` : '快速筛选失败';
  }
}

function clearQuickFilters() {
  try {
    const filter = activeWorkbook()?.getActiveSheet?.()?.getFilter?.();
    if (!filter) {
      statusEl.textContent = '当前没有筛选';
      return;
    }
    filter.removeFilterCriteria?.();
    statusEl.textContent = '已清除筛选条件';
  } catch (error) {
    statusEl.textContent = error instanceof Error ? `清除筛选失败：${error.message}` : '清除筛选失败';
  }
}

function registerContextMenuActions() {
  const api = (window as any).univerAPI;
  api?.createMenu?.({
    id: 'clinical.quick-filter-by-cell',
    title: '快速筛选当前值',
    tooltip: '按当前单元格的值筛选这一列',
    action: quickFilterByActiveCell,
    order: 20,
  })?.appendTo?.(['contextMenu.mainArea', 'contextMenu.others']);
  api?.createMenu?.({
    id: 'clinical.clear-quick-filter',
    title: '清除筛选',
    tooltip: '清除当前表的所有筛选条件',
    action: clearQuickFilters,
    order: 21,
  })?.appendTo?.(['contextMenu.mainArea', 'contextMenu.others']);
}

function installLeftDoubleClickEditing() {
  const root = document.getElementById('app');
  if (!root || root.dataset.leftDoubleClickEditing === '1') return;
  root.dataset.leftDoubleClickEditing = '1';

  const api = (window as any).univerAPI;
  let lastClick: { row: number; column: number; at: number } | null = null;
  api?.addEvent?.(api.Event.CellPointerDown, (params: any) => {
    const now = window.performance.now();
    const isDoubleClick = lastClick
      && lastClick.row === params.row
      && lastClick.column === params.column
      && now - lastClick.at < 380;
    lastClick = { row: params.row, column: params.column, at: now };
    if (!isDoubleClick) return;

    const workbook = params.workbook || activeWorkbook();
    const worksheet = params.worksheet || workbook?.getActiveSheet?.();
    const range = worksheet?.getRange?.(params.row, params.column);
    if (!workbook || !range || workbook.isCellEditing?.()) return;

    workbook.setActiveRange?.(range);
    window.requestAnimationFrame(() => {
      if (!workbook.isCellEditing?.()) workbook.startEditing?.();
    });
  });

  root.addEventListener('dblclick', (event) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, button, [contenteditable="true"]')) return;
    window.requestAnimationFrame(() => {
      const workbook = activeWorkbook();
      if (!workbook || workbook.isCellEditing?.()) return;
      workbook.startEditing?.();
    });
  }, true);
}

async function workbookSnapshot(finishEditing: boolean) {
  const workbook = activeWorkbook();
  if (!workbook) throw new Error('工作簿尚未加载');
  if (finishEditing) {
    if (workbook.endEditingAsync) await workbook.endEditingAsync(true);
    else if (workbook.endEditing) await workbook.endEditing(true);
  }
  return workbook.save();
}

function workbookHash(snapshot: any) {
  const sheets = snapshot?.sheets || {};
  return JSON.stringify(Object.fromEntries(Object.entries(sheets).map(([id, sheet]: [string, any]) => [id, {
    rowCount: sheet?.rowCount,
    columnCount: sheet?.columnCount,
    cellData: sheet?.cellData || {},
  }])));
}

function syncSummary(payload: FollowupPayload, suffix: string) {
  summaryEl.hidden = false;
  if (hasRawTables(payload)) {
    const rows = (payload.raw_tables || []).reduce((sum, table) => sum + (table.rows?.length || 0), 0);
    summaryEl.textContent = `${payload.raw_tables?.length || 0} 张 SeaTable 表 · ${rows} 行 · ${suffix}`;
    return;
  }
  summaryEl.textContent = `${payload.patients.length} 位患者 · 药敏 ${payload.drug_sensitivity.length} 条 · 随访 ${payload.followups.length} 条 · ${suffix}`;
}

async function saveCurrentWorkbook(mode: '手动' | '自动', finishEditing: boolean) {
  if (!currentPayload || isSaving || isRefreshing) return;
  if (!hasRawTables(currentPayload) && !expanded && !workbookHeaders(currentPayload).length) {
    statusEl.textContent = '摘要视图不自动写回';
    return;
  }
  isSaving = true;
  try {
    if (mode === '手动') saveSyncEl.disabled = true;
    statusEl.textContent = mode === '自动' ? '自动保存中' : '正在保存联动';
    const snapshot = await workbookSnapshot(finishEditing);
    const hash = workbookHash(snapshot);
    if (mode === '自动' && hash === lastSavedWorkbookHash) {
      statusEl.textContent = '实时同步中';
      return;
    }
    const payload = payloadFromSnapshot(snapshot, currentPayload);
    const response = await fetch('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload, snapshot, expected_signature: lastRemoteSignature }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      if (response.status === 409 && result.state?.signature) lastRemoteSignature = result.state.signature;
      throw new Error(result.error || `HTTP ${response.status}`);
    }
    currentPayload = payload;
    lastSavedWorkbookHash = hash;
    lastLocalSaveAt = Date.now();
    if (result.seatable?.state?.signature) lastRemoteSignature = result.seatable.state.signature;
    const deletedStructured = (result.seatable?.deleted_patients || 0)
      + (result.seatable?.deleted_drugs || 0)
      + (result.seatable?.deleted_followups || 0);
    const seatableText = result.seatable?.ok && hasRawTables(payload)
      ? `SeaTable 原表 ${result.seatable.raw_tables || 0} 张 · 更新 ${result.seatable.raw_rows || 0} 行 · 删除 ${result.seatable.deleted_raw_rows || 0} 行`
      : result.seatable?.ok
      ? `SeaTable 主表 ${result.seatable.patients || result.seatable.updated || 0} · 药敏 ${result.seatable.drugs || 0} · 随访 ${result.seatable.followups || 0} · 删除 ${deletedStructured}`
      : `SeaTable未写入: ${result.seatable?.error || '未配置'}`;
    syncSummary(payload, `${mode}保存 ${result.saved_at}`);
    statusEl.textContent = `${mode}保存完成 · ${seatableText}`;
    if (hasRawTables(payload) && rawPayloadHasNewRows(payload)) {
      statusEl.textContent = '新增行已写入 SeaTable，正在刷新 row_id';
      window.setTimeout(() => refreshFromSeaTable('自动'), 300);
    }
  } catch (error) {
    statusEl.textContent = `${mode}保存失败`;
    summaryEl.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    if (mode === '手动') saveSyncEl.disabled = false;
    isSaving = false;
  }
}

async function refreshFromSeaTable(mode: '手动' | '自动') {
  if (isRefreshing) return;
  isRefreshing = true;
  try {
    if (mode === '手动') refreshSyncEl.disabled = true;
    statusEl.textContent = mode === '自动' ? '检测到 SeaTable 新版本，正在覆盖刷新' : '正在从 SeaTable 刷新';
    const response = await fetch('/api/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
    const counts = result.counts || {};
    summaryEl.textContent = `SeaTable 已刷新 · 患者 ${counts.patients || 0} · 药敏 ${counts.drugs || 0} · 随访 ${counts.followups || 0}`;
    statusEl.textContent = '刷新完成，正在重载';
    window.setTimeout(() => window.location.reload(), 500);
  } catch (error) {
    isRefreshing = false;
    statusEl.textContent = '刷新失败';
    summaryEl.textContent = error instanceof Error ? error.message : String(error);
    if (mode === '手动') refreshSyncEl.disabled = false;
  }
}

async function pollRemoteState() {
  const response = await fetch('/api/remote-state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return result.state || {};
}

function startRealtimeSync() {
  if (currentPayload && !hasRawTables(currentPayload) && !expanded && !workbookHeaders(currentPayload).length) {
    statusEl.textContent = '摘要视图已加载，展开药敏后启用实时写回';
    return;
  }
  window.setTimeout(async () => {
    try {
      const snapshot = await workbookSnapshot(false);
      lastSavedWorkbookHash = workbookHash(snapshot);
      const state = await pollRemoteState();
      lastRemoteSignature = state.signature || '';
      statusEl.textContent = '实时同步中';
    } catch (error) {
      statusEl.textContent = '实时同步初始化失败';
    }
  }, 3000);

  window.setInterval(async () => {
    if (isSaving || isRefreshing) return;
    try {
      const state = await pollRemoteState();
      const signature = state.signature || '';
      if (!signature || signature === lastRemoteSignature) return;
      if (Date.now() - lastLocalSaveAt < SELF_SAVE_GRACE_MS) {
        lastRemoteSignature = signature;
        return;
      }
      await refreshFromSeaTable('自动');
    } catch (error) {
      statusEl.textContent = 'SeaTable 远端检查失败';
    }
  }, REMOTE_POLL_INTERVAL_MS);
}

async function boot() {
  document.body.classList.add('sheet-mode');
  document.querySelectorAll<HTMLElement>('.table-action').forEach((item) => {
    item.hidden = false;
  });
  const openSheetEl = document.getElementById('openSheet');
  if (openSheetEl) openSheetEl.hidden = true;
  document.getElementById('app')!.innerHTML = '';
  let payload: FollowupPayload = await fetch('/followup.json').then((response) => response.json());
  if (!hasRawTables(payload)) {
    statusEl.textContent = '正在从 SeaTable 初始化原表 sheets';
    const response = await fetch('/api/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
    payload = result.payload;
  }
  currentPayload = payload;
  summaryEl.hidden = false;
  const metas = buildColumnMeta();
  const hiddenCount = metas.filter((meta) => getHiddenColumnKeys().has(meta.key)).length;
  if (hasRawTables(payload)) {
    const rawRows = (payload.raw_tables || []).reduce((sum, table) => sum + (table.rows?.length || 0), 0);
    summaryEl.textContent = `${payload.raw_tables?.length || 0} 张 SeaTable 表 · ${rawRows} 行`;
    [
      toggleEl,
      reloadEl,
      expandAllEl,
      collapseAllEl,
      toggleClinicalGroupEl,
      togglePathologyGroupEl,
      toggleMolecularGroupEl,
      toggleImagingGroupEl,
      toggleDrugGroupEl,
      toggleFollowupGroupEl,
      columnPanelToggleEl,
    ].forEach((item) => {
      item.hidden = true;
    });
    columnPanelEl.hidden = true;
  } else {
    summaryEl.textContent = `${payload.patients.length} 位患者 · 药敏 ${payload.drug_sensitivity.length} 条 · 随访 ${payload.followups.length} 条 · ${expanded ? '药敏明细展开' : '药敏摘要视图'} · 隐藏 ${hiddenCount} 列`;
    toggleEl.textContent = expanded ? '收起药敏明细' : '展开药敏明细';
    renderColumnPanel();
  }

  const univer = new Univer({
    locale: LocaleType.ZH_CN,
    locales: {
      [LocaleType.ZH_CN]: mergeLocales(
        DesignZhCN,
        UIZhCN,
        DocsUIZhCN,
        SheetsZhCN,
        SheetsUIZhCN,
        SheetsFilterUIZhCN,
        SheetsSortUIZhCN,
      ),
    },
  });

  univer.registerPlugin(UniverRenderEnginePlugin);
  univer.registerPlugin(UniverFormulaEnginePlugin, { notExecuteFormula: true });
  univer.registerPlugin(UniverUIPlugin, { container: 'app' });
  univer.registerPlugin(UniverDocsPlugin);
  univer.registerPlugin(UniverDocsUIPlugin);
  univer.registerPlugin(UniverSheetsPlugin, {
    notExecuteFormula: true,
    autoHeightForMergedCells: false,
  });
  univer.registerPlugin(UniverSheetsUIPlugin);
  univer.registerPlugin(UniverSheetsNumfmtPlugin);
  univer.registerPlugin(UniverSheetsFilterPlugin);
  univer.registerPlugin(UniverSheetsFilterUIPlugin);
  univer.registerPlugin(UniverSheetsFormulaPlugin);
  univer.registerPlugin(UniverSheetsSortPlugin);
  univer.registerPlugin(UniverSheetsSortUIPlugin);
  univer.registerPlugin(UniverSheetsTablePlugin);

  univer.createUnit(UniverInstanceType.UNIVER_SHEET, makeWorkbook(payload) as any);
  (window as any).univer = univer;
  (window as any).univerAPI = FUniver.newAPI(univer);
  installLeftDoubleClickEditing();
  registerContextMenuActions();
  statusEl.textContent = '已加载，双击或输入可编辑';
  startRealtimeSync();
}

saveSyncEl.addEventListener('click', async () => {
  await saveCurrentWorkbook('手动', true);
});

refreshSyncEl.addEventListener('click', async () => {
  await refreshFromSeaTable('手动');
});

expandAllEl.addEventListener('click', showAllGroups);

collapseAllEl.addEventListener('click', collapseAllGroups);

toggleClinicalGroupEl.addEventListener('click', () => {
  toggleColumnGroup('clinical');
});

togglePathologyGroupEl.addEventListener('click', () => {
  toggleColumnGroup('pathology');
});

toggleMolecularGroupEl.addEventListener('click', () => {
  toggleColumnGroup('molecular');
});

toggleImagingGroupEl.addEventListener('click', () => {
  toggleColumnGroup('imaging');
});

toggleDrugGroupEl.addEventListener('click', () => {
  toggleColumnGroup('drug');
});

toggleFollowupGroupEl.addEventListener('click', () => {
  toggleColumnGroup('followup');
});

toggleEl.addEventListener('click', () => {
  localStorage.setItem('drug_columns_collapsed', expanded ? '1' : '0');
  window.location.reload();
});

reloadEl.addEventListener('click', () => {
  localStorage.removeItem('drug_columns_collapsed');
  localStorage.removeItem(HIDDEN_COLUMNS_KEY);
  window.location.reload();
});

columnPanelToggleEl.addEventListener('click', () => {
  renderColumnPanel();
  columnPanelEl.classList.toggle('hidden');
});

columnPanelEl.addEventListener('change', (event) => {
  const input = event.target instanceof HTMLInputElement ? event.target : null;
  if (!input) return;
  const metas = buildColumnMeta();
  const hidden = getHiddenColumnKeys();

  const columnKey = input.dataset.columnKey;
  if (columnKey) {
    if (input.checked) hidden.delete(columnKey);
    else hidden.add(columnKey);
    setHiddenColumnKeys(hidden);
    renderColumnPanel();
    columnPanelEl.classList.remove('hidden');
    statusEl.textContent = '列设置已修改';
    return;
  }

  const group = input.dataset.columnGroup as ColumnMeta['group'] | undefined;
  if (group) {
    metas.filter((meta) => meta.group === group).forEach((meta) => {
      if (input.checked) hidden.delete(meta.key);
      else hidden.add(meta.key);
    });
    setHiddenColumnKeys(hidden);
    renderColumnPanel();
    columnPanelEl.classList.remove('hidden');
    statusEl.textContent = '列设置已修改';
    return;
  }

  const drugName = input.dataset.drugName;
  if (drugName) {
    metas.filter((meta) => meta.drugName === drugName).forEach((meta) => {
      if (input.checked) hidden.delete(meta.key);
      else hidden.add(meta.key);
    });
    setHiddenColumnKeys(hidden);
    renderColumnPanel();
    columnPanelEl.classList.remove('hidden');
    statusEl.textContent = '列设置已修改';
  }
});

columnPanelEl.addEventListener('click', (event) => {
  const button = event.target instanceof HTMLElement ? event.target.closest('button[data-column-action]') : null;
  if (!(button instanceof HTMLButtonElement)) return;
  const action = button.dataset.columnAction;
  const metas = buildColumnMeta();
  const hidden = getHiddenColumnKeys();

  if (action === 'apply') {
    reloadForColumns();
    return;
  }
  if (action === 'close') {
    columnPanelEl.classList.add('hidden');
    return;
  }
  if (action === 'show-all') {
    setHiddenColumnKeys(new Set());
    reloadForColumns();
    return;
  }
  if (action === 'clinical') {
    const next = new Set<string>();
    metas.forEach((meta) => {
      if (meta.group !== 'basic' && meta.group !== 'drug') next.add(meta.key);
    });
    setHiddenColumnKeys(next);
    reloadForColumns();
    return;
  }
  if (action === 'hide-drug') {
    metas.filter((meta) => meta.group === 'drug').forEach((meta) => hidden.add(meta.key));
    setHiddenColumnKeys(hidden);
    reloadForColumns();
  }
});

boot().catch((error) => {
  statusEl.textContent = '加载失败';
  summaryEl.textContent = error instanceof Error ? error.message : String(error);
});
