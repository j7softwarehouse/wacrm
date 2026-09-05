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
import { ImageOff, Loader2, RefreshCw, Settings, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useAuth } from '@/hooks/use-auth';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { SettingsPanelHead } from './settings-panel-head';

interface WhatsAppGroup {
  id: string;
  group_jid: string;
  name: string | null;
  avatar_url: string | null;
  enabled: boolean;
  left_at: string | null;
}

interface GroupParticipant {
  phoneNumber: string;
  isAdmin: boolean;
}

function GroupManageDialog({
  group,
  onClose,
  onLeft,
  onRenamed,
}: {
  group: WhatsAppGroup;
  onClose: () => void;
  onLeft: () => void;
  onRenamed: (name: string) => void;
}) {
  const t = useTranslations('Settings.groups');
  const [participants, setParticipants] = useState<GroupParticipant[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState(group.name ?? '');
  const [savingName, setSavingName] = useState(false);
  const [newPhone, setNewPhone] = useState('');
  const [addingPhone, setAddingPhone] = useState(false);
  const [busyPhone, setBusyPhone] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const loadParticipants = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/whatsapp/groups/${group.id}/participants`, {
        cache: 'no-store',
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || t('participantsLoadError'));
        return;
      }
      setParticipants((payload.participants ?? []) as GroupParticipant[]);
      setIsAdmin(!!payload.isConnectedNumberAdmin);
    } catch {
      toast.error(t('participantsLoadError'));
    } finally {
      setLoading(false);
    }
  }, [group.id, t]);

  useEffect(() => {
    void loadParticipants();
  }, [loadParticipants]);

  async function handleAction(action: 'add' | 'remove' | 'promote' | 'demote', phone: string) {
    setBusyPhone(phone);
    try {
      const res = await fetch(`/api/whatsapp/groups/${group.id}/participants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, phone }),
      });
      const payload = await res.json().catch(() => ({}));
      const errorKey =
        action === 'add'
          ? 'addParticipantError'
          : action === 'remove'
            ? 'removeParticipantError'
            : 'promoteError';
      if (!res.ok) {
        toast.error(payload.error || t(errorKey));
        return;
      }
      setParticipants((payload.participants ?? []) as GroupParticipant[]);
      const successKey =
        action === 'add'
          ? 'addParticipantSuccess'
          : action === 'remove'
            ? 'removeParticipantSuccess'
            : action === 'promote'
              ? 'promoteSuccess'
              : 'demoteSuccess';
      toast.success(t(successKey));
    } catch {
      toast.error(t('networkError'));
    } finally {
      setBusyPhone(null);
      setConfirmRemove(null);
    }
  }

  async function handleAdd() {
    const phone = newPhone.trim();
    if (!phone) return;
    setAddingPhone(true);
    await handleAction('add', phone);
    setAddingPhone(false);
    setNewPhone('');
  }

  async function handleRename() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === group.name) return;
    setSavingName(true);
    try {
      const res = await fetch(`/api/whatsapp/groups/${group.id}/name`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || t('renameError'));
        return;
      }
      toast.success(t('renameSuccess'));
      onRenamed(trimmed);
    } catch {
      toast.error(t('networkError'));
    } finally {
      setSavingName(false);
    }
  }

  async function handleLeave() {
    setLeaving(true);
    try {
      const res = await fetch(`/api/whatsapp/groups/${group.id}/leave`, { method: 'POST' });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || t('leaveError'));
        return;
      }
      toast.success(t('leaveSuccess'));
      onLeft();
    } catch {
      toast.error(t('networkError'));
    } finally {
      setLeaving(false);
      setConfirmLeave(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('manageTitle')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-muted-foreground text-xs">{t('renameLabel')}</label>
            <div className="mt-1 flex gap-2">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!isAdmin || savingName}
              />
              {isAdmin && (
                <Button
                  size="sm"
                  onClick={handleRename}
                  disabled={savingName || !name.trim() || name.trim() === group.name}
                >
                  {savingName ? <Loader2 className="size-4 animate-spin" /> : t('renameSave')}
                </Button>
              )}
            </div>
          </div>

          {!isAdmin && !loading && (
            <p className="text-muted-foreground text-xs">{t('notAdminHint')}</p>
          )}

          <div>
            <p className="text-muted-foreground text-xs">{t('participantsTitle')}</p>
            {loading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="size-4 animate-spin" />
              </div>
            ) : (
              <ul className="mt-2 divide-border divide-y">
                {participants.map((p) => (
                  <li key={p.phoneNumber} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <span className="flex items-center gap-2">
                      {p.phoneNumber}
                      {p.isAdmin && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">
                          {t('adminBadge')}
                        </span>
                      )}
                    </span>
                    {isAdmin && (
                      <span className="flex shrink-0 gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busyPhone === p.phoneNumber}
                          onClick={() =>
                            handleAction(p.isAdmin ? 'demote' : 'promote', p.phoneNumber)
                          }
                        >
                          {p.isAdmin ? t('demote') : t('promote')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          disabled={busyPhone === p.phoneNumber}
                          onClick={() => setConfirmRemove(p.phoneNumber)}
                        >
                          {t('removeParticipant')}
                        </Button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {isAdmin && (
            <div>
              <label className="text-muted-foreground text-xs">{t('addParticipant')}</label>
              <div className="mt-1 flex gap-2">
                <Input
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  placeholder={t('addParticipantPlaceholder')}
                  disabled={addingPhone}
                />
                <Button size="sm" onClick={handleAdd} disabled={addingPhone || !newPhone.trim()}>
                  {addingPhone ? <Loader2 className="size-4 animate-spin" /> : t('addParticipantAction')}
                </Button>
              </div>
            </div>
          )}

          <Button
            variant="destructive"
            className="w-full"
            onClick={() => setConfirmLeave(true)}
          >
            {t('leaveGroup')}
          </Button>
        </div>
      </DialogContent>

      <Dialog open={!!confirmRemove} onOpenChange={(open) => !open && setConfirmRemove(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('removeConfirmTitle')}</DialogTitle>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRemove(null)}>
              {t('cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => confirmRemove && handleAction('remove', confirmRemove)}
            >
              {t('removeConfirmAction')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmLeave} onOpenChange={setConfirmLeave}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('leaveConfirmTitle')}</DialogTitle>
            <DialogDescription>{t('leaveConfirmBody')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmLeave(false)} disabled={leaving}>
              {t('cancel')}
            </Button>
            <Button variant="destructive" onClick={handleLeave} disabled={leaving}>
              {leaving ? <Loader2 className="size-4 animate-spin" /> : t('leaveConfirmAction')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}

export function GroupsManager() {
  const t = useTranslations('Settings.groups');
  const { canEditSettings } = useAuth();

  const [groups, setGroups] = useState<WhatsAppGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [manageGroup, setManageGroup] = useState<WhatsAppGroup | null>(null);

  function openManage(group: WhatsAppGroup) {
    setManageGroup(group);
  }

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
                    {group.left_at ? (
                      <span className="text-muted-foreground text-xs italic">
                        {t('youLeft')}
                      </span>
                    ) : (
                      <>
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
                      </>
                    )}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => openManage(group)}
                      aria-label={t('manage')}
                    >
                      <Settings className="size-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {manageGroup && (
        <GroupManageDialog
          group={manageGroup}
          onClose={() => setManageGroup(null)}
          onLeft={() => {
            setManageGroup(null);
            void load();
          }}
          onRenamed={(newName) => {
            setGroups((prev) =>
              prev.map((g) => (g.id === manageGroup.id ? { ...g, name: newName } : g)),
            );
            setManageGroup((prev) => (prev ? { ...prev, name: newName } : prev));
          }}
        />
      )}
    </section>
  );
}
