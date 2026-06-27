import type { FollowupPayload, RawRow, RawTable } from './types';
import { RAW_HEADER_ROWS, RAW_SHEET_PREFIX } from './columnModel';
import { cellText } from './sheetUtils';

export function rawSheetId(index: number) {
  return `${RAW_SHEET_PREFIX}${index}`;
}

export function hasRawTables(payload: FollowupPayload) {
  return Array.isArray(payload.raw_tables) && payload.raw_tables.length > 0;
}

export function rawTableIndexFromSheetId(sheetId: string) {
  if (!sheetId.startsWith(RAW_SHEET_PREFIX)) return -1;
  const index = Number(sheetId.slice(RAW_SHEET_PREFIX.length));
  return Number.isInteger(index) ? index : -1;
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

function rawColumnsFromSnapshot(sheet: any, table: RawTable) {
  const cells = sheet?.cellData || {};
  const fallback = table.columns || [];
  const columnCount = Math.max(sheet?.columnCount || 0, fallback.length + 1);
  const seen = new Set<string>();
  const columns: string[] = [];

  for (let col = 1; col < columnCount; col += 1) {
    const header = cellText(cells[0]?.[col]) || fallback[col - 1] || '';
    const name = header.trim();
    if (!name || name === '_id' || seen.has(name)) continue;
    seen.add(name);
    columns.push(name);
  }
  return columns;
}

export function payloadFromRawSnapshot(snapshot: any, original: FollowupPayload): FollowupPayload {
  const rawTables = original.raw_tables || [];
  const nextTables: RawTable[] = [];
  const changedTables: string[] = [];
  const markChanged = (name: string) => {
    if (name && !changedTables.includes(name)) changedTables.push(name);
  };

  rawTables.forEach((table, tableIndex) => {
    const sheet = snapshot?.sheets?.[rawSheetId(tableIndex)];
    if (!sheet) {
      nextTables.push(table);
      return;
    }
    const cells = sheet?.cellData || {};
    const columns = rawColumnsFromSnapshot(sheet, table);
    const nextRows: RawRow[] = [];
    const rowCount = sheet?.rowCount || 0;

    for (let row = RAW_HEADER_ROWS; row < rowCount; row += 1) {
      const rowID = cellText(cells[row]?.[0]);
      const values: RawRow = { _id: rowID };
      let hasValue = Boolean(rowID);
      columns.forEach((column, index) => {
        const value = cellText(cells[row]?.[index + 1]);
        values[column] = value;
        if (value) hasValue = true;
      });
      if (hasValue) nextRows.push(values);
    }

    if (comparableRawRows(nextRows, columns) !== comparableRawRows(table.rows || [], columns)) {
      markChanged(table.name);
    }
    if (JSON.stringify(columns) !== JSON.stringify(table.columns || [])) {
      markChanged(table.name);
    }
    nextTables.push({ ...table, columns, rows: nextRows });
  });

  return {
    ...original,
    generated_at: new Date().toISOString(),
    raw_tables: nextTables,
    changed_raw_tables: changedTables,
  };
}

export function rawPayloadHasNewRows(payload: FollowupPayload) {
  const changed = new Set(payload.changed_raw_tables || []);
  return (payload.raw_tables || []).some((table) => {
    return changed.has(table.name) && (table.rows || []).some((row) => !String(row._id || '').trim());
  });
}
