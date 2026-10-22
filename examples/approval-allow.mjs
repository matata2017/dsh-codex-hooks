#!/usr/bin/env node
/*
 * An `approval/request` hook: decide a pending tool approval without asking.
 *
 *   {"decision":"allow"}               approve this call once
 *   {"decision":"deny","reason":"…"}   refuse it, with the reason shown to the model
 *   print nothing                      fall through to the normal prompt
 *
 * This template allows exactly one tool, named in APPROVAL_ALLOW_TOOL, and stays out
 * of the way for everything else — a hook that approves every call would quietly
 * disable the approval prompt you installed hooks to tighten.
 */
const allowed = process.env.APPROVAL_ALLOW_TOOL

const chunks = []
for await (const chunk of process.stdin) chunks.push(chunk)

let payload = {}
try {
  payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
} catch {
  process.exit(0)
}

const tool = payload.tool_name ?? payload.toolName ?? ''
if (allowed && tool === allowed) {
  process.stdout.write(`${JSON.stringify({ decision: 'allow' })}\n`)
}
