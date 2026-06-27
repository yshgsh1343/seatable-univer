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
import { UniverSheetsFormulaUIPlugin } from '@univerjs/sheets-formula-ui';
import SheetsFormulaUIZhCN from '@univerjs/sheets-formula-ui/locale/zh-CN';
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
import '@univerjs/sheets-formula-ui/lib/index.css';
import '@univerjs/sheets-sort-ui/lib/index.css';
import '@univerjs/sheets/facade';
import '@univerjs/ui/facade';
import '@univerjs/sheets-ui/facade';
import '@univerjs/engine-formula/facade';
import '@univerjs/sheets-numfmt/facade';
import '@univerjs/sheets-filter/facade';
import '@univerjs/sheets-sort/facade';
import '@univerjs/sheets-table/facade';

import { baseKey, payloadBaseName as payloadBaseNameFromPayload, payloadWorkspaceID as payloadWorkspaceIDFromPayload, sameBase } from './baseModel';
import {
  AUTO_SAVE_INTERVAL_MS,
  CUSTOM_COLUMN_GROUPS_KEY,
  HEADER_ROWS,
  HIDDEN_COLUMNS_KEY,
  RAW_HEADER_ROWS,
  REMOTE_POLL_INTERVAL_MS,
  SELF_SAVE_GRACE_MS,
  buildColumnMeta as buildColumnMetaForPayload,
  drugTypes,
  groupLabels,
  groupOrder,
  rawColumnMeta,
  workbookHeaders as workbookHeadersForPayload,
} from './columnModel';
import { payloadFromSnapshot as payloadFromSnapshotForSave } from './payloadTransforms';
import { hasRawTables, rawPayloadHasNewRows, rawSheetId, rawTableIndexFromSheetId } from './rawPayload';
import { sheetColumnMetaFromSnapshot } from './snapshotModel';
import { columnAddress, escapeHtml, slug } from './sheetUtils';
import type {
  ColumnGroup,
  ColumnMeta,
  CustomColumnGroup,
  CustomColumnGroupConfig,
  FollowupPayload,
  SeaTableBase,
} from './types';
import { makeWorkbook as createWorkbook } from './workbookFactory';

const expanded = localStorage.getItem('drug_columns_collapsed') === '0';
const ACTIVE_RAW_TABLE_KEY = 'active_raw_table_index_v1';

const summaryEl = document.getElementById('summary')!;
const baseSwitchEl = document.getElementById('baseSwitch') as HTMLSelectElement;
const rawTableSwitchEl = document.getElementById('rawTableSwitch') as HTMLSelectElement;
const statusEl = document.getElementById('status')!;
const reloadEl = document.getElementById('reloadFull') as HTMLButtonElement;
const saveSyncEl = document.getElementById('saveSync') as HTMLButtonElement;
const refreshSyncEl = document.getElementById('refreshSync') as HTMLButtonElement;
const customGroupToggleEl = document.getElementById('customGroupToggle') as HTMLButtonElement;
const columnPanelToggleEl = document.getElementById('columnPanelToggle') as HTMLButtonElement;
const customGroupPanelEl = document.getElementById('customGroupPanel')!;
const columnPanelEl = document.getElementById('columnPanel')!;

let currentPayload: FollowupPayload | null = null;
let availableBases: SeaTableBase[] = [];
let selectedBase: SeaTableBase | null = null;
let isSaving = false;
let isRefreshing = false;
let lastSavedWorkbookHash = '';
let lastRemoteSignature = '';
let lastLocalSaveAt = 0;
let currentUniver: any = null;
let activeSheetSubscription: { unsubscribe?: () => void; dispose?: () => void } | null = null;
let syncInitTimer: number | null = null;
let syncPollTimer: number | null = null;
let syncAutoSaveTimer: number | null = null;
let customColumnGroups: CustomColumnGroupConfig = { version: 1, groups: [] };
let customColumnGroupEditorOpen = false;
let lastCustomGroupMetas: ColumnMeta[] = [];

function payloadBaseName(payload: FollowupPayload | null = currentPayload) {
  return payloadBaseNameFromPayload(payload);
}

function payloadWorkspaceID(payload: FollowupPayload | null = currentPayload) {
  return payloadWorkspaceIDFromPayload(payload);
}

function findBase(name: string, workspaceID = '') {
  const trimmedName = name.trim();
  const trimmedWorkspaceID = workspaceID.trim();
  if (!trimmedName) return null;
  return availableBases.find((base) => sameBase(base, trimmedName, trimmedWorkspaceID))
    || availableBases.find((base) => base.name === trimmedName)
    || null;
}

function baseByKey(key: string) {
  return availableBases.find((base) => baseKey(base) === key) || null;
}

function currentBaseRequest() {
  const baseName = selectedBase?.name || payloadBaseName();
  const workspaceID = selectedBase?.workspace_id || payloadWorkspaceID();
  return {
    base_name: baseName,
    workspace_id: workspaceID,
  };
}

function attachCurrentBase(payload: FollowupPayload): FollowupPayload {
  const current = currentBaseRequest();
  if (!current.base_name) return payload;
  return {
    ...payload,
    source: `SeaTable:${current.base_name}`,
    base_name: current.base_name,
    workspace_id: current.workspace_id,
  };
}

function workbookHeaders(payload: FollowupPayload | null = currentPayload) {
  return workbookHeadersForPayload(payload);
}

function activeRawTableIndex() {
  if (!currentPayload || !hasRawTables(currentPayload)) return -1;
  const activeSheetId = String(activeWorkbook()?.getActiveSheet?.()?.getSheetId?.() || '');
  const sheetIndex = rawTableIndexFromSheetId(activeSheetId);
  if (sheetIndex >= 0 && currentPayload.raw_tables?.[sheetIndex]) return sheetIndex;
  const switchIndex = Number(rawTableSwitchEl.value);
  if (Number.isInteger(switchIndex) && currentPayload.raw_tables?.[switchIndex]) return switchIndex;
  return 0;
}

function activeRawTableColumnMeta() {
  if (!currentPayload || !hasRawTables(currentPayload)) return [];
  return rawColumnMeta(currentPayload.raw_tables?.[activeRawTableIndex()]);
}

function rawTableDisplayRows(table: { rows?: unknown[]; row_count?: number } | undefined) {
  if (!table) return 0;
  return Number(table.row_count) || table.rows?.length || 0;
}

function rawRefreshIndex() {
  const savedIndex = Number(localStorage.getItem(ACTIVE_RAW_TABLE_KEY) || rawTableSwitchEl.value || '0');
  return Number.isInteger(savedIndex) && savedIndex >= 0 ? savedIndex : 0;
}

function refreshRequestBody(force: boolean) {
  return {
    force,
    lazy_raw: true,
    raw_table_index: rawRefreshIndex(),
    ...currentBaseRequest(),
  };
}

function buildColumnMeta() {
  if (currentPayload && hasRawTables(currentPayload)) return activeRawTableColumnMeta();
  return buildColumnMetaForPayload(currentPayload, expanded);
}

function customGroupMetasForCurrentPanel() {
  return lastCustomGroupMetas.length ? lastCustomGroupMetas : buildColumnMeta();
}

async function currentTableColumnMeta() {
  const fallback = buildColumnMeta();
  if (!currentPayload || hasRawTables(currentPayload) || !workbookHeaders(currentPayload).length) return fallback;
  try {
    const snapshot = await workbookSnapshot(false);
    const metas = sheetColumnMetaFromSnapshot(snapshot);
    return metas.length ? metas : fallback;
  } catch {
    return fallback;
  }
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

function normalizeCustomColumnGroups(value: any): CustomColumnGroupConfig {
  const rawGroups = Array.isArray(value?.groups) ? value.groups : [];
  const groups = rawGroups.map((group: any) => ({
    name: String(group?.name || '').trim(),
    columns: Array.isArray(group?.columns) ? group.columns.map((item: any) => String(item).trim()).filter(Boolean) : [],
    keys: Array.isArray(group?.keys) ? group.keys.map((item: any) => String(item).trim()).filter(Boolean) : [],
    match: Array.isArray(group?.match) ? group.match.map((item: any) => String(item).trim()).filter(Boolean) : [],
  })).filter((group: CustomColumnGroup) => group.name && (
    (group.columns?.length || 0) > 0
    || (group.keys?.length || 0) > 0
    || (group.match?.length || 0) > 0
  ));
  return { version: Number(value?.version) || 1, groups };
}

async function loadCustomColumnGroups() {
  try {
    const response = await fetch('/api/column-groups', { method: 'GET' });
    if (response.ok) {
      customColumnGroups = normalizeCustomColumnGroups(await response.json());
      localStorage.setItem(CUSTOM_COLUMN_GROUPS_KEY, JSON.stringify(customColumnGroups));
      return;
    }
  } catch {
    // Fall back to browser-local configuration when the Go API is not available.
  }
  try {
    customColumnGroups = normalizeCustomColumnGroups(JSON.parse(localStorage.getItem(CUSTOM_COLUMN_GROUPS_KEY) || '{}'));
  } catch {
    customColumnGroups = { version: 1, groups: [] };
  }
}

async function saveCustomColumnGroups(config: CustomColumnGroupConfig) {
  const normalized = normalizeCustomColumnGroups(config);
  customColumnGroups = normalized;
  localStorage.setItem(CUSTOM_COLUMN_GROUPS_KEY, JSON.stringify(normalized));
  const response = await fetch('/api/column-groups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(normalized),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok === false) throw new Error(result.error || `HTTP ${response.status}`);
}

function customGroupColumnKeys(group: CustomColumnGroup, metas = buildColumnMeta()) {
  const exact = new Set([...(group.columns || []), ...(group.keys || [])].map((item) => item.toLowerCase()));
  const matches = (group.match || []).map((item) => item.toLowerCase());
  const keys = metas.filter((meta) => {
    const values = [meta.key, meta.label, meta.sourceKey || '', meta.drugName || '', meta.drugField || '']
      .filter(Boolean)
      .map((item) => item.toLowerCase());
    return values.some((value) => exact.has(value)) || matches.some((pattern) => values.some((value) => value.includes(pattern)));
  }).map((meta) => meta.key);
  return new Set(keys);
}

function customGroupsTemplate(metas = buildColumnMeta()) {
  return {
    version: 1,
    groups: [
      {
        name: '核心信息',
        columns: metas.slice(0, Math.min(8, metas.length)).map((meta) => meta.label),
      },
      {
        name: '随访相关',
        match: ['随访', '结局', '疗效'],
      },
    ],
  };
}

function renderCustomGroupColumnPicker(group: CustomColumnGroup, metas: ColumnMeta[]) {
  const selectedKeys = customGroupColumnKeys(group, metas);
  const selectedCount = metas.filter((meta) => selectedKeys.has(meta.key)).length;
  const columnItems = metas.map((meta, index) => `
    <label class="custom-group-column-option" title="${escapeHtml(columnAddress(index))} ${escapeHtml(meta.label)}">
      <input
        type="checkbox"
        data-custom-column-label="${escapeHtml(meta.label)}"
        ${selectedKeys.has(meta.key) ? 'checked' : ''}
      />
      <span class="custom-group-column-address">${columnAddress(index)}</span>
      <span class="custom-group-column-label">${escapeHtml(meta.label)}</span>
    </label>
  `).join('');
  return `
    <section class="custom-group-column-section">
      <div class="custom-group-column-section-head">
        <label>
          <input type="checkbox" data-custom-section-toggle="all-table-columns" />
          <span>表格列</span>
        </label>
        <span class="custom-group-column-count">${selectedCount}/${metas.length}</span>
      </div>
      <div class="custom-group-column-options">${columnItems}</div>
    </section>
  `;
}

function reloadForColumns() {
  statusEl.textContent = '正在应用列显示';
  window.location.reload();
}

function setVisibleColumnGroups(groups: ColumnGroup[]) {
  const visible = new Set(groups);
  const hidden = new Set<string>();
  buildColumnMeta().forEach((meta) => {
    if (!visible.has(meta.group)) hidden.add(meta.key);
  });
  setHiddenColumnKeys(hidden);
  reloadForColumns();
}

function restoreDefaultColumns() {
  localStorage.removeItem(HIDDEN_COLUMNS_KEY);
  localStorage.removeItem('drug_columns_collapsed');
  reloadForColumns();
}

function renderCustomColumnGroups(metas: ColumnMeta[], hidden: Set<string>) {
  const groups = customColumnGroups.groups || [];
  const groupCards = groups.length ? groups.map((group, index) => {
    const keys = customGroupColumnKeys(group, metas);
    const groupMetas = metas.filter((meta) => keys.has(meta.key));
    const visibleCount = groupMetas.filter((meta) => !hidden.has(meta.key)).length;
    const allVisible = groupMetas.length > 0 && visibleCount === groupMetas.length;
    const columnNames = groupMetas.slice(0, 8).map((meta) => meta.label).join('、');
    return `
      <section class="custom-column-group">
        <div class="custom-column-group-head">
          <div>
            <label class="custom-column-group-label">
              <input
                type="checkbox"
                data-custom-group-toggle="${index}"
                ${allVisible ? 'checked' : ''}
                ${groupMetas.length ? '' : 'disabled'}
              />
              <span class="custom-column-group-name">${escapeHtml(group.name)}</span>
            </label>
            <div class="custom-column-group-summary">${visibleCount}/${groupMetas.length} 列${columnNames ? ` · ${escapeHtml(columnNames)}` : ''}</div>
          </div>
          <div class="custom-column-group-actions">
            <button type="button" data-column-action="custom-only" data-custom-group-index="${index}">仅此组</button>
          </div>
        </div>
      </section>
    `;
  }).join('') : '<div class="custom-column-empty">未配置自定义分组</div>';
  const editorRows = groups.map((group, index) => `
    <div class="custom-group-form-row" data-custom-group-form-index="${index}">
      <div class="custom-group-form-row-head">
        <label>
          <span>分组名</span>
          <input data-custom-field="name" value="${escapeHtml(group.name)}" />
        </label>
        <span class="custom-group-form-count" data-custom-form-count>0/${metas.length} 列</span>
        <button type="button" data-column-action="custom-delete" data-custom-group-index="${index}">删除</button>
      </div>
      <div class="custom-group-column-picker">
        ${renderCustomGroupColumnPicker(group, metas)}
      </div>
    </div>
  `).join('');
  const editor = customColumnGroupEditorOpen ? `
    <div class="custom-column-editor">
      <div class="custom-group-form-head">
        <span>勾选表格列来定义分组</span>
        <div class="custom-column-editor-actions">
          <button type="button" data-column-action="custom-add">新增分组</button>
          <button type="button" data-column-action="custom-save-form">保存分组</button>
          <button type="button" data-column-action="custom-cancel">取消</button>
        </div>
      </div>
      <div class="custom-group-form">${editorRows || '<div class="custom-column-empty">暂无可编辑分组</div>'}</div>
    </div>
  ` : '';
  return `
    <section class="custom-column-panel">
      <div class="custom-column-panel-head">
        <div>
          <div class="custom-column-panel-title">自定义分组</div>
          <div class="custom-column-panel-summary">${groups.length} 组</div>
        </div>
        <div class="custom-column-panel-actions">
          <button type="button" data-column-action="custom-save-current">保存当前为分组</button>
          <button type="button" data-column-action="custom-edit">${customColumnGroupEditorOpen ? '收起编辑' : '编辑分组'}</button>
          <button type="button" data-column-action="custom-close">关闭</button>
        </div>
      </div>
      <div class="custom-column-groups">${groupCards}</div>
      ${editor}
    </section>
  `;
}

async function renderCustomGroupPanel() {
  const metas = await currentTableColumnMeta();
  lastCustomGroupMetas = metas;
  customGroupPanelEl.innerHTML = renderCustomColumnGroups(metas, getHiddenColumnKeys());
  customGroupPanelEl.querySelectorAll<HTMLElement>('.custom-group-form-row').forEach(updateCustomGroupFormCounts);
}

function renderColumnPanel() {
  const metas = buildColumnMeta();
  const hidden = getHiddenColumnKeys();
  const hiddenCount = metas.filter((meta) => hidden.has(meta.key)).length;
  const drugModeAction = workbookHeaders().length ? '' : `
        <button type="button" data-column-action="toggle-drug-detail">${expanded ? '药敏摘要' : '药敏明细'}</button>
  `;
  const visibleGroups = groupOrder.filter((group) => metas.some((meta) => meta.group === group));
  const panelGroups = visibleGroups.length ? visibleGroups : groupOrder;
  const groupShortcutHtml = panelGroups.map((group) => {
    const groupMetas = metas.filter((meta) => meta.group === group);
    const visibleCount = groupMetas.filter((meta) => !hidden.has(meta.key)).length;
    const allVisible = groupMetas.length > 0 && visibleCount === groupMetas.length;
    return `
        <label class="column-shortcut" title="${escapeHtml(groupLabels[group])}">
          <input type="checkbox" data-column-shortcut-group="${group}" ${allVisible ? 'checked' : ''} />
          <span>${groupLabels[group]}</span>
        </label>
    `;
  }).join('');
  const groupHtml = panelGroups.map((group) => {
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
        <button type="button" data-column-action="restore-default">恢复默认</button>
        <button type="button" data-column-action="show-all">全部显示</button>
        ${groupShortcutHtml}
        ${drugModeAction}
        <button type="button" data-column-action="close">关闭</button>
      </div>
    </div>
    <div class="column-groups">${groupHtml}</div>
  `;
}

function updateBaseSwitch(payload: FollowupPayload | null = null) {
  baseSwitchEl.replaceChildren();
  if (payload) {
    const payloadName = payloadBaseName(payload);
    const payloadWorkspace = payloadWorkspaceID(payload);
    const matched = findBase(payloadName, payloadWorkspace);
    if (matched) {
      selectedBase = matched;
    } else if (payloadName && !selectedBase) {
      selectedBase = { name: payloadName, workspace_id: payloadWorkspace };
    }
  }
  if (!selectedBase && availableBases.length) {
    selectedBase = availableBases[0];
  }

  const options = availableBases.length ? availableBases : selectedBase ? [selectedBase] : [];
  if (!options.length) {
    baseSwitchEl.hidden = true;
    baseSwitchEl.disabled = true;
    return;
  }

  options.forEach((base) => {
    const option = document.createElement('option');
    option.value = baseKey(base);
    option.textContent = base.label || base.name;
    baseSwitchEl.appendChild(option);
  });
  baseSwitchEl.hidden = false;
  baseSwitchEl.disabled = options.length < 2 || isRefreshing;
  if (selectedBase) baseSwitchEl.value = baseKey(selectedBase);
}

async function loadBaseOptions() {
  const previousBase = selectedBase;
  try {
    const response = await fetch('/api/bases', { method: 'GET' });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
    availableBases = Array.isArray(result.bases)
      ? result.bases
        .map((base: any) => ({
          name: String(base.name || '').trim(),
          workspace_id: String(base.workspace_id || '').trim(),
          uuid: String(base.uuid || '').trim(),
          label: String(base.label || base.name || '').trim(),
          workspace_name: String(base.workspace_name || '').trim(),
          workspace_type: String(base.workspace_type || '').trim(),
        }))
        .filter((base: SeaTableBase) => base.name)
      : [];
    const selected = result.selected || {};
    const selectedName = String(selected.name || '').trim();
    const selectedWorkspaceID = String(selected.workspace_id || '').trim();
    const apiSelectedBase = findBase(selectedName, selectedWorkspaceID) || (selectedName ? {
      name: selectedName,
      workspace_id: selectedWorkspaceID,
      label: String(selected.label || selectedName),
    } : null);
    selectedBase = previousBase
      ? findBase(previousBase.name, previousBase.workspace_id) || previousBase
      : apiSelectedBase || selectedBase;
    updateBaseSwitch();
  } catch (error) {
    if (!selectedBase && currentPayload) {
      const name = payloadBaseName(currentPayload);
      if (name) selectedBase = { name, workspace_id: payloadWorkspaceID(currentPayload) };
    }
    updateBaseSwitch();
  }
}

function updateRawTableSwitch(payload: FollowupPayload) {
  rawTableSwitchEl.replaceChildren();
  const tables = payload.raw_tables || [];
  if (!hasRawTables(payload)) {
    rawTableSwitchEl.hidden = true;
    rawTableSwitchEl.disabled = true;
    return;
  }
  tables.forEach((table, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    const loadedMark = table.loaded === false ? ' · 未加载' : '';
    option.textContent = `${table.name || `SeaTable ${index + 1}`} (${rawTableDisplayRows(table)}${loadedMark})`;
    rawTableSwitchEl.appendChild(option);
  });
  rawTableSwitchEl.hidden = false;
  rawTableSwitchEl.disabled = tables.length < 2;
  const savedIndex = Number(localStorage.getItem(ACTIVE_RAW_TABLE_KEY) || '0');
  rawTableSwitchEl.value = Number.isInteger(savedIndex) && tables[savedIndex] ? String(savedIndex) : '0';
}

function syncRawTableSwitchValue(sheetId?: string) {
  if (!currentPayload || !hasRawTables(currentPayload) || !sheetId) return;
  const index = rawTableIndexFromSheetId(sheetId);
  if (index >= 0 && currentPayload.raw_tables?.[index]) {
    const changed = rawTableSwitchEl.value !== String(index);
    rawTableSwitchEl.value = String(index);
    localStorage.setItem(ACTIVE_RAW_TABLE_KEY, String(index));
    if (changed) {
      lastCustomGroupMetas = [];
      renderColumnPanel();
      if (!customGroupPanelEl.classList.contains('hidden')) {
        renderCustomGroupPanel().catch((error) => {
          statusEl.textContent = '自定义分组读取列失败';
          summaryEl.textContent = error instanceof Error ? error.message : String(error);
        });
      }
    }
  }
}

function clearActiveSheetSubscription() {
  activeSheetSubscription?.unsubscribe?.();
  activeSheetSubscription?.dispose?.();
  activeSheetSubscription = null;
}

function bindRawTableSwitchToActiveSheet() {
  clearActiveSheetSubscription();
  if (!currentPayload || !hasRawTables(currentPayload)) return;
  const workbook = activeWorkbook();
  const activeSheet = workbook?.getActiveSheet?.();
  syncRawTableSwitchValue(activeSheet?.getSheetId?.());
  activeSheetSubscription = workbook?.getWorkbook?.()?.activeSheet$?.subscribe?.((sheet: any) => {
    syncRawTableSwitchValue(sheet?.getSheetId?.());
  }) || null;
}

async function loadRawTable(index: number) {
  if (!currentPayload || !hasRawTables(currentPayload)) return false;
  const table = currentPayload.raw_tables?.[index];
  if (!table || table.loaded !== false) return true;
  const snapshot = await workbookSnapshot(false);
  currentPayload = attachCurrentBase(payloadFromSnapshotForSave(snapshot, currentPayload, expanded));
  setSyncStatus(`正在加载 ${table.name || `SeaTable ${index + 1}`}`);
  const response = await fetch('/api/raw-table', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...currentBaseRequest(),
      raw_table_index: index,
      table_name: table.name,
    }),
  });
  const result = await response.json();
  if (!response.ok || !result.ok || !result.table) throw new Error(result.error || `HTTP ${response.status}`);
  const nextTables = [...(currentPayload.raw_tables || [])];
  nextTables[index] = {
    ...nextTables[index],
    ...result.table,
    loaded: true,
    row_count: Number(result.table.row_count) || result.table.rows?.length || 0,
  };
  currentPayload = {
    ...currentPayload,
    raw_tables: nextTables,
  };
  mountWorkbook(currentPayload, `已加载 ${nextTables[index].name || `SeaTable ${index + 1}`}`);
  return false;
}

async function activateRawTable(index: number) {
  if (!currentPayload || !hasRawTables(currentPayload) || !Number.isInteger(index)) return;
  const table = currentPayload.raw_tables?.[index];
  if (!table) return;
  const sheetId = rawSheetId(index);
  try {
    if (!(await loadRawTable(index))) return;
    const workbook = activeWorkbook();
    if (!workbook?.setActiveSheet) throw new Error('当前工作簿不支持表切换');
    workbook.setActiveSheet(sheetId);
    syncRawTableSwitchValue(sheetId);
    localStorage.setItem(ACTIVE_RAW_TABLE_KEY, String(index));
    lastCustomGroupMetas = [];
    renderColumnPanel();
    if (!customGroupPanelEl.classList.contains('hidden')) {
      renderCustomGroupPanel().catch((error) => {
        statusEl.textContent = '自定义分组读取列失败';
        summaryEl.textContent = error instanceof Error ? error.message : String(error);
      });
    }
    setSyncStatus(`已切换到 ${table.name || `SeaTable ${index + 1}`}`);
  } catch (error) {
    setSyncStatus('切换表失败');
    summaryEl.textContent = error instanceof Error ? error.message : String(error);
  }
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
  const rawIndex = rawMode ? rawTableIndexFromSheetId(String(sheet.getSheetId?.() || '')) : -1;
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

async function rememberWorkbookHash(payload: FollowupPayload) {
  try {
    const snapshot = await workbookSnapshot(false);
    if (currentPayload === payload) lastSavedWorkbookHash = workbookHash(snapshot);
  } catch {
    // The realtime sync initializer will retry shortly after mount.
  }
}

async function hasUnsavedWorkbookChanges() {
  if (!currentPayload || !activeWorkbook()) return false;
  const snapshot = await workbookSnapshot(false);
  const hash = workbookHash(snapshot);
  if (!lastSavedWorkbookHash) {
    lastSavedWorkbookHash = hash;
    return false;
  }
  return hash !== lastSavedWorkbookHash;
}

async function confirmDiscardUnsaved(message: string) {
  if (!(await hasUnsavedWorkbookChanges())) return true;
  return window.confirm(message);
}

function syncSummary(payload: FollowupPayload, suffix: string) {
  summaryEl.hidden = false;
  if (hasRawTables(payload)) {
    const rows = (payload.raw_tables || []).reduce((sum, table) => sum + rawTableDisplayRows(table), 0);
    summaryEl.textContent = `${payload.raw_tables?.length || 0} 张 SeaTable 表 · ${rows} 行 · ${suffix}`;
    return;
  }
  summaryEl.textContent = `${payload.patients.length} 位患者 · 药敏 ${payload.drug_sensitivity.length} 条 · 随访 ${payload.followups.length} 条 · ${suffix}`;
}

function updatePayloadSummary(payload: FollowupPayload, suffix = '') {
  currentPayload = payload;
  updateBaseSwitch(payload);
  updateRawTableSwitch(payload);
  summaryEl.hidden = false;
  const tail = suffix ? ` · ${suffix}` : '';
  if (hasRawTables(payload)) {
    const rawRows = (payload.raw_tables || []).reduce((sum, table) => sum + rawTableDisplayRows(table), 0);
    [reloadEl, customGroupToggleEl, columnPanelToggleEl].forEach((item) => {
      item.hidden = false;
    });
    customGroupPanelEl.hidden = false;
    columnPanelEl.hidden = false;
    const metas = buildColumnMeta();
    const hiddenCount = metas.filter((meta) => getHiddenColumnKeys().has(meta.key)).length;
    const unloaded = (payload.raw_tables || []).filter((table) => table.loaded === false).length;
    summaryEl.textContent = `${payload.raw_tables?.length || 0} 张 SeaTable 表 · ${rawRows} 行 · ${unloaded} 张未加载 · 当前表隐藏 ${hiddenCount} 列${tail}`;
    renderCustomGroupPanel().catch(() => {
      customGroupPanelEl.innerHTML = renderCustomColumnGroups(buildColumnMeta(), getHiddenColumnKeys());
    });
    renderColumnPanel();
    return;
  }
  [reloadEl, customGroupToggleEl, columnPanelToggleEl].forEach((item) => {
    item.hidden = false;
  });
  customGroupPanelEl.hidden = false;
  columnPanelEl.hidden = false;
  const metas = buildColumnMeta();
  const hiddenCount = metas.filter((meta) => getHiddenColumnKeys().has(meta.key)).length;
  summaryEl.textContent = `${payload.patients.length} 位患者 · 药敏 ${payload.drug_sensitivity.length} 条 · 随访 ${payload.followups.length} 条 · ${expanded ? '药敏明细展开' : '药敏摘要视图'} · 隐藏 ${hiddenCount} 列${tail}`;
  renderCustomGroupPanel().catch(() => {
    customGroupPanelEl.innerHTML = renderCustomColumnGroups(buildColumnMeta(), getHiddenColumnKeys());
  });
  renderColumnPanel();
}

function setSyncStatus(message: string) {
  statusEl.textContent = `同步：${message}`;
}

function stopRealtimeSync() {
  if (syncInitTimer !== null) {
    window.clearTimeout(syncInitTimer);
    syncInitTimer = null;
  }
  if (syncPollTimer !== null) {
    window.clearInterval(syncPollTimer);
    syncPollTimer = null;
  }
  if (syncAutoSaveTimer !== null) {
    window.clearInterval(syncAutoSaveTimer);
    syncAutoSaveTimer = null;
  }
}

async function saveCurrentWorkbook(mode: '手动' | '自动', finishEditing: boolean) {
  if (!currentPayload || isSaving || isRefreshing) return;
  if (!hasRawTables(currentPayload) && !expanded && !workbookHeaders(currentPayload).length) {
    setSyncStatus('摘要视图不自动写回');
    return;
  }
  isSaving = true;
  try {
    if (mode === '手动') saveSyncEl.disabled = true;
    setSyncStatus(mode === '自动' ? '正在保存' : '正在手动保存');
    const snapshot = await workbookSnapshot(finishEditing);
    const hash = workbookHash(snapshot);
    if (mode === '自动' && hash === lastSavedWorkbookHash) {
      setSyncStatus('已同步');
      return;
    }
    if (await refreshBeforeSaveIfNeeded(hash)) return;
    const payload = attachCurrentBase(payloadFromSnapshotForSave(snapshot, currentPayload, expanded));
    const baseRequest = currentBaseRequest();
    const response = await fetch('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...baseRequest, payload, snapshot, expected_signature: lastRemoteSignature }),
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
    const createdRawColumns = result.seatable?.created_raw_columns || 0;
    const seatableText = result.seatable?.ok && hasRawTables(payload)
      ? `SeaTable 原表 ${result.seatable.raw_tables || 0} 张 · 更新 ${result.seatable.raw_rows || 0} 行 · 新增列 ${createdRawColumns} 个 · 删除 ${result.seatable.deleted_raw_rows || 0} 行`
      : result.seatable?.ok
      ? `SeaTable 主表 ${result.seatable.patients || result.seatable.updated || 0} · 药敏 ${result.seatable.drugs || 0} · 随访 ${result.seatable.followups || 0} · 删除 ${deletedStructured}`
      : `SeaTable未写入: ${result.seatable?.error || '未配置'}`;
    syncSummary(payload, `${mode}保存 ${result.saved_at}`);
    setSyncStatus(`已同步 · ${seatableText}`);
    if (hasRawTables(payload) && rawPayloadHasNewRows(payload)) {
      setSyncStatus('新增行已写入，正在刷新 row_id');
      window.setTimeout(() => refreshFromSeaTable('自动'), 300);
    }
  } catch (error) {
    setSyncStatus(`${mode}保存失败`);
    summaryEl.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    if (mode === '手动') saveSyncEl.disabled = false;
    isSaving = false;
  }
}

async function refreshFromSeaTable(mode: '手动' | '自动', options: { skipDirtyCheck?: boolean } = {}) {
  if (isRefreshing) return;
  if (mode === '手动' && !options.skipDirtyCheck) {
    const confirmed = await confirmDiscardUnsaved('当前表格有未保存修改，刷新会放弃这些修改，是否继续？');
    if (!confirmed) return;
  }
  const restartSyncOnFailure = syncInitTimer !== null || syncPollTimer !== null || syncAutoSaveTimer !== null;
  stopRealtimeSync();
  isRefreshing = true;
  try {
    if (mode === '手动') refreshSyncEl.disabled = true;
    updateBaseSwitch();
    if (mode === '手动') await loadBaseOptions();
    setSyncStatus(mode === '自动' ? '检测到 SeaTable 新版本，正在同步' : '正在从 SeaTable 刷新');
    const baseRequest = currentBaseRequest();
    if (!baseRequest.base_name) throw new Error('未选择 SeaTable 表格');
    const response = await fetch('/api/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(refreshRequestBody(true)),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
    const payload = result.payload as FollowupPayload;
    if (!payload) throw new Error('刷新结果缺少 payload');
    const counts = result.counts || {};
    if (result.state?.signature) lastRemoteSignature = result.state.signature;
    isRefreshing = false;
    const status = hasRawTables(payload)
      ? `SeaTable 已同步 · ${payload.raw_tables?.length || 0} 张表 · ${(payload.raw_tables || []).reduce((sum, table) => sum + rawTableDisplayRows(table), 0)} 行`
      : `SeaTable 已同步 · 患者 ${counts.patients || 0} · 药敏 ${counts.drugs || 0} · 随访 ${counts.followups || 0}`;
    mountWorkbook(payload, status);
  } catch (error) {
    isRefreshing = false;
    setSyncStatus('刷新失败');
    summaryEl.textContent = error instanceof Error ? error.message : String(error);
    if (restartSyncOnFailure && currentPayload && activeWorkbook()) startRealtimeSync();
    if (mode === '手动') refreshSyncEl.disabled = false;
  } finally {
    if (mode === '手动') refreshSyncEl.disabled = false;
    updateBaseSwitch();
  }
}

async function pollRemoteState() {
  const response = await fetch('/api/remote-state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(currentBaseRequest()),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return result.state || {};
}

async function loadInitialPayload() {
  const baseRequest = currentBaseRequest();
  if (baseRequest.base_name) {
    try {
      const response = await fetch('/api/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(refreshRequestBody(false)),
      });
      const result = await response.json();
      if (response.ok && result.ok && result.payload) return result.payload as FollowupPayload;
    } catch {
      // Fall back to the bundled JSON below.
    }
  }
  return fetch('/followup.json').then((response) => response.json()) as Promise<FollowupPayload>;
}

async function refreshBeforeSaveIfNeeded(currentHash: string) {
  const state = await pollRemoteState();
  const signature = state.signature || '';
  if (!signature || signature === lastRemoteSignature) return false;
  if (Date.now() - lastLocalSaveAt < SELF_SAVE_GRACE_MS) {
    lastRemoteSignature = signature;
    return false;
  }
  if (currentHash === lastSavedWorkbookHash) {
    lastRemoteSignature = signature;
    await refreshFromSeaTable('自动');
    return true;
  }
  throw new Error('SeaTable 已有新版本，本地也有未保存修改；自动同步已暂停，避免覆盖 SeaTable 新数据');
}

async function refreshIfRemoteChanged() {
  if (!currentPayload || !activeWorkbook()) return;
  if (isSaving || isRefreshing) return;
  const state = await pollRemoteState();
  const signature = state.signature || '';
  if (!signature || signature === lastRemoteSignature) return;
  if (Date.now() - lastLocalSaveAt < SELF_SAVE_GRACE_MS) {
    lastRemoteSignature = signature;
    return;
  }
  const snapshot = await workbookSnapshot(false);
  if (workbookHash(snapshot) !== lastSavedWorkbookHash) {
    setSyncStatus('SeaTable 有更新，本地也有未保存修改，已暂停');
    return;
  }
  await refreshFromSeaTable('自动');
}

function startRealtimeSync() {
  if (currentPayload && !hasRawTables(currentPayload) && !expanded && !workbookHeaders(currentPayload).length) {
    setSyncStatus('摘要视图已加载，切换到药敏明细后启用写回');
    return;
  }
  stopRealtimeSync();
  syncInitTimer = window.setTimeout(async () => {
    try {
      const snapshot = await workbookSnapshot(false);
      lastSavedWorkbookHash = workbookHash(snapshot);
      const state = await pollRemoteState();
      lastRemoteSignature = state.signature || '';
      setSyncStatus('已同步');
      syncAutoSaveTimer = window.setInterval(async () => {
        await saveCurrentWorkbook('自动', false);
      }, AUTO_SAVE_INTERVAL_MS);
      syncPollTimer = window.setInterval(async () => {
        try {
          await refreshIfRemoteChanged();
        } catch (error) {
          setSyncStatus('SeaTable 远端检查失败');
        }
      }, REMOTE_POLL_INTERVAL_MS);
    } catch (error) {
      setSyncStatus('初始化失败');
    }
  }, 3000);
}

function mountWorkbook(payload: FollowupPayload, status: string) {
  stopRealtimeSync();
  clearActiveSheetSubscription();
  try {
    currentUniver?.dispose?.();
  } catch {
    // Best effort: Univer 0.25 cleans most resources through dispose().
  }
  document.getElementById('app')!.innerHTML = '';
  updatePayloadSummary(payload);

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
        SheetsFormulaUIZhCN,
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
  univer.registerPlugin(UniverSheetsFormulaUIPlugin);
  univer.registerPlugin(UniverSheetsSortPlugin);
  univer.registerPlugin(UniverSheetsSortUIPlugin);
  univer.registerPlugin(UniverSheetsTablePlugin);

  univer.createUnit(UniverInstanceType.UNIVER_SHEET, createWorkbook(payload, { expanded, hiddenColumns: getHiddenColumnKeys() }) as any);
  currentUniver = univer;
  (window as any).univer = univer;
  (window as any).univerAPI = FUniver.newAPI(univer);
  bindRawTableSwitchToActiveSheet();
  registerContextMenuActions();
  if (hasRawTables(payload)) {
    const savedIndex = Number(localStorage.getItem(ACTIVE_RAW_TABLE_KEY) || rawTableSwitchEl.value || '0');
    if (Number.isInteger(savedIndex) && payload.raw_tables?.[savedIndex]) {
      activateRawTable(savedIndex).catch((error) => {
        setSyncStatus('切换表失败');
        summaryEl.textContent = error instanceof Error ? error.message : String(error);
      });
    }
  }
  setSyncStatus(status || '初始化中');
  void rememberWorkbookHash(payload);
  startRealtimeSync();
}

async function boot() {
  document.body.classList.add('sheet-mode');
  document.querySelectorAll<HTMLElement>('.table-action').forEach((item) => {
    item.hidden = false;
  });
  const openSheetEl = document.getElementById('openSheet');
  if (openSheetEl) openSheetEl.hidden = true;
  saveSyncEl.hidden = true;
  await loadCustomColumnGroups();
  await loadBaseOptions();
  const payload = await loadInitialPayload();
  currentPayload = payload;
  updateBaseSwitch(payload);
  mountWorkbook(payload, '已加载，正在从 SeaTable 同步');
  void refreshFromSeaTable('自动');
}

saveSyncEl.addEventListener('click', async () => {
  await saveCurrentWorkbook('手动', true);
});

refreshSyncEl.addEventListener('click', async () => {
  await refreshFromSeaTable('手动');
});

rawTableSwitchEl.addEventListener('change', () => {
  activateRawTable(Number(rawTableSwitchEl.value)).catch((error) => {
    setSyncStatus('切换表失败');
    summaryEl.textContent = error instanceof Error ? error.message : String(error);
  });
});

baseSwitchEl.addEventListener('change', async () => {
  const nextBase = baseByKey(baseSwitchEl.value);
  if (!nextBase || (selectedBase && baseKey(nextBase) === baseKey(selectedBase))) return;
  const previousBase = selectedBase;
  const confirmed = await confirmDiscardUnsaved('当前表格有未保存修改，切换 SeaTable 表格会放弃这些修改，是否继续？');
  if (!confirmed) {
    if (previousBase) baseSwitchEl.value = baseKey(previousBase);
    return;
  }
  selectedBase = nextBase;
  lastRemoteSignature = '';
  lastSavedWorkbookHash = '';
  lastLocalSaveAt = 0;
  setSyncStatus(`正在切换到 ${nextBase.label || nextBase.name}`);
  await refreshFromSeaTable('手动', { skipDirtyCheck: true });
});

window.addEventListener('focus', () => {
  refreshIfRemoteChanged().catch(() => {
    setSyncStatus('SeaTable 远端检查失败');
  });
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  refreshIfRemoteChanged().catch(() => {
    setSyncStatus('SeaTable 远端检查失败');
  });
});

reloadEl.addEventListener('click', () => {
  localStorage.removeItem('drug_columns_collapsed');
  localStorage.removeItem(HIDDEN_COLUMNS_KEY);
  window.location.reload();
});

columnPanelToggleEl.addEventListener('click', () => {
  renderColumnPanel();
  columnPanelEl.classList.toggle('hidden');
  customGroupPanelEl.classList.add('hidden');
});

customGroupToggleEl.addEventListener('click', () => {
  customGroupPanelEl.classList.toggle('hidden');
  columnPanelEl.classList.add('hidden');
  if (customGroupPanelEl.classList.contains('hidden')) return;
  customGroupPanelEl.innerHTML = '<div class="custom-column-empty">正在读取当前表格列...</div>';
  renderCustomGroupPanel().catch((error) => {
    statusEl.textContent = '自定义分组读取列失败';
    summaryEl.textContent = error instanceof Error ? error.message : String(error);
  });
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

  const shortcutGroup = input.dataset.columnShortcutGroup as ColumnMeta['group'] | undefined;
  if (shortcutGroup) {
    metas.filter((meta) => meta.group === shortcutGroup).forEach((meta) => {
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

function customGroupConfigFromForm() {
  const rows = [...customGroupPanelEl.querySelectorAll<HTMLElement>('.custom-group-form-row')];
  return normalizeCustomColumnGroups({
    version: 1,
    groups: rows.map((row) => {
      const name = (row.querySelector<HTMLInputElement>('[data-custom-field="name"]')?.value || '').trim();
      const columns = [...row.querySelectorAll<HTMLInputElement>('input[data-custom-column-label]:checked')]
        .map((input) => input.dataset.customColumnLabel || '')
        .filter(Boolean);
      return { name, columns };
    }),
  });
}

function updateCustomGroupFormCounts(row: HTMLElement) {
  const allInputs = [...row.querySelectorAll<HTMLInputElement>('input[data-custom-column-label]')];
  const checkedCount = allInputs.filter((input) => input.checked).length;
  const formCountEl = row.querySelector<HTMLElement>('[data-custom-form-count]');
  if (formCountEl) formCountEl.textContent = `${checkedCount}/${allInputs.length} 列`;

  row.querySelectorAll<HTMLElement>('.custom-group-column-section').forEach((section) => {
    const sectionInputs = [...section.querySelectorAll<HTMLInputElement>('input[data-custom-column-label]')];
    const sectionChecked = sectionInputs.filter((input) => input.checked).length;
    const toggle = section.querySelector<HTMLInputElement>('input[data-custom-section-toggle]');
    const countEl = section.querySelector<HTMLElement>('.custom-group-column-count');
    if (toggle) {
      toggle.checked = sectionInputs.length > 0 && sectionChecked === sectionInputs.length;
      toggle.indeterminate = sectionChecked > 0 && sectionChecked < sectionInputs.length;
    }
    if (countEl) countEl.textContent = `${sectionChecked}/${sectionInputs.length}`;
  });
}

async function handleCustomGroupAction(button: HTMLButtonElement) {
  const action = button.dataset.columnAction;
  const metas = action === 'custom-close' ? customGroupMetasForCurrentPanel() : await currentTableColumnMeta();
  lastCustomGroupMetas = metas;
  const hidden = getHiddenColumnKeys();

  if (action === 'custom-close') {
    customGroupPanelEl.classList.add('hidden');
    return;
  }
  if (action === 'custom-edit') {
    customColumnGroupEditorOpen = !customColumnGroupEditorOpen;
    await renderCustomGroupPanel();
    customGroupPanelEl.classList.remove('hidden');
    return;
  }
  if (action === 'custom-cancel') {
    customColumnGroupEditorOpen = false;
    await renderCustomGroupPanel();
    customGroupPanelEl.classList.remove('hidden');
    return;
  }
  if (action === 'custom-template') {
    customColumnGroups = normalizeCustomColumnGroups(customGroupsTemplate(metas));
    customColumnGroupEditorOpen = true;
    statusEl.textContent = '已填入示例分组';
    await renderCustomGroupPanel();
    customGroupPanelEl.classList.remove('hidden');
    return;
  }
  if (action === 'custom-add') {
    customColumnGroups = {
      version: 1,
      groups: [
        ...(customColumnGroups.groups || []),
        { name: '新分组', columns: [] },
      ],
    };
    customColumnGroupEditorOpen = true;
    await renderCustomGroupPanel();
    customGroupPanelEl.classList.remove('hidden');
    return;
  }
  if (action === 'custom-delete') {
    const index = Number(button.dataset.customGroupIndex);
    const groups = [...(customColumnGroups.groups || [])];
    if (!Number.isFinite(index) || !groups[index]) return;
    groups.splice(index, 1);
    await saveCustomColumnGroups({ version: 1, groups });
    statusEl.textContent = '自定义分组已删除';
    await renderCustomGroupPanel();
    return;
  }
  if (action === 'custom-save-form') {
    try {
      await saveCustomColumnGroups(customGroupConfigFromForm());
      customColumnGroupEditorOpen = false;
      statusEl.textContent = '自定义分组已保存';
      await renderCustomGroupPanel();
      customGroupPanelEl.classList.remove('hidden');
    } catch (error) {
      statusEl.textContent = '自定义分组保存失败';
      summaryEl.textContent = error instanceof Error ? error.message : String(error);
    }
    return;
  }
  if (action === 'custom-save-current') {
    const name = window.prompt('分组名称');
    if (!name?.trim()) return;
    const visibleColumns = metas.filter((meta) => !hidden.has(meta.key)).map((meta) => meta.label);
    if (!visibleColumns.length) {
      statusEl.textContent = '当前没有可保存的可见列';
      return;
    }
    try {
      await saveCustomColumnGroups({
        version: 1,
        groups: [
          ...(customColumnGroups.groups || []),
          { name: name.trim(), columns: visibleColumns },
        ],
      });
      statusEl.textContent = '当前列显示已保存为分组';
      await renderCustomGroupPanel();
      customGroupPanelEl.classList.remove('hidden');
    } catch (error) {
      statusEl.textContent = '自定义分组保存失败';
      summaryEl.textContent = error instanceof Error ? error.message : String(error);
    }
    return;
  }
  if (action === 'custom-show' || action === 'custom-hide' || action === 'custom-only') {
    const index = Number(button.dataset.customGroupIndex);
    const group = customColumnGroups.groups[index];
    if (!group) return;
    const keys = customGroupColumnKeys(group, metas);
    if (!keys.size) {
      statusEl.textContent = '自定义分组没有匹配列';
      return;
    }
    if (action === 'custom-only') {
      metas.forEach((meta) => {
        if (keys.has(meta.key)) hidden.delete(meta.key);
        else hidden.add(meta.key);
      });
    } else {
      keys.forEach((key) => {
        if (action === 'custom-show') hidden.delete(key);
        else hidden.add(key);
      });
    }
    setHiddenColumnKeys(hidden);
    reloadForColumns();
  }
}

customGroupPanelEl.addEventListener('click', (event) => {
  const button = event.target instanceof HTMLElement ? event.target.closest('button[data-column-action]') : null;
  if (!(button instanceof HTMLButtonElement)) return;
  handleCustomGroupAction(button).catch((error) => {
    statusEl.textContent = '自定义分组操作失败';
    summaryEl.textContent = error instanceof Error ? error.message : String(error);
  });
});

customGroupPanelEl.addEventListener('change', (event) => {
  const input = event.target instanceof HTMLInputElement ? event.target : null;
  if (!input) return;

  if (input.dataset.customSectionToggle !== undefined) {
    const section = input.closest<HTMLElement>('.custom-group-column-section');
    const row = input.closest<HTMLElement>('.custom-group-form-row');
    section?.querySelectorAll<HTMLInputElement>('input[data-custom-column-label]').forEach((item) => {
      item.checked = input.checked;
    });
    if (row) updateCustomGroupFormCounts(row);
    return;
  }

  if (input.dataset.customColumnLabel !== undefined) {
    const row = input.closest<HTMLElement>('.custom-group-form-row');
    if (row) updateCustomGroupFormCounts(row);
    return;
  }

  if (input.dataset.customGroupToggle === undefined) return;
  const index = Number(input.dataset.customGroupToggle);
  const group = customColumnGroups.groups[index];
  if (!group) return;
  (async () => {
    const metas = await currentTableColumnMeta();
    lastCustomGroupMetas = metas;
    const keys = customGroupColumnKeys(group, metas);
    if (!keys.size) {
      statusEl.textContent = '自定义分组没有匹配列';
      await renderCustomGroupPanel();
      customGroupPanelEl.classList.remove('hidden');
      return;
    }
    const hidden = getHiddenColumnKeys();
    keys.forEach((key) => {
      if (input.checked) hidden.delete(key);
      else hidden.add(key);
    });
    setHiddenColumnKeys(hidden);
    reloadForColumns();
  })().catch((error) => {
    statusEl.textContent = '自定义分组操作失败';
    summaryEl.textContent = error instanceof Error ? error.message : String(error);
  });
});

columnPanelEl.addEventListener('click', async (event) => {
  const button = event.target instanceof HTMLElement ? event.target.closest('button[data-column-action]') : null;
  if (!(button instanceof HTMLButtonElement)) return;
  const action = button.dataset.columnAction;

  if (action === 'apply') {
    reloadForColumns();
    return;
  }
  if (action === 'restore-default') {
    restoreDefaultColumns();
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
  if (action === 'toggle-drug-detail') {
    localStorage.setItem('drug_columns_collapsed', expanded ? '1' : '0');
    reloadForColumns();
  }
});

boot().catch((error) => {
  statusEl.textContent = '加载失败';
  summaryEl.textContent = error instanceof Error ? error.message : String(error);
});
