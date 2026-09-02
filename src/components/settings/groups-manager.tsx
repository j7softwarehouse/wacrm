'use client';

// ============================================================
// GroupsManager — Settings → Groups → which WhatsApp groups feed
// the inbox.
//
// Consumes GET/PATCH /api/whatsapp/groups (list + toggle) and POST
// /api/whatsapp/groups/sync (pull the live group list from the
// account's default WhatsApp channel). Mirrors the structural and
// visual pattern of `channels-manager.tsx`: a panel head with a
// primary action, a loading spinner, an empty state, and a card
// holding a divided list of rows.
//
// Read-only note: there is no group composer yet — the `enabled`
// toggle only controls whether a group's inbound messages surface
// in the inbox. Sending into a group arrives in a later phase, so
// a banner says so up front instead of leaving users to wonder why
// there's no "send" affordance on a group thread.
//
// Role gating: GET only requires account membership (any role can
// see which groups are synced), but the PATCH route enforces
// `canEditSettings` (admin+) server-side — a non-admin's toggle
// would otherwise round-trip to a 403. Rather than let that click
// fail silently, every actionable control (Sync button, each
// Switch) is disabled up front for non-admins, with a hint
// explaining why.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ImageOff, Loader2, RefreshCw, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useAuth } from '@/hooks/use-auth';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { SettingsPanelHead } from './settings-panel-head';

interface WhatsAppGroup {
  id: string;
  group_jid: string;
  name: string | null;
  avatar_url: string | null;
  enabled: boolean;
}

export function GroupsManager() {
  const t = useTranslations('Settings.groups');
  const { canEditSettings } = useAuth();

  const [groups, setGroups] = useState<WhatsAppGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/whatsapp/groups', { cache: 'no-store' });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || t('loadError'));
        return;
      }
      setGroups((payload.groups ?? []) as WhatsAppGroup[]);
    } catch (err) {
      console.error('[GroupsManager] load error:', err);
      toast.error(t('networkError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await fetch('/api/whatsapp/groups/sync', { method: 'POST' });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || t('syncError'));
        return;
      }
      const synced = (payload.synced as number | undefined) ?? 0;
      if (synced === 0) {
        toast(t('syncEmpty'));
      } else {
        toast.success(t('syncSuccess', { count: synced }));
      }
      await load();
    } catch (err) {
      console.error('[GroupsManager] sync error:', err);
      toast.error(t('networkError'));
    } finally {
      setSyncing(false);
    }
  }

  async function handleToggle(group: WhatsAppGroup, nextEnabled: boolean) {
    if (!canEditSettings) return;

    const previousEnabled = group.enabled;
    setTogglingId(group.id);
    // Optimistic — flip immediately, revert on failure below.
    setGroups((prev) =>
      prev.map((g) => (g.id === group.id ? { ...g, enabled: nextEnabled } : g)),
    );

    try {
      const res = await fetch('/api/whatsapp/groups', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: group.id, enabled: nextEnabled }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setGroups((prev) =>
          prev.map((g) =>
            g.id === group.id ? { ...g, enabled: previousEnabled } : g,
          ),
        );
        toast.error(payload.error || t('updateError'));
        return;
      }
    } catch (err) {
      console.error('[GroupsManager] toggle error:', err);
      setGroups((prev) =>
        prev.map((g) =>
          g.id === group.id ? { ...g, enabled: previousEnabled } : g,
        ),
      );
      toast.error(t('networkError'));
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <section className="animate-in fade-in-50 space-y-4 duration-200">
      <SettingsPanelHead
        title={t('title')}
        description={t('description')}
        action={
          <Button onClick={handleSync} disabled={syncing || !canEditSettings}>
            {syncing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            {t('sync')}
          </Button>
        }
      />

      <Alert className="border-border bg-card">
        <AlertDescription className="text-muted-foreground text-sm">
          {t('readOnly')}
        </AlertDescription>
      </Alert>

      {!canEditSettings && (
        <p className="text-muted-foreground text-xs">{t('adminOnlyHint')}</p>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="text-primary size-5 animate-spin" />
        </div>
      ) : groups.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-8 text-center">
            <Users className="text-muted-foreground size-6" />
            <p className="text-muted-foreground mt-2 text-sm">{t('empty')}</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-border divide-y">
              {groups.map((group) => (
                <li
                  key={group.id}
                  className="flex items-center gap-3 px-4 py-3"
                >
                  <Avatar size="sm" className="shrink-0">
                    {group.avatar_url ? (
                      <AvatarImage
                        src={group.avatar_url}
                        alt={group.name || t('unnamed')}
                      />
                    ) : null}
                    <AvatarFallback>
                      <Users className="size-3.5" />
                    </AvatarFallback>
                  </Avatar>

                  <div className="min-w-0 flex-1">
                    <p className="text-foreground truncate text-sm font-medium">
                      {group.name || t('unnamed')}
                    </p>
                    <p className="text-muted-foreground mt-0.5 flex items-center gap-1 text-xs">
                      {group.avatar_url ? null : (
                        <ImageOff className="size-3 shrink-0" />
                      )}
                      {group.avatar_url ? t('hasPhoto') : t('noPhoto')}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-muted-foreground hidden text-xs sm:inline">
                      {t('enabled')}
                    </span>
                    <Switch
                      checked={group.enabled}
                      disabled={!canEditSettings || togglingId === group.id}
                      onCheckedChange={(checked) =>
                        handleToggle(group, !!checked)
                      }
                      aria-label={t('enabled')}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </section>
  );
}
