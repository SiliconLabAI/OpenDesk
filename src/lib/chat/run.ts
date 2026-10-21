import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { callLlm } from '~/lib/llm/client'
import { resolveSettings } from '~/lib/settings/resolve'
import { getSkill } from '~/lib/skills/catalog'
import { doctrineFor } from '~/lib/skills/doctrine'
import { enrichSkillInputs } from '~/lib/auto/research'

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

    let skillContext = ''
    if (skill) {
      let values = data.skillValues || {}
      // Prefill empty skill fields from profile for chat context
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
${filled || '(no form fields filled — use profile + user message)'}
`
    }

    const system = `You are Newsjack Web, a PR agent chat.
You follow newsjack ethics: no invented facts, no spammy outreach, no fake journalists.
Always use the client profile as ground truth.

## Client profile
${data.profile}
${skillContext}

Respond in clear markdown. If the user asks to run a skill workflow, produce the skill's expected deliverable. If information is missing, ask concise questions.`

    // Flatten history for single-turn providers that only take system+user
    const history = data.messages
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n\n')
    const user = `Conversation so far:\n\n${history}\n\nRespond as the assistant to the latest user message.`

    try {
      const { text, provider } = await callLlm(settings, system, user)
      return { ok: true as const, content: text, provider }
    } catch (e) {
      return {
        ok: false as const,
        error: e instanceof Error ? e.message : String(e),
        content: '',
      }
    }
  })
