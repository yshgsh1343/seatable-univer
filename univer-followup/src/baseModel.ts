import type { FollowupPayload, SeaTableBase } from './types';

export function payloadBaseName(payload: FollowupPayload | null) {
  const direct = String(payload?.base_name || '').trim();
  if (direct) return direct;
  const source = String(payload?.source || '').trim();
  return source.startsWith('SeaTable:') ? source.slice('SeaTable:'.length).trim() : '';
}

export function payloadWorkspaceID(payload: FollowupPayload | null) {
  return String(payload?.workspace_id || '').trim();
}

export function baseKey(base: SeaTableBase) {
  return `${base.workspace_id || ''}\u0000${base.name}`;
}

export function sameBase(base: SeaTableBase, name: string, workspaceID: string) {
  if (!base || base.name !== name) return false;
  return !workspaceID || !base.workspace_id || base.workspace_id === workspaceID;
}
