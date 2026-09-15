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
  /** Canal da conversa de origem. Dois canais da mesma conta se
   *  comportam como duas contas de WhatsApp independentes — a lista só
   *  mostra (e a rota só aceita) destinos do MESMO canal. `null`/
   *  `undefined` = conta com um canal só ou conversa sem canal fixo;
   *  nesse caso não filtra (não há "outro canal" pra confundir). */
  channelId,
}: {
  messageId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentConversationId?: string;
  channelId?: string | null;
}) {
  const t = useTranslations("Inbox.forward");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSearch("");
    setSelected(new Set());
    setLoading(true);

    let cancelled = false;
    (async () => {
      const supabase = createClient();
      let query = supabase
        .from("conversations")
        .select(CONVERSATION_SELECT)
        .order("last_message_at", { ascending: false })
        .limit(200);
      // Mesmo canal da origem — ver o comentário do prop `channelId`.
      if (channelId) query = query.eq("channel_id", channelId);
      const { data, error } = await query;
      if (cancelled) return;
      if (error) {
        console.error("[ForwardDialog] load error:", error.message);
        toast.error(t("loadError"));
      } else {
        setConversations(normalizeConversations(data ?? []));
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [open, t, channelId]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return conversations
      .filter((c) => c.id !== currentConversationId)
      // Defesa extra além do filtro já aplicado na consulta acima —
      // mesmo canal da origem, nunca mistura entre canais da conta.
      .filter((c) => !channelId || c.channel_id === channelId)
      // Grupo do qual o número já saiu não aceita envio — não faz
      // sentido oferecer como destino.
      .filter((c) => !c.group?.left_at)
      .filter((c) => {
        if (!query) return true;
        const name = conversationLabel(c, "").toLowerCase();
        const phone = (c.contact?.phone ?? "").toLowerCase();
        return name.includes(query) || phone.includes(query);
      });
  }, [conversations, search, currentConversationId, channelId]);

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
        body: JSON.stringify({ conversationIds: Array.from(selected) }),
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
