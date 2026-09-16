"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { splitHighlight } from "@/lib/inbox/message-search";
import { canRemoveMarker, markerChipText } from "@/lib/inbox/message-markers";
import type { Message, MessageMarker, MessageReaction } from "@/types";
import {
  Clock,
  Check,
  CheckCheck,
  XCircle,
  FileText,
  MapPin,
  LayoutTemplate,
  ImageOff,
  CornerDownLeft,
  Sparkles,
  Forward,
  Bookmark,
  X,
} from "lucide-react";
import { format } from "date-fns";
import { ReplyQuote } from "./reply-quote";
import { MessageReactions } from "./message-reactions";
import { InteractivePreview } from "@/components/interactive/interactive-preview";
import { useTranslations } from "next-intl";

interface MessageBubbleProps {
  message: Message;
  /** Pre-computed quote info for messages that reply to another. */
  reply?: { authorLabel: string; preview: string } | null;
  reactions?: MessageReaction[];
  currentUserId?: string;
  onToggleReaction?: (emoji: string) => void;
  /** De `shouldShowAuthor` — true só quando o operador muda em relação
   * à mensagem anterior (ver `message-author.ts`). */
  showAuthor?: boolean;
  /** Nome do autor a estampar; ausente (automação/broadcast/API) cai
   * no rótulo "Sistema". */
  authorName?: string;
  /** Termo da busca dentro da conversa; vazio = sem destaque. */
  highlightQuery?: string;
  /** True na ocorrência "atual" da busca — ganha um anel para o
   *  atendente saber em qual das ocorrências ele está. */
  highlightActive?: boolean;
  /** Marcadores desta mensagem (de qualquer pessoa da conta) — ver
   *  docs/superpowers/specs/2026-09-16-marcadores-de-mensagem-design.md. */
  markers?: MessageMarker[];
  /** Resolve o id de quem marcou pro nome de exibição. */
  markerAuthorName?: (userId: string) => string;
  /** True quando o usuário logado é admin/owner — junto com
   *  `currentUserId`, decide (via `canRemoveMarker`) em quais chips o
   *  "×" aparece: só o dono do marcador, ou admin+. */
  isAccountAdmin?: boolean;
  onRemoveMarker?: (markerCreatedBy: string) => void;
}

function StatusIcon({ status }: { status: Message["status"] }) {
  switch (status) {
    case "sending":
      return <Clock className="h-3 w-3 text-muted-foreground" />;
    case "sent":
      return <Check className="h-3 w-3 text-muted-foreground" />;
    case "delivered":
      return <CheckCheck className="h-3 w-3 text-muted-foreground" />;
    case "read":
      return <CheckCheck className="h-3 w-3 text-blue-400" />;
    case "failed":
      return <XCircle className="h-3 w-3 text-red-400" />;
    default:
      return null;
  }
}

function MediaUnavailable({ label, t }: { label: string, t: ReturnType<typeof useTranslations> }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      <ImageOff className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span>{t("unavailable", { label })}</span>
    </div>
  );
}

function MediaImage({ url, alt }: { url: string; alt: string }) {
  const t = useTranslations("Inbox.bubble");
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  const loadImage = useCallback(async () => {
    if (!url) return;

    // Proxy URLs need auth fetch to create blob URL
    if (url.startsWith("/api/whatsapp/media/")) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error("Failed to load media");
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        setSrc(blobUrl);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    } else {
      setSrc(url);
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    loadImage();
    return () => {
      if (src?.startsWith("blob:")) {
        URL.revokeObjectURL(src);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadImage]);

  // Listener só existe enquanto a sobreposição está aberta -- evita
  // capturar Escape globalmente para toda mensagem de imagem no chat.
  useEffect(() => {
    if (!expanded) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [expanded]);

  if (error) {
    return (
      <div className="flex h-40 w-60 items-center justify-center rounded-lg bg-muted">
        <ImageOff className="h-8 w-8 text-muted-foreground" />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-40 w-60 items-center justify-center rounded-lg bg-muted">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="block cursor-zoom-in"
        aria-label={t("openMedia")}
      >
        <img
          src={src ?? ""}
          alt={alt}
          className="max-h-64 max-w-60 rounded-lg object-contain"
          onError={() => setError(true)}
        />
      </button>
      {expanded && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setExpanded(false)}
          role="dialog"
          aria-modal="true"
        >
          <img
            src={src ?? ""}
            alt={alt}
            className="max-h-full max-w-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <a
            href={src ?? ""}
            download
            onClick={(e) => e.stopPropagation()}
            className="absolute right-4 top-4 rounded-lg bg-white/90 px-3 py-1.5 text-sm font-medium text-black"
          >
            {t("downloadMedia")}
          </a>
        </div>
      )}
    </>
  );
}

/**
 * Renderiza `content_text`/legenda distinguindo o trecho ENCAMINHADO
 * do trecho que o atendente digitou junto (`forwarded_note`), pedido
 * do usuário depois de ver os dois num balão só sem diferença nenhuma
 * — "gera confusão". O WhatsApp real recebeu tudo como uma string só
 * (não dá pra colorir texto lá), então a separação é só na nossa
 * própria bolha: usa o MESMO estilo de bloco citado que already existe
 * pra resposta (`reply-quote.tsx`) pro trecho encaminhado, e texto
 * normal pra nota — a leitura fica "isto veio de outro lugar" + "isto
 * eu escrevi agora", igual a intenção visual do WhatsApp de verdade.
 */
/**
 * Texto com o trecho buscado destacado (busca dentro da conversa). Sem
 * busca ativa, renderiza o texto puro — nenhum nó extra no caminho
 * normal, que é a esmagadora maioria dos renders.
 */
function Highlighted({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;
  return (
    <>
      {splitHighlight(text, query).map((chunk, i) =>
        chunk.match ? (
          <mark
            key={i}
            className="rounded-sm bg-amber-300 px-0.5 text-foreground dark:bg-amber-400/80"
          >
            {chunk.text}
          </mark>
        ) : (
          <span key={i}>{chunk.text}</span>
        ),
      )}
    </>
  );
}

function ForwardableText({
  message,
  className,
  highlightQuery = "",
}: {
  message: Message;
  className?: string;
  highlightQuery?: string;
}) {
  const isAgent = message.sender_type === "agent" || message.sender_type === "bot";
  const full = message.content_text ?? "";
  const note = message.forwarded_note;
  const suffix = note ? `\n\n${note}` : "";
  const hasSplit = !!note && full.endsWith(suffix);

  if (!hasSplit) {
    return (
      <p className={cn("whitespace-pre-wrap break-words text-sm", className)}>
        <Highlighted text={full} query={highlightQuery} />
      </p>
    );
  }

  const original = full.slice(0, full.length - suffix.length);

  return (
    <div className={cn("space-y-1", className)}>
      {original && (
        <div
          className={cn(
            "rounded-md border-l-2 px-2 py-1 text-sm whitespace-pre-wrap break-words",
            isAgent
              ? "border-primary-foreground/50 bg-primary-foreground/15 text-primary-foreground/90"
              : "border-primary bg-muted/60 text-foreground/90",
          )}
        >
          <Highlighted text={original} query={highlightQuery} />
        </div>
      )}
      <p className="text-sm whitespace-pre-wrap break-words">
        <Highlighted text={note ?? ""} query={highlightQuery} />
      </p>
    </div>
  );
}

function MessageContent({
  message,
  t,
  highlightQuery = "",
}: {
  message: Message;
  t: ReturnType<typeof useTranslations>;
  highlightQuery?: string;
}) {
  if (message.deleted_at) {
    return (
      <p className="text-sm italic text-muted-foreground">
        {t("deletedMessage")}
      </p>
    );
  }

  switch (message.content_type) {
    case "text":
      return <ForwardableText message={message} highlightQuery={highlightQuery} />;

    case "image":
      return (
        <div>
          {message.media_url ? (
            <MediaImage url={message.media_url} alt="Shared image" />
          ) : (
            <MediaUnavailable label={t("photo")} t={t} />
          )}
          {message.content_text && (
            <ForwardableText
              message={message}
              className="mt-1"
              highlightQuery={highlightQuery}
            />
          )}
        </div>
      );

    case "video":
      return (
        <div>
          {message.media_url ? (
            <div>
              <video
                src={message.media_url}
                controls
                className="max-h-64 max-w-60 rounded-lg"
              />
              <a
                href={message.media_url}
                download
                className="mt-1 inline-block text-xs font-medium underline underline-offset-2 opacity-80 hover:opacity-100"
              >
                {t("downloadMedia")}
              </a>
            </div>
          ) : (
            <MediaUnavailable label={t("video")} t={t} />
          )}
          {message.content_text && (
            <ForwardableText
              message={message}
              className="mt-1"
              highlightQuery={highlightQuery}
            />
          )}
        </div>
      );

    case "audio":
      return (
        <div>
          {message.media_url ? (
            <audio src={message.media_url} controls className="max-w-60" />
          ) : (
            <MediaUnavailable label={t("audio")} t={t} />
          )}
        </div>
      );

    case "document":
      if (!message.media_url) {
        return <MediaUnavailable label={message.content_text || t("document")} t={t} />;
      }
      return (
        <a
          href={message.media_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm hover:bg-muted"
        >
          <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
          <span className="truncate">
            {message.content_text || t("document")}
          </span>
        </a>
      );

    case "template":
      return (
        <div>
          <span className="mb-1 inline-flex items-center gap-1 rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary">
            <LayoutTemplate className="h-3 w-3" />
            {t("template")}
          </span>
          {message.content_text && (
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">
              {message.content_text}
            </p>
          )}
        </div>
      );

    case "location":
      return (
        <div className="flex items-center gap-2 text-sm">
          <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span>{message.content_text || t("locationShared")}</span>
        </div>
      );

    case "interactive": {
      // Three cases share content_type='interactive':
      //  - OUTBOUND with payload (composer / automation / Flow send after
      //    migration 035): render the buttons/list as they appear on the phone.
      //  - INBOUND tap (customer chose an option, sender_type='customer'):
      //    no payload; show the tapped option's title with a reply affordance
      //    so agents can tell it's a tap, not the customer typing.
      //  - OUTBOUND with NO payload (legacy bot/Flow sends from before
      //    migration 035 backfilled the column): show the body text plainly —
      //    it is our own message, NOT a customer tap.
      if (message.interactive_payload) {
        return <InteractivePreview payload={message.interactive_payload} />;
      }
      if (message.sender_type === "customer") {
        return (
          <div className="flex flex-col gap-0.5">
            <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              <CornerDownLeft className="h-3 w-3" />
              {t("buttonReply")}
            </span>
            <p className="whitespace-pre-wrap break-words text-sm">
              {message.content_text || t("interactiveReply")}
            </p>
          </div>
        );
      }
      return (
        <p className="whitespace-pre-wrap break-words text-sm">
          {message.content_text || t("interactiveReply")}
        </p>
      );
    }

    default:
      return (
        <p className="whitespace-pre-wrap break-words text-sm">
          {message.content_text || t("unsupported")}
        </p>
      );
  }
}

export function MessageBubble({
  message,
  reply,
  reactions,
  currentUserId,
  onToggleReaction,
  showAuthor,
  authorName,
  highlightQuery = "",
  highlightActive = false,
  markers,
  markerAuthorName,
  isAccountAdmin = false,
  onRemoveMarker,
}: MessageBubbleProps) {
  const t = useTranslations("Inbox.bubble");

  const isAgent = message.sender_type === "agent" || message.sender_type === "bot";
  const time = format(new Date(message.created_at), "HH:mm");

  // Row alignment + width cap are owned by <MessageActions> so its hover
  // group matches the bubble's content area, not the full row.
  return (
    <div
      className={cn(
        "flex flex-col",
        isAgent ? "items-end" : "items-start",
      )}
    >
      <div
        className={cn(
          "relative rounded-2xl px-3 py-2",
          isAgent
            ? "rounded-br-md bg-primary text-primary-foreground"
            : "rounded-bl-md bg-muted text-foreground",
          // Ocorrência atual da busca: um anel marca em qual das N
          // ocorrências o atendente está, já que todas ficam destacadas.
          highlightActive && "ring-2 ring-amber-400 ring-offset-1 ring-offset-background",
        )}
      >
        {reply && (
          <ReplyQuote
            authorLabel={reply.authorLabel}
            preview={reply.preview}
            onPrimary={isAgent}
          />
        )}
        {/* Sem `authorName` resolvido — histórico anterior à Task 1 (coluna
            `sender_id` nula em toda mensagem de agente) ou automação/
            broadcast/API pública, que legitimamente nunca tem `sender_id` —
            não renderiza rótulo nenhum. Mostrar "Sistema" seria falso no
            caso do histórico (foi uma pessoa real que escreveu); decisão do
            usuário: melhor nenhum rótulo do que um rótulo errado.
            Mensagem de participante de grupo (Tarefa 11) não cai nesse
            caso: `message-thread.tsx` sempre resolve `authorName` com um
            fallback (display_name -> phone -> "Participante"), então
            `showAuthor` nunca aparece sem nome ali. */}
        {showAuthor && authorName && (
          <span className="mb-0.5 block text-[11px] font-medium opacity-70">
            {authorName}
          </span>
        )}
        {/* Etiqueta "Encaminhada" ACIMA do conteúdo, como o WhatsApp
            posiciona — não no rodapé junto do horário. */}
        {message.forwarded_at && !message.deleted_at && (
          <span
            className={cn(
              "mb-0.5 flex items-center gap-1 text-[11px] italic",
              isAgent ? "text-primary-foreground/70" : "text-muted-foreground",
            )}
          >
            <Forward className="h-3 w-3" />
            {t("forwardedTag")}
          </span>
        )}
        <MessageContent message={message} t={t} highlightQuery={highlightQuery} />
        <div
          className={cn(
            "mt-1 flex items-center gap-1",
            isAgent ? "justify-end" : "justify-start",
          )}
        >
          {/* AI badge — only on replies the auto-reply bot generated
              (always outbound, so it sits on the primary fill). Lets
              agents tell an AI reply from their own / a Flow's at a
              glance. */}
          {message.ai_generated && (
            <span
              className="inline-flex items-center gap-0.5 rounded-full bg-primary-foreground/20 px-1.5 py-px text-[9px] font-semibold uppercase leading-none tracking-wide text-primary-foreground"
              title={t("aiBadgeTitle")}
            >
              <Sparkles className="h-2.5 w-2.5" />
              {t("aiBadge")}
            </span>
          )}
          {message.edited_at && !message.deleted_at && (
            <span
              className={cn(
                "text-[10px] italic",
                isAgent ? "text-primary-foreground/70" : "text-muted-foreground",
              )}
            >
              {t("editedTag")}
            </span>
          )}
          <span
            className={cn(
              "text-[10px]",
              // Outbound bubbles sit on the primary fill, so the
              // timestamp must read against that (not the neutral
              // foreground) — otherwise it goes low-contrast in light
              // mode. Inbound bubbles use the muted surface.
              isAgent ? "text-primary-foreground/70" : "text-muted-foreground",
            )}
          >
            {time}
          </span>
          {isAgent && <StatusIcon status={message.status} />}
        </div>
      </div>
      {reactions && reactions.length > 0 && onToggleReaction && (
        <MessageReactions
          reactions={reactions}
          currentUserId={currentUserId}
          onToggle={onToggleReaction}
        />
      )}
      {/* Chips de marcador — "onde eu parei". Visíveis a toda a conta
          (é isso que também avisa "fulano já está tratando isso
          daqui"); o "×" só aparece pra quem marcou ou admin+
          (canRemoveMarker espelha a policy message_markers_delete). */}
      {markers && markers.length > 0 && (
        <div
          className={cn(
            "mt-1 flex flex-wrap gap-1",
            isAgent ? "justify-end" : "justify-start",
          )}
        >
          {markers.map((marker) => {
            const name = markerAuthorName?.(marker.created_by) ?? "";
            const removable =
              !!currentUserId &&
              !!onRemoveMarker &&
              canRemoveMarker(marker, currentUserId, isAccountAdmin);
            return (
              <span
                key={marker.id}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-popover px-2 py-0.5 text-[10px] text-popover-foreground"
              >
                <Bookmark className="h-2.5 w-2.5" />
                {markerChipText(marker.label, name)}
                {removable && (
                  <button
                    type="button"
                    onClick={() => onRemoveMarker?.(marker.created_by)}
                    className="ml-0.5 rounded-full hover:text-destructive"
                    aria-label={t("removeMarker")}
                    title={t("removeMarker")}
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                )}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
