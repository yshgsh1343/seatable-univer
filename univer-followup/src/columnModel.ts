import xlsxHeaderTemplate from '../xlsx_headers.json';
import type { ColumnGroup, ColumnMeta, DetailColumn, FollowupPayload, RawTable } from './types';
import { columnAddress, slug } from './sheetUtils';

export const HEADER_ROWS = 2;
export const EXTRA_EMPTY_ROWS = 5;
export const HIDDEN_COLUMNS_KEY = 'hidden_columns_v2';
export const CUSTOM_COLUMN_GROUPS_KEY = 'custom_column_groups_v1';
export const REMOTE_POLL_INTERVAL_MS = 60000;
export const AUTO_SAVE_INTERVAL_MS = 4000;
export const SELF_SAVE_GRACE_MS = 12000;
export const RAW_HEADER_ROWS = 1;
export const RAW_SHEET_PREFIX = 'seatable-raw-';

export const xlsxHeaders = xlsxHeaderTemplate as string[];
export const headerAliases: Record<string, string> = {
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

export const baseColumns = ['患者ID', '姓名', '性别', '年龄', '取样时间', '取样方式', '癌种'];
export const clinicalColumns: DetailColumn[] = [
  { key: 'clinical-diagnosis', label: '临床诊断', sourceKey: '临床诊断结果', width: 140 },
  { key: 'course', label: '病程', sourceKey: '病程', width: 96 },
  { key: 'treatment-history', label: '治疗史', sourceKey: '治疗史', width: 260 },
];
export const pathologyColumns: DetailColumn[] = [
  { key: 'pathology-diagnosis', label: '病理诊断', sourceKey: '病理诊断结果', width: 160 },
];
export const ihcColumns: DetailColumn[] = [
  { key: 'ihc-raw', label: '免疫组化原文', sourceKey: '免疫组化结果', width: 260 },
];
export const molecularColumns: DetailColumn[] = [
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
export const imagingColumns: DetailColumn[] = [
  { key: 'imaging', label: '影像评估', sourceKey: '影像评估', width: 260 },
];
export const detailColumns = [...clinicalColumns, ...pathologyColumns, ...ihcColumns, ...molecularColumns, ...imagingColumns];
export const globalColumns = ['随访条数', '随访摘要', '药敏结果原文'];
export const drugTypes = [
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
export const drugTypeColumns = [
  { key: 'ic50', label: 'IC50' },
  { key: 'inhibition', label: '抑制率' },
  { key: 'plan', label: '术后方案' },
  { key: 'efficacy', label: '疗效评估' },
  { key: 'outcome', label: '临床结局' },
  { key: 'followup', label: '随访' },
];
export const groupLabels = {
  basic: '基本信息',
  clinical: '临床信息',
  pathology: '病理',
  ihc: '组化',
  molecular: '分子标志',
  imaging: '影像评估',
  drug: '按药物类型',
  followup: '全局记录',
} as const;
export const groupOrder: ColumnMeta['group'][] = ['basic', 'clinical', 'pathology', 'ihc', 'molecular', 'imaging', 'drug', 'followup'];
export const droppedXlsxHeaders = new Set(['序号']);

export const colors = {
  basic: '#DCEBFF',
  clinical: '#E0F2FE',
  pathology: '#FFE7C2',
  ihc: '#FEF3C7',
  molecular: '#F3E8FF',
  imaging: '#E5E7EB',
  drug: '#DCFCE7',
  followup: '#E0F2FE',
  header: '#F8FAFC',
  high: '#D1FAE5',
  warn: '#FEF3C7',
};

function detailMeta(group: ColumnGroup, columns: DetailColumn[]) {
  return columns.map((column) => ({
    key: `${group}.${column.key}`,
    label: column.label,
    group,
    groupLabel: groupLabels[group],
    sourceKey: column.sourceKey,
  }));
}

function uniqueColumnKey(base: string, used: Set<string>, index: number) {
  let key = base;
  let suffix = 0;
  while (used.has(key)) {
    suffix += 1;
    key = `${base}.${index}${suffix > 1 ? `-${suffix}` : ''}`;
  }
  used.add(key);
  return key;
}

export function xlsxColumnMetaFromHeaders(headers: string[]) {
  const used = new Set<string>();
  return headers.map((rawHeader, index) => {
    const header = String(rawHeader || '').trim() || `第${columnAddress(index)}列`;
    const group = groupForXlsxHeader(header);
    return {
      key: uniqueColumnKey(`xlsx.${slug(header)}`, used, index),
      label: header,
      group,
      groupLabel: groupLabels[group],
      sourceKey: header,
      drugName: header.startsWith('药敏_') ? header.slice(3) : undefined,
    };
  });
}

export function rawColumnKey(tableName: string, columnName: string, index: number) {
  return `raw.${slug(tableName || 'table')}.${slug(columnName || columnAddress(index))}.${index}`;
}

export function rawColumnMeta(table: RawTable | undefined) {
  if (!table) return [];
  return (table.columns || []).map((column, index) => {
    const label = String(column || '').trim() || `第${columnAddress(index + 1)}列`;
    const group = groupForXlsxHeader(label);
    return {
      key: rawColumnKey(table.name, label, index),
      label,
      group,
      groupLabel: groupLabels[group],
      sourceKey: label,
    };
  });
}

export function workbookHeaders(payload: FollowupPayload | null) {
  const headers = payload?.xlsx_headers;
  const sourceHeaders = Array.isArray(headers) && headers.length ? headers : xlsxHeaders;
  return sourceHeaders.filter((header) => !droppedXlsxHeaders.has(String(header).trim()));
}

export function groupForXlsxHeader(header: string): ColumnGroup {
  if (header.startsWith('药敏_')) return 'drug';
  if (header.startsWith('临床诊断_') || header.startsWith('病程_')) return 'clinical';
  if (header.startsWith('病理诊断_')) return 'pathology';
  if (header.startsWith('免疫组化_')) return 'ihc';
  if (header.startsWith('临床结局/疗效_') || header.includes('随访')) return 'followup';
  if (header.includes('分子分型')) return 'molecular';
  if (header.includes('MR/CT') || header.includes('影像')) return 'imaging';
  if (['临床诊断结果', '初治/复发', '如复发-->治疗史'].includes(header)) return 'clinical';
  if (header === '病理诊断结果') return 'pathology';
  if (header === '免疫组化结果') return 'ihc';
  return 'basic';
}

export function buildColumnMeta(payload: FollowupPayload | null, expanded: boolean) {
  const headers = workbookHeaders(payload);
  if (headers.length) {
    return xlsxColumnMetaFromHeaders(headers);
  }
  const metas: ColumnMeta[] = [];
  baseColumns.forEach((label) => metas.push({ key: `basic.${slug(label)}`, label, group: 'basic', groupLabel: groupLabels.basic }));
  metas.push(...detailMeta('clinical', clinicalColumns));
  metas.push(...detailMeta('pathology', pathologyColumns));
  metas.push(...detailMeta('ihc', ihcColumns));
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
