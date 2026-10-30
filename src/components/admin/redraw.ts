/**
 * The command that draws stale gallery thumbnails again
 * (scripts/redraw-thumbnails.ts, docs/WHITE_LABEL.md → Image library,
 * "Thumbnails"): a dry run unless `upload`, one category or all. Node's own
 * fetch needs NODE_USE_ENV_PROXY=1 behind an HTTPS proxy.
 */
export const redrawCommand = (category: string | null, upload = false) =>
  'NODE_USE_ENV_PROXY=1 FLYTTGO_SUPABASE_URL=https://<ref>.supabase.co FLYTTGO_SERVICE_ROLE_KEY=<service key> \\\n'
  + `  node scripts/redraw-thumbnails.ts${category ? ` --category ${category}` : ''}${upload ? ' --upload' : ''}`;
