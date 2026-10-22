/**
 * Run log for executed hooks.
 *
 * The settings UI and the `/hooks` command both answer "what has been running
 * lately?" so the ring buffer and its formatting live here, away from the
 * Cordis wiring. Pure functions only: no I/O, no imports.
 */

export const RUN_LIMIT = 200
export const HISTORY_LIMIT = 50

/** Display name of a hook: its statusMessage, else its command, else its key. */
export function hookTitle(hook) {
  if (typeof hook?.statusMessage === 'string' && hook.statusMessage !== '') return hook.statusMessage
  const command = typeof hook?.handler?.command === 'string' ? hook.handler.command : null
  if (command) {
    const last = command.split(/[\\/]/).filter(Boolean).at(-1) ?? command
    return last.replace(/\.(exe|cmd|bat|ps1|sh|mjs|cjs|js)$/i, '')
  }
  return hook?.key ?? ''
}

/** One row for one hook execution. */
export function runRow(eventName, entry) {
  return {
    eventName,
    at: new Date().toISOString(),
    key: entry?.key ?? '',
    title: entry?.title ?? entry?.key ?? '',
    source: entry?.source ?? '',
    sourceLabel: entry?.sourceLabel ?? '',
    status: entry?.status ?? 'failed',
    reason: entry?.reason ?? null,
    error: entry?.error ?? null,
    durationMs: Number.isFinite(entry?.durationMs) ? entry.durationMs : 0,
  }
}

/** Roll a newest-first row list into the counters the UI shows. */
export function summarize(rows) {
  const list = Array.isArray(rows) ? rows : []
  return {
    runs: list.length,
    blocked: list.filter((row) => row.status === 'blocked').length,
    failed: list.filter((row) => row.status === 'failed').length,
    history: list.slice(0, HISTORY_LIMIT),
  }
}

/** Newest-first ring buffer of hook executions. */
export function createRunLog(options) {
  const limit = options?.limit ?? RUN_LIMIT
  const rows = []
  return {
    record(eventName, entries) {
      const list = Array.isArray(entries) ? entries : []
      for (const entry of list) {
        rows.unshift(runRow(eventName, entry))
      }
      if (rows.length > limit) rows.length = limit
    },
    stats() {
      return summarize(rows)
    },
    clear() {
      rows.length = 0
    },
  }
}

const STATUS_MARK = { ok: '✓', blocked: '✕', failed: '!', skipped: '-' }

/** Body of the `/hooks` command: catalog overview plus recent runs. */
export function hooksCommandText(catalog) {
  const hooks = Array.isArray(catalog?.hooks) ? catalog.hooks : []
  const stats = catalog?.stats ?? summarize(catalog?.recent ?? [])
  const trusted = hooks.filter((hook) => hook.trust === 'Trusted' || hook.trust === 'Managed').length
  const review = hooks.filter((hook) => hook.trust === 'Untrusted' || hook.trust === 'Modified')
  const disabled = hooks.filter((hook) => hook.enabled === false).length
  const sources = new Map()
  for (const hook of hooks) {
    const label = hook.sourceLabel ?? hook.group ?? 'unknown'
    sources.set(label, (sources.get(label) ?? 0) + 1)
  }

  const lines = []
  lines.push(
    `Hooks: ${hooks.length} total — ${trusted} trusted, ${review.length} needs review, ${disabled} disabled` +
      (sources.size > 0 ? ` (${[...sources].map(([label, count]) => `${label}: ${count}`).join(', ')})` : ''),
  )
  lines.push(`Recent: ${stats.runs} runs · ${stats.blocked} blocked · ${stats.failed} failed`)

  if (review.length > 0) {
    lines.push('', 'Needs review:')
    for (const hook of review) {
      lines.push(`  - ${hook.eventName}  ${hookTitle(hook)}  [${hook.sourceLabel ?? hook.group ?? '?'}]  ${hook.trust}`)
    }
    lines.push('', 'Trust them in Settings → Hooks, or send /hooks again after approving there.')
  }
  if (stats.history.length > 0) {
    lines.push('', 'Recent runs:')
    for (const row of stats.history.slice(0, 10)) {
      const mark = STATUS_MARK[row.status] ?? '?'
      const detail = row.reason ?? row.error ?? ''
      lines.push(
        `  ${mark} ${row.eventName}  ${row.title}  [${row.sourceLabel || row.source || '?'}]  ${row.durationMs}ms` +
          (detail ? `  ${String(detail).slice(0, 80)}` : ''),
      )
    }
  }
  if (hooks.length === 0) {
    lines.push('', 'No hooks found. Add a hooks.json to ~/.dsh, a project .dsh folder, or a plugin.')
  } else if (review.length === 0 && stats.history.length === 0) {
    lines.push('', 'Nothing has run in this session yet.')
  }
  return lines.join('\n')
}
