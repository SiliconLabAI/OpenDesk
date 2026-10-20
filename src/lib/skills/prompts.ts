import type { SkillDef } from './catalog'

const ETHICS_FLOOR = `
ETHICS FLOOR (non-negotiable):
- Do not invent facts, quotes, statistics, titles, or journalist relationships.
- Every claim must trace to user-supplied facts or clearly labeled external evidence.
- Journalist inboxes are a commons — no spam, no fake familiarity, no spray-and-pray.
- Prefer "insufficient evidence" over confident fabrication.
- Human-facing copy: no AI-marketing slop, empty superlatives, or bracketed placeholders left in final text.
- If the task requires legal counsel review (crisis), say so explicitly and do not invent legal advice.
`

const ROLE = `You are a newsjack.sh skill running in the web Limited Mode app.
You produce the same quality of judgment as the local agent skills, but you only use the inputs the user provides (plus general professional knowledge).
You do not have a persistent local monitor, Chrome, or Medialyst unless the user pastes evidence.
Label reduced coverage when live news index or local tooling would normally be required.
`

export function buildSystemPrompt(skill: SkillDef): string {
  return `${ROLE}

Skill: ${skill.name} (\`/${skill.slug}\`)
Category: ${skill.category}
Purpose: ${skill.description}
When to use: ${skill.whenToUse}

${ETHICS_FLOOR}

Output rules:
- Lead with the useful artifact (angles, verdict, scored claims, ranked list, strategy steps) — not a sales preamble.
- Use clear markdown structure.
- If inputs are insufficient, say what is missing and stop rather than inventing.
- For local-only skills, explain that full execution needs Claude Code / Codex / local install (\`curl -fsSL newsjack.sh | bash\`) and provide a planning checklist instead.
`
}

export function buildUserPrompt(
  skill: SkillDef,
  values: Record<string, string>,
  profile?: string,
): string {
  const parts: string[] = []
  if (profile?.trim()) {
    parts.push(`## Saved client profile\n${profile.trim()}`)
  }
  for (const input of skill.inputs) {
    const v = values[input.id]?.trim()
    if (v) parts.push(`## ${input.label}\n${v}`)
  }
  if (parts.length === 0) {
    return 'No inputs provided.'
  }
  parts.push(
    `\nRun the \`${skill.slug}\` skill on the material above. Follow the skill purpose and ethics floor.`,
  )
  return parts.join('\n\n')
}

/** Deterministic offline demo when no LLM key is configured */
export function offlineDemoResult(
  skill: SkillDef,
  values: Record<string, string>,
): string {
  if (skill.localOnly) {
    return `## Local-only skill

\`${skill.slug}\` needs a local agent harness (Claude Code, Codex, Hermes, or OpenClaw) with filesystem, optional Chrome/Playwright, and the Newsjack CLI.

**Install Full Mode:**
\`\`\`bash
curl -fsSL newsjack.sh | bash
\`\`\`

Then invoke \`/${skill.slug}\` in your agent.

### Web checklist (planning only)
${skill.inputs
  .map((i) => {
    const v = values[i.id]?.trim()
    return `- **${i.label}:** ${v ? 'provided ✓' : 'still needed'}`
  })
  .join('\n')}

${values[skill.inputs[0]?.id]
  ? `\n### Your notes\n${values[skill.inputs[0].id].slice(0, 1200)}`
  : ''}
`
  }

  const first = Object.values(values).find((v) => v.trim())?.slice(0, 280) ?? ''

  switch (skill.slug) {
    case 'angle-generator':
      return `## Angles (demo — connect an API key for live model output)

Based on the facts you supplied${first ? ` (excerpt: “${first}…”)` : ''}, here is the **structure** angle-generator uses. With a model key, each angle is fully written from your facts only.

1. **Perspective shift** — change the protagonist (customer, operator, regulator, competitor).
2. **Ladder of abstraction** — one concrete instance vs category trend.
3. **News values** — timeliness, conflict, consequence, human interest where evidence supports it.
4. **Data angle** — only if numbers were in your input.
5. **Contrarian** — only if you supplied evidence that challenges a prevailing claim.
6. **News peg** — only if you attached a verified external signal.

**Hard rules applied:** no invented facts · no named-journalist guesses · zero viable angles is an allowed outcome.

*Enable \`OPENAI_API_KEY\` or \`ANTHROPIC_API_KEY\` on the server for full generation.*
`
    case 'newsworthiness-check':
      return `## Newsworthiness check (demo rubric)

| Dimension | What we score |
| --- | --- |
| Novelty | Is this actually new vs recycled corporate noise? |
| Scale / consequence | Who is affected, how much? |
| Standing | Can *you* credibly speak to it? |
| Timing | Still inside a journalist’s window? |
| Brand safety | Any kill switches? |

**Verdict ladder:** \`not_news\` · \`weak\` · \`conditional\` · \`clear\`

Paste richer evidence and enable a model key for a scored verdict. Do not treat this scaffold as permission to pitch.
`
    case 'fact-check':
      return `## Fact-check workflow (demo)

1. Extract discrete factual claims from the draft.
2. For each claim: source tier, corroboration, and calibrated confidence.
3. Flag anything that cannot be traced to your evidence block.
4. Output: claim · rating · notes — never “looks fine” without claim-level work.

*With a model key, this runs claim-by-claim on your paste.*
`
    case 'meanest-editor':
      return `## Editor roast rubric (demo)

Editors actually care about:
- **Why this, why now** — is there a real peg?
- **So what** — reader consequence, not company pride
- **Evidence** — numbers, named customers, primary docs
- **Fit** — does this match the desk’s recent work?
- **Length & clarity** — bury the lede and you lose

Paste your pitch and enable a model key for a line-level roast.
`
    default:
      return `## ${skill.name} — Limited Mode scaffold

This web app mirrors the Newsjack skill \`${skill.slug}\`.

**Your inputs were received.** Connect \`OPENAI_API_KEY\` or \`ANTHROPIC_API_KEY\` in the server environment to run the full skill prompt against a model.

Without a key, use this as a structured workspace: refine inputs, save a client profile, then export to a local agent:

\`\`\`bash
curl -fsSL newsjack.sh | bash
\`\`\`

### Input summary
${skill.inputs
  .map((i) => {
    const v = values[i.id]?.trim()
    return `**${i.label}**\n${v ? v.slice(0, 500) + (v.length > 500 ? '…' : '') : '_empty_'}`
  })
  .join('\n\n')}
`
  }
}
