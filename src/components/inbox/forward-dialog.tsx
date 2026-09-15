"use client";

// ============================================================
// ForwardDialog — "Encaminhar para", espelhando o WhatsApp.
//
// Lista as conversas mais recentes (individuais E grupos), com busca
// por nome/telefone e seleção múltipla até o limite. O limite de 5 é
// o mesmo do WhatsApp, e existe pelo mesmo motivo: encaminhar a mesma
// mensagem para dezenas de chats de uma vez é o padrão que leva o
// número ao banimento. A rota tem o mesmo teto — aqui é só para o
// usuário enxergar o limite antes de tentar.
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { Forward, Loader2, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { CONVERSATION_SELECT, normalizeConversations } from "@/lib/inbox/conversations";
import { channelColor } from "@/lib/whatsapp/channel-color";
import { resolveChannelPhone } from "@/lib/whatsapp/channel-identity";
import { cn } from "@/lib/utils";
import type { Conversation } from "@/types";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";

const MAX_DESTINATIONS = 5;

function conversationLabel(conversation: Conversation, fallback: string): string {
  return (
    conversation.group?.name ||
    conversation.contact?.name ||
    conversation.contact?.phone ||
    fallback
  );
}

export function ForwardDialog({
  messageId,
  open,
  onOpenChange,
  /** Conversa de onde a mensagem saiu — some da lista, igual ao
   *  WhatsApp, que não oferece encaminhar para o próprio chat. */
  currentConversationId,
  /** Canal (resolvido, já com fallback pro padrão da conta quando a
   *  conversa não tem um) de onde a mensagem saiu. Dois canais só são
   *  "contas independentes" quando o TELEFONE é diferente — a lista
   *  resolve o telefone de cada canal e compara por ele, nunca pelo id
   *  bruto, porque recriar a instância UAZAPI do mesmo número não pode
   *  virar um canal novo pra este efeito (ver channel-identity.ts).
   *  `null`/`undefined` = conta sem canal nenhum; nesse caso não filtra. */
  channelId,
  /** Rótulo de exibição desse canal (nome ou telefone) — mostrado no
   *  topo do diálogo pra deixar claro por qual número o encaminhamento
   *  vai sair, pedido explícito do usuário quando há mais de um canal. */
  channelDisplayLabel,
}: {
  messageId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentConversationId?: string;
  channelId?: string | null;
  channelDisplayLabel?: string;
}) {
  const t = useTranslations("Inbox.forward");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [phoneByChannelId, setPhoneByChannelId] = useState<Map<string, string | null>>(
    new Map(),
  );
  const [defaultChannelId, setDefaultChannelId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!open) return;
    setSearch("");
    setSelected(new Set());
    setNote("");
    setLoading(true);

    let cancelled = false;
    (async () => {
      const supabase = createClient();
      // Canais da conta (id + telefone) e conversas rodam em paralelo —
      // o filtro por telefone acontece depois, em memória, porque
      // comparar telefone exige resolver canal-a-canal (mesma lógica
      // da rota, ver channel-identity.ts).
      const [channelsRes, conversationsRes] = await Promise.all([
        supabase
          .from("whatsapp_channels")
          .select("id, phone_e164")
          .order("created_at", { ascending: true }),
        supabase
          .from("conversations")
          .select(CONVERSATION_SELECT)
          .order("last_message_at", { ascending: false })
          .limit(200),
      ]);
      if (cancelled) return;

      if (channelsRes.error) {
        console.error("[ForwardDialog] channels load error:", channelsRes.error.message);
      } else {
        const rows = channelsRes.data ?? [];
        setPhoneByChannelId(
          new Map(rows.map((c) => [c.id as string, c.phone_e164 as string | null])),
        );
        // Já vem ordenado por created_at ascendente — o primeiro é o
        // canal padrão da conta, mesma definição de resolveDefaultChannelId.
        setDefaultChannelId((rows[0]?.id as string | undefined) ?? null);
      }

      if (conversationsRes.error) {
        console.error("[ForwardDialog] load error:", conversationsRes.error.message);
        toast.error(t("loadError"));
      } else {
        setConversations(normalizeConversations(conversationsRes.data ?? []));
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [open, t]);

  const sourcePhone = useMemo(
    () => resolveChannelPhone(channelId ?? null, phoneByChannelId, defaultChannelId),
    [channelId, phoneByChannelId, defaultChannelId],
  );

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return conversations
      .filter((c) => c.id !== currentConversationId)
      // Mesmo NÚMERO da origem — nunca mistura entre canais/contas
      // independentes. Resolvido por telefone, não por id de canal.
      .filter(
        (c) =>
          !sourcePhone ||
          resolveChannelPhone(c.channel_id ?? null, phoneByChannelId, defaultChannelId) ===
            sourcePhone,
      )
      // Grupo do qual o número já saiu não aceita envio — não faz
      // sentido oferecer como destino.
      .filter((c) => !c.group?.left_at)
      .filter((c) => {
        if (!query) return true;
        const name = conversationLabel(c, "").toLowerCase();
        const phone = (c.contact?.phone ?? "").toLowerCase();
        return name.includes(query) || phone.includes(query);
      });
  }, [conversations, search, currentConversationId, sourcePhone, phoneByChannelId, defaultChannelId]);

  function toggle(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) {
        if (next.size >= MAX_DESTINATIONS) return prev;
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  async function handleSend() {
    if (!messageId || selected.size === 0) return;
    setSending(true);
    try {
      const res = await fetch(`/api/whatsapp/messages/${messageId}/forward`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationIds: Array.from(selected),
          note: note.trim() || undefined,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || t("error"));
        return;
      }

      const sent = (payload.sent as number | undefined) ?? 0;
      const failed = selected.size - sent;
      if (sent > 0) toast.success(t("success", { count: sent }));
      // Falha parcial precisa aparecer: sem isto, um destino que não
      // recebeu passaria despercebido atrás do toast de sucesso.
      if (failed > 0) toast.error(t("partialFailure", { count: failed }));
      onOpenChange(false);
    } catch (err) {
      console.error("[ForwardDialog] send error:", err);
      toast.error(t("error"));
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !sending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {t("selectedCount", { count: selected.size, max: MAX_DESTINATIONS })}
          </DialogDescription>
          {channelDisplayLabel && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span
                className={cn(
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  // Pelo telefone já resolvido, não pelo id do canal —
                  // mesma cor que a lista/cabeçalho mostram pro mesmo número.
                  sourcePhone ? channelColor(sourcePhone).dot : "bg-muted-foreground",
                )}
              />
              {t("usingChannel", { label: channelDisplayLabel })}
            </p>
          )}
        </DialogHeader>

        <div className="space-y-2">
          <div className="relative">
            <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("searchPlaceholder")}
              className="pl-8"
              disabled={sending}
            />
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="size-5 animate-spin text-primary" />
            </div>
          ) : visible.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t("empty")}
            </p>
          ) : (
            <ScrollArea className="h-72 rounded-md border border-border">
              <div className="divide-y divide-border">
                {visible.map((conversation) => {
                  const checked = selected.has(conversation.id);
                  const label = conversationLabel(conversation, t("unknown"));
                  const avatarUrl =
                    conversation.group?.avatar_url ||
                    conversation.contact?.avatar_url ||
                    undefined;
                  return (
                    <label
                      key={conversation.id}
                      className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm hover:bg-muted"
                    >
                      <Checkbox
                        checked={checked}
                        disabled={
                          sending || (!checked && selected.size >= MAX_DESTINATIONS)
                        }
                        onCheckedChange={(next) =>
                          toggle(conversation.id, next === true)
                        }
                      />
                      <Avatar className="size-8 shrink-0">
                        {avatarUrl ? <AvatarImage src={avatarUrl} alt={label} /> : null}
                        <AvatarFallback className="bg-primary/10 text-xs text-primary">
                          {label.charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-foreground">
                          {label}
                        </span>
                        {conversation.contact?.phone && (
                          <span className="block truncate text-xs text-muted-foreground">
                            {conversation.contact.phone}
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            </ScrollArea>
          )}

          {/* Opcional, igual ao WhatsApp: manda como mensagem comum
              separada, DEPOIS da encaminhada — nunca junto na mesma
              bolha (não é uma legenda da mensagem original). */}
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("notePlaceholder")}
            disabled={sending}
            rows={2}
            className="resize-none text-sm"
          />
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={sending}
          >
            {t("cancel")}
          </Button>
          <Button onClick={handleSend} disabled={sending || selected.size === 0}>
            {sending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Forward className="size-4" />
            )}
            {t("send")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
