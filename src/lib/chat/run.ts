import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { callLlm } from '~/lib/llm/client'
import { resolveSettings } from '~/lib/settings/resolve'
import { getSkill } from '~/lib/skills/catalog'
import { doctrineFor } from '~/lib/skills/doctrine'
import { enrichSkillInputs } from '~/lib/auto/research'
import {
  fetchToolContext,
  researchCoverageNote,
} from '~/lib/skills/toolContext'
import { writeAppLog } from '~/lib/logs/write'
import {
  hasManusConfig,
  manusRunAndWait,
} from '~/lib/manus/client'

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

function isTrivialUserMessage(s: string) {
  const t = s.trim().toLowerCase()
  if (t.length < 8) return true
  return /^(hi|hello|hey|yo|test|ok|thanks|thank you)[.!?]*$/i.test(t)
}

function needsLiveResearch(slug: string | undefined, skillNeedsNews?: boolean) {
  if (!slug) return false
  if (skillNeedsNews) return true
  return [
    'newsjack-detector',
    'news-search',
    'story-origin-check',
    'newsjack-triage',
    'coverage-tracker',
    'pr-calendar',
    'find-journalists',
    'newsworthiness-check',
    'angle-generator',
    'reactive-comment',
  ].includes(slug)
}

/**
 * Blocking Manus research for chat — waits for assistant_message text.
 * Does not call the chat LLM until research text is available (or hard timeout).
 */
async function waitForManusResearch(
  prompt: string,
  settings: ReturnType<typeof resolveSettings>,
): Promise<{ text: string; taskId: string; taskUrl?: string; timedOut: boolean }> {
  if (!hasManusConfig({ apiKey: settings.manusApiKey || undefined })) {
    return { text: '', taskId: '', timedOut: true }
  }
  const result = await manusRunAndWait(
    {
      title: `newsjack chat research: ${prompt.slice(0, 36)}`,
      prompt,
      agentProfile: 'standard',
      timeoutMs: 180_000, // up to 3 minutes
      intervalMs: 3_000,
    },
    { apiKey: settings.manusApiKey || undefined },
  )
  return {
    text: result.text,
    taskId: result.taskId,
    taskUrl: result.taskUrl,
    timedOut: result.timedOut,
  }
}

export const runChat = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      messages: z.array(MessageSchema).min(1),
      skillSlug: z.string().optional(),
      skillValues: z.record(z.string()).optional(),
      profile: z.string().min(1),
      settings: SettingsPartial,
    }),
  )
  .handler(async ({ data }) => {
    try {
      const settings = resolveSettings(data.settings)
      const skill = data.skillSlug ? getSkill(data.skillSlug) : undefined
      const lastUser =
        [...data.messages].reverse().find((m) => m.role === 'user')?.content ||
        ''

      let skillContext = ''
      let liveResearch = ''
      let coverageNote = ''
      let manusTaskId = ''
      let manusTaskUrl = ''

      const wantResearch =
        Boolean(skill && needsLiveResearch(skill.slug, skill.needsNewsApi)) &&
        !isTrivialUserMessage(lastUser)

      if (skill) {
        let values = data.skillValues || {}
        const empty = Object.fromEntries(
          skill.inputs.map((i) => [i.id, values[i.id] || '']),
        )
        // Skip LLM enrich when we will block on Manus — faster path
        if (!wantResearch) {
          try {
            const enriched = await enrichSkillInputs({
              data: {
                slug: skill.slug,
                values: empty,
                profile: data.profile,
                settings: data.settings,
              },
            })
            if (enriched.ok) values = { ...empty, ...enriched.values, ...values }
          } catch {
            values = empty
          }
        } else {
          values = empty
          if (!Object.values(values).some((v) => v?.trim()) && lastUser) {
            const firstId = skill.inputs[0]?.id
            if (firstId) values = { ...values, [firstId]: lastUser }
          }
        }

        if (wantResearch) {
          await writeAppLog({
            level: 'info',
            kind: 'chat',
            source: 'runChat',
            message: 'blocking on Manus before LLM',
            request: { skill: skill.slug, last_user: lastUser.slice(0, 300) },
          })

          // Prefer Medialyst if configured; else Manus wait-for-complete
          if (settings.medialystApiKey) {
            try {
              liveResearch =
                (await fetchToolContext(skill.slug, values, settings, {
                  userMessage: lastUser,
                  profile: data.profile,
                })) || ''
            } catch (e) {
              liveResearch = `### Live research error\n${e instanceof Error ? e.message : String(e)}`
            }
          }

          // If no Medialyst results (or no key), block on Manus until text or timeout
          if (!liveResearch || !liveResearch.includes('Medialyst')) {
            const researchPrompt = `You are researching live news for a PR tool (newsjack).

Client profile:
${data.profile.slice(0, 2000)}

Skill: /${skill.slug}
User request: ${lastUser}

Search the live web for recent, real news relevant to this company and request.
Return a markdown list of articles with: title, outlet, date, URL, one-line why it matters.
Do not invent URLs or headlines.`

            const man = await waitForManusResearch(researchPrompt, settings)
            manusTaskId = man.taskId
            manusTaskUrl = man.taskUrl || ''
            if (man.text) {
              liveResearch = `### Manus live research (task ${man.taskId}${man.taskUrl ? ` — ${man.taskUrl}` : ''})\n${man.text}`
            } else {
              // Do NOT call LLM to invent findings — return status to user
              const msg = [
                `## Research still running`,
                '',
                `Manus task \`${man.taskId}\` did not return an assistant message within the wait window.`,
                man.taskUrl ? `Open the task: ${man.taskUrl}` : '',
                '',
                'Reply again in a moment, or open the Manus link to view results. I will not invent headlines while research is incomplete.',
              ]
                .filter(Boolean)
                .join('\n')
              await writeAppLog({
                level: 'warn',
                kind: 'chat',
                source: 'runChat',
                message: 'Manus incomplete — skip LLM findings',
                meta: { task_id: man.taskId, task_url: man.taskUrl },
              })
              return {
                ok: true as const,
                content: msg,
                provider: 'manus-pending',
                usedLiveResearch: false,
                manusTaskId: man.taskId,
                manusTaskUrl: man.taskUrl,
              }
            }
          }

          coverageNote = researchCoverageNote(
            liveResearch || undefined,
            settings,
          )
        }

        const filled = skill.inputs
          .map((i) => {
            const v = values[i.id]?.trim()
            return v ? `### ${i.label}\n${v}` : null
          })
          .filter(Boolean)
          .join('\n\n')

        skillContext = `
## Attached skill: /${skill.slug} (${skill.name})
${doctrineFor(skill.slug)}

### Skill form context
${filled || '(from profile + user message)'}

${liveResearch ? `### Live tool research\n${liveResearch}` : ''}

### Coverage instruction
${coverageNote || 'Use only attached live research. Never claim research is still running if a Manus block with articles is present.'}
`
      }

      // Free chat news-looking query without skill
      if (
        !skill &&
        !isTrivialUserMessage(lastUser) &&
        /\b(news|coverage|headline|journalist)\b/i.test(lastUser)
      ) {
        if (settings.medialystApiKey) {
          liveResearch =
            (await fetchToolContext(
              'news-search',
              { query: lastUser.slice(0, 400) },
              settings,
              { userMessage: lastUser, profile: data.profile },
            )) || ''
        } else if (hasManusConfig({ apiKey: settings.manusApiKey || undefined })) {
          const man = await waitForManusResearch(
            `Search live news for: ${lastUser}\n\nProfile:\n${data.profile.slice(0, 1200)}\n\nReturn real articles with titles, outlets, dates, URLs.`,
            settings,
          )
          manusTaskId = man.taskId
          manusTaskUrl = man.taskUrl || ''
          if (man.text) {
            liveResearch = `### Manus live research (task ${man.taskId})\n${man.text}`
          } else {
            return {
              ok: true as const,
              content: `Manus research task \`${man.taskId}\` is still running${man.taskUrl ? `: ${man.taskUrl}` : ''}. Try again shortly — I will not invent headlines.`,
              provider: 'manus-pending',
              usedLiveResearch: false,
              manusTaskId: man.taskId,
              manusTaskUrl: man.taskUrl,
            }
          }
        }
        coverageNote = researchCoverageNote(liveResearch || undefined, settings)
      }

      const system = `You are Newsjack Web, a PR agent chat.
Ethics: no invented facts, journalists, or headlines.
Use the client profile and any LIVE RESEARCH block as ground truth.

## Client profile
${data.profile}
${skillContext}
${
  liveResearch && !skill
    ? `\n## Live tool research\n${liveResearch}\n\n### Coverage instruction\n${coverageNote}\n`
    : ''
}

When a "### Manus live research" or "### Medialyst" block is present with articles, treat it as completed live research. Do NOT say research is still running. Do NOT invent extra articles beyond that block.
Respond in clear markdown.`

      const history = data.messages
        .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
        .join('\n\n')
      const user = `Conversation so far:\n\n${history}\n\nRespond as the assistant to the latest user message.`

      await writeAppLog({
        level: 'info',
        kind: 'chat',
        source: 'runChat',
        message: skill ? `skill /${skill.slug} → LLM` : 'free chat → LLM',
        request: {
          skill: skill?.slug,
          message_count: data.messages.length,
          last_user: lastUser.slice(0, 400),
          live_research_len: liveResearch.length,
          manus_task_id: manusTaskId || undefined,
        },
      })

      const { text, provider } = await callLlm(settings, system, user)

      await writeAppLog({
        level: 'info',
        kind: 'chat',
        source: 'runChat',
        message: `reply via ${provider}`,
        response: { provider, text_preview: text.slice(0, 600) },
        meta: {
          usedLiveResearch: Boolean(liveResearch),
          manus_task_id: manusTaskId || undefined,
        },
      })

      return {
        ok: true as const,
        content: text,
        provider,
        usedLiveResearch: Boolean(liveResearch),
        manusTaskId: manusTaskId || undefined,
        manusTaskUrl: manusTaskUrl || undefined,
      }
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e)
      await writeAppLog({
        level: 'error',
        kind: 'chat',
        source: 'runChat',
        message: 'runChat failed',
        error: err,
      })
      return {
        ok: false as const,
        error: err,
        content: `**Error:** ${err}`,
      }
    }
  })
