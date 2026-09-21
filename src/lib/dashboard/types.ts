// Shared result shapes the dashboard components consume. Centralised
// here so each component stays thin and the page-level loader wires
// them up without type gymnastics.

export interface MetricDelta {
  current: number
  previous: number
}

export interface MetricsBundle {
  activeConversations: MetricDelta
  newContactsToday: MetricDelta
  openDealsValue: number
  openDealsCount: number
  messagesSentToday: MetricDelta
}

export interface ConversationsSeriesPoint {
  day: string // YYYY-MM-DD local
  incoming: number
  outgoing: number
}

export interface PipelineStageSlice {
  id: string
  name: string
  color: string
  dealCount: number
  totalValue: number
}

export interface PipelineDonutData {
  stages: PipelineStageSlice[]
  totalValue: number
}

export interface ResponseTimeBucket {
  /** 0 = Mon … 6 = Sun (Monday-first). */
  dow: number
  /** Average first-response time in minutes. Null means no samples. */
  avgMinutes: number | null
  samples: number
}

export interface ResponseTimeSummary {
  buckets: ResponseTimeBucket[]
  thisWeekAvg: number | null
  lastWeekAvg: number | null
}

export type ActivityKind =
  | 'message'
  | 'deal'
  | 'broadcast'
  | 'automation'
  | 'contact'

export interface ActivityItem {
  id: string
  kind: ActivityKind
  /** Primary line of text rendered in the feed. Pre-formatted. */
  text: string
  /** ISO timestamp the item happened at, drives relative-time + sort. */
  at: string
  /** Optional deep-link for the whole row (not all items have a target). */
  href?: string
}

/**
 * Uma conversa pendente, já com o "dono" resolvido em cascata: marcador
 * (mais recente, se houver mais de um) > responsável atribuído > nenhum.
 * `marker_owner_id`/`assigned_agent_id` nulos ao mesmo tempo = pendência
 * órfã (ninguém a cobre) — ver summarizePending.
 */
export interface PendingConversationRow {
  conversation_id: string
  pending_since: string | null
  assigned_agent_id: string | null
  marker_owner_id: string | null
  marker_label: string | null
}

export interface PendingSummary {
  total: number
  /** Nem marcador, nem responsável atribuído — o caso que o card precisa destacar. */
  unowned: number
  /** Dono resolvido (marcador ou atribuição) é o usuário atual. */
  mine: number
}
