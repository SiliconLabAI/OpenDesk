import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { callLlm } from '~/lib/llm/client'
import { resolveSettings } from '~/lib/settings/resolve'
import { getSkill } from '~/lib/skills/catalog'
import { doctrineFor } from '~/lib/skills/doctrine'
import {
  extractManusResults,
  hasManusConfig,
  isSubstantialManusResearch,
  manusCreateTask,
  manusGetTask,
  manusListMessages,
  rewriteManusSandboxLinks,
} from '~/lib/manus/client'
import { getServiceSupabase, hasSupabaseConfig } from '~/lib/supabase/server'
import { ensureDefaultOrg } from '~/lib/supabase/org'
import { writeAppLog } from '~/lib/logs/write'
import type { ProviderSettings } from '~/lib/settings/types'

const SettingsPartial = z
  .object({
    preferredLlm: z
      .enum(['auto', 'anthropic', 'openai', 'openai_compatible'])
      .optional(),
    anthropicApiKey: z.string().optional(),
    anthropicModel: z.string().optional(),
    openaiApiKey: z.string().optional(),
    openaiModel: z.string().optional(),
    openaiBaseUrl: z.string().optional(),
    openaiCompatibleEnabled: z.boolean().optional(),
    openaiCompatibleBaseUrl: z.string().optional(),
    openaiCompatibleApiKey: z.string().optional(),
    openaiCompatibleModel: z.string().optional(),
    medialystApiKey: z.string().optional(),
    medialystApiBase: z.string().optional(),
    manusApiKey: z.string().optional(),
    appUrl: z.string().optional(),
    slackWebhookUrl: z.string().optional(),
  })
  .optional()

const MessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
})

export async function completeChatResearchJob(
  jobId: string,
  researchText: string,
  taskUrl?: string,
): Promise<{ ok: boolean; content?: string; error?: string }> {
  if (!hasSupabaseConfig()) {
    return { ok: false, error: 'No Supabase' }
  }
  const sb = getServiceSupabase()
  const { data: job, error } = await sb
    .from('jobs')
    .select('*')
    .eq('id', jobId)
    .single()
  if (error || !job) {
    return { ok: false, error: error?.message || 'Job not found' }
  }
  if (job.status === 'completed' && job.output_text) {
    return { ok: true, content: job.output_text }
  }

  const input = (job.input || {}) as {
    messages?: Array<{ role: string; content: string }>
    skillSlug?: string
    profile?: string
    settings?: Partial<ProviderSettings>
  }

  const taskId = (job.manus_task_id as string) || ''
  const research = rewriteManusSandboxLinks(researchText, {
    taskId,
    taskUrl: taskUrl || (job.manus_task_url as string) || undefined,
  })

  const settings = resolveSettings(input.settings)
  const skill = input.skillSlug ? getSkill(input.skillSlug) : undefined
  const profile = input.profile || ''
  const messages = input.messages || []

  const system = `You are Newsjack Web, a PR agent chat.
Ethics: no invented facts, journalists, or headlines.
The LIVE RESEARCH block below is the completed Manus agent result. Treat it as ground truth.
Do NOT say research is still running. Do NOT invent extra articles beyond that block.

## Client profile
${profile}

${
  skill
    ? `## Attached skill: /${skill.slug}\n${doctrineFor(skill.slug)}\n`
    : ''
}

## Live research (Manus completed)
${research}
${taskUrl ? `\nManus task: ${taskUrl}` : ''}

When citing downloads, keep full https://manus.im/app/... preview URLs (with previewSandboxPath). Never emit bare /home/ubuntu/... paths.

Respond in clear markdown to the user's latest message using this research.`

  const history = messages
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join('\n\n')
  const user = `Conversation:\n\n${history}\n\nRespond using the Manus research above.`

  try {
    const { text, provider } = await callLlm(settings, system, user)
    // Ensure any leftover sandbox paths become Manus preview URLs
    const finalText = rewriteManusSandboxLinks(text, {
      taskId,
      taskUrl: taskUrl || (job.manus_task_url as string) || undefined,
    })
    await sb
      .from('jobs')
      .update({
        status: 'completed',
        output_text: finalText,
        output: {
          provider,
          research_preview: research.slice(0, 2000),
          source: 'manus_callback_or_poll',
        },
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId)

    await writeAppLog({
      level: 'info',
      kind: 'chat',
      source: 'completeChatResearchJob',
      message: `completed via ${provider}`,
      meta: { job_id: jobId },
      response: { text_preview: finalText.slice(0, 500) },
    })

    return { ok: true, content: finalText }
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e)
    await sb
      .from('jobs')
      .update({
        status: 'failed',
        error: err,
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId)
    return { ok: false, error: err }
  }
}

/** Start Manus research job for chat — returns immediately; poll or webhook finishes it. */
export const startChatResearch = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      messages: z.array(MessageSchema).min(1),
      skillSlug: z.string().optional(),
      profile: z.string().min(1),
      settings: SettingsPartial,
    }),
  )
  .handler(async ({ data }) => {
    const settings = resolveSettings(data.settings)
    if (!hasManusConfig({ apiKey: settings.manusApiKey || undefined })) {
      return {
        ok: false as const,
        error: 'Manus API key not configured',
      }
    }
    if (!hasSupabaseConfig()) {
      return {
        ok: false as const,
        error: 'Supabase required for Manus callback jobs',
      }
    }

    const lastUser =
      [...data.messages].reverse().find((m) => m.role === 'user')?.content || ''
    const skill = data.skillSlug ? getSkill(data.skillSlug) : undefined

    const prompt = `You are researching live news for a PR tool (newsjack).

Client profile:
${data.profile.slice(0, 2500)}

${skill ? `Skill: /${skill.slug} (${skill.name})` : ''}
User request: ${lastUser}

Search the live web for recent, real news relevant to this company and request.
Return a detailed markdown report with articles: title, outlet, date, URL, one-line why it matters for this client.
Do not invent URLs or headlines.`

    try {
      const task = await manusCreateTask(
        {
          title: `chat research: ${lastUser.slice(0, 40)}`,
          prompt,
          agentProfile: 'standard',
          clearConnectors: true,
          hideInTaskList: false,
        },
        { apiKey: settings.manusApiKey || undefined },
      )

      const sb = getServiceSupabase()
      const orgId = await ensureDefaultOrg(sb)
      const { data: job, error } = await sb
        .from('jobs')
        .insert({
          org_id: orgId,
          kind: 'chat_research',
          skill_slug: data.skillSlug || null,
          status: 'waiting_manus',
          input: {
            messages: data.messages,
            skillSlug: data.skillSlug,
            profile: data.profile,
            settings: data.settings,
          },
          manus_task_id: task.task_id,
          manus_task_url: task.task_url || null,
        })
        .select('id')
        .single()

      if (error) {
        return { ok: false as const, error: error.message }
      }

      await writeAppLog({
        level: 'info',
        kind: 'chat',
        source: 'startChatResearch',
        message: `job ${job.id} task ${task.task_id}`,
        meta: {
          job_id: job.id,
          task_id: task.task_id,
          task_url: task.task_url,
        },
      })

      return {
        ok: true as const,
        pending: true as const,
        jobId: job.id as string,
        manusTaskId: task.task_id,
        manusTaskUrl: task.task_url,
        content: [
          `## Researching with Manus…`,
          '',
          `Task: \`${task.task_id}\`${task.task_url ? ` — [open in Manus](${task.task_url})` : ''}`,
          '',
          'Waiting for the Manus **callback** (or poll) with real results. I will not invent headlines while this runs.',
        ].join('\n'),
      }
    } catch (e) {
      return {
        ok: false as const,
        error: e instanceof Error ? e.message : String(e),
      }
    }
  })

/**
 * Poll job: if still waiting, pull Manus messages (works without webhook).
 * When research text exists, run LLM once and mark completed.
 */
export const pollChatResearch = createServerFn({ method: 'POST' })
  .validator(z.object({ jobId: z.string().uuid() }))
  .handler(async ({ data }) => {
    if (!hasSupabaseConfig()) {
      return { ok: false as const, status: 'failed', error: 'No Supabase' }
    }
    const sb = getServiceSupabase()
    const { data: job, error } = await sb
      .from('jobs')
      .select('*')
      .eq('id', data.jobId)
      .single()
    if (error || !job) {
      return {
        ok: false as const,
        status: 'failed',
        error: error?.message || 'not found',
      }
    }

    if (job.status === 'completed') {
      return {
        ok: true as const,
        status: 'completed' as const,
        content: job.output_text || '',
        manusTaskUrl: job.manus_task_url as string | undefined,
      }
    }
    if (job.status === 'failed') {
      return {
        ok: false as const,
        status: 'failed' as const,
        error: job.error || 'failed',
        manusTaskUrl: job.manus_task_url as string | undefined,
      }
    }

    // Still waiting — try to pull Manus messages (callback may have already fired)
    const taskId = job.manus_task_id as string
    const settings = resolveSettings(
      ((job.input || {}) as { settings?: Partial<ProviderSettings> }).settings,
    )
    const ctx = { apiKey: settings.manusApiKey || undefined }

    try {
      const messages = await manusListMessages(taskId, 50, ctx)
      const extracted = extractManusResults(messages)

      // Task status — only treat as done when agent stopped AND we have substance
      let agentStatus = ''
      try {
        const detail = await manusGetTask(taskId, ctx)
        agentStatus = String(
          (detail as { status?: string }).status ||
            (detail as { task?: { status?: string } }).task?.status ||
            (detail as { data?: { status?: string } }).data?.status ||
            '',
        )
      } catch {
        /* optional */
      }

      // Use longest substantial chunk among all assistant messages
      const candidates = [
        extracted.text,
        ...((extracted as { allTexts?: string[] }).allTexts || []),
      ].filter(Boolean)
      const best =
        candidates
          .filter((c) => isSubstantialManusResearch(c))
          .sort((a, b) => b.length - a.length)[0] || ''
      const researchText = best || extracted.text
      const substantial = isSubstantialManusResearch(researchText)
      const terminal =
        agentStatus === 'stopped' ||
        agentStatus === 'completed' ||
        agentStatus === 'error'

      await writeAppLog({
        level: 'debug',
        kind: 'manus',
        source: 'pollChatResearch',
        message: `status=${agentStatus || '?'} substantial=${substantial} len=${extracted.text.length}`,
        meta: {
          job_id: data.jobId,
          task_id: taskId,
          text_len: extracted.text.length,
          agent_status: agentStatus,
          substantial,
        },
        response: {
          text_preview: extracted.text.slice(0, 500),
          types: extracted.rawTypes.slice(0, 30),
        },
      })

      // Prefer waiting until substantial research text exists
      if (substantial) {
        const rewritten = rewriteManusSandboxLinks(researchText, {
          taskId,
          taskUrl: job.manus_task_url || undefined,
          eventId: ((extracted as { eventIds?: string[] }).eventIds || [])[0],
        })
        // Append download links for sandbox files if not already in text
        const paths = (extracted as { sandboxPaths?: string[] }).sandboxPaths || []
        let researchBlock = rewritten
        for (const sp of paths) {
          if (!researchBlock.includes(sp) && !researchBlock.includes(encodeURIComponent(sp))) {
            const link = rewriteManusSandboxLinks(sp, {
              taskId,
              taskUrl: job.manus_task_url || undefined,
              eventId: ((extracted as { eventIds?: string[] }).eventIds || [])[0],
            })
            researchBlock += `\n\n[Download ${sp.split('/').pop()}](${link})`
          }
        }
        const done = await completeChatResearchJob(
          data.jobId,
          researchBlock,
          job.manus_task_url || undefined,
        )
        if (done.ok) {
          return {
            ok: true as const,
            status: 'completed' as const,
            content: done.content || '',
            manusTaskUrl: job.manus_task_url as string | undefined,
          }
        }
        return {
          ok: false as const,
          status: 'failed' as const,
          error: done.error,
        }
      }

      // Terminal with only ack text → keep waiting a bit more is useless; report incomplete
      if (terminal && extracted.text && !substantial) {
        // One more listMessages in case final message lag
        await new Promise((r) => setTimeout(r, 2000))
        const messages2 = await manusListMessages(taskId, 50, ctx)
        const ex2 = extractManusResults(messages2)
        if (isSubstantialManusResearch(ex2.text)) {
          const done = await completeChatResearchJob(
            data.jobId,
            ex2.text,
            job.manus_task_url || undefined,
          )
          if (done.ok) {
            return {
              ok: true as const,
              status: 'completed' as const,
              content: done.content || '',
              manusTaskUrl: job.manus_task_url as string | undefined,
            }
          }
        }
        // Still no substance after stop — do not invent; surface Manus text + link
        const fallback = [
          '## Manus finished without usable article list',
          '',
          `Task status: **${agentStatus}**`,
          job.manus_task_url ? `Open: ${job.manus_task_url}` : '',
          '',
          '### Raw Manus text',
          rewriteManusSandboxLinks(extracted.text || '(empty)', {
            taskId,
            taskUrl: job.manus_task_url || undefined,
          }),
          '',
          'I will not invent headlines. Retry research or open the Manus task for the full agent transcript.',
        ]
          .filter(Boolean)
          .join('\n')
        await sb
          .from('jobs')
          .update({
            status: 'completed',
            output_text: fallback,
            output: { incomplete_research: true, agent_status: agentStatus },
            completed_at: new Date().toISOString(),
          })
          .eq('id', data.jobId)
        return {
          ok: true as const,
          status: 'completed' as const,
          content: fallback,
          manusTaskUrl: job.manus_task_url as string | undefined,
        }
      }
    } catch (e) {
      await writeAppLog({
        level: 'warn',
        kind: 'manus',
        source: 'pollChatResearch',
        message: 'listMessages failed',
        error: e instanceof Error ? e.message : String(e),
        meta: { job_id: data.jobId, task_id: taskId },
      })
    }

    return {
      ok: true as const,
      status: 'waiting_manus' as const,
      content: [
        `## Researching with Manus…`,
        '',
        `Task: \`${taskId}\`${job.manus_task_url ? ` — [open](${job.manus_task_url})` : ''}`,
        '',
        'Waiting for a **final** Manus research report (not the intermediate “searching…” message).',
      ].join('\n'),
      manusTaskUrl: job.manus_task_url as string | undefined,
    }
  })
