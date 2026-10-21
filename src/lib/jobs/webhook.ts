import { createHash, createVerify, createPublicKey } from 'node:crypto'
import {
  extractManusResults,
  manusListMessages,
  manusPublicKey,
  type ManusWebhookEnvelope,
} from '~/lib/manus/client'
import { getServiceSupabase, hasSupabaseConfig } from '~/lib/supabase/server'

let cachedPublicKey: string | null = null

async function getPublicKeyPem(): Promise<string | null> {
  if (cachedPublicKey) return cachedPublicKey
  try {
    cachedPublicKey = await manusPublicKey()
    return cachedPublicKey
  } catch {
    return null
  }
}

/**
 * Verify Manus RSA-SHA256 signature.
 * Signed content: `{timestamp}.{url}.{sha256_hex(body)}`
 * Headers: X-Webhook-Signature, X-Webhook-Timestamp
 */
export async function verifyManusSignature(
  rawBody: string,
  headers: Headers,
  webhookUrl: string,
): Promise<{ ok: boolean; reason?: string }> {
  const skip = process.env.MANUS_WEBHOOK_SKIP_VERIFY === '1'
  if (skip) return { ok: true, reason: 'skipped' }

  const sig = headers.get('x-webhook-signature') || headers.get('X-Webhook-Signature')
  const ts = headers.get('x-webhook-timestamp') || headers.get('X-Webhook-Timestamp')
  if (!sig || !ts) {
    // Allow unsigned in dev when no key yet
    if (process.env.NODE_ENV !== 'production') {
      return { ok: true, reason: 'dev_unsigned' }
    }
    return { ok: false, reason: 'missing signature headers' }
  }

  const tsNum = Number(ts)
  if (!Number.isFinite(tsNum)) return { ok: false, reason: 'bad timestamp' }
  const age = Math.abs(Date.now() / 1000 - tsNum)
  if (age > 5 * 60) return { ok: false, reason: 'timestamp too old' }

  const pem = await getPublicKeyPem()
  if (!pem) {
    if (process.env.NODE_ENV !== 'production') {
      return { ok: true, reason: 'no_public_key_dev' }
    }
    return { ok: false, reason: 'cannot load public key' }
  }

  const bodyHash = createHash('sha256').update(rawBody, 'utf8').digest('hex')
  const signed = `${ts}.${webhookUrl}.${bodyHash}`

  try {
    // pem may be raw key material or full PEM
    let keyPem = pem
    if (!pem.includes('BEGIN')) {
      keyPem = `-----BEGIN PUBLIC KEY-----\n${pem}\n-----END PUBLIC KEY-----`
    }
    const key = createPublicKey(keyPem)
    const verifier = createVerify('RSA-SHA256')
    verifier.update(signed)
    verifier.end()
    const ok = verifier.verify(key, Buffer.from(sig, 'base64'))
    return ok ? { ok: true } : { ok: false, reason: 'signature mismatch' }
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : 'verify failed',
    }
  }
}

async function storeArtifactFromUrl(
  orgId: string,
  jobId: string,
  kind: string,
  url: string,
): Promise<void> {
  if (!hasSupabaseConfig()) return
  const sb = getServiceSupabase()

  // Always record external URL
  let storage_path: string | null = null
  try {
    const res = await fetch(url)
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer())
      const ext =
        url.includes('.pdf') ? 'pdf' : url.includes('.mp4') ? 'mp4' : 'bin'
      const path = `artifacts/${orgId}/${jobId}/${Date.now()}.${ext}`
      const { error } = await sb.storage
        .from('newsjack-artifacts')
        .upload(path, buf, {
          contentType: res.headers.get('content-type') || 'application/octet-stream',
          upsert: true,
        })
      if (!error) storage_path = path
    }
  } catch {
    // keep external_url only
  }

  await sb.from('artifacts').insert({
    org_id: orgId,
    job_id: jobId,
    kind,
    storage_path,
    external_url: url,
    meta: { source: 'manus' },
  })
}

export async function handleManusWebhook(
  body: ManusWebhookEnvelope,
  rawBody?: string,
  headers?: Headers,
  webhookUrl?: string,
): Promise<{ ok: boolean; detail?: string }> {
  if (rawBody && headers && webhookUrl) {
    const v = await verifyManusSignature(rawBody, headers, webhookUrl)
    if (!v.ok) {
      return { ok: false, detail: `signature: ${v.reason}` }
    }
  }

  if (!hasSupabaseConfig()) {
    return { ok: true, detail: 'no supabase — acknowledged only' }
  }

  const taskId =
    body.task_detail?.task_id ||
    body.task_id ||
    (body as { taskId?: string }).taskId
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
    return { ok: true, detail: 'no matching job' }
  }

  const eventLog = Array.isArray(job.manus_event_log)
    ? [...job.manus_event_log]
    : []
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
      // keep prior
    }

    for (const url of artifactUrls) {
      await storeArtifactFromUrl(
        job.org_id,
        job.id,
        job.kind === 'press_clip' ? 'press_clip_pdf' : 'coverage_reel',
        url,
      )
    }

    // Press-clip QA gate in output_text
    if (job.kind === 'press_clip' && output_text) {
      const mention = (job.input as { mention?: string })?.mention
      if (mention && !output_text.toLowerCase().includes(mention.toLowerCase())) {
        output_text +=
          '\n\n## QA warning\nClient mention not clearly present in Manus output text — review artifacts manually.'
      }
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
