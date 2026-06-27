export type Patient = Record<string, string>;
export type DrugRow = Record<string, string>;
export type FollowupRow = Record<string, string>;
export type RawRow = Record<string, string>;

export interface RawTable {
  name: string;
  columns: string[];
  rows: RawRow[];
  loaded?: boolean;
  row_count?: number;
}

export interface SeaTableBase {
  name: string;
  workspace_id: string;
  uuid?: string;
  label?: string;
  workspace_name?: string;
  workspace_type?: string;
}

export interface FollowupPayload {
  generated_at: string;
  source?: string;
  base_name?: string;
  workspace_id?: string;
  xlsx_headers?: string[];
  patients: Patient[];
  drug_sensitivity: DrugRow[];
  followups: FollowupRow[];
  raw_tables?: RawTable[];
  changed_raw_tables?: string[];
  deleted_raw_rows?: Record<string, string[]>;
}

export type ColumnGroup = 'basic' | 'clinical' | 'pathology' | 'ihc' | 'molecular' | 'imaging' | 'drug' | 'followup';

export interface ColumnMeta {
  key: string;
  label: string;
  group: ColumnGroup;
  groupLabel: string;
  sourceKey?: string;
  drugName?: string;
  drugField?: string;
}

export interface CustomColumnGroup {
  name: string;
  columns?: string[];
  keys?: string[];
  match?: string[];
}

export interface CustomColumnGroupConfig {
  version?: number;
  groups: CustomColumnGroup[];
}

export interface DetailColumn {
  key: string;
  label: string;
  sourceKey?: string;
  patterns?: string[];
  width?: number;
}
