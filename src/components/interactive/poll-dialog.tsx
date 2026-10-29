"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  validateInteractivePayload,
  type InteractivePollPayload,
} from "@/lib/whatsapp/interactive";
import { InteractivePreview } from "./interactive-preview";

const MAX_OPTIONS = 12;
const MIN_OPTIONS = 2;
const OPTION_MAX_LENGTH = 100;

const blankOptions = () => Array.from({ length: MIN_OPTIONS }, () => "");

/**
 * Builder for a WhatsApp poll (enquete). Mirrors the phone's "Criar
 * enquete" sheet: a question, the answer options, and whether the voter
 * may pick more than one. The live preview is the same card the bubble
 * renders after sending.
 */
export function PollDialog({
  open,
  onOpenChange,
  onSend,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSend: (payload: InteractivePollPayload) => void;
}) {
  const t = useTranslations("Inbox.composer");
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<string[]>(blankOptions);
  const [multiple, setMultiple] = useState(false);

  // Blank rows are ignored, so an unused "add option" row doesn't block
  // sending. The count is what the voter sees and what the API checks.
  const filledOptions = options.map((o) => o.trim()).filter(Boolean);
  const payload: InteractivePollPayload = {
    kind: "poll",
    body: question.trim(),
    options: filledOptions,
    selectable_count: multiple ? Math.max(1, filledOptions.length) : 1,
  };
  const validation = validateInteractivePayload(payload);
  const hasInput = question.trim() !== "" || filledOptions.length > 0;

  const reset = () => {
    setQuestion("");
    setOptions(blankOptions());
    setMultiple(false);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const updateOption = (index: number, value: string) => {
    setOptions((prev) => prev.map((o, i) => (i === index ? value : o)));
  };

  const removeOption = (index: number) => {
    setOptions((prev) => prev.filter((_, i) => i !== index));
  };

  const addOption = () => {
    setOptions((prev) => [...prev, ""]);
  };

  const handleSend = () => {
    if (!validation.ok) return;
    onSend(payload);
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("pollDialogTitle")}</DialogTitle>
        </DialogHeader>

        <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="poll-question">{t("pollQuestion")}</Label>
            <Input
              id="poll-question"
              value={question}
              placeholder={t("pollQuestionPlaceholder")}
              onChange={(e) => setQuestion(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{t("pollOptions")}</Label>
            {options.map((option, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  value={option}
                  maxLength={OPTION_MAX_LENGTH}
                  placeholder={t("pollOptionPlaceholder", { number: index + 1 })}
                  onChange={(e) => updateOption(index, e.target.value)}
                />
                {options.length > MIN_OPTIONS && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("pollRemoveOption")}
                    onClick={() => removeOption(index)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
            {options.length < MAX_OPTIONS && (
              <Button
                variant="ghost"
                size="sm"
                className="self-start"
                onClick={addOption}
              >
                <Plus className="mr-1 h-4 w-4" />
                {t("pollAddOption")}
              </Button>
            )}
          </div>

          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="poll-multiple">{t("pollAllowMultiple")}</Label>
            <Switch
              id="poll-multiple"
              checked={multiple}
              onCheckedChange={setMultiple}
            />
          </div>

          {hasInput && !validation.ok && (
            <p className="text-xs text-red-400">{validation.error}</p>
          )}

          <InteractivePreview payload={payload} />
        </div>

        <DialogFooter>
          <Button disabled={!validation.ok} onClick={handleSend}>
            <Send className="mr-1 h-4 w-4" />
            {t("pollSend")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
