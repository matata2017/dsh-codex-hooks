// ponytail: the host composes one boot row per installed package and the
// browser loader checks that the bundle registered exactly that id. The row id
// is the package name, so register under ours; the manifest is the fallback
// for a host that composed the row under another name.
const SELF_ID = (() => {
  const entries = (typeof window !== 'undefined' && window.__DSH_BOOT__?.entries) || []
  const ids = entries.map((entry) => entry?.id).filter((id) => typeof id === 'string')
  return (
    ids.find((id) => id === 'dsh-codex-hooks') ??
    ids.find((id) => /dsh-(?:codex-)?hooks$/.test(id)) ??
    'dsh-codex-hooks'
  )
})()

window.__ModuleLoader__.load({
  id: SELF_ID,
  factory: (require) => {
    const React = require('react')
    const { createPortal } = require('react-dom')
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
      allowSelected: 'Allow selected',
      reviewSettingsHint: 'You can change this later in Settings → Hooks.',
      statusOk: 'Completed',
      statusBlocked: 'Blocked',
      statusFailed: 'Failed',
      statusSkipped: 'Skipped',
      reviewTitle: 'Review hooks',
      reviewCount: '{count} hook(s) are new or changed.',
      reviewNote: 'Trusted hooks can run commands on your machine.',
      reviewNoteBefore: 'You can change this later in ',
      reviewNoteAfter: '',
      settingsLink: 'settings',
      hookSettings: 'Hook settings',
      noPending: 'No hook is waiting for review.',
      details: 'Show details',
      sourceLabel: 'Source',
      typeLabel: 'Hook type',
      commandLabel: 'Command',
      timeoutLabel: 'Timeout',
      milliseconds: '{value} ms',
      newBadge: 'New',
      reviewHooks: 'Review hooks',
      trustAllContinue: 'Trust all and continue',
      continueWithout: "Continue without trusting (hooks won't run)",
      browserSubtitle: 'View and manage lifecycle hooks.',
      events: 'Events',
      handlers: 'Handlers',
      back: 'Back',
      close: 'Close',
      triggerLabel: 'Lifecycle hooks',
      pendingTitle: '{count} hook(s) need review',
      hookStats: 'Hook stats',
      runHistory: 'Run history',
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
      allowSelected: '允许所选项',
      reviewSettingsHint: '之后可在 设置 → Hooks 中修改。',
      statusOk: '已完成',
      statusBlocked: '被拦截',
      statusFailed: '失败',
      statusSkipped: '已跳过',
      reviewTitle: '审查钩子',
      reviewCount: '{count} 个钩子是新的或已被修改。',
      reviewNote: '信任后钩子可以在你的机器上执行命令。',
      reviewNoteBefore: '你可以稍后在',
      reviewNoteAfter: '中更改此选项',
      settingsLink: '设置',
      hookSettings: '钩子设置',
      noPending: '没有待审核的钩子。',
      details: '查看详情',
      sourceLabel: '来源',
      typeLabel: 'Hook 类型',
      commandLabel: '命令',
      timeoutLabel: '超时',
      milliseconds: '{value}毫秒',
      newBadge: '新建',
      reviewHooks: '查看钩子',
      trustAllContinue: '全部信任并继续',
      continueWithout: '暂不信任（钩子不会运行）',
      browserSubtitle: '查看并管理生命周期钩子。',
      events: '事件',
      handlers: '处理器',
      back: '返回',
      close: '关闭',
      triggerLabel: '生命周期钩子',
      pendingTitle: '有 {count} 个钩子需要审核',
      hookStats: '钩子统计',
      runHistory: '运行历史',
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
      '.__dh_row{display:flex;flex-direction:column;gap:5px;padding:10px 0;border-bottom:1px solid var(--dsw-alias-border-l2,#dce2eb)}',
      '.__dh_row:last-child{border-bottom:none}',
      '.__dh_rowHead{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.__dh_event{font-weight:600;font-size:12px;flex:none;white-space:nowrap}',
      '.__dh_desc{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#6b7280);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.__dh_rowFoot{display:flex;align-items:center;gap:10px}',
      '.__dh_rowTitle{flex:1;min-width:0}',
      '.__dh_name{font-size:12px;color:var(--dsw-alias-label-secondary,#4b5563);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.__dh_actions{display:flex;align-items:center;gap:6px;margin-left:auto;flex:none}',
      '.__dh_btn{border:1px solid var(--dsw-alias-border-l2,#dce2eb);background:var(--dsw-alias-bg-layer-3,#f7f8fa);color:var(--dsw-alias-label-primary,#1f2328);border-radius:8px;padding:3px 10px;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap;flex:none}',
      '.__dh_btn:hover:not(:disabled){border-color:var(--dsw-alias-state-business-primary,#3964fe)}',
      '.__dh_btn:disabled{opacity:.5;cursor:not-allowed}',
      '.__dh_btnPrimary{border-color:var(--dsw-alias-state-business-primary,#3964fe);background:var(--dsw-alias-state-business-primary,#3964fe);color:#fff}',
      '.__dh_switch{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-tertiary,#6b7280);white-space:nowrap;flex:none}',
      '.__dh_switch input{accent-color:var(--dsw-alias-state-business-primary,#3964fe)}',
      '.__dh_status{font-size:11px;color:var(--dsw-alias-label-tertiary,#6b7280)}',
      '.__dh_error{font-size:12px;color:var(--dsw-alias-state-error-primary,#f85149)}',
      '.__dh_empty{font-size:12px;color:var(--dsw-alias-label-tertiary,#6b7280);padding:6px 0}',
      '.__dh_stats{border:1px solid var(--dsw-alias-border-l2,#dce2eb);border-radius:10px;padding:8px 12px}',
      '.__dh_runRow{display:flex;align-items:center;gap:8px;padding:3px 0;font-size:12px;color:var(--dsw-alias-label-secondary,#4b5563)}',
      '.__dh_runMark{width:14px;text-align:center;color:var(--dsw-alias-label-tertiary,#6b7280)}',
      '.__dh_runMarkBad{color:var(--dsw-alias-state-error-primary,#f85149)}',
      '.__dh_panel{display:flex;flex-direction:column;gap:8px;min-height:0}',
      '.__dh_panelHead{display:flex;align-items:center;gap:8px}',
      '.__dh_list{display:flex;flex-direction:column}',
      '.__dh_listRow{display:flex;align-items:center;gap:8px;padding:6px 4px;border-bottom:1px solid var(--dsw-alias-border-l2,#dce2eb);font-size:12px}',
      '.__dh_listRow:last-child{border-bottom:none}',
      '.__dh_listRowPick{cursor:pointer}',
      '.__dh_listRowPick:hover{background:var(--dsw-alias-bg-layer-3,#f2f4f7)}',
      '.__dh_warn{color:var(--dsw-alias-state-error-primary,#f85149);font-weight:600}',
      '.__dh_trigger{position:relative;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;border:1px solid transparent;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#4b5563);cursor:pointer}',
      '.__dh_trigger:hover{background:var(--dsw-alias-interactive-bg-hover,#f2f4f7)}',
      '.__dh_trigger[data-open="true"]{background:var(--dsw-alias-interactive-bg-hover,#f2f4f7);color:var(--dsw-alias-label-primary,#1f2328)}',
      '.__dh_dot{position:absolute;top:2px;right:2px;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-error-primary,#f85149);pointer-events:none}',
      '.__dh_dlg{position:fixed;z-index:1200;box-sizing:border-box;min-width:340px;max-width:min(440px,calc(100vw - 24px));max-height:min(72vh,560px);overflow:auto;border:1px solid var(--dsw-alias-border-l2,#dce2eb);border-radius:14px;background:var(--dsw-alias-bg-base,#fff);box-shadow:var(--dsw-elevation-prominent);padding:14px 16px;display:flex;flex-direction:column;gap:10px;font-size:13px;line-height:1.6;color:var(--dsw-alias-label-primary,#1f2328);text-align:left}',
      '.__dh_dlgTitle{font-size:15px;font-weight:600}',
      '.__dh_dlgBody{display:flex;flex-direction:column;gap:6px}',
      '.__dh_hookRow{border:1px solid var(--dsw-alias-border-l2,#dce2eb);border-radius:10px;padding:8px 10px;background:var(--dsw-alias-bg-layer-1,#fff)}',
      '.__dh_hookHead{display:flex;align-items:center;gap:8px}',
      '.__dh_hookName{flex:1;min-width:0;font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.__dh_badgeNew{background:var(--dsw-alias-state-business-primary,#3964fe);color:#fff;border-radius:999px;padding:0 8px;font-size:10px;line-height:16px}',
      '.__dh_chevron{border:none;background:transparent;color:var(--dsw-alias-label-tertiary,#6b7280);cursor:pointer;font-size:12px;padding:0 2px}',
      '.__dh_hookMeta{margin:8px 0 2px;padding:8px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-2,#f7f8fa);display:flex;flex-direction:column;gap:4px;font-size:12px}',
      '.__dh_metaRow{display:flex;gap:10px}',
      '.__dh_metaKey{width:84px;flex:none;color:var(--dsw-alias-label-tertiary,#6b7280)}',
      '.__dh_metaValue{flex:1;min-width:0;word-break:break-all;font-size:11px}',
      '.__dh_dlgNote{font-size:11px;color:var(--dsw-alias-label-tertiary,#6b7280)}',
      '.__dh_link{border:none;background:none;padding:0;font:inherit;color:var(--dsw-alias-state-business-primary,#3964fe);cursor:pointer;text-decoration:underline}',
      '.__dh_dlgActions{display:flex;justify-content:flex-end;gap:8px;margin-top:2px}',
      '.__dh_pendingRow{display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--dsw-alias-border-l2,#dce2eb);font-size:12px}',
      '.__dh_pendingRow:last-child{border-bottom:none}',
      '.__dh_actionBtn{width:28px;height:28px;border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-tertiary,#6b7280);cursor:pointer;background:0 0;border:none;justify-content:center;align-items:center;padding:6px;display:inline-flex}',
      '.__dh_actionBtn:hover{background:var(--dsw-alias-interactive-bg-hover,#f2f4f7);color:var(--dsw-alias-label-secondary,#4b5563)}',
      '.__dh_actionBtn svg{width:17px;height:17px}',
      '.__dh_modalRoot{position:fixed;inset:0;z-index:200;display:flex;align-items:center;justify-content:center}',
      '.__dh_modalBackdrop{position:absolute;inset:0;background:rgba(0,0,0,.28)}',
      '.__dh_modal{position:relative;z-index:1;box-sizing:border-box;min-width:320px;max-width:min(520px,92vw);border-radius:14px;border:1px solid var(--dsw-alias-border-l2,#dce2eb);background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-1,#fff));box-shadow:var(--dsw-elevation-prominent);padding:16px 18px;display:flex;flex-direction:column;gap:4px;font-size:13px;line-height:1.6;color:var(--dsw-alias-label-primary,#1f2328)}',
      '.__dh_dlgCenter{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:1200;background:var(--dsw-alias-bg-base,#fff)}',
      '.__dh_modalHead{display:flex;align-items:center;gap:10px;margin-bottom:6px}',
      '.__dh_modalTitle{font-size:15px;font-weight:600;flex:1}',
      '.__dh_iconBtn{border:none;background:transparent;color:var(--dsw-alias-label-tertiary,#6b7280);font-size:16px;line-height:1;cursor:pointer;padding:2px 6px;border-radius:6px}',
      '.__dh_iconBtn:hover{background:var(--dsw-alias-interactive-bg-hover,#f2f4f7)}',
      '.__dh_statRow{display:flex;align-items:center;justify-content:space-between;padding:2px 0;color:var(--dsw-alias-label-secondary,#4b5563)}',
      '.__dh_modalSection{margin-top:12px;color:var(--dsw-alias-label-tertiary,#6b7280)}',
      '.__dh_history{display:flex;flex-direction:column;margin-top:4px}',
      '.__dh_historyRow{display:flex;align-items:center;gap:8px;padding:3px 0;font-size:12px;color:var(--dsw-alias-label-secondary,#4b5563)}',
      '.__dh_historyChevron{color:var(--dsw-alias-label-tertiary,#6b7280)}',
      '.__dh_historyStatus{color:var(--dsw-alias-label-primary,#1f2328)}',
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
      useRevision(refresh)

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
          bumpRevision()
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
                            h('span', { className: TRUST_CLASS[hook.trust] ?? '__dh_badge' }, t(hook.trust.toLowerCase())),
                            hook.matcher
                              ? h('span', { className: '__dh_status' }, t('matcher', { value: hook.matcher }))
                              : null,
                          ),
                          h('div', { className: '__dh_desc' }, hook.description),
                          h(
                            'div',
                            { className: '__dh_rowFoot' },
                            h(
                              'div',
                              { className: '__dh_rowTitle' },
                              h('div', { className: '__dh_name' }, hookTitle(hook)),
                              h('div', { className: '__dh_status' }, t('source', { value: hook.sourcePath })),
                            ),
                            h(
                              'div',
                              { className: '__dh_actions' },
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
                        ),
                      ),
                )
              : null,
          )
        }),
      )
    }

    /* ---------------- overlays: review dialog + hooks browser ---------------- */

    // Codex shows a review dialog when a hook needs a fingerprint, the hooks
    // browser behind "/hooks", and the run counters behind the message action
    // row. One overlay state drives all three.
    const ui = { view: null, eventName: null, stats: false }
    const uiListeners = new Set()
    let triggerEl = null

    function setUi(patch) {
      let changed = false
      for (const key of Object.keys(patch)) {
        if (ui[key] !== patch[key]) {
          ui[key] = patch[key]
          changed = true
        }
      }
      if (changed) for (const listener of uiListeners) listener()
    }

    function useUi() {
      const [, bump] = React.useState(0)
      React.useEffect(() => {
        const listener = () => bump((value) => value + 1)
        uiListeners.add(listener)
        return () => {
          uiListeners.delete(listener)
        }
      }, [])
      return ui
    }

    function openReview() {
      setUi({ view: 'review', eventName: null, stats: false })
    }

    function openBrowser(eventName) {
      setUi({ view: 'browser', eventName: eventName ?? null, stats: false })
    }

    function openStats() {
      setUi({ stats: true })
    }

    function closeOverlay() {
      setUi({ view: null, eventName: null, stats: false })
    }

    // dsh publishes no API for a plugin to open a settings section, so this drives
    // the same path a user does: click the nav entry if settings is already open,
    // otherwise fire the settings shortcut and look for it on the next ticks.
    // If neither lands, our own panel opens so the click is never a dead end.
    function openSettingsSection() {
      closeOverlay()
      const label = translate('nav')
      const findCell = () => {
        if (typeof document.querySelectorAll !== 'function') return null
        return (
          Array.from(document.querySelectorAll('[class*="_navLabel"]')).find(
            (node) => node.textContent?.trim() === label,
          ) ?? null
        )
      }
      const openCell = () => {
        const cell = findCell()
        if (!cell) return false
        ;(cell.closest('button') ?? cell).click()
        return true
      }
      const press = (altKey) => {
        const event = new KeyboardEvent('keydown', {
          key: ',',
          code: 'Comma',
          ctrlKey: true,
          altKey,
          bubbles: true,
          cancelable: true,
        })
        document.dispatchEvent(event)
      }
      if (openCell()) return
      let attempts = 0
      const timer = setInterval(() => {
        attempts += 1
        if (openCell()) {
          clearInterval(timer)
          return
        }
        if (attempts === 2) press(true)
        if (attempts >= 8) {
          clearInterval(timer)
          openBrowser()
        }
      }, 70)
      if (typeof KeyboardEvent === 'function') press(false)
      else {
        clearInterval(timer)
        openBrowser()
      }
    }

    // Hooks and their trust state live on the host, so every panel that changes them
    // pings this counter and the settings section refreshes itself.
    let revision = 0
    const revisionListeners = new Set()

    function bumpRevision() {
      revision += 1
      for (const listener of revisionListeners) listener()
    }

    function useRevision(onChange) {
      React.useEffect(() => {
        revisionListeners.add(onChange)
        return () => {
          revisionListeners.delete(onChange)
        }
      }, [onChange])
    }

    // The panels float above the composer, so they track the trigger button.
    function anchorStyle(width) {
      const rect =
        triggerEl && typeof triggerEl.getBoundingClientRect === 'function'
          ? triggerEl.getBoundingClientRect()
          : null
      if (!rect || !rect.width) {
        return { left: '50%', bottom: 96, transform: 'translateX(-50%)', width }
      }
      const left = Math.max(12, Math.min(rect.left - 6, window.innerWidth - width - 12))
      return { left, bottom: Math.max(12, window.innerHeight - rect.top + 10), width }
    }

    function useAnchorTick(active) {
      const [, bump] = React.useState(0)
      React.useEffect(() => {
        if (!active) return undefined
        const update = () => bump((value) => value + 1)
        window.addEventListener('resize', update)
        window.addEventListener('scroll', update, true)
        return () => {
          window.removeEventListener('resize', update)
          window.removeEventListener('scroll', update, true)
        }
      }, [active])
    }

    function metaRow(key, value) {
      return h(
        'div',
        { className: '__dh_metaRow' },
        h('span', { className: '__dh_metaKey' }, key),
        h('span', { className: '__dh_metaValue' }, value),
      )
    }

    function hookIcon() {
      return h(
        'svg',
        { viewBox: '0 0 24 24', width: 16, height: 16, fill: 'none', 'aria-hidden': 'true' },
        h('path', {
          d: 'M9 3.5v9a3 3 0 0 0 6 0V9',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
        }),
        h('circle', { cx: 9, cy: 3.5, r: 1.8, stroke: 'currentColor', strokeWidth: 1.8 }),
      )
    }

    function HooksTrigger() {
      const t = (key, values) => format(translate(key), values)
      const conn = useConnection()
      const view = useUi()
      const ref = React.useRef(null)
      const [needsReview, setNeedsReview] = React.useState(false)

      React.useEffect(() => {
        triggerEl = ref.current
        return () => {
          triggerEl = null
        }
      }, [])

      // A dot, not a number: a count goes stale the moment someone trusts a hook elsewhere.
      const checkPending = React.useCallback(async () => {
        if (!conn) return
        try {
          const value = await call('review', {})
          setNeedsReview((value?.hooks ?? []).length > 0)
        } catch {
          /* the host may not answer before it is ready; the dot just stays off */
        }
      }, [conn])

      React.useEffect(() => {
        checkPending()
      }, [checkPending])
      useRevision(checkPending)

      return h(
        'button',
        {
          type: 'button',
          className: '__dh_trigger',
          ref,
          title: t('triggerLabel'),
          'aria-label': t('triggerLabel'),
          'aria-haspopup': 'dialog',
          'aria-expanded': view.view === 'review' ? 'true' : 'false',
          'data-open': view.view === 'review' ? 'true' : 'false',
          onClick: () => (view.view === 'review' ? closeOverlay() : openReview()),
        },
        hookIcon(),
        needsReview ? h('span', { className: '__dh_dot' }) : null,
      )
    }

    function HooksStatsAction() {
      const t = (key, values) => format(translate(key), values)
      const view = useUi()
      return h(
        'button',
        {
          type: 'button',
          className: '__dh_actionBtn',
          title: t('hookStats'),
          'aria-label': t('hookStats'),
          onClick: () => (view.stats ? closeOverlay() : openStats()),
        },
        hookIcon(),
      )
    }

    function HooksReviewDialog() {
      const t = (key, values) => format(translate(key), values)
      const conn = useConnection()
      const [pending, setPending] = React.useState([])
      const [selected, setSelected] = React.useState(() => new Set())
      const [expanded, setExpanded] = React.useState(() => new Set())
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(null)
      const dialogRef = React.useRef(null)
      useAnchorTick(true)

      const refresh = React.useCallback(async () => {
        if (!conn) return
        try {
          const value = await call('review', {})
          const items = value?.hooks ?? []
          setPending(items)
          setSelected(new Set(items.map((hook) => hook.key)))
        } catch (failure) {
          setError(failure?.message ?? String(failure))
        }
      }, [conn])

      React.useEffect(() => {
        refresh()
      }, [refresh])

      React.useEffect(() => {
        const onKey = (event) => {
          if (event.key !== 'Escape') return
          event.stopPropagation()
          closeOverlay()
        }
        const onDown = (event) => {
          const target = event.target
          if (dialogRef.current && dialogRef.current.contains(target)) return
          if (triggerEl && triggerEl.contains(target)) return
          closeOverlay()
        }
        document.addEventListener('keydown', onKey, true)
        document.addEventListener('mousedown', onDown, true)
        return () => {
          document.removeEventListener('keydown', onKey, true)
          document.removeEventListener('mousedown', onDown, true)
        }
      }, [])

      const trust = async (keys) => {
        if (keys.length === 0) return
        setBusy(true)
        try {
          for (const key of keys) await call('setTrusted', { key, trusted: true })
          setError(null)
          bumpRevision()
          closeOverlay()
        } catch (failure) {
          setError(failure?.message ?? String(failure))
        } finally {
          setBusy(false)
        }
      }

      const toggleExpanded = (key) => {
        setExpanded((current) => {
          const next = new Set(current)
          if (next.has(key)) next.delete(key)
          else next.add(key)
          return next
        })
      }

      const toggleSelected = (key, on) => {
        setSelected((current) => {
          const next = new Set(current)
          if (on) next.add(key)
          else next.delete(key)
          return next
        })
      }

      return createPortal(
        h(
          'div',
          {
            className: '__dh_dlg',
            style: anchorStyle(420),
            ref: dialogRef,
            role: 'dialog',
            'aria-label': t('reviewTitle'),
          },
          h('div', { className: '__dh_dlgTitle' }, t('reviewTitle')),
          error ? h('div', { className: '__dh_error' }, t('error', { message: error })) : null,
          h(
            'div',
            { className: '__dh_dlgBody' },
            pending.length === 0
              ? h('div', { className: '__dh_empty' }, t('noPending'))
              : pending.map((hook) =>
                  h(
                    'div',
                    { key: hook.key, className: '__dh_hookRow' },
                    h(
                      'div',
                      { className: '__dh_hookHead' },
                      h('input', {
                        type: 'checkbox',
                        checked: selected.has(hook.key),
                        disabled: busy,
                        'aria-label': hook.title || hook.key,
                        onChange: (event) => toggleSelected(hook.key, event.target.checked),
                      }),
                      h('span', { className: '__dh_hookName' }, hook.title || hook.key),
                      h('span', { className: '__dh_badgeNew' }, t('newBadge')),
                      h(
                        'button',
                        {
                          type: 'button',
                          className: '__dh_chevron',
                          'aria-label': t('details'),
                          'aria-expanded': expanded.has(hook.key) ? 'true' : 'false',
                          onClick: () => toggleExpanded(hook.key),
                        },
                        expanded.has(hook.key) ? '▾' : '▸',
                      ),
                    ),
                    expanded.has(hook.key)
                      ? h(
                          'div',
                          { className: '__dh_hookMeta' },
                          metaRow(t('sourceLabel'), hook.sourceLabel || hook.source || ''),
                          metaRow(t('typeLabel'), hook.eventName),
                          hook.command ? metaRow(t('commandLabel'), hook.command) : null,
                          metaRow(
                            t('timeoutLabel'),
                            t('milliseconds', { value: Math.round((hook.timeout ?? 60) * 1000) }),
                          ),
                        )
                      : null,
                  ),
                ),
          ),
          h(
            'div',
            { className: '__dh_dlgNote' },
            t('reviewNoteBefore'),
            h(
              'button',
              {
                type: 'button',
                className: '__dh_link',
                onClick: () => {
                  openSettingsSection()
                },
              },
              t('settingsLink'),
            ),
            t('reviewNoteAfter'),
          ),
          h(
            'div',
            { className: '__dh_dlgActions' },
            h(
              'button',
              { type: 'button', className: '__dh_btn', disabled: busy, onClick: closeOverlay },
              t('notNow'),
            ),
            h(
              'button',
              {
                type: 'button',
                className: '__dh_btn',
                disabled: busy || pending.length === 0,
                onClick: () => trust(pending.map((hook) => hook.key)),
              },
              t('allowAll'),
            ),
            h(
              'button',
              {
                type: 'button',
                className: '__dh_btn __dh_btnPrimary',
                disabled: busy || selected.size === 0,
                onClick: () => trust([...selected]),
              },
              t('allowSelected'),
            ),
          ),
        ),
        document.body,
      )
    }

    function HooksBrowserPanel() {
      const t = (key, values) => format(translate(key), values)
      const conn = useConnection()
      const view = useUi()
      const [data, setData] = React.useState(null)
      const [busy, setBusy] = React.useState(null)
      const [error, setError] = React.useState(null)
      const panelRef = React.useRef(null)

      const refresh = React.useCallback(async () => {
        if (!conn) return
        try {
          setData(await call('list', {}))
          setError(null)
        } catch (failure) {
          setError(failure?.message ?? String(failure))
        }
      }, [conn])

      React.useEffect(() => {
        refresh()
      }, [refresh])

      React.useEffect(() => {
        const onKey = (event) => {
          if (event.key !== 'Escape') return
          event.stopPropagation()
          closeOverlay()
        }
        const onDown = (event) => {
          const target = event.target
          if (panelRef.current && panelRef.current.contains(target)) return
          closeOverlay()
        }
        document.addEventListener('keydown', onKey, true)
        document.addEventListener('mousedown', onDown, true)
        return () => {
          document.removeEventListener('keydown', onKey, true)
          document.removeEventListener('mousedown', onDown, true)
        }
      }, [])

      const act = async (key, action) => {
        setBusy(key)
        try {
          const result = await action()
          if (result && result.ok === false) throw new Error(result.error ?? 'hooks call failed')
          bumpRevision()
          await refresh()
        } catch (failure) {
          setError(failure?.message ?? String(failure))
        } finally {
          setBusy(null)
        }
      }

      const hooks = data?.hooks ?? []
      const events = data?.events ?? []
      const handlers = view.eventName
        ? hooks.filter((hook) => hook.eventName === view.eventName)
        : []
      const needsReview = (hook) => hook.trust === 'Untrusted' || hook.trust === 'Modified'

      return createPortal(
        h(
          'div',
          {
            className: '__dh_dlg __dh_dlgCenter',
            ref: panelRef,
            role: 'dialog',
            'aria-label': t('hookSettings'),
          },
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
                ? h(
                    'button',
                    { type: 'button', className: '__dh_btn', onClick: () => openBrowser() },
                    t('back'),
                  )
                : null,
              h('button', { type: 'button', className: '__dh_btn', onClick: closeOverlay }, t('close')),
            ),
          ),
          error ? h('div', { className: '__dh_error' }, t('error', { message: error })) : null,
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
                                  type: 'button',
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
                                  type: 'button',
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
                        row.description
                          ? h('span', { className: '__dh_name' }, row.description)
                          : null,
                      ),
                    ),
              ),
        ),
        document.body,
      )
    }

    /* ---------------- hook stats dialog (Codex style) ---------------- */

    // Codex shows "Hook stats" from a message action: a dialog with the run
    // counters and the run history.
    function HooksStatsDialog() {
      const t = (key, values) => format(translate(key), values)
      const conn = useConnection()
      const [stats, setStats] = React.useState(null)
      const [error, setError] = React.useState(null)
      const dialogRef = React.useRef(null)

      const refresh = React.useCallback(async () => {
        if (!conn) return
        try {
          setStats(await call('stats', {}))
          setError(null)
        } catch (failure) {
          setError(failure?.message ?? String(failure))
        }
      }, [conn])

      React.useEffect(() => {
        refresh()
      }, [refresh])

      React.useEffect(() => {
        const onKey = (event) => {
          if (event.key !== 'Escape') return
          event.stopPropagation()
          closeOverlay()
        }
        const onDown = (event) => {
          const target = event.target
          if (dialogRef.current && dialogRef.current.contains(target)) return
          closeOverlay()
        }
        document.addEventListener('keydown', onKey, true)
        document.addEventListener('mousedown', onDown, true)
        return () => {
          document.removeEventListener('keydown', onKey, true)
          document.removeEventListener('mousedown', onDown, true)
        }
      }, [])

      const history = stats?.history ?? []
      return createPortal(
        h(
          'div',
          {
            className: '__dh_modal __dh_dlgCenter',
            ref: dialogRef,
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': t('hookStats'),
          },
          h(
            'div',
            { className: '__dh_modalHead' },
            h('span', { className: '__dh_modalTitle' }, t('hookStats')),
            h(
              'button',
              {
                type: 'button',
                className: '__dh_iconBtn',
                'aria-label': t('close'),
                onClick: closeOverlay,
              },
              '×',
            ),
          ),
          h(
            'div',
            { className: '__dh_statRow' },
            h('span', null, t('runs')),
            h('span', null, String(stats?.runs ?? 0)),
          ),
          h(
            'div',
            { className: '__dh_statRow' },
            h('span', null, t('blocked')),
            h('span', null, String(stats?.blocked ?? 0)),
          ),
          h(
            'div',
            { className: '__dh_statRow' },
            h('span', null, t('failed')),
            h('span', null, String(stats?.failed ?? 0)),
          ),
          error ? h('div', { className: '__dh_error' }, t('error', { message: error })) : null,
          h('div', { className: '__dh_modalSection' }, t('runHistory')),
          history.length === 0
            ? h('div', { className: '__dh_empty' }, t('noRuns'))
            : h(
                'div',
                { className: '__dh_history' },
                history.map((row, index) =>
                  h(
                    'div',
                    { key: `${row.at}-${index}`, className: '__dh_historyRow' },
                    h('span', { className: '__dh_historyChevron' }, '>'),
                    h('span', { className: '__dh_historyStatus' }, t(STATUS_KEY[row.status] ?? 'statusOk')),
                    h('span', { className: '__dh_event' }, row.eventName),
                    h('span', { className: '__dh_name' }, row.sourceLabel || row.source || ''),
                  ),
                ),
              ),
        ),
        document.body,
      )
    }

    /* ---------------- overlay host ---------------- */

    function HooksOverlay() {
      const view = useUi()
      if (!view.view && !view.stats) return null
      return h(
        React.Fragment,
        null,
        view.view === 'review' ? h(HooksReviewDialog, null) : null,
        view.view === 'browser' ? h(HooksBrowserPanel, null) : null,
        view.stats ? h(HooksStatsDialog, null) : null,
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
          client.slots.inject('conversation.input.left', () =>
            client.slots.register(
              {
                name: 'conversation.input.left',
                id: 'dsh-codex-hooks/trigger',
                order: 1,
                locale: NS,
                inject: () => ({ t: translate }),
              },
              HooksTrigger,
            ),
          )
        } catch {
          /* the composer tool row is optional: Settings and /hooks still work */
        }
        try {
          client.slots.inject('conversation.chat.assistant-actions', () =>
            client.slots.register(
              {
                name: 'conversation.chat.assistant-actions',
                id: 'dsh-codex-hooks/stats',
                order: 10,
                locale: NS,
                inject: () => ({ t: translate }),
              },
              HooksStatsAction,
            ),
          )
        } catch {
          /* the message action row is optional */
        }
        try {
          client.slots.inject('shell.overlay', () =>
            client.slots.register(
              {
                name: 'shell.overlay',
                id: 'dsh-codex-hooks/overlay',
                order: 40,
                locale: NS,
                inject: () => ({ t: translate }),
              },
              HooksOverlay,
            ),
          )
        } catch {
          /* the shell overlay is optional */
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
