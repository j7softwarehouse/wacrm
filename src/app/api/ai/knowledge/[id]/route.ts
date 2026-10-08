import { NextResponse } from 'next/server'
import { getTranslations } from 'next-intl/server'
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadEmbeddingsKey } from '@/lib/ai/config'
import { ingestDocument } from '@/lib/ai/knowledge'
import { AiError } from '@/lib/ai/types'

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/ai/knowledge/[id] — full document (any member).
 */
export async function GET(_request: Request, { params }: Params) {
  const t = await getTranslations('Api')
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const { id } = await params
    const { data, error } = await supabase
      .from('ai_knowledge_documents')
      .select('id, title, content, updated_at')
      .eq('account_id', accountId)
      .eq('id', id)
      .maybeSingle()
    if (error) {
      console.error('[ai/knowledge/[id] GET] error:', error)
      return NextResponse.json({ error: t('failedToLoadDocument') }, { status: 500 })
    }
    if (!data) return NextResponse.json({ error: t('notFound') }, { status: 404 })
    return NextResponse.json(data)
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * PATCH /api/ai/knowledge/[id]  (admin+) — update title/content and
 * re-index when the content changed.
 */
export async function PATCH(request: Request, { params }: Params) {
  const t = await getTranslations('Api')
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`ai-kb:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { id } = await params
    const body = await request.json().catch(() => null)
    const title = typeof body?.title === 'string' ? body.title.trim() : undefined
    const content = typeof body?.content === 'string' ? body.content.trim() : undefined
    if (title === undefined && content === undefined) {
      return NextResponse.json({ error: t('nothingToUpdate') }, { status: 400 })
    }
    if (title !== undefined && !title) {
      return NextResponse.json({ error: t('titleCannotBeEmpty') }, { status: 400 })
    }
    if (content !== undefined && !content) {
      return NextResponse.json({ error: t('contentEmpty') }, { status: 400 })
    }

    const update: Record<string, string> = {}
    if (title !== undefined) update.title = title
    if (content !== undefined) update.content = content

    const { data: updated, error } = await supabase
      .from('ai_knowledge_documents')
      .update(update)
      .eq('account_id', accountId)
      .eq('id', id)
      .select('id')
      .maybeSingle()
    if (error) {
      console.error('[ai/knowledge/[id] PATCH] error:', error)
      return NextResponse.json({ error: t('failedToUpdateDocument') }, { status: 500 })
    }
    if (!updated) return NextResponse.json({ error: t('notFound') }, { status: 404 })

    if (content !== undefined) {
      const { key: embeddingsApiKey, corrupt } = await loadEmbeddingsKey(
        supabase,
        accountId,
      )
      try {
        await ingestDocument(supabase, accountId, { embeddingsApiKey }, id, content)
      } catch (err) {
        const message = err instanceof AiError ? err.message : t('indexingFailedFallback')
        console.error('[ai/knowledge/[id] PATCH] ingest error:', err)
        return NextResponse.json(
          {
            success: true,
            warning: t('updatedButIndexingFailed', { message }),
          },
          { status: 200 },
        )
      }
      if (corrupt) {
        return NextResponse.json({
          success: true,
          warning: t('updatedKeywordOnlyEmbeddingsCorrupt'),
        })
      }
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/ai/knowledge/[id]  (admin+) — chunks cascade.
 */
export async function DELETE(_request: Request, { params }: Params) {
  const t = await getTranslations('Api')
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { id } = await params
    const { error } = await supabase
      .from('ai_knowledge_documents')
      .delete()
      .eq('account_id', accountId)
      .eq('id', id)
    if (error) {
      console.error('[ai/knowledge/[id] DELETE] error:', error)
      return NextResponse.json({ error: t('failedToDeleteDocument') }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
