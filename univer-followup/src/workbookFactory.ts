import { HorizontalAlign, LocaleType } from '@univerjs/core';
import {
  EXTRA_EMPTY_ROWS,
  HEADER_ROWS,
  RAW_HEADER_ROWS,
  baseColumns,
  buildColumnMeta,
  clinicalColumns,
  colors,
  detailColumns,
  drugTypeColumns,
  drugTypes,
  globalColumns,
  groupForXlsxHeader,
  groupLabels,
  ihcColumns,
  imagingColumns,
  molecularColumns,
  pathologyColumns,
  workbookHeaders,
} from './columnModel';
import { hasRawTables, rawSheetId } from './rawPayload';
import { parseAssayRaw } from './sheetUtils';
import type { ColumnGroup, DetailColumn, DrugRow, FollowupPayload, FollowupRow, Patient } from './types';

interface WorkbookOptions {
  expanded: boolean;
  hiddenColumns: Set<string>;
}

function byPatient<T extends Record<string, string>>(items: T[]) {
  return items.reduce<Record<string, T[]>>((acc, item) => {
    const id = item.patient_id || '';
    acc[id] ||= [];
    acc[id].push(item);
    return acc;
  }, {});
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

function xlsxValue(patient: Patient, header: string, drugs: DrugRow[], followups: FollowupRow[]) {
  if (patient[header]) return patient[header];
  const alias = {
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
  }[header];
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
  ihc: 'groupIhc',
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
      body: { fs: 11, vt: 2, ht: HorizontalAlign.LEFT },
      wrap: { fs: 11, vt: 1, ht: HorizontalAlign.LEFT, tb: 2 },
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

function makeXlsxWorkbook(payload: FollowupPayload, options: WorkbookOptions) {
  const headers = workbookHeaders(payload);
  const drugMap = byPatient(payload.drug_sensitivity);
  const followupMap = byPatient(payload.followups);
  const columnMeta = buildColumnMeta(payload, options.expanded);
  const hiddenColumns = options.hiddenColumns;
  const cells: any = {};
  const merges: any[] = [];
  const columnData: any = {};
  const rowData: any = {
    0: { h: 34 },
    1: { h: 32 },
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
    styles: workbookStyles(true),
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

function workbookStyles(xlsxMode = false) {
  return {
    groupBasic: { bg: { rgb: colors.basic }, bl: 1, ht: 2, vt: 2, fs: 12 },
    groupClinical: { bg: { rgb: colors.clinical }, bl: 1, ht: 2, vt: 2, fs: 12 },
    groupPathology: { bg: { rgb: colors.pathology }, bl: 1, ht: 2, vt: 2, fs: 12 },
    groupIhc: { bg: { rgb: colors.ihc }, bl: 1, ht: 2, vt: 2, fs: 12 },
    groupMolecular: { bg: { rgb: colors.molecular }, bl: 1, ht: 2, vt: 2, fs: 12 },
    groupImaging: { bg: { rgb: colors.imaging }, bl: 1, ht: 2, vt: 2, fs: 12 },
    groupDrug: { bg: { rgb: colors.drug }, bl: 1, ht: 2, vt: 2, fs: 12 },
    groupFollowup: { bg: { rgb: colors.followup }, bl: 1, ht: 2, vt: 2, fs: 12 },
    subDrug: { bg: { rgb: '#BBF7D0' }, bl: 1, ht: 2, vt: 2, fs: 11 },
    header: { bg: { rgb: colors.header }, bl: 1, ht: 2, vt: 2, fs: 11, tb: xlsxMode ? 2 : undefined },
    body: { fs: 11, vt: 2, ht: HorizontalAlign.LEFT },
    wrap: { fs: 11, vt: 1, ht: HorizontalAlign.LEFT, tb: 2 },
    high: { bg: { rgb: colors.high }, fs: 11, vt: 2, ht: HorizontalAlign.LEFT },
    warn: { bg: { rgb: colors.warn }, fs: 11, vt: 2, ht: HorizontalAlign.LEFT },
  };
}

export function makeWorkbook(payload: FollowupPayload, options: WorkbookOptions) {
  if (hasRawTables(payload)) return makeRawWorkbook(payload);
  if (workbookHeaders(payload).length) return makeXlsxWorkbook(payload, options);
  const drugMap = byPatient(payload.drug_sensitivity);
  const followupMap = byPatient(payload.followups);
  const columnMeta = buildColumnMeta(payload, options.expanded);
  const hiddenColumns = options.hiddenColumns;
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
  col = putDetailHeader(cells, merges, col, 'ihc', ihcColumns);
  col = putDetailHeader(cells, merges, col, 'molecular', molecularColumns);
  col = putDetailHeader(cells, merges, col, 'imaging', imagingColumns);

  const drugStart = col;
  if (options.expanded) {
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
    dataCol = putDetailRow(cells, row, dataCol, patient, ihcColumns);
    dataCol = putDetailRow(cells, row, dataCol, patient, molecularColumns);
    dataCol = putDetailRow(cells, row, dataCol, patient, imagingColumns);

    if (options.expanded) {
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
    styles: workbookStyles(false),
    sheets: {
      'followup-sheet': {
        id: 'followup-sheet',
        name: options.expanded ? '随访总表-药敏展开' : '随访总表-药敏摘要',
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
