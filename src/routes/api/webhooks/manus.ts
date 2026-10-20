import { createAPIFileRoute } from '@tanstack/react-start/api'
import { handleManusWebhook } from '~/lib/jobs/webhook'
import type { ManusWebhookEnvelope } from '~/lib/manus/client'

/**
 * Manus webhook receiver.
 * Register: POST https://api.manus.ai/v2/webhook.create
 *   { "url": "https://YOUR_DOMAIN/api/webhooks/manus" }
 */
export const APIRoute = createAPIFileRoute('/api/webhooks/manus')({
  POST: async ({ request }) => {
    const raw = await request.text()
    let body: ManusWebhookEnvelope
    try {
      body = JSON.parse(raw) as ManusWebhookEnvelope
    } catch {
      return new Response(JSON.stringify({ ok: false, error: 'invalid json' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Optional: verify X-Webhook-Signature / X-Webhook-Timestamp (RSA-SHA256)
    // using manusPublicKey() — recommended in production.

    const result = await handleManusWebhook(body, raw, request.headers)
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  },
  GET: async () =>
    new Response(
      JSON.stringify({
        ok: true,
        service: 'newsjack-web manus webhook',
        hint: 'POST task lifecycle events from Manus here',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ),
})
