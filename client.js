window.__ModuleLoader__.load({
  id: 'dsh-codex-hooks',
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

    /* ---------------- component ---------------- */

    function HooksSection() {
      const t = (key, values) => format(translate(key), values)
      const conn = useConnection()
      const [data, setData] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [expanded, setExpanded] = React.useState(() => new Set(['config']))
      const [busy, setBusy] = React.useState(null)
      const [notice, setNotice] = React.useState(null)

      const refresh = React.useCallback(async () => {
        if (!conn) return
        try {
          const value = await call('list', {})
          setData(value)
          setError(null)
        } catch (failure) {
          setError(failure?.message ?? String(failure))
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
        setConnection(resolveHandle(client.connection))
      })
      ctx.inject(['connection'], (rpc) => {
        setConnection(resolveHandle(rpc))
      })
    }

    return { inject: ['slots', 'locale', 'connection'], apply }
  },
})
