export type SkillCategory = 'detect' | 'act' | 'strategize' | 'ai-visibility'

export type SkillDef = {
  slug: string
  name: string
  category: SkillCategory
  icon: string
  description: string
  whenToUse: string
  /** Skills that need local Chrome / filesystem / scheduled state — web shows guidance only */
  localOnly?: boolean
  /** Full Mode browser job via Manus API + webhook */
  browserWorker?: boolean
  /** Needs live news API for full quality */
  needsNewsApi?: boolean
  inputs: Array<{
    id: string
    label: string
    placeholder: string
    type: 'textarea' | 'text'
    required?: boolean
    rows?: number
  }>
}

export const CATEGORIES: Record<
  SkillCategory,
  { label: string; blurb: string; color: string }
> = {
  detect: {
    label: 'Detect',
    blurb: 'Surface what matters in your space',
    color: 'var(--detect)',
  },
  act: {
    label: 'Act',
    blurb: 'Turn signal into output',
    color: 'var(--act)',
  },
  strategize: {
    label: 'Strategize',
    blurb: 'Figure out what your story even is',
    color: 'var(--strategize)',
  },
  'ai-visibility': {
    label: 'AI visibility',
    blurb: 'Get your facts into AI answers (AEO/GEO)',
    color: 'var(--ai)',
  },
}

export const SKILLS: SkillDef[] = [
  // Detect
  {
    slug: 'newsjack-detector',
    name: 'Newsjack Detector',
    category: 'detect',
    icon: '📡',
    description:
      'Find newsjacking opportunities: fresh stories you have standing to jump on before the wave breaks.',
    whenToUse:
      'You want to monitor news for pitchable hooks or decide whether a current signal is worth riding.',
    needsNewsApi: true,
    inputs: [
      {
        id: 'company',
        label: 'Company / product context',
        placeholder:
          'Who you are, standing, beat topics, competitors, spokespeople…',
        type: 'textarea',
        required: true,
        rows: 5,
      },
      {
        id: 'signals',
        label: 'News signals to evaluate (paste headlines + links + dates)',
        placeholder: 'Paste recent headlines, URLs, and publication times…',
        type: 'textarea',
        required: true,
        rows: 8,
      },
    ],
  },
  {
    slug: 'news-search',
    name: 'News Search',
    category: 'detect',
    icon: '🔎',
    description:
      'Dated, attributed articles on a topic, company, or competitor.',
    whenToUse: 'You need recent coverage on a topic, company, or competitor.',
    needsNewsApi: true,
    inputs: [
      {
        id: 'query',
        label: 'Search query',
        placeholder: 'e.g. Series B fintech lending regulation 2026',
        type: 'text',
        required: true,
      },
      {
        id: 'context',
        label: 'Why you care (optional)',
        placeholder: 'Competitor watch, pitch research, etc.',
        type: 'textarea',
        rows: 3,
      },
    ],
  },
  {
    slug: 'story-origin-check',
    name: 'Story Origin Check',
    category: 'detect',
    icon: '🔍',
    description:
      'Verify the story is still fresh: who broke it, who owns it, what oxygen is left.',
    whenToUse: 'Before newsjacking or pitching off a circulating story.',
    needsNewsApi: true,
    inputs: [
      {
        id: 'story',
        label: 'Story / headline + links',
        placeholder: 'Headline, URLs, and any known first-public timestamps…',
        type: 'textarea',
        required: true,
        rows: 6,
      },
    ],
  },
  {
    slug: 'relevance-coarse-filter',
    name: 'Relevance Coarse Filter',
    category: 'detect',
    icon: '🧹',
    description:
      'Cheap high-recall first pass that throws out obvious junk before expensive work.',
    whenToUse: 'You have a pile of candidate headlines and need a first cut.',
    inputs: [
      {
        id: 'profile',
        label: 'Client standing / topics',
        placeholder: 'What the client can credibly speak to…',
        type: 'textarea',
        required: true,
        rows: 4,
      },
      {
        id: 'candidates',
        label: 'Candidate headlines (one per line)',
        placeholder: 'Paste headlines…',
        type: 'textarea',
        required: true,
        rows: 10,
      },
    ],
  },
  {
    slug: 'newsjack-triage',
    name: 'Newsjack Triage',
    category: 'detect',
    icon: '🚦',
    description:
      'Route surviving stories by standing: pitch now, watch, or surface as big news.',
    whenToUse: 'You have filtered signals and need routing decisions.',
    inputs: [
      {
        id: 'profile',
        label: 'Client profile / standing',
        placeholder: 'Company, authority, beat fit…',
        type: 'textarea',
        required: true,
        rows: 4,
      },
      {
        id: 'stories',
        label: 'Stories to triage',
        placeholder: 'Each story with freshness and source notes…',
        type: 'textarea',
        required: true,
        rows: 8,
      },
    ],
  },
  {
    slug: 'newsjack-monitor-setup',
    name: 'Monitor Setup',
    category: 'detect',
    icon: '⚙️',
    description:
      'Build a monitoring profile: standing, beats, competitors, feeds, delivery.',
    whenToUse: 'First-time setup for ongoing newsjack monitoring.',
    localOnly: true,
    inputs: [
      {
        id: 'company',
        label: 'Company details',
        placeholder: 'Name, product, standing, competitors…',
        type: 'textarea',
        required: true,
        rows: 6,
      },
    ],
  },
  {
    slug: 'coverage-tracker-setup',
    name: 'Coverage Tracker Setup',
    category: 'detect',
    icon: '🔔',
    description: 'Declare keywords to watch and what each one means.',
    whenToUse: 'You want Google Alerts-style tracking with LLM filtering.',
    localOnly: true,
    inputs: [
      {
        id: 'keywords',
        label: 'Keywords + meaning',
        placeholder: 'keyword — what counts as a real feature for this term…',
        type: 'textarea',
        required: true,
        rows: 6,
      },
    ],
  },
  {
    slug: 'coverage-tracker',
    name: 'Coverage Tracker',
    category: 'detect',
    icon: '🗞️',
    description:
      'Keyword tracking with LLM filtering for real features — only genuinely new coverage.',
    whenToUse: 'Review recent hits for declared keywords.',
    needsNewsApi: true,
    inputs: [
      {
        id: 'keywords',
        label: 'Keywords + definitions',
        placeholder: 'Your tracking definitions…',
        type: 'textarea',
        required: true,
        rows: 4,
      },
      {
        id: 'hits',
        label: 'Raw hits to filter',
        placeholder: 'Paste alert results or article list…',
        type: 'textarea',
        required: true,
        rows: 8,
      },
    ],
  },

  // Act
  {
    slug: 'angle-generator',
    name: 'Angle Generator',
    category: 'act',
    icon: '🎯',
    description:
      'Turn one update into 3–7 structurally distinct, journalist-shaped story angles.',
    whenToUse:
      'You have company news but no story yet: funding, launch, hire, partnership, milestone.',
    inputs: [
      {
        id: 'update',
        label: 'Company update (facts only)',
        placeholder:
          'Paste the raw facts — no marketing fluff. Links and numbers welcome.',
        type: 'textarea',
        required: true,
        rows: 8,
      },
      {
        id: 'context',
        label: 'Company / beat context (optional)',
        placeholder: 'Industry, prior coverage, audience…',
        type: 'textarea',
        rows: 3,
      },
    ],
  },
  {
    slug: 'headline-generator',
    name: 'Headline Generator',
    category: 'act',
    icon: '📝',
    description:
      'Headlines and pitch subject lines built from the story’s raw facts.',
    whenToUse: 'You have an angle and need subject lines / headlines.',
    inputs: [
      {
        id: 'facts',
        label: 'Story facts / angle',
        placeholder: 'The angle and supporting facts…',
        type: 'textarea',
        required: true,
        rows: 6,
      },
    ],
  },
  {
    slug: 'meanest-editor',
    name: 'Meanest Editor',
    category: 'act',
    icon: '🥊',
    description: 'Roast your pitch against the rubric editors actually use.',
    whenToUse: 'Before you send a pitch or press release.',
    inputs: [
      {
        id: 'pitch',
        label: 'Pitch or draft',
        placeholder: 'Paste the full pitch / release…',
        type: 'textarea',
        required: true,
        rows: 12,
      },
      {
        id: 'target',
        label: 'Intended outlet / beat (optional)',
        placeholder: 'e.g. TechCrunch enterprise, Bloomberg markets…',
        type: 'text',
      },
    ],
  },
  {
    slug: 'crisis-holding',
    name: 'Crisis Holding',
    category: 'act',
    icon: '🚨',
    description:
      'Holding statements, journalist Q&A posture, and what not to say — with a hard legal-counsel gate.',
    whenToUse: 'Active or looming crisis; need a holding line fast.',
    inputs: [
      {
        id: 'situation',
        label: 'Situation (known facts only)',
        placeholder: 'What happened, what is confirmed, what is alleged…',
        type: 'textarea',
        required: true,
        rows: 8,
      },
      {
        id: 'constraints',
        label: 'Legal / counsel constraints (optional)',
        placeholder: 'Anything counsel has already ruled out…',
        type: 'textarea',
        rows: 3,
      },
    ],
  },
  {
    slug: 'reactive-comment',
    name: 'Reactive Comment',
    category: 'act',
    icon: '🎙️',
    description:
      'Triage inbound HARO-style source requests; draft only the real fits.',
    whenToUse: 'HARO / Connectively / journalist source request landed.',
    inputs: [
      {
        id: 'request',
        label: 'Source request',
        placeholder: 'Paste the full query…',
        type: 'textarea',
        required: true,
        rows: 6,
      },
      {
        id: 'profile',
        label: 'Your expertise / standing',
        placeholder: 'Why you might be a fit…',
        type: 'textarea',
        required: true,
        rows: 4,
      },
    ],
  },
  {
    slug: 'fact-check',
    name: 'Fact Check',
    category: 'act',
    icon: '✅',
    description:
      'Extract claims, verify each, flag the shaky ones before you send.',
    whenToUse: 'Before a pitch, release, reactive comment, or journalist-facing draft.',
    inputs: [
      {
        id: 'copy',
        label: 'Copy to fact-check',
        placeholder: 'Paste the draft…',
        type: 'textarea',
        required: true,
        rows: 12,
      },
      {
        id: 'evidence',
        label: 'Evidence / sources you have (optional)',
        placeholder: 'Links, reports, internal numbers…',
        type: 'textarea',
        rows: 4,
      },
    ],
  },
  {
    slug: 'journalist-fit-check',
    name: 'Journalist Fit Check',
    category: 'act',
    icon: '🤝',
    description:
      'Will this reporter actually care, or are you spamming?',
    whenToUse: 'You have a named journalist and a pitch angle.',
    inputs: [
      {
        id: 'journalist',
        label: 'Journalist + recent work',
        placeholder:
          'Name, outlet, beat, and 2–5 recent headlines or links…',
        type: 'textarea',
        required: true,
        rows: 6,
      },
      {
        id: 'pitch',
        label: 'Your pitch / angle',
        placeholder: 'What you want to pitch them…',
        type: 'textarea',
        required: true,
        rows: 5,
      },
    ],
  },
  {
    slug: 'same-outlet-ranker',
    name: 'Same-Outlet Ranker',
    category: 'act',
    icon: '🥇',
    description:
      'Rank colleagues at the same publication — send to one, don’t spray the masthead.',
    whenToUse: 'Multiple reporters at one outlet could cover this.',
    inputs: [
      {
        id: 'reporters',
        label: 'Reporters + recent coverage',
        placeholder: 'List names, beats, and sample recent stories…',
        type: 'textarea',
        required: true,
        rows: 8,
      },
      {
        id: 'story',
        label: 'Your story / angle',
        placeholder: 'What you are pitching…',
        type: 'textarea',
        required: true,
        rows: 4,
      },
    ],
  },
  {
    slug: 'voice-extractor',
    name: 'Voice Extractor',
    category: 'act',
    icon: '🗣️',
    description: 'Fingerprint your real writing; kill the AI tells.',
    whenToUse: 'You have sample writing and want a reusable voice brief.',
    inputs: [
      {
        id: 'samples',
        label: 'Writing samples',
        placeholder: 'Paste 2–5 authentic samples…',
        type: 'textarea',
        required: true,
        rows: 12,
      },
    ],
  },
  {
    slug: 'find-journalists',
    name: 'Find Journalists',
    category: 'act',
    icon: '📋',
    description:
      'Build a fit-checked media list from a brief (best-effort without Medialyst).',
    whenToUse: 'You need a small, fit-checked list for a specific pitch.',
    needsNewsApi: true,
    inputs: [
      {
        id: 'brief',
        label: 'Pitch brief',
        placeholder: 'Story, beat, geography, outlet tier…',
        type: 'textarea',
        required: true,
        rows: 6,
      },
      {
        id: 'candidates',
        label: 'Candidate journalists (optional research paste)',
        placeholder: 'Names and links from your research…',
        type: 'textarea',
        rows: 6,
      },
    ],
  },
  {
    slug: 'press-clip',
    name: 'Press Clip',
    category: 'act',
    icon: '📰',
    description:
      'Turn a live article URL into a branded press-clip PDF via Manus browser worker (webhook on complete).',
    whenToUse: 'You have a live coverage URL to package.',
    browserWorker: true,
    inputs: [
      {
        id: 'url',
        label: 'Article URL',
        placeholder: 'https://…',
        type: 'text',
        required: true,
      },
      {
        id: 'mention',
        label: 'Client mention to highlight',
        placeholder: 'Company or product name…',
        type: 'text',
        required: true,
      },
    ],
  },
  {
    slug: 'coverage-reel',
    name: 'Coverage Reel',
    category: 'act',
    icon: '🎞️',
    description:
      'Coverage list → dashboard + motion reel via Manus browser worker (webhook on complete).',
    whenToUse: 'You have a set of press clips to turn into a reel.',
    browserWorker: true,
    inputs: [
      {
        id: 'notes',
        label: 'Coverage notes / CSV paste',
        placeholder: 'Outlet, date, URL, mention line…',
        type: 'textarea',
        required: true,
        rows: 8,
      },
    ],
  },

  // Strategize
  {
    slug: 'pr-strategist',
    name: 'PR Strategist',
    category: 'strategize',
    icon: '🗺️',
    description:
      'Opinionated walkthrough: audience first, positioning second, news pegs third.',
    whenToUse: 'You are not PR-fluent yet or need a reset on strategy.',
    inputs: [
      {
        id: 'company',
        label: 'Company / product',
        placeholder: 'What you sell, to whom, why now…',
        type: 'textarea',
        required: true,
        rows: 6,
      },
      {
        id: 'goals',
        label: 'Goals / constraints',
        placeholder: 'Hire, fundraise, launch, category creation…',
        type: 'textarea',
        rows: 3,
      },
    ],
  },
  {
    slug: 'pr-calendar',
    name: 'PR Calendar',
    category: 'strategize',
    icon: '📅',
    description:
      'Plan six months of source-backed upcoming hooks (web: planning scaffold).',
    whenToUse: 'You need a forward calendar of pegs and campaigns.',
    needsNewsApi: true,
    inputs: [
      {
        id: 'company',
        label: 'Company + themes',
        placeholder: 'Product, beats, seasonal moments…',
        type: 'textarea',
        required: true,
        rows: 5,
      },
      {
        id: 'horizon',
        label: 'Planning horizon',
        placeholder: 'e.g. next 6 months, Q1–Q2…',
        type: 'text',
      },
    ],
  },
  {
    slug: 'newsworthiness-check',
    name: 'Newsworthiness Check',
    category: 'strategize',
    icon: '📊',
    description:
      'Cold read on whether it clears the bar before you act.',
    whenToUse:
      'Is this event or pitch idea actually newsworthy to journalists?',
    inputs: [
      {
        id: 'item',
        label: 'Event or pitch idea',
        placeholder: 'Describe the news event or your announcement…',
        type: 'textarea',
        required: true,
        rows: 8,
      },
      {
        id: 'standing',
        label: 'Your standing (optional)',
        placeholder: 'Why you could speak to this…',
        type: 'textarea',
        rows: 3,
      },
    ],
  },

  // AI visibility
  {
    slug: 'ai-visibility-writing',
    name: 'AI Visibility Writing',
    category: 'ai-visibility',
    icon: '✍️',
    description:
      'Audit or fact-preservingly revise copy so AI answers can reuse it — no invented evidence.',
    whenToUse: 'You have web copy that should be citable by AI systems.',
    inputs: [
      {
        id: 'copy',
        label: 'Copy to audit / revise',
        placeholder: 'Paste page or section…',
        type: 'textarea',
        required: true,
        rows: 12,
      },
    ],
  },
  {
    slug: 'build-ai-visibility-panel',
    name: 'Build AI Visibility Panel',
    category: 'ai-visibility',
    icon: '🧭',
    description:
      'Turn a public URL + description into an evidence-bound prompt list across intent and journey.',
    whenToUse: 'First step to measure AI visibility for a product URL.',
    inputs: [
      {
        id: 'url',
        label: 'Public URL',
        placeholder: 'https://…',
        type: 'text',
        required: true,
      },
      {
        id: 'description',
        label: 'Product / market description',
        placeholder: 'What it is, for whom, category…',
        type: 'textarea',
        required: true,
        rows: 5,
      },
    ],
  },
  {
    slug: 'icp-evidence-analysis',
    name: 'ICP Evidence Analysis',
    category: 'ai-visibility',
    icon: '👥',
    description:
      'Turn a company dossier into testable ICP hypotheses, roles, triggers, and research gaps.',
    whenToUse: 'You need buyer definition grounded in evidence.',
    inputs: [
      {
        id: 'dossier',
        label: 'Company / market dossier',
        placeholder: 'Paste notes, reviews, interviews, site copy…',
        type: 'textarea',
        required: true,
        rows: 12,
      },
    ],
  },
  {
    slug: 'buyer-job-intent-analysis',
    name: 'Buyer Job Intent Analysis',
    category: 'ai-visibility',
    icon: '🧩',
    description:
      'Recover jobs, struggling moments, workarounds, and authentic buyer language from evidence.',
    whenToUse: 'You have customer/review/forum evidence to mine.',
    inputs: [
      {
        id: 'evidence',
        label: 'Customer / review / forum evidence',
        placeholder: 'Paste real quotes and sources…',
        type: 'textarea',
        required: true,
        rows: 12,
      },
    ],
  },
]

export function getSkill(slug: string): SkillDef | undefined {
  return SKILLS.find((s) => s.slug === slug)
}

export function skillsByCategory(cat: SkillCategory): SkillDef[] {
  return SKILLS.filter((s) => s.category === cat)
}
