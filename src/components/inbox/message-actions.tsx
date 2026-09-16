"use client";

import { useState, type ReactNode } from "react";
import {
  Bookmark,
  BookmarkX,
  CornerUpLeft,
  Copy,
  Forward,
  Pencil,
  SmilePlus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Message } from "@/types";
import { useTranslations } from "next-intl";

// WhatsApp's own quick-reaction bar starts with these six. Picking the same
// set keeps the affordance familiar without pulling in a 300KB emoji library.
const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

interface MessageActionsProps {
  message: Message;
  onReply: () => void;
  onReact: (emoji: string) => void;
  /** Ausente = botão de apagar não aparece (mensagem do cliente,
   *  canal não-uazapi, ou sem permissão — decidido pelo chamador). */
  onDelete?: () => void;
  /** Ausente = botão de editar não aparece (mensagem não é de texto,
   *  já apagada, canal não-uazapi, ou sem permissão). */
  onEdit?: () => void;
  /** Ausente = botão de encaminhar não aparece (mensagem apagada, tipo
   *  não encaminhável, ou mídia que já expirou do storage). */
  onForward?: () => void;
  /** O PRÓPRIO marcador do usuário logado nesta mensagem, se houver —
   *  distinto do de outras pessoas, que aparecem como chip no balão
   *  mas não dão a ele controle de editar/remover por aqui. */
  myMarker?: { label: string | null } | null;
  /** Ausente = ação "Marcar" não aparece (sem permissão de escrever
   *  na conversa — mesma regra de `message_markers_insert`). Chamado
   *  ao confirmar o rótulo (pode ser string vazia); `targetUserId`
   *  presente = atribuindo o marcador a um colega, não a si mesmo. */
  onMark?: (label: string, targetUserId?: string) => void;
  /** Presente só quando `myMarker` existe — remove a própria marcação. */
  onUnmark?: () => void;
  /** Colegas de conta pra quem dá pra atribuir um marcador (exclui o
   *  próprio usuário logado — esse caso já é o "Marcar" de sempre).
   *  Vazio/ausente = seletor de destinatário não aparece. */
  accountMembers?: { user_id: string; full_name: string }[];
  children: ReactNode;
}

/**
 * Hover/long-press toolbar wrapper around a `<MessageBubble>`. The bubble
 * itself stays a pure presenter — this component owns the action surface so
 * the bubble's render path is unaffected when the toolbar isn't visible.
 */
export function MessageActions({
  message,
  onReply,
  onReact,
  onDelete,
  onEdit,
  onForward,
  myMarker,
  onMark,
  onUnmark,
  accountMembers,
  children,
}: MessageActionsProps) {
  const t = useTranslations("Inbox.actions");

  // Touch devices have no hover. Long-press fires `contextmenu`; we capture
  // it, suppress the native menu, and pin the toolbar open until the user
  // interacts elsewhere.
  const [touchOpen, setTouchOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [markerOpen, setMarkerOpen] = useState(false);
  const [markerLabel, setMarkerLabel] = useState(myMarker?.label ?? "");
  // `null` = marcando pra mim mesmo (o caso de sempre). Só aparece pra
  // escolher quando ainda não tenho marcador meu nesta mensagem — editar
  // o meu já é uma ação separada de atribuir pra outra pessoa.
  const [targetUserId, setTargetUserId] = useState<string | null>(null);

  const isAgent =
    message.sender_type === "agent" || message.sender_type === "bot";

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setTouchOpen(true);
  };

  const handleCopy = async () => {
    const text = message.content_text ?? "";
    if (!text) {
      toast.error(t("nothingToCopy"));
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("copied"));
    } catch {
      toast.error(t("copyFailed"));
    }
    setTouchOpen(false);
  };

  const handlePickEmoji = (emoji: string) => {
    onReact(emoji);
    setPickerOpen(false);
    setTouchOpen(false);
  };

  const handleReply = () => {
    onReply();
    setTouchOpen(false);
  };

  const handleDelete = () => {
    onDelete?.();
    setTouchOpen(false);
  };

  const handleEdit = () => {
    onEdit?.();
    setTouchOpen(false);
  };

  const handleForward = () => {
    onForward?.();
    setTouchOpen(false);
  };

  const handleMarkSubmit = () => {
    onMark?.(markerLabel, targetUserId ?? undefined);
    setMarkerOpen(false);
    setTouchOpen(false);
  };

  const handleUnmark = () => {
    onUnmark?.();
    setMarkerLabel("");
    setMarkerOpen(false);
    setTouchOpen(false);
  };

  const handleMarkerOpenChange = (open: boolean) => {
    setMarkerOpen(open);
    if (open) {
      // Reabre sempre no estado "pra mim" — trocar de destinatário limpa
      // o rótulo (não faz sentido herdar o texto do meu próprio marcador
      // pro de um colega).
      setTargetUserId(null);
      setMarkerLabel(myMarker?.label ?? "");
    }
  };

  const handleTargetChange = (value: string | null) => {
    const next = value && value !== "me" ? value : null;
    setTargetUserId(next);
    setMarkerLabel(next === null ? (myMarker?.label ?? "") : "");
  };

  // Row alignment lives here (not in MessageBubble) so the `group/actions`
  // hover region matches the bubble's content width — hovering empty space
  // in the row no longer reveals the toolbar.
  return (
    <div
      // Âncora da busca dentro da conversa: é por este atributo que a
      // thread acha a linha da mensagem para rolar até ela.
      data-message-id={message.id}
      className={cn(
        "flex w-full",
        isAgent ? "justify-end" : "justify-start",
      )}
      onContextMenu={handleContextMenu}
      onBlur={() => setTouchOpen(false)}
    >
      {/* `min-w-0` lets this flex child actually respect the 75% cap.
       *  Default `min-width: auto` lets content (a long quote preview,
       *  an unbroken URL) push past the cap and shove the row past
       *  100%, which used to bleed across into the contact-sidebar
       *  area. See issue #165. */}
      <div className="group/actions relative min-w-0 max-w-[75%]">
        {children}
      <div
        data-touch-open={touchOpen || pickerOpen ? "true" : undefined}
        className={cn(
          "absolute -top-3 z-10 flex h-7 items-center gap-0.5 rounded-full border border-border bg-popover/95 px-1 shadow-md backdrop-blur-sm transition-opacity",
          "opacity-0 group-hover/actions:opacity-100 group-focus-within/actions:opacity-100",
          "data-[touch-open=true]:opacity-100",
          isAgent ? "right-3" : "left-3",
        )}
      >
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger
            className="flex h-5 w-5 items-center justify-center rounded-full text-popover-foreground hover:bg-muted hover:text-foreground"
            aria-label={t("react")}
            title={t("react")}
          >
            <SmilePlus className="h-3.5 w-3.5" />
          </PopoverTrigger>
          <PopoverContent
            className="flex w-auto flex-row gap-1 p-1.5"
            sideOffset={6}
          >
            {QUICK_EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => handlePickEmoji(e)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-lg leading-none transition-transform hover:scale-125 hover:bg-muted"
                aria-label={t("reactWith", { emoji: e })}
              >
                {e}
              </button>
            ))}
          </PopoverContent>
        </Popover>
        <button
          type="button"
          onClick={handleReply}
          className="flex h-5 w-5 items-center justify-center rounded-full text-popover-foreground hover:bg-muted hover:text-foreground"
          aria-label={t("reply")}
          title={t("reply")}
        >
          <CornerUpLeft className="h-3.5 w-3.5" />
        </button>
        {onForward && (
          <button
            type="button"
            onClick={handleForward}
            className="flex h-5 w-5 items-center justify-center rounded-full text-popover-foreground hover:bg-muted hover:text-foreground"
            aria-label={t("forward")}
            title={t("forward")}
          >
            <Forward className="h-3.5 w-3.5" />
          </button>
        )}
        {onMark && (
          <Popover open={markerOpen} onOpenChange={handleMarkerOpenChange}>
            <PopoverTrigger
              className={cn(
                "flex h-5 w-5 items-center justify-center rounded-full hover:bg-muted",
                myMarker ? "text-primary" : "text-popover-foreground hover:text-foreground",
              )}
              aria-label={myMarker ? t("editMarker") : t("mark")}
              title={myMarker ? t("editMarker") : t("mark")}
            >
              <Bookmark
                className="h-3.5 w-3.5"
                fill={myMarker ? "currentColor" : "none"}
              />
            </PopoverTrigger>
            <PopoverContent className="w-64 space-y-2 p-3" sideOffset={6}>
              <p className="text-xs font-medium text-foreground">
                {targetUserId
                  ? t("markForTitle")
                  : myMarker
                    ? t("editMarkerTitle")
                    : t("markTitle")}
              </p>
              {/* Só oferece atribuir a outra pessoa quando ainda não
                  tenho marcador meu aqui — editar o meu é uma ação à
                  parte de escolher um destinatário novo. */}
              {!myMarker && accountMembers && accountMembers.length > 0 && (
                <Select
                  value={targetUserId ?? "me"}
                  onValueChange={handleTargetChange}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="me">{t("markForMe")}</SelectItem>
                    {accountMembers.map((m) => (
                      <SelectItem key={m.user_id} value={m.user_id}>
                        {m.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Input
                autoFocus
                value={markerLabel}
                onChange={(e) => setMarkerLabel(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleMarkSubmit()}
                placeholder={t("markLabelPlaceholder")}
                maxLength={60}
              />
              <div className="flex items-center justify-between gap-2">
                {myMarker ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleUnmark}
                    className="text-destructive hover:text-destructive"
                  >
                    <BookmarkX className="h-3.5 w-3.5" />
                    {t("unmark")}
                  </Button>
                ) : (
                  <span />
                )}
                <Button type="button" size="sm" onClick={handleMarkSubmit}>
                  {targetUserId
                    ? t("markFor")
                    : myMarker
                      ? t("saveMarker")
                      : t("mark")}
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        )}
        <button
          type="button"
          onClick={handleCopy}
          className="flex h-5 w-5 items-center justify-center rounded-full text-popover-foreground hover:bg-muted hover:text-foreground"
          aria-label={t("copyText")}
          title={t("copyText")}
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
        {onEdit && (
          <button
            type="button"
            onClick={handleEdit}
            className="flex h-5 w-5 items-center justify-center rounded-full text-popover-foreground hover:bg-muted hover:text-foreground"
            aria-label={t("edit")}
            title={t("edit")}
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            onClick={handleDelete}
            className="flex h-5 w-5 items-center justify-center rounded-full text-popover-foreground hover:bg-muted hover:text-destructive"
            aria-label={t("delete")}
            title={t("delete")}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      </div>
    </div>
  );
}
