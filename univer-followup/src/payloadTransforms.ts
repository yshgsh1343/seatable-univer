import {
  HEADER_ROWS,
  baseColumns,
  clinicalColumns,
  drugTypes,
  headerAliases,
  ihcColumns,
  imagingColumns,
  molecularColumns,
  pathologyColumns,
  workbookHeaders,
} from './columnModel';
import { hasRawTables, payloadFromRawSnapshot } from './rawPayload';
import { firstSnapshotSheet, sheetHeadersFromSnapshot } from './snapshotModel';
import { cellText, linesToText, parseAssayRaw } from './sheetUtils';
import type { DetailColumn, DrugRow, FollowupPayload, FollowupRow, Patient } from './types';

function byPatient<T extends Record<string, string>>(items: T[]) {
  return items.reduce<Record<string, T[]>>((acc, item) => {
    const id = item.patient_id || '';
    acc[id] ||= [];
    acc[id].push(item);
    return acc;
  }, {});
}

function splitDrugClinical(value: string, drug: string) {
  if (!value) return '';
  return value.includes('\n') || value.includes('【') ? value : `【${drug}】${value}`;
}

function applyXlsxAliases(patient: Patient) {
  patient.patient_id = patient['类器官样本号'] || patient.patient_id || '';
  patient['类器官样本号'] = patient.patient_id;
  Object.entries(headerAliases).forEach(([header, alias]) => {
    if (patient[header] !== undefined) patient[alias] = patient[header] || '';
  });
}

function applyDetailSnapshot(patient: Patient, columns: DetailColumn[], cells: any, row: number, startCol: number) {
  let col = startCol;
  columns.forEach((column) => {
    const value = cellText(cells[row]?.[col++]);
    if (column.sourceKey) patient[column.sourceKey] = value;
  });
  return col;
}

function payloadFromXlsxSnapshot(snapshot: any, original: FollowupPayload): FollowupPayload {
  const originalHeaders = workbookHeaders(original);
  const headers = sheetHeadersFromSnapshot(snapshot, originalHeaders);
  const sheet = firstSnapshotSheet(snapshot);
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

export function payloadFromSnapshot(snapshot: any, original: FollowupPayload, expanded: boolean): FollowupPayload {
  if (hasRawTables(original)) return payloadFromRawSnapshot(snapshot, original);
  if (workbookHeaders(original).length) return payloadFromXlsxSnapshot(snapshot, original);
  if (!expanded) {
    throw new Error('请先在列显示中切换到药敏明细后再保存联动');
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
    col = applyDetailSnapshot(patient, ihcColumns, cells, row, col);
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
