'use client';

// ============================================================
// ChannelsManager — Settings → WhatsApp → UAZAPI channels
//
// Manages the account's UAZAPI (unofficial WhatsApp API) channels:
// list, add, connect by QR Code, remove, and copy the webhook URL
// for diagnostics. The Meta channel keeps its own dedicated form in
// `whatsapp-config.tsx` — this component only ever creates/lists
// `provider === 'uazapi'` rows, filtering the shared
// `GET /api/whatsapp/channels` response down to those.
//
// Polling contract: while the connect dialog is open, `GET
// .../status` is polled every 3s to detect connection and pick up a
// rotated QR Code. Everything — the poll interval AND the 2-minute
// QR timeout — is torn down in the effect's cleanup function, so
// closing the dialog (or unmounting) always stops both timers. This
// is the one behavior a regression here would be invisible for: a
// leaked interval keeps hitting the API forever with nothing in the
// UI showing it.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Copy,
  Loader2,
  Plus,
  QrCode,
  Trash2,
  Wifi,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';
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
import { Label } from '@/components/ui/label';
import { SettingsPanelHead } from './settings-panel-head';
import type { PublicChannel } from '@/app/api/whatsapp/channels/route';

const POLL_INTERVAL_MS = 3000;
// The UAZAPI-documented lifetime of a QR Code before it must be
// regenerated.
const QR_TIMEOUT_MS = 2 * 60 * 1000;

/** UAZAPI's `/instance/connect` may return either a full data URI or
 * bare base64 — normalize to something an <img> can render either
 * way. */
function normalizeQrImage(raw: string): string {
  return raw.startsWith('data:') ? raw : `data:image/png;base64,${raw}`;
}

function statusBadgeClass(status: PublicChannel['status']): string {
  switch (status) {
    case 'connected':
      return 'border-emerald-700/50 bg-emerald-950/30 text-emerald-300';
    case 'connecting':
      return 'border-amber-700/50 bg-amber-950/30 text-amber-300';
    case 'hibernated':
      return 'border-border bg-muted text-muted-foreground';
    default:
      return 'border-red-900/50 bg-red-950/30 text-red-300';
  }
}

export function ChannelsManager() {
  const t = useTranslations('Settings.whatsapp.channels');

  const [channels, setChannels] = useState<PublicChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [copyingId, setCopyingId] = useState<string | null>(null);

  const [connectChannel, setConnectChannel] = useState<PublicChannel | null>(
    null,
  );
  const [connectOpen, setConnectOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/whatsapp/channels', { cache: 'no-store' });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || t('loadError'));
        return;
      }
      const all = (payload.channels ?? []) as PublicChannel[];
      setChannels(all.filter((c) => c.provider === 'uazapi'));
    } catch (err) {
      console.error('[ChannelsManager] load error:', err);
      toast.error(t('networkError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  function handleConnect(channel: PublicChannel) {
    setConnectChannel(channel);
    setConnectOpen(true);
  }

  async function handleRemove(channel: PublicChannel) {
    const confirmed = window.confirm(
      t('removeConfirm', { label: channel.label || channel.phone_e164 || t('unnamed') }),
    );
    if (!confirmed) return;

    setRemovingId(channel.id);
    try {
      const res = await fetch(`/api/whatsapp/channels/${channel.id}`, {
        method: 'DELETE',
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || t('removeError'));
        return;
      }
      toast.success(t('removeSuccess'));
      setChannels((prev) => prev.filter((c) => c.id !== channel.id));
    } catch (err) {
      console.error('[ChannelsManager] remove error:', err);
      toast.error(t('networkError'));
    } finally {
      setRemovingId(null);
    }
  }

  async function handleCopyWebhookUrl(channel: PublicChannel) {
    setCopyingId(channel.id);
    try {
      const res = await fetch(`/api/whatsapp/channels/${channel.id}/webhook-url`);
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || t('webhookFetchError'));
        return;
      }
      await navigator.clipboard.writeText(payload.webhookUrl as string);
      toast.success(t('copyWebhookSuccess'));
    } catch (err) {
      console.error('[ChannelsManager] copy webhook url error:', err);
      toast.error(t('copyWebhookError'));
    } finally {
      setCopyingId(null);
    }
  }

  return (
    <section className="animate-in fade-in-50 space-y-4 duration-200">
      <SettingsPanelHead
        title={t('title')}
        description={t('description')}
        action={
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="size-4" />
            {t('addChannel')}
          </Button>
        }
      />

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="text-primary size-5 animate-spin" />
        </div>
      ) : channels.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-8 text-center">
            <QrCode className="text-muted-foreground size-6" />
            <p className="text-muted-foreground mt-2 text-sm">{t('empty')}</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-border divide-y">
              {channels.map((channel) => (
                <li
                  key={channel.id}
                  className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-foreground truncate text-sm font-medium">
                        {channel.label || t('unnamed')}
                      </span>
                      <Badge className="border-border bg-muted text-muted-foreground text-[10px] tracking-wide uppercase">
                        UAZAPI
                      </Badge>
                      <Badge
                        className={`text-[10px] tracking-wide uppercase ${statusBadgeClass(channel.status)}`}
                      >
                        {t(`status.${channel.status}`)}
                      </Badge>
                    </div>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      {channel.phone_e164 ? `+${channel.phone_e164}` : t('noPhoneYet')}
                    </p>
                    {channel.last_error && (
                      <p className="mt-1.5 flex items-start gap-1.5 text-xs text-amber-300">
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                        <span>{channel.last_error}</span>
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2 sm:shrink-0">
                    {channel.status !== 'connected' && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleConnect(channel)}
                        className="border-border text-foreground hover:bg-muted"
                      >
                        <Wifi className="size-3.5" />
                        {t('connect')}
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleCopyWebhookUrl(channel)}
                      disabled={copyingId === channel.id}
                      className="border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                    >
                      {copyingId === channel.id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Copy className="size-3.5" />
                      )}
                      {t('copyWebhook')}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleRemove(channel)}
                      disabled={removingId === channel.id}
                      className="border-red-900/50 bg-red-500/10 text-red-300 hover:border-red-500/60 hover:bg-red-500/20 hover:text-red-200"
                    >
                      {removingId === channel.id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="size-3.5" />
                      )}
                      {t('remove')}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <AddChannelDialog open={addOpen} onOpenChange={setAddOpen} onCreated={load} />

      <ConnectDialog
        channel={connectChannel}
        open={connectOpen}
        onOpenChange={setConnectOpen}
        onConnected={load}
      />
    </section>
  );
}

// ------------------------------------------------------------
// Add channel — label + subdomain/URL + token, verified server-side
// against the live instance before the row is saved.
// ------------------------------------------------------------

function AddChannelDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const t = useTranslations('Settings.whatsapp.channels');
  const [label, setLabel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [token, setToken] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setLabel('');
    setBaseUrl('');
    setToken('');
    setSubmitting(false);
  }

  async function handleCreate() {
    if (!baseUrl.trim() || !token.trim()) {
      toast.error(t('fieldsRequired'));
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/whatsapp/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'uazapi',
          label: label.trim() || undefined,
          baseUrl: baseUrl.trim(),
          token: token.trim(),
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || t('addError'));
        return;
      }
      toast.success(t('addSuccess'));
      reset();
      onOpenChange(false);
      onCreated();
    } catch (err) {
      console.error('[AddChannelDialog] create error:', err);
      toast.error(t('networkError'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="border-border bg-popover sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">
            {t('addTitle')}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {t('addDesc')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="uazapi-label" className="text-muted-foreground">
              {t('labelLabel')}
              <span className="ml-1 text-muted-foreground">{t('optional')}</span>
            </Label>
            <Input
              id="uazapi-label"
              value={label}
              maxLength={80}
              placeholder={t('labelPlaceholder')}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="uazapi-base-url" className="text-muted-foreground">
              {t('baseUrlLabel')}
            </Label>
            <Input
              id="uazapi-base-url"
              value={baseUrl}
              placeholder={t('baseUrlPlaceholder')}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
            <p className="text-muted-foreground text-xs">{t('baseUrlHint')}</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="uazapi-token" className="text-muted-foreground">
              {t('tokenLabel')}
            </Label>
            <Input
              id="uazapi-token"
              type="password"
              value={token}
              placeholder={t('tokenPlaceholder')}
              onChange={(e) => setToken(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              reset();
              onOpenChange(false);
            }}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            {t('cancel')}
          </Button>
          <Button onClick={handleCreate} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {t('saving')}
              </>
            ) : (
              t('save')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------
// Connect dialog — starts the QR flow and polls status every 3s.
//
// Kept always-mounted by the parent (controlled purely by `open`)
// rather than conditionally rendered, so the tear-down logic lives
// entirely in this one effect's cleanup regardless of how the
// dialog primitive itself handles mount/unmount on close.
// ------------------------------------------------------------

function ConnectDialog({
  channel,
  open,
  onOpenChange,
  onConnected,
}: {
  channel: PublicChannel | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected: () => void;
}) {
  const t = useTranslations('Settings.whatsapp.channels');
  const [qrcode, setQrcode] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(true);

  useEffect(() => {
    if (!open || !channel) {
      setQrcode(null);
      setQrLoading(true);
      return;
    }

    const channelId = channel.id;
    let cancelled = false;

    async function startConnect() {
      setQrLoading(true);
      try {
        const res = await fetch(`/api/whatsapp/channels/${channelId}/connect`, {
          method: 'POST',
        });
        const payload = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          toast.error(payload.error || t('connectError'));
          onOpenChange(false);
          return;
        }
        setQrcode((payload.qrcode as string | null) ?? null);
      } catch (err) {
        console.error('[ConnectDialog] connect error:', err);
        if (!cancelled) {
          toast.error(t('networkError'));
          onOpenChange(false);
        }
      } finally {
        if (!cancelled) setQrLoading(false);
      }
    }

    async function pollStatus() {
      try {
        const res = await fetch(`/api/whatsapp/channels/${channelId}/status`, {
          cache: 'no-store',
        });
        const payload = await res.json().catch(() => ({}));
        if (cancelled || !res.ok) return;

        if (payload.qrcode) setQrcode(payload.qrcode as string);

        if (payload.status === 'connected') {
          clearInterval(pollId);
          clearTimeout(timeoutId);
          toast.success(t('connectedSuccess'));
          onConnected();
          onOpenChange(false);
        }
      } catch (err) {
        console.error('[ConnectDialog] status poll error:', err);
      }
    }

    void startConnect();
    const pollId = setInterval(() => void pollStatus(), POLL_INTERVAL_MS);
    const timeoutId = setTimeout(() => {
      clearInterval(pollId);
      onOpenChange(false);
      toast(t('qrExpiredTitle'), {
        description: t('qrExpiredDesc'),
        duration: 10000,
        action: {
          label: t('regenerateQr'),
          onClick: () => onOpenChange(true),
        },
      });
    }, QR_TIMEOUT_MS);

    // Cleanup — runs on close (open → false), on unmount, and before
    // every re-run of this effect. Both timers are always cleared
    // here; nothing keeps polling once this fires.
    return () => {
      cancelled = true;
      clearInterval(pollId);
      clearTimeout(timeoutId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, channel?.id]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-popover sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">
            {t('qrTitle')}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {t('qrDesc')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center justify-center gap-3 py-4">
          {qrLoading ? (
            <Loader2 className="text-primary size-8 animate-spin" />
          ) : qrcode ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={normalizeQrImage(qrcode)}
              alt={t('qrAlt')}
              className="size-56 rounded-md border border-border bg-white p-2"
            />
          ) : (
            <p className="text-muted-foreground text-sm">{t('qrUnavailable')}</p>
          )}
          <p className="text-muted-foreground text-center text-xs">{t('qrHint')}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
