import {
  extractManusResults,
  manusListMessages,
  type ManusWebhookEnvelope,
} from '~/lib/manus/client'
import { getServiceSupabase, hasSupabaseConfig } from '~/lib/supabase/server'

/**
 * Handle Manus webhook callbacks.
 * Register once: POST https://api.manus.ai/v2/webhook.create
 * body: { "url": "https://YOUR_HOST/api/webhooks/manus" }
 *
 * Events: task_created, task_progress, task state changes (completed / waiting / error).
 * Signature verification: see https://open.manus.ai/docs/v2/webhooks-security
 * (RSA-SHA256 over `{timestamp}.{url}.{body_sha256_hex}`). Optional in dev.
 */
export async function handleManusWebhook(
  body: ManusWebhookEnvelope,
  _rawBody?: string,
  _headers?: Headers,
): Promise<{ ok: boolean; detail?: string }> {
  if (!hasSupabaseConfig()) {
    return { ok: true, detail: 'no supabase — acknowledged only' }
  }

  const taskId =
    body.task_detail?.task_id || body.task_id || (body as { taskId?: string }).taskId
  if (!taskId) {
    return { ok: true, detail: 'no task_id in payload' }
  }

  const sb = getServiceSupabase()
  const { data: job } = await sb
    .from('jobs')
    .select('*')
    .eq('manus_task_id', taskId)
    .maybeSingle()

  if (!job) {
    // Unknown task — still 200 so Manus does not retry forever
    return { ok: true, detail: 'no matching job' }
  }

  const eventLog = Array.isArray(job.manus_event_log) ? [...job.manus_event_log] : []
  eventLog.push({
    at: new Date().toISOString(),
    event_type: body.event_type,
    event_id: body.event_id,
    payload: body,
  })

  const agentStatus =
    body.task_detail?.agent_status ||
    body.task_detail?.status ||
    (body as { agent_status?: string }).agent_status

  const terminalSuccess =
    body.event_type === 'task_stopped' ||
    body.event_type === 'task_completed' ||
    agentStatus === 'stopped' ||
    agentStatus === 'completed'

  const terminalFail =
    agentStatus === 'error' || body.event_type === 'task_failed'

  if (terminalSuccess) {
    let output_text = job.output_text
    let output = job.output
    const artifactUrls: string[] = []

    try {
      const messages = await manusListMessages(taskId, 30)
      const extracted = extractManusResults(messages)
      if (extracted.text) output_text = extracted.text
      artifactUrls.push(...extracted.fileUrls)
      output = {
        ...(typeof output === 'object' && output ? output : {}),
        manus_messages_summary: true,
        artifact_urls: artifactUrls,
      }
    } catch {
      // keep prior output
    }

    for (const url of artifactUrls) {
      await sb.from('artifacts').insert({
        org_id: job.org_id,
        job_id: job.id,
        kind: job.kind === 'press_clip' ? 'press_clip_pdf' : 'coverage_reel',
        external_url: url,
        meta: { source: 'manus' },
      })
    }

    await sb
      .from('jobs')
      .update({
        status: 'completed',
        output_text,
        output,
        manus_event_log: eventLog,
        completed_at: new Date().toISOString(),
      })
      .eq('id', job.id)

    return { ok: true, detail: 'job completed' }
  }

  if (terminalFail) {
    await sb
      .from('jobs')
      .update({
        status: 'failed',
        error: `Manus agent_status=${agentStatus || 'error'}`,
        manus_event_log: eventLog,
        completed_at: new Date().toISOString(),
      })
      .eq('id', job.id)
    return { ok: true, detail: 'job failed' }
  }

  await sb
    .from('jobs')
    .update({
      status: 'waiting_manus',
      manus_event_log: eventLog,
    })
    .eq('id', job.id)

  return { ok: true, detail: 'progress recorded' }
}
