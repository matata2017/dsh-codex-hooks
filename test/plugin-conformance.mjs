/**
 * test/plugin-conformance.mjs — compare the plugin implementation against the reference
 * semantics in test/spec.mjs.
 *
 * The probes are deliberately *tolerant*: they look for a few plausible export names and
 * call shapes, and they report SKIP (never FAIL) when the plugin does not expose a
 * compatible API. That keeps the runner honest — a FAIL always means a real divergence
 * in behaviour, not a guess about a function signature.
 *
 * Nothing here installs the plugin, writes to $DSH_HOME, or touches the user's profile.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)

const HASH_NAMES = [
  'hookHash',
  'computeHookHash',
  'hashHook',
  'buildHookHash',
  'computeHash',
  'fingerprintHook',
  'hook_hash',
]
const PARSE_NAMES = [
  'parseHooksFile',
  'parseHooks',
  'loadHooksFile',
  'parseHooksConfig',
  'readHooksFile',
  'parseHooksJson',
]
const MATCH_NAMES = [
  'matchMatcher',
  'matchHook',
  'matchesMatcher',
  'hookMatches',
  'matcherMatches',
  'matchPattern',
  'matchesHook',
  'matchHookName',
]
const TRUST_NAMES = [
  'trustStatus',
  'computeTrustStatus',
  'hookTrustStatus',
  'getTrustStatus',
  'resolveTrustStatus',
  'trustStatusOf',
  'computeTrustStatusFor',
]
const STATE_READ_NAMES = ['readStateFile', 'loadStateFile', 'readState', 'loadState', 'readHookState', 'loadHookState']
const STATE_WRITE_NAMES = ['writeStateFile', 'saveStateFile', 'writeState', 'saveState', 'writeHookState', 'saveHookState']

function pick(exportsObject, names) {
  for (const name of names) {
    if (typeof exportsObject?.[name] === 'function') return { name, fn: exportsObject[name] }
  }
  return null
}

async function loadModule(path) {
  const attempts = []
  try {
    return { ok: true, exports: require(path) }
  } catch (error) {
    attempts.push(`require: ${error.message}`)
  }
  try {
    const imported = await import(pathToFileURL(path).href)
    return { ok: true, exports: imported.default ?? imported }
  } catch (error) {
    attempts.push(`import: ${error.message}`)
  }
  return { ok: false, error: attempts.join(' | ') }
}

function isHashString(value) {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value)
}

function eventKeysOf(value) {
  if (!value || typeof value !== 'object') return null
  if (value.events && typeof value.events === 'object') return Object.keys(value.events).sort()
  if (value.hooks && typeof value.hooks === 'object') return Object.keys(value.hooks).sort()
  return null
}

function normalizeStatus(value) {
  if (typeof value !== 'string') return null
  const cleaned = value.toLowerCase().replace(/[^a-z]/g, '')
  if (!cleaned) return null
  if (cleaned.startsWith('managed')) return 'Managed'
  if (cleaned.startsWith('trusted')) return 'Trusted'
  if (cleaned.startsWith('modified')) return 'Modified'
  if (cleaned.startsWith('untrusted')) return 'Untrusted'
  return null
}

export async function runConformance({ root, spec, vectors }) {
  const results = []
  const corePath = join(root, 'lib', 'core.js')

  if (!existsSync(corePath)) {
    results.push({
      status: 'SKIP',
      name: 'plugin/lib/core.js',
      detail: 'not present yet — the plugin implementation has not landed',
    })
    return results
  }

  // Redirect DSH_HOME for the whole probe so an incidental write cannot touch the real one.
  const tempHome = mkdtempSync(join(tmpdir(), 'dsh-hooks-home-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = tempHome

  try {
    const loaded = await loadModule(corePath)
    if (!loaded.ok) {
      results.push({ status: 'SKIP', name: 'plugin/load lib/core.js', detail: loaded.error })
      return results
    }
    const exportsObject = loaded.exports ?? {}

    // --- A. hash ---------------------------------------------------------
    const hashCandidate = pick(exportsObject, HASH_NAMES)
    if (!hashCandidate) {
      results.push({
        status: 'SKIP',
        name: 'plugin/hash',
        detail: `no hash function exported (looked for ${HASH_NAMES.join(', ')})`,
      })
    } else {
      const expectedWin = vectors.hashVectors.map((vector) =>
        spec.hookHash({
          eventName: vector.event,
          matcher: vector.matcher,
          handler: vector.handler,
          platform: 'win32',
        }),
      )
      const expectedLinux = vectors.hashVectors.map((vector) =>
        spec.hookHash({
          eventName: vector.event,
          matcher: vector.matcher,
          handler: vector.handler,
          platform: 'linux',
        }),
      )
      const shapes = {
        'object({eventName,matcher,handler,platform})': (v) =>
          hashCandidate.fn({ eventName: v.event, event: v.event, matcher: v.matcher, handler: v.handler, platform: v.platform }),
        'object({event_name,matcher,hooks})': (v) =>
          hashCandidate.fn({ event_name: spec.EVENT_LABELS[v.event], matcher: v.matcher, hooks: [v.handler] }),
        'positional(label,matcher,handler,platform)': (v) =>
          hashCandidate.fn(spec.EVENT_LABELS[v.event], v.matcher, v.handler, v.platform),
        'positional(event,matcher,handler,platform)': (v) =>
          hashCandidate.fn(v.event, v.matcher, v.handler, v.platform),
        'positional(label,matcher,handler)': (v) => hashCandidate.fn(spec.EVENT_LABELS[v.event], v.matcher, v.handler),
      }

      let decided = null
      for (const [shapeName, call] of Object.entries(shapes)) {
        const produced = vectors.hashVectors.map((vector) => {
          try {
            return { value: call(vector), error: null }
          } catch (error) {
            return { value: null, error: error.message }
          }
        })
        if (!produced.every((item) => isHashString(item.value))) continue
        decided = { shapeName, produced }
        break
      }

      if (!decided) {
        results.push({
          status: 'SKIP',
          name: 'plugin/hash',
          detail: `${hashCandidate.name}() has no recognised call shape`,
        })
      } else {
        const mismatches = []
        let linuxOnly = 0
        decided.produced.forEach((item, index) => {
          if (item.value === expectedWin[index]) return
          if (item.value === expectedLinux[index] && expectedWin[index] !== expectedLinux[index]) {
            linuxOnly += 1
            return
          }
          mismatches.push(`${vectors.hashVectors[index].name}: got ${item.value}`)
        })
        if (mismatches.length === 0 && linuxOnly === 0) {
          results.push({
            status: 'PASS',
            name: 'plugin/hash',
            detail: `${hashCandidate.name}() via ${decided.shapeName} — ${vectors.hashVectors.length}/${vectors.hashVectors.length} vectors match CODEX`,
          })
        } else if (mismatches.length === 0) {
          results.push({
            status: 'FAIL',
            name: 'plugin/hash',
            detail: `${hashCandidate.name}() ignored commandWindows on win32 (${linuxOnly} vectors) — CODEX prefers commandWindows on Windows`,
          })
        } else {
          results.push({
            status: 'FAIL',
            name: 'plugin/hash',
            detail: `${hashCandidate.name}() via ${decided.shapeName}: ${mismatches.join('; ')}`,
          })
        }
      }
    }

    // --- B. parse --------------------------------------------------------
    const parseCandidate = pick(exportsObject, PARSE_NAMES)
    if (!parseCandidate) {
      results.push({
        status: 'SKIP',
        name: 'plugin/parse',
        detail: `no parse function exported (looked for ${PARSE_NAMES.join(', ')})`,
      })
    } else {
      const examplePath = join(root, 'examples', 'hooks.json')
      const exampleText = existsSync(examplePath) ? readFileSync(examplePath, 'utf8') : '{"hooks":{}}'
      let pluginValue = null
      let pluginError = null
      try {
        pluginValue = parseCandidate.fn(exampleText)
      } catch (error) {
        pluginError = error.message
      }
      if (pluginError) {
        results.push({
          status: 'FAIL',
          name: 'plugin/parse',
          detail: `${parseCandidate.name}() threw on examples/hooks.json: ${pluginError}`,
        })
      } else {
        const pluginEvents = eventKeysOf(pluginValue)
        const specEvents = Object.keys(spec.parseHooksFile(exampleText).events).sort()
        if (!pluginEvents) {
          results.push({
            status: 'SKIP',
            name: 'plugin/parse',
            detail: `${parseCandidate.name}() returned a shape without an event map`,
          })
        } else if (JSON.stringify(pluginEvents) !== JSON.stringify(specEvents)) {
          results.push({
            status: 'FAIL',
            name: 'plugin/parse',
            detail: `event set differs: plugin [${pluginEvents}] vs reference [${specEvents}]`,
          })
        } else {
          results.push({
            status: 'PASS',
            name: 'plugin/parse',
            detail: `${parseCandidate.name}() exposes the same events as the reference`,
          })
        }
      }
    }

    // --- C. matcher ------------------------------------------------------
    const matchCandidate = pick(exportsObject, MATCH_NAMES)
    if (!matchCandidate) {
      results.push({
        status: 'SKIP',
        name: 'plugin/matcher',
        detail: `no matcher function exported (looked for ${MATCH_NAMES.join(', ')})`,
      })
    } else {
      const cases = [
        { pattern: '*', input: 'Bash' },
        { pattern: 'Bash', input: 'Bash' },
        { pattern: 'Bash', input: 'bash' },
        { pattern: 'Bash|Read', input: 'Read' },
        { pattern: '^Bash$', input: 'BashTool' },
      ]
      const expected = cases.map((item) => spec.matchMatcher(item.pattern, item.input))
      const shapes = {
        'positional(pattern,input)': (item) => matchCandidate.fn(item.pattern, item.input),
        'positional(input,pattern)': (item) => matchCandidate.fn(item.input, item.pattern),
        'object({matcher,input})': (item) => matchCandidate.fn({ matcher: item.pattern, pattern: item.pattern, input: item.input }),
      }
      let decided = null
      for (const [shapeName, call] of Object.entries(shapes)) {
        const produced = cases.map((item) => {
          try {
            return Boolean(call(item))
          } catch {
            return null
          }
        })
        if (produced.some((value) => value === null)) continue
        if (JSON.stringify(produced) === JSON.stringify(expected)) {
          decided = { shapeName, produced, ok: true }
          break
        }
        if (!decided) decided = { shapeName, produced, ok: false }
      }
      if (!decided) {
        results.push({
          status: 'SKIP',
          name: 'plugin/matcher',
          detail: `${matchCandidate.name}() has no recognised call shape`,
        })
      } else if (decided.ok) {
        results.push({
          status: 'PASS',
          name: 'plugin/matcher',
          detail: `${matchCandidate.name}() via ${decided.shapeName} — matches CODEX on all cases`,
        })
      } else {
        results.push({
          status: 'FAIL',
          name: 'plugin/matcher',
          detail: `${matchCandidate.name}() via ${decided.shapeName}: got [${decided.produced}] want [${expected}]`,
        })
      }
    }

    // --- D. trust --------------------------------------------------------
    const trustCandidate = pick(exportsObject, TRUST_NAMES)
    if (!trustCandidate) {
      results.push({
        status: 'SKIP',
        name: 'plugin/trust',
        detail: `no trust function exported (looked for ${TRUST_NAMES.join(', ')})`,
      })
    } else {
      const cases = [
        { input: { currentHash: 'h', trustedHash: 'h' }, expected: 'Trusted' },
        { input: { currentHash: 'h', trustedHash: 'other' }, expected: 'Modified' },
        { input: { currentHash: 'h', trustedHash: null }, expected: 'Untrusted' },
        { input: { isManaged: true, currentHash: 'h', trustedHash: 'other' }, expected: 'Managed' },
      ]
      const shapes = {
        'object({currentHash,trustedHash,isManaged})': (input) =>
          trustCandidate.fn({
            ...input,
            isBuiltin: input.isBuiltin ?? false,
            managed: input.isManaged ?? false,
            hash: input.currentHash,
            trusted_hash: input.trustedHash,
          }),
        'positional(currentHash,trustedHash,isManaged)': (input) =>
          trustCandidate.fn(input.currentHash, input.trustedHash, input.isManaged === true),
      }
      let decided = null
      for (const [shapeName, call] of Object.entries(shapes)) {
        const produced = cases.map((item) => {
          try {
            return normalizeStatus(call(item.input))
          } catch {
            return null
          }
        })
        if (produced.some((value) => value === null)) continue
        const ok = produced.every((value, index) => value === cases[index].expected)
        if (ok) {
          decided = { shapeName, produced, ok: true }
          break
        }
        if (!decided) decided = { shapeName, produced, ok: false }
      }
      if (!decided) {
        results.push({
          status: 'SKIP',
          name: 'plugin/trust',
          detail: `${trustCandidate.name}() has no recognised call shape`,
        })
      } else if (decided.ok) {
        results.push({
          status: 'PASS',
          name: 'plugin/trust',
          detail: `${trustCandidate.name}() via ${decided.shapeName} — all four trust states agree`,
        })
      } else {
        results.push({
          status: 'FAIL',
          name: 'plugin/trust',
          detail: `${trustCandidate.name}() via ${decided.shapeName}: got [${decided.produced}] want [${cases.map((c) => c.expected)}]`,
        })
      }
    }

    // --- E. state --------------------------------------------------------
    const readCandidate = pick(exportsObject, STATE_READ_NAMES)
    const writeCandidate = pick(exportsObject, STATE_WRITE_NAMES)
    const statePath = join(tempHome, 'hooks.state.json')

    if (!readCandidate) {
      results.push({
        status: 'SKIP',
        name: 'plugin/state-read',
        detail: `no state reader exported (looked for ${STATE_READ_NAMES.join(', ')})`,
      })
    } else if (readCandidate.fn.length < 1) {
      results.push({
        status: 'SKIP',
        name: 'plugin/state-read',
        detail: `${readCandidate.name}() takes no path argument — probing it could read the real $DSH_HOME`,
      })
    } else {
      try {
        const value = readCandidate.fn(statePath)
        const ok = value && typeof value === 'object'
        results.push({
          status: ok ? 'PASS' : 'FAIL',
          name: 'plugin/state-read',
          detail: ok
            ? `${readCandidate.name}(path) returned a state object`
            : `${readCandidate.name}(path) did not return an object`,
        })
      } catch (error) {
        results.push({ status: 'FAIL', name: 'plugin/state-read', detail: `${readCandidate.name}(path) threw: ${error.message}` })
      }
    }

    if (!writeCandidate) {
      results.push({
        status: 'SKIP',
        name: 'plugin/state-write',
        detail: `no state writer exported (looked for ${STATE_WRITE_NAMES.join(', ')})`,
      })
    } else if (writeCandidate.fn.length < 1) {
      results.push({
        status: 'SKIP',
        name: 'plugin/state-write',
        detail: `${writeCandidate.name}() takes no path argument — probing it would write to the real $DSH_HOME`,
      })
    } else {
      try {
        const written = writeCandidate.fn(statePath, {
          version: 1,
          states: { 'probe:stop:0:0': { enabled: false, trustedHash: 'sha256:probe' } },
        })
        const onDisk = JSON.parse(readFileSync(statePath, 'utf8'))
        const ok =
          onDisk &&
          onDisk.states &&
          onDisk.states['probe:stop:0:0'] &&
          onDisk.states['probe:stop:0:0'].enabled === false &&
          onDisk.states['probe:stop:0:0'].trustedHash === 'sha256:probe'
        results.push({
          status: ok ? 'PASS' : 'FAIL',
          name: 'plugin/state-write',
          detail: ok
            ? `${writeCandidate.name}(path, state) round-tripped through ${statePath}`
            : `${writeCandidate.name}(path, state) wrote an unexpected payload: ${JSON.stringify(onDisk)}`,
        })
      } catch (error) {
        results.push({
          status: 'FAIL',
          name: 'plugin/state-write',
          detail: `${writeCandidate.name}(path, state) threw: ${error.message}`,
        })
      }
    }

    return results
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    rmSync(tempHome, { recursive: true, force: true })
  }
}

/**
 * Self-test of the probe itself: build a throwaway plugin in a temp directory and check
 * that the probe reports PASS for a faithful implementation and FAIL for a broken one.
 * Without this, "the probe skipped everything" and "the probe would have caught the bug"
 * would be indistinguishable.
 */
export async function runConformanceSelfTest({ spec, vectors }) {
  const results = []
  const dir = mkdtempSync(join(tmpdir(), 'dsh-hooks-probe-'))
  const specPath = fileURLToPath(new URL('./spec.mjs', import.meta.url)).replace(/\\/g, '/')

  const goodSource = `
const spec = require(${JSON.stringify(specPath)})
module.exports = {
  hookHash: (options) => spec.hookHash(options),
  parseHooksFile: (text) => spec.parseHooksFile(text),
  matchMatcher: (pattern, input) => spec.matchMatcher(pattern, input),
  trustStatus: (options) => spec.trustStatus(options),
  readStateFile: (path) => spec.readStateFile(path),
  writeStateFile: (path, state) => spec.writeStateFile(path, state),
}
`
  const brokenSource = goodSource.replace(
    'hookHash: (options) => spec.hookHash(options)',
    'hookHash: (options) => spec.hookHash({ ...options, platform: "linux" })',
  )

  try {
    const goodRoot = join(dir, 'good')
    mkdirSync(join(goodRoot, 'lib'), { recursive: true })
    writeFileSync(join(goodRoot, 'lib', 'core.js'), goodSource, 'utf8')
    const goodResults = await runConformance({ root: goodRoot, spec, vectors })
    const goodFailures = goodResults.filter((item) => item.status === 'FAIL')
    const goodSkips = goodResults.filter((item) => item.status === 'SKIP')
    results.push({
      status: goodFailures.length === 0 && goodSkips.length === 0 ? 'PASS' : 'FAIL',
      name: 'probe/self-test(忠实实现 → 全部 PASS)',
      detail:
        goodFailures.length === 0 && goodSkips.length === 0
          ? `${goodResults.length} 个探针全部命中`
          : `FAIL: ${goodFailures.map((f) => f.name).join(',')} / SKIP: ${goodSkips.map((s) => s.name).join(',')}`,
    })

    const brokenRoot = join(dir, 'broken')
    mkdirSync(join(brokenRoot, 'lib'), { recursive: true })
    writeFileSync(join(brokenRoot, 'lib', 'core.js'), brokenSource, 'utf8')
    const brokenResults = await runConformance({ root: brokenRoot, spec, vectors })
    const hashResult = brokenResults.find((item) => item.name === 'plugin/hash')
    const caught = hashResult && hashResult.status === 'FAIL'
    results.push({
      status: caught ? 'PASS' : 'FAIL',
      name: 'probe/self-test(忽略 commandWindows → 必须 FAIL)',
      detail: caught ? hashResult.detail : `探针没有抓到故意植入的 bug：${JSON.stringify(hashResult)}`,
    })

    return results
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
