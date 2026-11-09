"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { InteractivePreview } from "@/components/interactive/interactive-preview";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import {
  groupVotersByOption,
  type PollVoteRow,
} from "@/lib/whatsapp/poll-voters";
import type { Message } from "@/types";

/**
 * Enquete enviada por nós na conversa: a prévia com a contagem e o botão
 * "Mostrar votos", que abre quem votou em cada opção. A lista é buscada
 * só ao abrir, para não pesar a conversa.
 */
export function PollMessage({ message }: { message: Message }) {
  const t = useTranslations("Inbox.bubble");
  const [open, setOpen] = useState(false);
  const [votes, setVotes] = useState<PollVoteRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const payload = message.interactive_payload;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    createClient()
      .from("poll_votes")
      .select("voter_jid, voter_name, options, voted_at")
      .eq("message_id", message.id)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) setFailed(true);
        else setVotes((data as PollVoteRow[]) ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [open, message.id]);

  if (!payload || payload.kind !== "poll") return null;

  const groups = votes ? groupVotersByOption(payload.options, votes) : null;

  return (
    <div className="flex w-full max-w-[260px] flex-col gap-1">
      <InteractivePreview payload={payload} pollResults={message.poll_results} />
      <button
        type="button"
        onClick={() => {
          setVotes(null);
          setFailed(false);
          setOpen(true);
        }}
        className="rounded-lg bg-card py-2 text-center text-sm font-medium text-primary shadow-sm ring-1 ring-border"
      >
        {t("showVotes")}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{payload.body}</DialogTitle>
          </DialogHeader>
          <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
            {failed ? (
              <p className="text-sm text-red-400">{t("pollVotersError")}</p>
            ) : groups === null ? (
              <p className="text-sm text-muted-foreground">{t("pollVotersLoading")}</p>
            ) : votes && votes.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("pollNoVotes")}</p>
            ) : (
              payload.options.map((option) => {
                const voters = groups?.[option] ?? [];
                return (
                  <section key={option} className="flex flex-col gap-1">
                    <div className="flex items-center justify-between text-sm font-semibold">
                      <span className="break-words">{option}</span>
                      <span className="tabular-nums text-muted-foreground">{voters.length}</span>
                    </div>
                    {voters.length > 0 ? (
                      <ul className="flex flex-col gap-0.5 pl-3 text-sm text-muted-foreground">
                        {voters.map((name, i) => (
                          <li key={`${name}-${i}`} className="break-words">
                            {name}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </section>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
