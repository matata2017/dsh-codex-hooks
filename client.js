// ponytail: the host's boot manifest keeps the package id it composed when the
// host process started. After a rename the manifest still advertises the old id,
// and a bundle that declares a different one never activates. Adopt the id the
// manifest advertises for us; drop this once every host restarts on >=0.1.0.
const SELF_ID = (() => {
  const entries = (typeof window !== 'undefined' && window.__DSH_BOOT__?.entries) || []
  const row = entries.find((entry) => typeof entry?.id === 'string' && /dsh-(?:codex-)?hooks$/.test(entry.id))
  return row?.id ?? 'dsh-codex-hooks'
})()

window.__ModuleLoader__.load({
  id: SELF_ID,
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const NS = 'dsh-hooks'

    const en = {
      meta: {
        title: 'Hooks',
        description: 'Manage lifecycle hooks loaded from your configuration, plugins and projects.',
      },
      nav: 'Hooks',
      title: 'Hooks',
      subtitle: 'Manage lifecycle hooks from your configuration and plugins.',
      loading: 'Loading hooks…',
      empty: 'No hooks found.',
      emptyHint: 'Add a hooks.json file to ~/.dsh, to a project .dsh folder, or to a plugin.',
      hooks: '{count} hooks',
      hook: '{count} hook',
      needsReview: '{count} needs review',
      trusted: 'Trusted',
      managed: 'Managed',
      untrusted: 'Untrusted',
      modified: 'Modified',
      trust: 'Trust',
      revoke: 'Revoke',
      test: 'Test',
      enable: 'Enable',
      disable: 'Disable',
      review: 'Review',
      testing: 'Testing…',
      testOk: 'Hook ran successfully.',
      testBlocked: 'Hook blocked the step.',
      testFailed: 'Hook failed.',
      emptyGroup: 'No hooks in this group.',
      matcher: 'matcher {value}',
      source: 'Source {value}',
      error: 'Could not reach the hooks service: {message}',
      recentRuns: 'Recent runs',
      runs: 'Runs',
      blocked: 'Blocked',
      failed: 'Failed',
      noRuns: 'No hook has run in this session yet.',
      refresh: 'Refresh',
      reviewBanner: '{count} hook(s) need review before they can run.',
      notNow: 'Not now',
      allowAll: 'Allow all',
      reviewSettingsHint: 'You can change this later in Settings → Hooks.',
      statusOk: 'Completed',
      statusBlocked: 'Blocked',
      statusFailed: 'Failed',
      statusSkipped: 'Skipped',
      reviewTitle: 'Hooks need review',
      reviewCount: '{count} hook(s) are new or changed.',
      reviewNote: 'Trusted hooks can run commands on your machine.',
      reviewHooks: 'Review hooks',
      trustAllContinue: 'Trust all and continue',
      continueWithout: "Continue without trusting (hooks won't run)",
      browserSubtitle: 'View and manage lifecycle hooks.',
      events: 'Events',
      handlers: 'Handlers',
      back: 'Back',
      close: 'Close',
    }

    const zh = {
      meta: {
        title: 'Hooks',
        description: '管理来自配置、插件与项目的生命周期钩子。',
      },
      nav: 'Hooks',
      title: 'Hooks',
      subtitle: '管理来自配置与插件的生命周期钩子。',
      loading: '正在加载钩子…',
      empty: '没有找到钩子。',
      emptyHint: '在 ~/.dsh、项目 .dsh 目录或插件中加入 hooks.json 即可。',
      hooks: '{count} 个钩子',
      hook: '{count} 个钩子',
      needsReview: '{count} 个待审核',
      trusted: '已信任',
      managed: '托管',
      untrusted: '未信任',
      modified: '已修改',
      trust: '信任',
      revoke: '撤销信任',
      test: '测试',
      enable: '启用',
      disable: '停用',
      review: '审核',
      testing: '测试中…',
      testOk: '钩子执行成功。',
      testBlocked: '钩子阻止了该步骤。',
      testFailed: '钩子执行失败。',
      emptyGroup: '该分组没有钩子。',
      matcher: '匹配 {value}',
      source: '来源 {value}',
      error: '无法连接 hooks 服务：{message}',
      recentRuns: '最近运行',
      runs: '运行',
      blocked: '拦截',
      failed: '失败',
      noRuns: '本次会话还没有钩子运行过。',
      refresh: '刷新',
      reviewBanner: '有 {count} 个钩子需要审核才能运行。',
      notNow: '稍后',
      allowAll: '全部信任',
      reviewSettingsHint: '之后可在 设置 → Hooks 中修改。',
      statusOk: '已完成',
      statusBlocked: '被拦截',
      statusFailed: '失败',
      statusSkipped: '已跳过',
      reviewTitle: '钩子需要审核',
      reviewCount: '{count} 个钩子是新的或已被修改。',
      reviewNote: '信任后钩子可以在你的机器上执行命令。',
      reviewHooks: '查看钩子',
      trustAllContinue: '全部信任并继续',
      continueWithout: '暂不信任（钩子不会运行）',
      browserSubtitle: '查看并管理生命周期钩子。',
      events: '事件',
      handlers: '处理器',
      back: '返回',
      close: '关闭',
    }

    const STYLE = [
      '.__dh_root{display:flex;flex-direction:column;gap:14px;font-size:13px;line-height:1.6;color:var(--dsw-alias-label-primary,#1f2328)}',
      '.__dh_title{font-size:16px;font-weight:600;margin:0}',
      '.__dh_subtitle{font-size:12px;color:var(--dsw-alias-label-tertiary,#6b7280);margin:0}',
      '.__dh_group{border:1px solid var(--dsw-alias-border-l2,#dce2eb);border-radius:10px;background:var(--dsw-alias-bg-layer-2,transparent)}',
      '.__dh_groupHead{display:flex;align-items:center;gap:10px;padding:10px 12px;cursor:pointer;user-select:none}',
      '.__dh_groupHead:hover{border-color:var(--dsw-alias-state-business-primary,#3964fe)}',
      '.__dh_groupIcon{width:24px;height:24px;display:flex;align-items:center;justify-content:center;border-radius:6px;background:var(--dsw-alias-bg-layer-3,#f2f4f7);font-size:13px}',
      '.__dh_groupName{font-weight:600;font-size:13px;flex:1;min-width:0}',
      '.__dh_count{font-size:12px;color:var(--dsw-alias-label-tertiary,#6b7280)}',
      '.__dh_badge{border:1px solid var(--dsw-alias-state-business-primary,#3964fe);color:var(--dsw-alias-state-business-primary,#3964fe);border-radius:999px;padding:0 8px;font-size:10px;white-space:nowrap}',
      '.__dh_badgeWarn{border-color:var(--dsw-alias-state-error-primary,#f85149);color:var(--dsw-alias-state-error-primary,#f85149)}',
      '.__dh_body{border-top:1px solid var(--dsw-alias-border-l2,#dce2eb);padding:6px 12px 10px;display:flex;flex-direction:column;gap:8px}',
      '.__dh_row{display:flex;flex-direction:column;gap:4px;padding:8px 0;border-bottom:1px solid var(--dsw-alias-border-l2,#dce2eb)}',
      '.__dh_row:last-child{border-bottom:none}',
      '.__dh_rowHead{display:flex;align-items:center;gap:8px}',
      '.__dh_event{font-weight:600;font-size:12px}',
      '.__dh_desc{font-size:11px;color:var(--dsw-alias-label-tertiary,#6b7280)}',
      '.__dh_name{font-size:12px;color:var(--dsw-alias-label-secondary,#4b5563);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.__dh_actions{display:flex;align-items:center;gap:6px;margin-left:auto}',
      '.__dh_btn{border:1px solid var(--dsw-alias-border-l2,#dce2eb);background:var(--dsw-alias-bg-layer-3,#f7f8fa);color:var(--dsw-alias-label-primary,#1f2328);border-radius:8px;padding:3px 10px;font:inherit;font-size:12px;cursor:pointer}',
      '.__dh_btn:hover:not(:disabled){border-color:var(--dsw-alias-state-business-primary,#3964fe)}',
      '.__dh_btn:disabled{opacity:.5;cursor:not-allowed}',
      '.__dh_btnPrimary{border-color:var(--dsw-alias-state-business-primary,#3964fe);background:var(--dsw-alias-state-business-primary,#3964fe);color:#fff}',
      '.__dh_switch{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-tertiary,#6b7280)}',
      '.__dh_switch input{accent-color:var(--dsw-alias-state-business-primary,#3964fe)}',
      '.__dh_status{font-size:11px;color:var(--dsw-alias-label-tertiary,#6b7280)}',
      '.__dh_error{font-size:12px;color:var(--dsw-alias-state-error-primary,#f85149)}',
      '.__dh_empty{font-size:12px;color:var(--dsw-alias-label-tertiary,#6b7280);padding:6px 0}',
      '.__dh_stats{border:1px solid var(--dsw-alias-border-l2,#dce2eb);border-radius:10px;padding:8px 12px}',
      '.__dh_runRow{display:flex;align-items:center;gap:8px;padding:3px 0;font-size:12px;color:var(--dsw-alias-label-secondary,#4b5563)}',
      '.__dh_runMark{width:14px;text-align:center;color:var(--dsw-alias-label-tertiary,#6b7280)}',
      '.__dh_runMarkBad{color:var(--dsw-alias-state-error-primary,#f85149)}',
      '.__dh_banner{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 6px;padding:6px 10px;border:1px solid var(--dsw-alias-state-business-primary,#3964fe);border-radius:10px;background:var(--dsw-alias-bg-layer-3,#f7f8fa);font-size:12px;line-height:18px;pointer-events:auto}',
      '.__dh_bannerText{flex:1;min-width:0;color:var(--dsw-alias-label-primary,#1f2328)}',
      '.__dh_bannerHint{font-size:11px;color:var(--dsw-alias-label-tertiary,#6b7280)}',
      '.__dh_card{border:1px solid var(--dsw-alias-state-business-primary,#3964fe);border-radius:10px;background:var(--dsw-alias-bg-layer-3,#f7f8fa);padding:8px 10px;display:flex;flex-direction:column;gap:4px;margin:0 0 6px}',
      '.__dh_cardTitle{font-weight:600;font-size:12px}',
      '.__dh_cardCount{font-size:12px;color:var(--dsw-alias-state-warning-primary,#b8820b)}',
      '.__dh_cardHint{font-size:11px;color:var(--dsw-alias-label-tertiary,#6b7280)}',
      '.__dh_panel{border:1px solid var(--dsw-alias-border-l2,#dce2eb);border-radius:10px;background:var(--dsw-alias-bg-layer-1,#fff);padding:8px 10px;display:flex;flex-direction:column;gap:8px;max-height:min(60vh,520px);overflow:auto}',
      '.__dh_panelHead{display:flex;align-items:center;gap:8px}',
      '.__dh_list{display:flex;flex-direction:column}',
      '.__dh_listRow{display:flex;align-items:center;gap:8px;padding:6px 4px;border-bottom:1px solid var(--dsw-alias-border-l2,#dce2eb);font-size:12px}',
      '.__dh_listRow:last-child{border-bottom:none}',
      '.__dh_listRowPick{cursor:pointer}',
      '.__dh_listRowPick:hover{background:var(--dsw-alias-bg-layer-3,#f2f4f7)}',
      '.__dh_warn{color:var(--dsw-alias-state-error-primary,#f85149);font-weight:600}',
    ].join('')

    /* ---------------- connection plumbing ---------------- */

    let connection = null
    const listeners = new Set()
    let translate = (key) => key

    function setConnection(value) {
      if (!value || value === connection) return
      connection = value
      for (const listener of listeners) listener(value)
    }

    function resolveHandle(service) {
      if (!service) return null
      if (service.rpc && typeof service.rpc.call === 'function') return service
      if (service.connection && service.connection.rpc && typeof service.connection.rpc.call === 'function') {
        return service.connection
      }
      return null
    }

    async function call(method, args) {
      if (!connection) throw new Error('hooks service is not connected')
      const response = await connection.rpc.call('/api', `hooks/${method}`, { args })
      if (!response || response.ok !== true) {
        throw new Error(response?.error?.message ?? 'hooks call failed')
      }
      return response.value
    }

    function useConnection() {
      const [, bump] = React.useState(0)
      React.useEffect(() => {
        const listener = () => bump((value) => value + 1)
        listeners.add(listener)
        if (connection) bump((value) => value + 1)
        return () => {
          listeners.delete(listener)
        }
      }, [])
      return connection
    }

    /* ---------------- helpers ---------------- */

    function format(template, values) {
      return String(template).replace(/\{(\w+)\}/g, (match, name) =>
        values && name in values ? String(values[name]) : match,
      )
    }

    function basename(command) {
      if (!command) return ''
      const parts = String(command).split(/[\\/]/).filter(Boolean)
      const last = parts.at(-1) ?? ''
      return last.replace(/\.(exe|cmd|bat|ps1|sh|mjs|cjs|js)$/i, '')
    }

    function hookTitle(hook) {
      if (hook.statusMessage) return hook.statusMessage
      if (hook.command) return basename(hook.command)
      return hook.key
    }

    const TRUST_CLASS = {
      Trusted: '__dh_badge',
      Managed: '__dh_badge',
      Modified: '__dh_badge __dh_badgeWarn',
      Untrusted: '__dh_badge __dh_badgeWarn',
    }

    const STATUS_KEY = {
      ok: 'statusOk',
      blocked: 'statusBlocked',
      failed: 'statusFailed',
      skipped: 'statusSkipped',
    }

    const STATUS_MARK = { ok: '\u2713', blocked: '\u2715', failed: '!', skipped: '-' }

    /* ---------------- component ---------------- */

    function HooksSection() {
      const t = (key, values) => format(translate(key), values)
      const conn = useConnection()
      const [data, setData] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [expanded, setExpanded] = React.useState(() => new Set(['config']))
      const [busy, setBusy] = React.useState(null)
      const [notice, setNotice] = React.useState(null)
      const [stats, setStats] = React.useState(null)

      const refresh = React.useCallback(async () => {
        if (!conn) return
        try {
          const value = await call('list', {})
          setData(value)
          setError(null)
        } catch (failure) {
          setError(failure?.message ?? String(failure))
        }
        try {
          setStats(await call('stats', {}))
        } catch {
          setStats(null)
        }
      }, [conn])

      React.useEffect(() => {
        refresh()
      }, [refresh])

      const toggleGroup = (id) => {
        setExpanded((current) => {
          const next = new Set(current)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          return next
        })
      }

      const run = async (key, action) => {
        setBusy(key)
        setNotice(null)
        try {
          const result = await action()
          if (result && result.ok === false) throw new Error(result.error ?? 'hooks call failed')
          await refresh()
          return result
        } catch (failure) {
          setError(failure?.message ?? String(failure))
          return null
        } finally {
          setBusy(null)
        }
      }

      const groups = data?.groups ?? []

      return h(
        'div',
        { className: '__dh_root' },
        h('h2', { className: '__dh_title' }, t('title')),
        h('p', { className: '__dh_subtitle' }, t('subtitle')),
        stats
          ? h(
              'div',
              { className: '__dh_stats' },
              h(
                'div',
                { className: '__dh_rowHead' },
                h('span', { className: '__dh_event' }, t('recentRuns')),
                h(
                  'span',
                  { className: '__dh_count' },
                  `${t('runs')} ${stats.runs} \u00b7 ${t('blocked')} ${stats.blocked} \u00b7 ${t('failed')} ${stats.failed}`,
                ),
                h(
                  'span',
                  { className: '__dh_actions' },
                  h('button', { className: '__dh_btn', onClick: () => refresh() }, t('refresh')),
                ),
              ),
              (stats.history ?? []).length === 0
                ? h('div', { className: '__dh_empty' }, t('noRuns'))
                : (stats.history ?? []).slice(0, 10).map((row, index) =>
                    h(
                      'div',
                      { key: `${row.at}-${index}`, className: '__dh_runRow' },
                      h(
                        'span',
                        {
                          className:
                            row.status === 'ok' ? '__dh_runMark' : '__dh_runMark __dh_runMarkBad',
                        },
                        STATUS_MARK[row.status] ?? '?',
                      ),
                      h('span', { className: '__dh_event' }, row.eventName),
                      h('span', { className: '__dh_name' }, row.title),
                      h('span', { className: '__dh_count' }, row.sourceLabel || row.source || ''),
                      h(
                        'span',
                        { className: '__dh_actions __dh_count' },
                        t(STATUS_KEY[row.status] ?? 'statusFailed'),
                        row.durationMs ? ` ${row.durationMs}ms` : '',
                      ),
                    ),
                  ),
            )
          : null,
        error ? h('div', { className: '__dh_error' }, t('error', { message: error })) : null,
        notice ? h('div', { className: '__dh_status' }, notice) : null,
        !conn && !data ? h('div', { className: '__dh_empty' }, t('loading')) : null,
        conn && !data && !error ? h('div', { className: '__dh_empty' }, t('loading')) : null,
        data && groups.length === 0 ? h('div', { className: '__dh_empty' }, t('empty')) : null,
        data && groups.length === 0 ? h('div', { className: '__dh_status' }, t('emptyHint')) : null,
        groups.map((group) => {
          const open = expanded.has(group.id)
          const review = group.hooks.filter((hook) => hook.trust === 'Untrusted' || hook.trust === 'Modified')
          return h(
            'div',
            { key: group.id, className: '__dh_group' },
            h(
              'div',
              { className: '__dh_groupHead', onClick: () => toggleGroup(group.id) },
              h('span', { className: '__dh_groupIcon' }, group.id === 'plugins' ? '🧩' : group.id === 'projects' ? '📁' : '🗂'),
              h('span', { className: '__dh_groupName' }, group.label),
              h('span', { className: '__dh_count' }, t(group.count === 1 ? 'hook' : 'hooks', { count: group.count })),
              review.length > 0
                ? h('span', { className: '__dh_badge __dh_badgeWarn' }, t('needsReview', { count: review.length }))
                : null,
            ),
            open
              ? h(
                  'div',
                  { className: '__dh_body' },
                  group.hooks.length === 0
                    ? h('div', { className: '__dh_empty' }, t('emptyGroup'))
                    : group.hooks.map((hook) =>
                        h(
                          'div',
                          { key: hook.key, className: '__dh_row' },
                          h(
                            'div',
                            { className: '__dh_rowHead' },
                            h('span', { className: '__dh_event' }, hook.eventName),
                            h('span', { className: '__dh_desc' }, hook.description),
                            h(
                              'span',
                              { className: '__dh_actions' },
                              h('span', { className: TRUST_CLASS[hook.trust] ?? '__dh_badge' }, t(hook.trust.toLowerCase())),
                              h(
                                'label',
                                { className: '__dh_switch' },
                                h('input', {
                                  type: 'checkbox',
                                  checked: hook.enabled === true,
                                  disabled: busy === hook.key,
                                  onChange: (event) => {
                                    const enabled = event.target.checked
                                    run(hook.key, () => call('setEnabled', { key: hook.key, enabled }))
                                  },
                                }),
                                h('span', null, hook.enabled === true ? t('enable') : t('disable')),
                              ),
                              hook.trust === 'Trusted' || hook.trust === 'Managed'
                                ? h(
                                    'button',
                                    {
                                      className: '__dh_btn',
                                      disabled: busy === hook.key,
                                      onClick: () => {
                                        run(hook.key, () => call('setTrusted', { key: hook.key, trusted: false }))
                                      },
                                    },
                                    t('revoke'),
                                  )
                                : h(
                                    'button',
                                    {
                                      className: '__dh_btn __dh_btnPrimary',
                                      disabled: busy === hook.key,
                                      onClick: () => {
                                        run(hook.key, () => call('setTrusted', { key: hook.key, trusted: true }))
                                      },
                                    },
                                    t('trust'),
                                  ),
                              h(
                                'button',
                                {
                                  className: '__dh_btn',
                                  disabled: busy === hook.key,
                                  onClick: async () => {
                                    const result = await run(hook.key, () => call('testHook', { key: hook.key }))
                                    if (!result) return
                                    if (result.status === 'ok') setNotice(t('testOk'))
                                    else if (result.status === 'blocked') setNotice(t('testBlocked'))
                                    else setNotice(t('testFailed'))
                                  },
                                },
                                busy === hook.key ? t('testing') : t('test'),
                              ),
                            ),
                          ),
                          h('div', { className: '__dh_name' }, hookTitle(hook)),
                          hook.matcher
                            ? h('div', { className: '__dh_status' }, t('matcher', { value: hook.matcher }))
                            : null,
                          h('div', { className: '__dh_status' }, t('source', { value: hook.sourcePath })),
                        ),
                      ),
                )
              : null,
          )
        }),
      )
    }

    /* ---------------- composer overlay: review card + hooks browser ---------------- */

    // One overlay above the composer holds both views. `/hooks` opens the
    // browser, the review card opens it too.
    const panel = { open: false, eventName: null }
    const panelListeners = new Set()

    function setPanel(next) {
      Object.assign(panel, next)
      for (const listener of panelListeners) listener()
    }

    function openBrowser(eventName) {
      setPanel({ open: true, eventName: eventName ?? null })
    }

    function closeBrowser() {
      setPanel({ open: false, eventName: null })
    }

    function usePanel() {
      const [, bump] = React.useState(0)
      React.useEffect(() => {
        const listener = () => bump((value) => value + 1)
        panelListeners.add(listener)
        return () => {
          panelListeners.delete(listener)
        }
      }, [])
      return panel
    }

    function HooksOverlay() {
      const t = (key, values) => format(translate(key), values)
      const conn = useConnection()
      const view = usePanel()
      const [data, setData] = React.useState(null)
      const [stats, setStats] = React.useState(null)
      const [pending, setPending] = React.useState([])
      const [dismissed, setDismissed] = React.useState(false)
      const [busy, setBusy] = React.useState(null)
      const [error, setError] = React.useState(null)

      const refresh = React.useCallback(async () => {
        if (!conn) return
        try {
          setData(await call('list', {}))
          setError(null)
        } catch (failure) {
          setError(failure?.message ?? String(failure))
        }
        try {
          setStats(await call('stats', {}))
        } catch {
          setStats(null)
        }
        try {
          const value = await call('review', {})
          setPending(value?.hooks ?? [])
        } catch {
          setPending([])
        }
      }, [conn])

      React.useEffect(() => {
        refresh()
      }, [refresh])

      const act = async (key, action) => {
        setBusy(key)
        try {
          const result = await action()
          if (result && result.ok === false) throw new Error(result.error ?? 'hooks call failed')
          await refresh()
        } catch (failure) {
          setError(failure?.message ?? String(failure))
        } finally {
          setBusy(null)
        }
      }

      const needsReview = (hook) => hook.trust === 'Untrusted' || hook.trust === 'Modified'
      const showCard = pending.length > 0 && !dismissed
      if (!showCard && !view.open) return null

      const hooks = data?.hooks ?? []
      const events = data?.events ?? []
      const handlers = view.eventName
        ? hooks.filter((hook) => hook.eventName === view.eventName)
        : []

      return h(
        'div',
        { className: '__dh_root' },
        showCard
          ? h(
              'div',
              { className: '__dh_card' },
              h('div', { className: '__dh_cardTitle' }, t('reviewTitle')),
              h('div', { className: '__dh_cardCount' }, t('reviewCount', { count: pending.length })),
              h('div', { className: '__dh_cardHint' }, t('reviewNote')),
              h(
                'div',
                { className: '__dh_actions' },
                h(
                  'button',
                  { className: '__dh_btn', disabled: busy !== null, onClick: () => openBrowser() },
                  t('reviewHooks'),
                ),
                h(
                  'button',
                  {
                    className: '__dh_btn __dh_btnPrimary',
                    disabled: busy !== null,
                    onClick: () =>
                      act('trustAll', async () => {
                        await call('trustAll', {})
                        setDismissed(true)
                      }),
                  },
                  t('trustAllContinue'),
                ),
                h(
                  'button',
                  { className: '__dh_btn', disabled: busy !== null, onClick: () => setDismissed(true) },
                  t('continueWithout'),
                ),
              ),
            )
          : null,
        error ? h('div', { className: '__dh_error' }, t('error', { message: error })) : null,
        view.open
          ? h(
              'div',
              { className: '__dh_panel' },
              h(
                'div',
                { className: '__dh_panelHead' },
                h('span', { className: '__dh_event' }, view.eventName ? t('handlers') : t('events')),
                h(
                  'span',
                  { className: '__dh_count' },
                  view.eventName ? view.eventName : t('browserSubtitle'),
                ),
                h(
                  'span',
                  { className: '__dh_actions' },
                  view.eventName
                    ? h('button', { className: '__dh_btn', onClick: () => openBrowser() }, t('back'))
                    : null,
                  h('button', { className: '__dh_btn', onClick: closeBrowser }, t('close')),
                ),
              ),
              view.eventName
                ? h(
                    'div',
                    { className: '__dh_list' },
                    handlers.length === 0
                      ? h('div', { className: '__dh_empty' }, t('emptyGroup'))
                      : handlers.map((hook) =>
                          h(
                            'div',
                            { key: hook.key, className: '__dh_listRow' },
                            h(
                              'span',
                              { className: needsReview(hook) ? '__dh_runMark __dh_warn' : '__dh_runMark' },
                              needsReview(hook) ? '!' : hook.enabled === false ? '-' : 'x',
                            ),
                            h('span', { className: '__dh_event' }, hookTitle(hook)),
                            h('span', { className: '__dh_name' }, hook.sourceLabel || hook.source || ''),
                            h(
                              'span',
                              { className: '__dh_actions' },
                              h(
                                'span',
                                { className: TRUST_CLASS[hook.trust] ?? '__dh_badge' },
                                t(hook.trust.toLowerCase()),
                              ),
                              h(
                                'label',
                                { className: '__dh_switch' },
                                h('input', {
                                  type: 'checkbox',
                                  checked: hook.enabled === true,
                                  disabled: busy === hook.key,
                                  onChange: (event) =>
                                    act(hook.key, () =>
                                      call('setEnabled', { key: hook.key, enabled: event.target.checked }),
                                    ),
                                }),
                              ),
                              hook.trust === 'Trusted' || hook.trust === 'Managed'
                                ? h(
                                    'button',
                                    {
                                      className: '__dh_btn',
                                      disabled: busy === hook.key,
                                      onClick: () =>
                                        act(hook.key, () => call('setTrusted', { key: hook.key, trusted: false })),
                                    },
                                    t('revoke'),
                                  )
                                : h(
                                    'button',
                                    {
                                      className: '__dh_btn __dh_btnPrimary',
                                      disabled: busy === hook.key,
                                      onClick: () =>
                                        act(hook.key, () => call('setTrusted', { key: hook.key, trusted: true })),
                                    },
                                    t('trust'),
                                  ),
                            ),
                          ),
                        ),
                  )
                : h(
                    'div',
                    { className: '__dh_list' },
                    events.length === 0
                      ? h('div', { className: '__dh_empty' }, t('empty'))
                      : events.map((row) =>
                          h(
                            'div',
                            {
                              key: row.eventName,
                              className: '__dh_listRow __dh_listRowPick',
                              onClick: () => openBrowser(row.eventName),
                            },
                            h(
                              'span',
                              { className: row.needsReview > 0 ? '__dh_runMark __dh_warn' : '__dh_runMark' },
                              row.needsReview > 0 ? '!' : ' ',
                            ),
                            h('span', { className: '__dh_event' }, row.eventName),
                            h('span', { className: '__dh_count' }, `${row.active}/${row.installed}`),
                          ),
                        ),
                  ),
              stats
                ? h(
                    'div',
                    { className: '__dh_stats' },
                    h(
                      'div',
                      { className: '__dh_rowHead' },
                      h('span', { className: '__dh_event' }, t('recentRuns')),
                      h(
                        'span',
                        { className: '__dh_count' },
                        `${t('runs')} ${stats.runs} · ${t('blocked')} ${stats.blocked} · ${t('failed')} ${stats.failed}`,
                      ),
                    ),
                    (stats.history ?? []).length === 0
                      ? h('div', { className: '__dh_empty' }, t('noRuns'))
                      : (stats.history ?? []).slice(0, 10).map((row, index) =>
                          h(
                            'div',
                            { key: `${row.at}-${index}`, className: '__dh_runRow' },
                            h(
                              'span',
                              {
                                className:
                                  row.status === 'ok' ? '__dh_runMark' : '__dh_runMark __dh_runMarkBad',
                              },
                              STATUS_MARK[row.status] ?? '?',
                            ),
                            h('span', { className: '__dh_event' }, row.eventName),
                            h('span', { className: '__dh_name' }, row.title),
                            h('span', { className: '__dh_count' }, row.sourceLabel || row.source || ''),
                            h(
                              'span',
                              { className: '__dh_actions __dh_count' },
                              t(STATUS_KEY[row.status] ?? 'statusFailed'),
                              row.durationMs ? ` ${row.durationMs}ms` : '',
                            ),
                          ),
                        ),
                  )
                : null,
            )
          : null,
      )
    }

    /* ---------------- plugin entry point ---------------- */

    function apply(ctx) {
      ctx.inject(['locale', 'slots', 'connection'], (client) => {
        translate = client.locale.bind(NS)
        client.effect(() => client.locale.register(NS, { zh, en }), 'dsh-hooks: dictionaries')
        client.effect(() => {
          const style = document.createElement('style')
          style.textContent = STYLE
          document.head.append(style)
          return () => style.remove()
        }, 'dsh-hooks: settings style')
        client.slots.inject('settings.section', () =>
          client.slots.register(
            {
              name: 'settings.section',
              id: 'hooks',
              order: 30,
              label: () => translate('nav'),
              locale: NS,
              inject: () => ({ t: translate }),
            },
            HooksSection,
          ),
        )
        try {
          client.slots.inject('conversation.input.overlay', () =>
            client.slots.register(
              {
                name: 'conversation.input.overlay',
                id: 'hooks-overlay',
                order: 40,
                locale: NS,
                inject: () => ({ t: translate }),
              },
              HooksOverlay,
            ),
          )
        } catch {
          /* the composer overlay slot is optional: without it the settings page is the only entry */
        }
        setConnection(resolveHandle(client.connection))
      })
      // `/hooks` opens the browser instead of printing text, the way Codex does.
      ctx.inject(['commandUi'], (scope) => {
        const commandUi = scope.commandUi ?? scope
        const effect = scope.effect ?? ((run) => run())
        effect(
          () =>
            commandUi.decorate({
              name: 'hooks',
              available: () => true,
              ui: { kind: 'action', run: () => openBrowser() },
            }),
          'dsh-hooks: /hooks browser',
        )
      })
      ctx.inject(['connection'], (rpc) => {
        setConnection(resolveHandle(rpc))
      })
    }

    return { inject: ['slots', 'locale', 'connection'], apply }
  },
})
