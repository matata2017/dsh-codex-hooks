/**
 * Run log for executed hooks.
 *
 * The settings UI and the `/hooks` command both answer "what has been running
 * lately?" so the ring buffer and its formatting live here, away from the
 * Cordis wiring. Pure functions only: no I/O, no imports.
 *
 * Scope model (mirrors Codex): a run belongs to the turn that triggered it, and
 * a turn belongs to a session. Codex emits transient HookStarted/HookCompleted
 * notifications tagged with a turn id and never persists run records — clients
 * keep their own in-memory view. This log is that view: a process-lifetime ring
 * buffer, read one session and one turn at a time. Nothing here is durable; a
 * reload starts empty, exactly like Codex.
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

/** Canonical event order, mirrors EVENT_DESCRIPTIONS in lib/events.js. */
const EVENT_ORDER = [
  'agent/pre-step',
  'agent/request',
  'tools/pre-execute',
  'tools/post-execute',
  'approval/request',
  'agent/created',
  'agent/turn-stopping',
  'session/disposed',
]

/**
 * Event level rows for the browser view: how many hooks an event has, how many
 * of them can run right now and how many wait for review.
 */
export function eventRows(hooks) {
  const rows = new Map()
  for (const hook of Array.isArray(hooks) ? hooks : []) {
    const name = hook?.eventName ?? ''
    if (!name) continue
    if (!rows.has(name)) {
      rows.set(name, {
        eventName: name,
        installed: 0,
        active: 0,
        needsReview: 0,
        description: hook.description ?? '',
      })
    }
    const row = rows.get(name)
    row.installed += 1
    if (hook.runnable === true) row.active += 1
    if (hook.trust === 'Untrusted' || hook.trust === 'Modified') row.needsReview += 1
  }
  const known = EVENT_ORDER.filter((name) => rows.has(name)).map((name) => rows.get(name))
  const extra = [...rows.values()].filter((row) => !EVENT_ORDER.includes(row.eventName))
  return [...known, ...extra]
}

/** Short label for a turn key such as `session-id#3`. */
export function turnLabel(turn) {
  if (turn === null || turn === undefined) return ''
  const text = String(turn)
  const hash = text.lastIndexOf('#')
  return hash >= 0 ? text.slice(hash + 1) : text
}

/** One row for one hook execution (or one that is still running). */
export function runRow(eventName, entry, context) {
  return {
    id: entry?.id ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    eventName,
    at: entry?.at ?? new Date().toISOString(),
    key: entry?.key ?? '',
    title: entry?.title ?? entry?.key ?? '',
    source: entry?.source ?? '',
    groupLabel: entry?.groupLabel ?? '',
    sourceLabel: entry?.sourceLabel ?? '',
    path: entry?.path ?? '',
    sessionId: context?.sessionId ?? null,
    // Host handlers pass `turnId` (it doubles as the hook payload's turn_id);
    // `turnKey` is accepted too for callers that name it explicitly.
    turn: context?.turnKey ?? context?.turnId ?? null,
    agentId: context?.agentId ?? null,
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
    running: list.filter((row) => row.status === 'running').length,
    history: list.slice(0, HISTORY_LIMIT),
  }
}

/** Per-turn aggregates, newest turn first. */
function turnIndex(rows) {
  const turns = new Map()
  for (const row of rows) {
    const key = row.turn
    if (key === null || key === undefined) continue
    if (!turns.has(key)) {
      turns.set(key, { turn: key, label: turnLabel(key), runs: 0, blocked: 0, failed: 0, firstAt: row.at, lastAt: row.at, lastSeq: row.seq ?? 0 })
    }
    const entry = turns.get(key)
    entry.runs += 1
    if (row.status === 'blocked') entry.blocked += 1
    if (row.status === 'failed') entry.failed += 1
    if (row.at < entry.firstAt) entry.firstAt = row.at
    if (row.at > entry.lastAt) entry.lastAt = row.at
    if ((row.seq ?? 0) > entry.lastSeq) entry.lastSeq = row.seq ?? 0
  }
  // Order by log sequence, not by wall clock: rows recorded in the same
  // millisecond would otherwise keep insertion order of the wrong turn.
  return [...turns.values()].sort((a, b) => b.lastSeq - a.lastSeq)
}

/** The newest session in the buffer, or null while nothing has run. */
function latestSession(rows) {
  for (const row of rows) {
    if (row.sessionId !== null && row.sessionId !== undefined) return row.sessionId
  }
  return null
}

/**
 * Merge the turns that ran hooks with the turns we merely saw.
 *
 * A turn whose hooks were all untrusted produced no rows, but it is still a
 * turn the user can ask about — it must show up with a zero count instead of
 * being answered with another turn's numbers.
 */
function mergeTurns(turns, known) {
  const merged = turns.map((entry) => ({ ...entry }))
  const seen = new Set(merged.map((entry) => entry.turn))
  for (const entry of known?.values() ?? []) {
    if (seen.has(entry.turn)) continue
    merged.push({
      turn: entry.turn,
      label: entry.label,
      runs: 0,
      blocked: 0,
      failed: 0,
      firstAt: entry.at,
      lastAt: entry.at,
      lastSeq: entry.seq,
    })
  }
  return merged.sort((a, b) => b.lastSeq - a.lastSeq)
}

/**
 * Newest-first ring buffer of hook executions.
 *
 * Rows carry the turn that triggered them; `stats()` reads one turn at a time
 * (the current turn when no turn is given) and always ships the turn index so
 * the UI can offer a switcher.
 */
export function createRunLog(options) {
  const limit = options?.limit ?? RUN_LIMIT
  const rows = []
  let counter = 0
  /**
   * Current turn per session, learned from the events that carry one.
   *
   * Not every seam knows its turn: `tools/pre-execute` and `approval/request`
   * hand over a ToolExecution / approval request with no turn field, so a hook
   * running there can only be attributed to whatever turn the session is on.
   * Guessing from the newest row was wrong — a tool hook in turn 5 landed in
   * turn 3 whenever turns 4 and 5 ran no hooks at all.
   */
  const currentTurns = new Map()
  /**
   * Turns we have seen, including the ones that ran no hook at all.
   *
   * The rows only know about turns that produced a run, so a turn whose hooks
   * were all untrusted looks identical to a turn the log never heard of. Those
   * two cases must not be confused: the first one is "this turn ran nothing",
   * the second one is "this turn is not in the log" (the buffer only lives as
   * long as the host process). Without this map the stats dialog silently
   * answered a question about turn 2 with the numbers of turn 1.
   */
  const knownTurns = new Map()
  /**
   * The session that most recently marked a turn — the one the user is in.
   *
   * `stats()` without a sessionId reads this one. Reading the newest session
   * with runs instead would answer about a session the user switched away
   * from: a turn's label is only its number, so that session's turn 88 gets
   * handed back as this session's turn 88.
   */
  let activeSession = null

  const nextSeq = () => {
    counter += 1
    return counter
  }

  const trim = () => {
    if (rows.length > limit) rows.length = limit
  }

  const turnFor = (context) =>
    context?.turnKey ?? context?.turnId ?? currentTurns.get(context?.sessionId ?? '') ?? null

  return {
    /** Learn the turn a session is on, from an event that actually carries one. */
    markTurn(sessionId, turn) {
      if (turn === null || turn === undefined || turn === '') return
      const session = sessionId ?? ''
      currentTurns.set(session, turn)
      // The session that just spoke is the one the user is looking at, even
      // when no hook ran there — that is exactly the read that must not fall
      // back to whichever session logged a run last.
      if (session !== '') activeSession = session
      if (!knownTurns.has(session)) knownTurns.set(session, new Map())
      knownTurns.get(session).set(turn, {
        turn,
        label: turnLabel(turn),
        seq: nextSeq(),
        at: new Date().toISOString(),
      })
    },

    /** Register a hook that is about to run; returns the row id to finish later. */
    start(eventName, hook, context) {
      const id = `${Date.now().toString(36)}-${nextSeq()}-${Math.random().toString(36).slice(2, 6)}`
      const turn = turnFor(context)
      const row = runRow(
        eventName,
        {
          id,
          key: hook?.key,
          title: hookTitle(hook),
          source: hook?.group ?? '',
          groupLabel: hook?.groupLabel ?? '',
          sourceLabel: hook?.sourceLabel ?? '',
          path: hook?.sourcePath ?? '',
          status: 'running',
        },
        { ...context, turnKey: turn },
      )
      row.seq = nextSeq()
      rows.unshift(row)
      trim()
      return id
    },

    /** Complete a running row in place, keeping its start position. */
    finish(id, eventName, entry, context) {
      const finished = runRow(eventName, { ...entry, id }, context)
      const index = rows.findIndex((row) => row.id === id)
      if (index >= 0) {
        rows[index] = { ...finished, at: rows[index].at, turn: rows[index].turn, seq: rows[index].seq }
        trim()
        return
      }
      finished.seq = nextSeq()
      rows.unshift(finished)
      trim()
    },

    /** Record completed runs without a matching start row (async completions). */
    record(eventName, entries, context) {
      const list = Array.isArray(entries) ? entries : []
      const turn = turnFor(context)
      for (const entry of list) {
        const row = runRow(eventName, entry, { ...context, turnKey: turn })
        row.seq = nextSeq()
        rows.unshift(row)
      }
      trim()
    },

    /**
     * Counters plus the newest rows for one turn of one session.
     *
     * The buffer is process lifetime, so a new session in the same host would
     * otherwise show the previous session's turns in the switcher — and their
     * labels ("turn 3") collide, because the label is only the number.
     *
     * @param query.turn - turn key, or the plain number a turn is labelled with
     *   (what the message action row knows); omitted or null reads the current
     *   turn, and a turn the log never saw reads as itself with zero runs.
     * @param query.sessionId - session to read; omitted reads the session that
     *   most recently marked a turn, i.e. the one the user is working in.
     */
    stats(query) {
      const requested = query?.turn ?? null
      const sessionId = query?.sessionId ?? activeSession ?? latestSession(rows)
      // Rows recorded without a session (a disposal whose agent is already gone)
      // stay visible in whichever session is being read.
      const scopedRows = rows.filter((row) => row.sessionId === null || row.sessionId === sessionId)
      const turns = mergeTurns(turnIndex(scopedRows), knownTurns.get(sessionId ?? ''))
      const current = turns.length > 0 ? turns[0].turn : null
      const exact =
        requested === null
          ? null
          : turns.find((entry) => entry.turn === requested) ??
            turns.find((entry) => entry.label === String(requested)) ??
            null
      /**
       * The host numbers turns from the agent's counter and the conversation
       * numbers them the same way, so a turn is found by its number. When the
       * log never saw that turn — it is older than this process, or its hooks
       * have not run yet — the answer is that turn with nothing in it. It is
       * never another turn's numbers: a click on a message has to describe
       * that message, not its neighbour. (Codex binds every run to its turn id
       * and matches exactly; DSH turns are per-session numbers, so the match
       * is the number inside the session being read — equally exact, and a
       * turn outside the log still answers zero.)
       */
      const resolved =
        requested === null
          ? current === null
            ? 'empty'
            : 'current'
          : exact !== null
            ? 'exact'
            : 'missing'
      // Never answer with another turn's numbers: an unknown turn reads as
      // itself with nothing in it.
      const selected = exact?.turn ?? (resolved === 'missing' ? requested : current)
      const turnRows = selected === null ? [] : scopedRows.filter((row) => row.turn === selected)
      return {
        scope: selected === null ? 'empty' : 'turn',
        turn: selected,
        requested,
        resolved,
        sessionId,
        label: turnLabel(selected),
        ...summarize(turnRows),
        turns,
        session: summarize(scopedRows),
      }
    },

    clear() {
      rows.length = 0
    },
  }
}

const STATUS_MARK = { ok: '✓', blocked: '✕', failed: '!', skipped: '-', running: '…' }

/** Body of the `/hooks` command: catalog overview plus recent runs. */
export function hooksCommandText(catalog) {
  const hooks = Array.isArray(catalog?.hooks) ? catalog.hooks : []
  const stats = catalog?.stats ?? {}
  const session = stats.session ?? summarize(catalog?.recent ?? [])
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
  lines.push(`This session: ${session.runs} runs · ${session.blocked} blocked · ${session.failed} failed`)

  if (review.length > 0) {
    lines.push('', 'Needs review:')
    for (const hook of review) {
      lines.push(`  - ${hook.eventName}  ${hookTitle(hook)}  [${hook.sourceLabel ?? hook.group ?? '?'}]  ${hook.trust}`)
    }
    lines.push('', 'Trust them in Settings → Hooks, or send /hooks again after approving there.')
  }
  if (session.history.length > 0) {
    lines.push('', 'Recent runs (newest first):')
    for (const row of session.history.slice(0, 10)) {
      const mark = STATUS_MARK[row.status] ?? '?'
      const detail = row.reason ?? row.error ?? ''
      const turn = row.turn ? ` turn ${turnLabel(row.turn)}` : ''
      lines.push(
        `  ${mark} ${row.eventName}  ${row.title}  [${row.sourceLabel || row.source || '?'}]${turn}  ${row.durationMs}ms` +
          (detail ? `  ${String(detail).slice(0, 80)}` : ''),
      )
    }
    lines.push('', 'Per-turn counters live in the Hook stats dialog (message action row).')
  }
  if (hooks.length === 0) {
    lines.push('', 'No hooks found. Add a hooks.json to ~/.dsh, a project .dsh folder, or a plugin.')
  } else if (review.length === 0 && session.history.length === 0) {
    lines.push('', 'Nothing has run in this session yet.')
  }
  return lines.join('\n')
}
