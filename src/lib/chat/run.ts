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
    const settings = resolveSettings(data.settings)
    const skill = data.skillSlug ? getSkill(data.skillSlug) : undefined
    const lastUser =
      [...data.messages].reverse().find((m) => m.role === 'user')?.content ||
      ''

    let skillContext = ''
    let liveResearch = ''
    let coverageNote = ''

    if (skill) {
      let values = data.skillValues || {}
      const empty = Object.fromEntries(
        skill.inputs.map((i) => [i.id, values[i.id] || '']),
      )
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

      // Prefer user message as query seed when form fields sparse
      if (!Object.values(values).some((v) => v?.trim()) && lastUser) {
        const firstId = skill.inputs[0]?.id
        if (firstId) values = { ...values, [firstId]: lastUser }
      }

      try {
        liveResearch =
          (await fetchToolContext(skill.slug, values, settings, {
            userMessage: lastUser,
            profile: data.profile,
          })) || ''
      } catch (e) {
        liveResearch = `### Live research error\n${e instanceof Error ? e.message : String(e)}`
      }

      coverageNote = researchCoverageNote(liveResearch || undefined, settings)

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
${filled || '(inferred from profile + latest user message)'}

${liveResearch ? `### Live tool research\n${liveResearch}` : ''}

### Coverage instruction
${coverageNote}
`
    } else if (lastUser) {
      // No skill pill — still try Manus if message looks like news research
      const looksLikeNews =
        /\b(news|coverage|headline|journalist|pitch|monitor|trend|today|this week)\b/i.test(
          lastUser,
        )
      if (looksLikeNews) {
        try {
          liveResearch =
            (await fetchToolContext(
              'news-search',
              { query: lastUser.slice(0, 400) },
              settings,
              { userMessage: lastUser, profile: data.profile },
            )) || ''
        } catch {
          liveResearch = ''
        }
        coverageNote = researchCoverageNote(liveResearch || undefined, settings)
      }
    }

    const system = `You are Newsjack Web, a PR agent chat.
You follow newsjack ethics: no invented facts, no spammy outreach, no fake journalists.
Always use the client profile as ground truth.

## Client profile
${data.profile}
${skillContext}
${
  liveResearch && !skill
    ? `\n## Live tool research\n${liveResearch}\n\n### Coverage instruction\n${coverageNote}\n`
    : ''
}

When live research blocks (Medialyst or Manus) are present above, use them as evidence. Do NOT claim "Reduced Coverage Mode" or that live web search is unavailable in that case.
Respond in clear markdown.`

    const history = data.messages
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n\n')
    const user = `Conversation so far:\n\n${history}\n\nRespond as the assistant to the latest user message.`

    try {
      await writeAppLog({
        level: 'info',
        kind: 'chat',
        source: 'runChat',
        message: skill ? `skill /${skill.slug}` : 'free chat',
        request: {
          skill: skill?.slug,
          message_count: data.messages.length,
          last_user: lastUser.slice(0, 400),
          live_research_len: liveResearch.length,
        },
      })
      const { text, provider } = await callLlm(settings, system, user)
      await writeAppLog({
        level: 'info',
        kind: 'chat',
        source: 'runChat',
        message: `reply via ${provider}`,
        response: { provider, text_preview: text.slice(0, 600) },
        meta: { usedLiveResearch: Boolean(liveResearch) },
      })
      return {
        ok: true as const,
        content: text,
        provider,
        usedLiveResearch: Boolean(liveResearch),
      }
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e)
      await writeAppLog({
        level: 'error',
        kind: 'chat',
        source: 'runChat',
        message: 'runChat failed',
        error: err,
        request: { skill: skill?.slug, last_user: lastUser.slice(0, 300) },
      })
      return {
        ok: false as const,
        error: err,
        content: '',
      }
    }
  })
