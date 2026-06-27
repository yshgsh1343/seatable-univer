export function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function slug(value: string) {
  return value.replace(/\s+/g, '-').toLowerCase();
}

export function cellText(cell: any) {
  const value = cell?.v ?? cell?.p?.body?.dataStream ?? '';
  return String(value ?? '').replace(/\r?\n\u0002?$/, '').trim();
}

export function linesToText(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].join('\n');
}

export function parseAssayRaw(raw: string) {
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

export function columnAddress(index: number) {
  let value = index + 1;
  let label = '';
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}
