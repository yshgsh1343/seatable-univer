import { HEADER_ROWS } from './columnModel';
import { xlsxColumnMetaFromHeaders } from './columnModel';
import { cellText, columnAddress } from './sheetUtils';

export function firstSnapshotSheet(snapshot: any) {
  const sheets = snapshot?.sheets || {};
  if (sheets['followup-sheet']) return sheets['followup-sheet'];
  const orderedIds = Array.isArray(snapshot?.sheetOrder) ? snapshot.sheetOrder : [];
  const orderedSheet = orderedIds.map((id: string) => sheets[id]).find(Boolean);
  if (orderedSheet) return orderedSheet;
  return Object.values(sheets)[0] || null;
}

function snapshotSheetColumnCount(sheet: any, fallbackLength = 0) {
  let count = Math.max(Number(sheet?.columnCount) || 0, fallbackLength);
  Object.values(sheet?.cellData || {}).forEach((row: any) => {
    Object.keys(row || {}).forEach((column) => {
      const index = Number(column);
      if (Number.isFinite(index)) count = Math.max(count, index + 1);
    });
  });
  return count;
}

function mergedHeaderCellText(sheet: any, rowIndex: number, columnIndex: number) {
  const cells = sheet?.cellData || {};
  const direct = cellText(cells[rowIndex]?.[columnIndex]);
  if (direct) return direct;
  const merge = (sheet?.mergeData || []).find((item: any) => (
    item.startRow <= rowIndex
    && item.endRow >= rowIndex
    && item.startColumn <= columnIndex
    && item.endColumn >= columnIndex
  ));
  return merge ? cellText(cells[merge.startRow]?.[merge.startColumn]) : '';
}

function rowFilledCellCount(sheet: any, rowIndex: number, columnCount: number) {
  const scanColumns = snapshotSheetColumnCount(sheet, columnCount);
  let count = 0;
  for (let col = 0; col < scanColumns; col += 1) {
    if (mergedHeaderCellText(sheet, rowIndex, col)) count += 1;
  }
  return count;
}

function sheetHeaderRowIndex(sheet: any, preferredRow = HEADER_ROWS - 1) {
  const columnCount = snapshotSheetColumnCount(sheet);
  if (rowFilledCellCount(sheet, preferredRow, columnCount) > 0) return preferredRow;
  const candidates = [preferredRow, 0, 1, 2].filter((row, index, rows) => row >= 0 && rows.indexOf(row) === index);
  let bestRow = preferredRow;
  let bestCount = -1;
  candidates.forEach((row) => {
    const count = rowFilledCellCount(sheet, row, columnCount);
    if (count > bestCount) {
      bestRow = row;
      bestCount = count;
    }
  });
  return bestCount > 0 ? bestRow : preferredRow;
}

export function sheetHeadersFromSnapshot(snapshot: any, fallbackHeaders: string[] = [], preferredRow = HEADER_ROWS - 1) {
  const sheet = firstSnapshotSheet(snapshot);
  if (!sheet) return [];
  const rowIndex = sheetHeaderRowIndex(sheet, preferredRow);
  const scanColumns = snapshotSheetColumnCount(sheet) || fallbackHeaders.length;
  const headers: string[] = [];
  for (let col = 0; col < scanColumns; col += 1) {
    const header = mergedHeaderCellText(sheet, rowIndex, col) || fallbackHeaders[col] || `第${columnAddress(col)}列`;
    headers.push(header);
  }
  return headers;
}

export function sheetColumnMetaFromSnapshot(snapshot: any, preferredRow = HEADER_ROWS - 1) {
  const metas = xlsxColumnMetaFromHeaders(sheetHeadersFromSnapshot(snapshot, [], preferredRow));
  return metas.filter((meta) => meta.label.trim());
}
