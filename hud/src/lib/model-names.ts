/**
 * Human label for a model id.
 *
 * Claude ids follow `claude-<family>-<major>[-<minor>][-<yyyymmdd>]`, so the
 * label is derived rather than looked up — a new release needs no edit here.
 * Anything else (an Ollama model like `qwen3:8b`) is shown as-is.
 */
export function formatModelName(id: string): string {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?(?:-\d{8})?$/.exec(id);
  if (!m) return id;
  const family = m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1);
  return m[3] !== undefined ? `${family} ${m[2]}.${m[3]}` : `${family} ${m[2]}`;
}
