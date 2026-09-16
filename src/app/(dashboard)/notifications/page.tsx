"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { Notification, MessageMarker } from "@/types";
import { Bell, Bookmark, CheckCheck, Loader2, UserPlus } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ko, ptBR } from "date-fns/locale";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  CONVERSATION_SELECT,
  conversationDisplayName,
  normalizeConversations,
} from "@/lib/inbox/conversations";
import {
  groupMarkersByConversation,
  type MarkerWithContext,
} from "@/lib/inbox/message-markers";

// `formatDistanceToNow` defaults to English; map the app's configured
// locale to the matching date-fns one. `en` needs no entry — that's
// date-fns' own default.
const DATE_FNS_LOCALES = { pt: ptBR, ko };

// Icon per notification type. Only one type exists today
// (conversation_assigned) but this keeps future types a one-line add.
const TYPE_ICON: Record<Notification["type"], typeof Bell> = {
  conversation_assigned: UserPlus,
};

export default function NotificationsPage() {
  const router = useRouter();
  const t = useTranslations("Notifications");
  const locale = useLocale();
  const dateFnsLocale = DATE_FNS_LOCALES[locale as keyof typeof DATE_FNS_LOCALES];
  const { accountId, user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[] | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  // ---- Meus marcadores -------------------------------------------
  // Ver docs/superpowers/specs/2026-09-16-marcadores-de-mensagem-design.md.
  // Fica em Notificações (não na Caixa de Entrada) por decisão do
  // cliente: quando o escopo de conversas restrito for pra produção,
  // Notificações vai ser a ÚNICA tela que aquele usuário enxerga —
  // colocar os marcadores aqui garante que ele também tenha sua fila
  // pessoal.
  const [markerGroups, setMarkerGroups] = useState<
    ReturnType<typeof groupMarkersByConversation> | null
  >(null);
  const [markersError, setMarkersError] = useState<string | null>(null);

  const loadMarkers = useCallback(async () => {
    if (!user) return;
    const supabase = createClient();

    const { data: markerRows, error: markerErr } = await supabase
      .from("message_markers")
      .select("*")
      .eq("created_by", user.id)
      .order("created_at", { ascending: false });

    if (markerErr) {
      setMarkersError(markerErr.message);
      return;
    }
    const rows = (markerRows ?? []) as MessageMarker[];
    if (rows.length === 0) {
      setMarkerGroups([]);
      return;
    }

    // Duas consultas em vez de um embed profundo (message_markers ->
    // conversations -> contacts/whatsapp_groups): o schema cache do
    // PostgREST fica obsoleto logo após migrações e derruba embeds
    // assim com PGRST200 — mesmo motivo documentado em
    // `CONVERSATION_SELECT` (src/lib/inbox/conversations.ts).
    const conversationIds = [...new Set(rows.map((m) => m.conversation_id))];
    const messageIds = [...new Set(rows.map((m) => m.message_id))];

    const [conversationsRes, messagesRes] = await Promise.all([
      supabase.from("conversations").select(CONVERSATION_SELECT).in("id", conversationIds),
      supabase.from("messages").select("id, content_text").in("id", messageIds),
    ]);

    if (conversationsRes.error) {
      setMarkersError(conversationsRes.error.message);
      return;
    }

    const conversations = normalizeConversations(conversationsRes.data ?? []);
    const conversationById = new Map(conversations.map((c) => [c.id, c]));
    const previewById = new Map(
      (messagesRes.data ?? []).map((m) => [m.id as string, m.content_text as string | null]),
    );

    const enriched: MarkerWithContext[] = rows.map((m) => ({
      id: m.id,
      conversationId: m.conversation_id,
      messageId: m.message_id,
      label: m.label,
      createdAt: m.created_at,
      contactName: conversationDisplayName(conversationById.get(m.conversation_id) ?? {}),
      messagePreview: previewById.get(m.message_id) ?? null,
    }));

    setMarkerGroups(groupMarkersByConversation(enriched));
  }, [user]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadMarkers();
  }, [loadMarkers]);

  const handleMarkerClick = useCallback(
    (conversationId: string, messageId: string) => {
      router.push(`/inbox?c=${conversationId}&m=${messageId}`);
    },
    [router],
  );

  const load = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();
    const { data, error: fetchErr } = await supabase
      .from("notifications")
      .select("*")
      .eq("account_id", accountId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (fetchErr) {
      setError(fetchErr.message);
      return;
    }
    setNotifications((data ?? []) as Notification[]);
  }, [accountId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  // Realtime — new assignments appear without a refresh, and a
  // "mark all read" fired from another tab/device stays in sync here.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("notifications-page")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications" },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const row = payload.new as Notification;
            setNotifications((prev) => {
              if (!prev) return [row];
              if (prev.some((n) => n.id === row.id)) return prev;
              return [row, ...prev];
            });
          } else if (payload.eventType === "UPDATE") {
            const row = payload.new as Notification;
            setNotifications((prev) =>
              prev?.map((n) => (n.id === row.id ? { ...n, ...row } : n)) ??
              prev,
            );
          } else if (payload.eventType === "DELETE") {
            const oldRow = payload.old as Partial<Notification>;
            setNotifications(
              (prev) => prev?.filter((n) => n.id !== oldRow.id) ?? prev,
            );
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const markRead = useCallback(
    async (id: string) => {
      // Optimistic — the row is already visually "read" by the time the
      // request lands, so the UI doesn't wait on the round-trip.
      setNotifications(
        (prev) =>
          prev?.map((n) =>
            n.id === id && !n.read_at
              ? { ...n, read_at: new Date().toISOString() }
              : n,
          ) ?? prev,
      );
      const supabase = createClient();
      const { error: updateErr } = await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", id)
        .is("read_at", null);
      if (updateErr) {
        toast.error(t("markReadFailed"));
        load();
      }
    },
    [load, t],
  );

  const handleClick = useCallback(
    (n: Notification) => {
      if (!n.read_at) markRead(n.id);
      if (n.conversation_id) {
        router.push(`/inbox?c=${n.conversation_id}`);
      }
    },
    [markRead, router],
  );

  const unreadIds = notifications?.filter((n) => !n.read_at).map((n) => n.id) ?? [];

  const markAllRead = useCallback(async () => {
    if (unreadIds.length === 0) return;
    setMarkingAll(true);
    const now = new Date().toISOString();
    setNotifications(
      (prev) => prev?.map((n) => (n.read_at ? n : { ...n, read_at: now })) ?? prev,
    );
    const supabase = createClient();
    const { error: updateErr } = await supabase
      .from("notifications")
      .update({ read_at: now })
      .is("read_at", null);
    setMarkingAll(false);
    if (updateErr) {
      toast.error(t("markAllReadFailed"));
      load();
    }
  }, [unreadIds.length, load, t]);

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" onClick={() => window.location.reload()}>
          {t("retry")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      <Tabs defaultValue="notifications">
        <TabsList>
          <TabsTrigger value="notifications">{t("tabNotifications")}</TabsTrigger>
          <TabsTrigger value="markers">
            {t("tabMarkers")}
            {markerGroups && markerGroups.length > 0 && (
              <span className="ml-1.5 rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground">
                {markerGroups.reduce((sum, g) => sum + g.markers.length, 0)}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="notifications" className="space-y-2 mt-4">
          <div className="flex items-center justify-end">
            <Button
              variant="outline"
              size="sm"
              disabled={unreadIds.length === 0 || markingAll}
              onClick={markAllRead}
            >
              {markingAll ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCheck className="h-4 w-4" />
              )}
              {t("markAllRead")}
            </Button>
          </div>

          {notifications === null ? (
            <div className="flex h-48 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/40">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
                <Bell className="h-6 w-6 text-primary" />
              </div>
              <p className="mt-3 text-sm font-medium text-foreground">
                {t("emptyTitle")}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("emptySubtitle")}
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {notifications.map((n) => {
                const Icon = TYPE_ICON[n.type] ?? Bell;
                const isUnread = !n.read_at;
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => handleClick(n)}
                      className={cn(
                        "flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-colors",
                        isUnread
                          ? "border-primary/30 bg-primary/5 hover:border-primary/50"
                          : "border-border bg-card hover:border-border/70",
                      )}
                    >
                      <div
                        className={cn(
                          "flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg",
                          isUnread ? "bg-primary/15" : "bg-muted",
                        )}
                        aria-hidden
                      >
                        <Icon
                          className={cn(
                            "h-5 w-5",
                            isUnread ? "text-primary" : "text-muted-foreground",
                          )}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "truncate text-sm font-semibold",
                              isUnread ? "text-foreground" : "text-muted-foreground",
                            )}
                          >
                            {n.title}
                          </span>
                          {isUnread && (
                            <span
                              aria-label={t("unread")}
                              className="h-2 w-2 flex-shrink-0 rounded-full bg-primary"
                            />
                          )}
                        </div>
                        {n.body && (
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {n.body}
                          </p>
                        )}
                        <p className="mt-1 text-[11px] text-muted-foreground/70">
                          {formatDistanceToNow(new Date(n.created_at), {
                            addSuffix: true,
                            locale: dateFnsLocale,
                          })}
                        </p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="markers" className="space-y-3 mt-4">
          {markersError ? (
            <p className="text-sm text-destructive">{markersError}</p>
          ) : markerGroups === null ? (
            <div className="flex h-48 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : markerGroups.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/40">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
                <Bookmark className="h-6 w-6 text-primary" />
              </div>
              <p className="mt-3 text-sm font-medium text-foreground">
                {t("markersEmptyTitle")}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("markersEmptySubtitle")}
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {markerGroups.map((group) => (
                <li
                  key={group.conversationId}
                  className="rounded-xl border border-border bg-card p-4"
                >
                  <p className="mb-2 text-sm font-semibold text-foreground">
                    {group.contactName || t("unknownContact")}
                  </p>
                  <ul className="space-y-1.5">
                    {group.markers.map((marker) => (
                      <li key={marker.id}>
                        <button
                          type="button"
                          onClick={() => handleMarkerClick(marker.conversationId, marker.messageId)}
                          className="flex w-full items-start gap-2 rounded-lg border border-transparent px-2 py-1.5 text-left transition-colors hover:border-border hover:bg-muted/60"
                        >
                          <Bookmark className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-medium text-foreground">
                              {marker.label?.trim() || t("markersUnlabeled")}
                            </p>
                            {marker.messagePreview && (
                              <p className="truncate text-[11px] text-muted-foreground">
                                {marker.messagePreview}
                              </p>
                            )}
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
