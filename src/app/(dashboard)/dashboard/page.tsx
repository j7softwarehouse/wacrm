"use client"

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import { useBlockRestrictedScope } from '@/hooks/use-block-restricted-scope'
import {
  MessageSquare,
  UserPlus,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Send,
} from 'lucide-react'

import {
  loadActivity,
  loadAwaitingReply,
  loadConversationsSeries,
  loadMetrics,
  loadPendingConversations,
  loadPipelineDonut,
  loadResponseTime,
  summarizePending,
} from '@/lib/dashboard/queries'
import type {
  ActivityItem,
  ConversationsSeriesPoint,
  MetricsBundle,
  PendingConversationRow,
  PipelineDonutData,
  ResponseTimeSummary,
} from '@/lib/dashboard/types'

import { MetricCard } from '@/components/dashboard/metric-card'
import { SkeletonCard } from '@/components/dashboard/skeleton'
import { QuickActions } from '@/components/dashboard/quick-actions'
import { ConversationsChart } from '@/components/dashboard/conversations-chart'
import { PipelineDonut } from '@/components/dashboard/pipeline-donut'
import { ResponseTimeChart } from '@/components/dashboard/response-time-chart'
import { ActivityFeed } from '@/components/dashboard/activity-feed'

import { useTranslations } from 'next-intl'

type RangeDays = 7 | 30 | 90

export default function DashboardPage() {
  useBlockRestrictedScope();
  const t = useTranslations('Dashboard.page')
  const { defaultCurrency, accountId, salesEnabled, user, canManageMembers } = useAuth()
  const [metrics, setMetrics] = useState<MetricsBundle | null>(null)
  const [metricsLoading, setMetricsLoading] = useState(true)

  const [awaitingReply, setAwaitingReply] = useState<{ count: number; withinHours: boolean; error?: boolean } | null>(null)
  const [awaitingReplyLoading, setAwaitingReplyLoading] = useState(true)

  const [range, setRange] = useState<RangeDays>(30)
  // Keep a cache per range so switching tabs doesn't re-fetch what we
  // already have. Ranges the user hasn't opened yet stay null and
  // trigger a fetch on first view.
  const [series, setSeries] = useState<Record<RangeDays, ConversationsSeriesPoint[] | null>>({
    7: null,
    30: null,
    90: null,
  })
  const [seriesLoading, setSeriesLoading] = useState(true)

  const [pipeline, setPipeline] = useState<PipelineDonutData | null>(null)
  const [pipelineLoading, setPipelineLoading] = useState(true)

  const [responseTime, setResponseTime] = useState<ResponseTimeSummary | null>(null)
  const [responseTimeLoading, setResponseTimeLoading] = useState(true)

  const [activity, setActivity] = useState<ActivityItem[] | null>(null)
  const [activityLoading, setActivityLoading] = useState(true)

  const loadAll = useCallback(() => {
    const db = createClient()

    // Kick everything off in parallel. Each block has its own
    // setState + finally so a slow query doesn't hold up faster
    // sections — each widget shows its own skeleton independently.
    void loadMetrics(db)
      .then((m) => setMetrics(m))
      .catch((err) => console.error('[dashboard] metrics failed:', err))
      .finally(() => setMetricsLoading(false))

    void loadConversationsSeries(db, 30)
      .then((s) => setSeries((prev) => ({ ...prev, 30: s })))
      .catch((err) => console.error('[dashboard] series failed:', err))
      .finally(() => setSeriesLoading(false))

    void loadPipelineDonut(db)
      .then((p) => setPipeline(p))
      .catch((err) => console.error('[dashboard] pipeline failed:', err))
      .finally(() => setPipelineLoading(false))

    void loadResponseTime(db)
      .then((r) => setResponseTime(r))
      .catch((err) => console.error('[dashboard] response time failed:', err))
      .finally(() => setResponseTimeLoading(false))

    // Fetch up to 50 so the biggest page-size option in the feed
    // (50 rows) is already in memory — switching sizes then becomes
    // a pure client-side slice with no extra round trip.
    void loadActivity(db, 50)
      .then((a) => setActivity(a))
      .catch((err) => console.error('[dashboard] activity failed:', err))
      .finally(() => setActivityLoading(false))
  }, [])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  // Separate effect: `accountId` resolves async (after the profile row
  // loads), later than the mount that kicks off `loadAll`. Keeping this
  // apart from `loadAll` means the other widgets don't re-fetch when
  // `accountId` finally arrives.
  useEffect(() => {
    if (!accountId) {
      setAwaitingReplyLoading(false)
      return
    }
    const db = createClient()

    // "Sem resposta há +30 min" muda só com o tempo passando, não
    // apenas quando uma mensagem nova chega — sem atualização
    // periódica, a secretária só veria o alerta se recarregasse a
    // página manualmente. `silent` evita o skeleton piscar a cada
    // ciclo: só a primeira carga mostra o estado de loading.
    const fetchAwaitingReply = (silent: boolean) => {
      if (!silent) setAwaitingReplyLoading(true)
      loadAwaitingReply(db, accountId)
        .then((r) => setAwaitingReply(r))
        .catch((err) => console.error('[dashboard] awaiting reply failed:', err))
        .finally(() => setAwaitingReplyLoading(false))
    }

    fetchAwaitingReply(false)
    const AWAITING_REPLY_REFRESH_MS = 60_000
    const interval = setInterval(
      () => fetchAwaitingReply(true),
      AWAITING_REPLY_REFRESH_MS,
    )
    return () => clearInterval(interval)
  }, [accountId])

  // Pendências: mesma cadência de repolling do card acima (o dono
  // resolvido de uma pendência pode mudar por ação de outra pessoa —
  // marcar/desmarcar um marcador — sem que este usuário faça nada).
  const [pendingRows, setPendingRows] = useState<PendingConversationRow[] | null>(null)
  const [pendingLoading, setPendingLoading] = useState(true)

  useEffect(() => {
    if (!accountId) {
      setPendingLoading(false)
      return
    }
    const db = createClient()

    const fetchPending = (silent: boolean) => {
      if (!silent) setPendingLoading(true)
      loadPendingConversations(db, accountId)
        .then((rows) => setPendingRows(rows))
        .catch((err) => console.error('[dashboard] pending conversations failed:', err))
        .finally(() => setPendingLoading(false))
    }

    fetchPending(false)
    const PENDING_REFRESH_MS = 60_000
    const interval = setInterval(() => fetchPending(true), PENDING_REFRESH_MS)
    return () => clearInterval(interval)
  }, [accountId])

  const pendingSummary = useMemo(
    () => (pendingRows && user ? summarizePending(pendingRows, user.id) : null),
    [pendingRows, user],
  )

  // Range switch handler — kept in an event callback (not an effect)
  // so the setState calls stay out of the react-hooks/set-state-in-effect
  // rule's way. The cached bucket check means switching back to a
  // previously-viewed range is instant and doesn't re-fetch.
  const handleRangeChange = useCallback(
    (r: RangeDays) => {
      setRange(r)
      if (series[r] !== null) return
      setSeriesLoading(true)
      const db = createClient()
      loadConversationsSeries(db, r)
        .then((s) => setSeries((prev) => ({ ...prev, [r]: s })))
        .catch((err) => console.error('[dashboard] series failed:', err))
        .finally(() => setSeriesLoading(false))
    },
    [series],
  )

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('description')}
        </p>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {metricsLoading || !metrics ? (
          Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <MetricCard
              title={t('activeConversations')}
              value={metrics.activeConversations.current.toLocaleString()}
              icon={MessageSquare}
              delta={{
                sign: metrics.activeConversations.previous,
                label: deltaLabel(
                  metrics.activeConversations.previous, 
                  t('newTodayVsYesterday'), 
                  t('noChange', { suffix: t('newTodayVsYesterday') })
                ),
              }}
            />
            <MetricCard
              title={t('newContactsToday')}
              value={metrics.newContactsToday.current.toLocaleString()}
              icon={UserPlus}
              delta={{
                sign:
                  metrics.newContactsToday.current - metrics.newContactsToday.previous,
                label: deltaLabel(
                  metrics.newContactsToday.current - metrics.newContactsToday.previous,
                  t('vsYesterday'),
                  t('noChange', { suffix: t('vsYesterday') })
                ),
              }}
            />
            {awaitingReplyLoading || !awaitingReply ? (
              <SkeletonCard />
            ) : (
              <Link href="/inbox" className="block">
                {(() => {
                  const hasRealAlert =
                    !awaitingReply.error &&
                    awaitingReply.withinHours &&
                    awaitingReply.count > 0
                  // Ícone reflete o que o estado realmente é: alerta
                  // de verdade merece o triângulo; "fora do horário" e
                  // "tudo respondido" são estados neutros/positivos,
                  // não avisos — relógio e check pesam menos. O valor
                  // grande fica sempre curto (mesmo padrão dos outros
                  // cards do dashboard); a frase de status vai no
                  // rodapé pequeno, junto com o resto dos cards.
                  const icon = awaitingReply.error
                    ? AlertTriangle
                    : !awaitingReply.withinHours
                      ? Clock
                      : hasRealAlert
                        ? AlertTriangle
                        : CheckCircle2
                  return (
                    <MetricCard
                      title={t('awaitingReply')}
                      value={
                        // Falha de RPC não pode se disfarçar de "tudo
                        // respondido" — um traço deixa claro que o
                        // número não está disponível, em vez de
                        // mentir "0".
                        awaitingReply.error
                          ? '—'
                          : awaitingReply.count.toLocaleString()
                      }
                      icon={icon}
                      subtitle={
                        <>
                          {(() => {
                            const SubtitleIcon = icon
                            return <SubtitleIcon className="h-4 w-4" aria-hidden />
                          })()}
                          <span>
                            {awaitingReply.error
                              ? t('awaitingReplyErrorHint')
                              : !awaitingReply.withinHours
                                ? t('awaitingReplyClosed')
                                : hasRealAlert
                                  ? t('awaitingReplyHint')
                                  : t('awaitingReplyEmpty')}
                          </span>
                        </>
                      }
                      tone={hasRealAlert ? 'alert' : 'default'}
                    />
                  )
                })()}
              </Link>
            )}
            {pendingLoading || !pendingSummary ? (
              <SkeletonCard />
            ) : (
              <Link href="/inbox" className="block">
                {(() => {
                  // Admin/owner veem o total da conta; os demais veem só
                  // as suas (a RLS de `conversations` já filtra o que
                  // chega quando o papel é restrito por escopo de
                  // conversa — ver loadPendingConversations). Alerta de
                  // verdade é só a órfã (nem marcador, nem responsável):
                  // ter pendências é operação normal, não falha.
                  const displayCount = canManageMembers
                    ? pendingSummary.total
                    : pendingSummary.mine
                  const hasUnowned = canManageMembers && pendingSummary.unowned > 0
                  const icon = hasUnowned ? AlertTriangle : Clock
                  return (
                    <MetricCard
                      title={t('pendingConversations')}
                      value={displayCount.toLocaleString()}
                      icon={icon}
                      subtitle={
                        <>
                          {(() => {
                            const SubtitleIcon = icon
                            return <SubtitleIcon className="h-4 w-4" aria-hidden />
                          })()}
                          <span>
                            {hasUnowned
                              ? t('pendingUnownedHint', { count: pendingSummary.unowned })
                              : canManageMembers
                                ? t('pendingAccountHint')
                                : t('pendingMineHint')}
                          </span>
                        </>
                      }
                      tone={hasUnowned ? 'alert' : 'default'}
                    />
                  )
                })()}
              </Link>
            )}
            <MetricCard
              title={t('messagesSentToday')}
              value={metrics.messagesSentToday.current.toLocaleString()}
              icon={Send}
              delta={{
                sign:
                  metrics.messagesSentToday.current - metrics.messagesSentToday.previous,
                label: deltaLabel(
                  metrics.messagesSentToday.current - metrics.messagesSentToday.previous,
                  t('vsYesterday'),
                  t('noChange', { suffix: t('vsYesterday') })
                ),
              }}
            />
          </>
        )}
      </div>

      {/* Quick actions */}
      <QuickActions />

      {/* Charts row */}
      {/* items-stretch (the grid default) stretches the two columns to
          match the tallest sibling; adding h-full on each wrapper and
          on the inner panels makes both cards actually fill that
          stretched height so their rounded borders line up. Without
          this, the pipeline card rendered at its natural (shorter)
          height while the line chart drove the row height. */}
      <div
        className={
          // Módulo de vendas desligado (Task 10): sem o donut de
          // pipeline, o gráfico de conversas fica sozinho e ocupa a
          // largura toda em vez de dividir 3/5.
          salesEnabled
            ? 'grid grid-cols-1 gap-4 lg:grid-cols-5'
            : 'grid grid-cols-1 gap-4'
        }
      >
        <div className={salesEnabled ? 'h-full lg:col-span-3' : 'h-full'}>
          <ConversationsChart
            series={series}
            loading={seriesLoading}
            range={range}
            onRangeChange={handleRangeChange}
          />
        </div>
        {salesEnabled && (
          <div className="h-full lg:col-span-2">
            <PipelineDonut
              data={pipeline}
              loading={pipelineLoading}
              currency={defaultCurrency}
            />
          </div>
        )}
      </div>

      {/* Response time */}
      <ResponseTimeChart data={responseTime} loading={responseTimeLoading} />

      {/* Activity feed */}
      <ActivityFeed items={activity} loading={activityLoading} />
    </div>
  )
}

// ------------------------------------------------------------

function deltaLabel(delta: number, suffix: string, noChangeLabel: string): string {
  if (delta === 0) return noChangeLabel
  const sign = delta > 0 ? '+' : ''
  return `${sign}${delta.toLocaleString()} ${suffix}`
}
