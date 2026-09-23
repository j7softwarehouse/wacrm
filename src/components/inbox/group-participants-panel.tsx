"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ScrollArea } from "@/components/ui/scroll-area";

interface GroupParticipantsPanelProps {
  conversationId: string;
  groupName: string | null;
  groupAvatarUrl: string | null;
}

interface ApiParticipant {
  phoneNumber: string;
  isAdmin: boolean;
  /** Já resolvido pelo backend: Contato -> nome do WhatsApp -> telefone. */
  name: string;
}

interface ApiResponse {
  group: { id: string; name: string | null; avatarUrl: string | null; left: boolean };
  participants: ApiParticipant[];
}

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "left" }
  | { status: "ready"; participants: ApiParticipant[] };

/**
 * Painel do canto direito quando a conversa selecionada é de grupo —
 * substitui o `ContactSidebar` de contato individual (não há `contact`
 * numa conversa de grupo). Busca sempre ao vivo na uazapi via
 * `GET /api/whatsapp/conversations/[id]/participants`; a permissão é
 * decidida pela RLS de `conversations` dentro dessa rota, não aqui.
 */
export function GroupParticipantsPanel({
  conversationId,
  groupName,
  groupAvatarUrl,
}: GroupParticipantsPanelProps) {
  const t = useTranslations("Inbox.groupParticipants");
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ status: "loading" });

    fetch(`/api/whatsapp/conversations/${conversationId}/participants`)
      .then(async (res) => {
        if (!res.ok) throw new Error("failed to load participants");
        return (await res.json()) as ApiResponse;
      })
      .then((data) => {
        if (cancelled) return;
        if (data.group.left) {
          setState({ status: "left" });
        } else {
          setState({ status: "ready", participants: data.participants });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });

    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  const displayName = groupName || t("unnamedGroup");
  const initials = displayName.charAt(0).toUpperCase();

  return (
    <div className="flex h-full w-70 flex-col border-l border-border bg-card">
      <div className="flex flex-col items-center border-b border-border p-4 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-lg font-semibold text-foreground">
          {groupAvatarUrl ? (
            <img
              src={groupAvatarUrl}
              alt={displayName}
              className="h-16 w-16 rounded-full object-cover"
            />
          ) : (
            initials
          )}
        </div>
        <h3 className="mt-3 text-sm font-semibold text-foreground">{displayName}</h3>
        {state.status === "ready" && (
          <p className="text-xs text-muted-foreground">
            {t("participantCount", { count: state.participants.length })}
          </p>
        )}
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2">
          {state.status === "loading" && (
            <p className="p-3 text-center text-xs text-muted-foreground">{t("loading")}</p>
          )}
          {state.status === "error" && (
            <p className="p-3 text-center text-xs text-muted-foreground">{t("loadError")}</p>
          )}
          {state.status === "left" && (
            <p className="p-3 text-center text-xs text-muted-foreground">{t("leftGroup")}</p>
          )}
          {state.status === "ready" &&
            state.participants.map((p) => (
              <div
                key={p.phoneNumber}
                className="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-muted"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground">
                  {p.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-foreground">{p.name}</p>
                  {/* Só mostra o telefone como linha extra quando o nome
                      resolvido é DIFERENTE do telefone — senão repetiria
                      o mesmo valor duas vezes (caso do participante sem
                      contato nem nome de WhatsApp salvo). */}
                  {p.name !== p.phoneNumber && (
                    <p className="truncate text-xs text-muted-foreground">{p.phoneNumber}</p>
                  )}
                </div>
                {p.isAdmin && (
                  <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                    {t("adminBadge")}
                  </span>
                )}
              </div>
            ))}
        </div>
      </ScrollArea>
    </div>
  );
}
