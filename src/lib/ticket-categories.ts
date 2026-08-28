/**
 * Categorias de atendimento (SGI + legado).
 * Colunas do relatório "Indicadores – SGI" seguem SGI_CATEGORY_COLUMNS.
 */

export const SGI_REPORT_TITLE = 'Indicadores – SGI';

/** Colunas canônicas do quadro SGI (nessa ordem). */
export const SGI_CATEGORY_COLUMNS = [
  'Atendimento WK Radar',
  'Atendimento Dominio',
  'Atendimento Hardware',
  'Facilities',
  'Desenvolvimento Interno de Software',
] as const;

export type SgiCategory = (typeof SGI_CATEGORY_COLUMNS)[number];

/** Opções do select (SGI primeiro, depois categorias legadas ainda em tickets). */
export const TICKET_CATEGORY_OPTIONS = [
  ...SGI_CATEGORY_COLUMNS,
  'Acessos',
  'Redes',
  'Geral',
  'Hardware',
  'Software',
] as const;

const CATEGORY_ALIAS: Record<string, string> = {
  'atendimento wk radar': 'Atendimento WK Radar',
  'wk radar': 'Atendimento WK Radar',
  wkradar: 'Atendimento WK Radar',
  'atendimento dominio': 'Atendimento Dominio',
  'atendimento domínio': 'Atendimento Dominio',
  dominio: 'Atendimento Dominio',
  domínio: 'Atendimento Dominio',
  'atendimento hardware': 'Atendimento Hardware',
  hardware: 'Atendimento Hardware',
  facilities: 'Facilities',
  facility: 'Facilities',
  'desenvolvimento interno de software': 'Desenvolvimento Interno de Software',
  software: 'Desenvolvimento Interno de Software',
  'dev interno': 'Desenvolvimento Interno de Software',
};

function foldCategoryKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

/** Normaliza categoria gravada no ticket para a coluna do relatório. */
export function normalizeReportCategory(raw: string | null | undefined): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) return 'Geral';
  const alias = CATEGORY_ALIAS[foldCategoryKey(trimmed)];
  if (alias) return alias;
  const exactSgi = SGI_CATEGORY_COLUMNS.find((c) => foldCategoryKey(c) === foldCategoryKey(trimmed));
  if (exactSgi) return exactSgi;
  return trimmed;
}

export function categorySelectOptions(current?: string | null): string[] {
  const list: string[] = [...TICKET_CATEGORY_OPTIONS];
  const cur = (current || '').trim();
  if (cur && !list.includes(cur)) {
    return [cur, ...list];
  }
  return list;
}
