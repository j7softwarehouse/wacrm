'use client';

// ============================================================
// Botão "Conversar" com escolha de canal. Sem seletor: comportamento
// idêntico ao de antes (find-or-create no canal padrão da conta). Com
// 2+ canais na conta, vira um menu suspenso que lista cada canal —
// com a cor já usada no resto do inbox (ver channel-color.ts) e um
// rótulo indicando se já existe conversa com o contato naquele canal
// ("abrir conversa") ou não ("iniciar nova") — decisão de produto
// tomada com o usuário em 2026-09-15.
// ============================================================

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Loader2, MessageCircle } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { openConversationForContact } from '@/lib/contacts/open-conversation';
import { channelColor } from '@/lib/whatsapp/channel-color';
import { cn } from '@/lib/utils';
import { GatedButton } from '@/components/ui/gated-button';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import type { PublicChannel } from '@/app/api/whatsapp/channels/route';

interface ConversarButtonProps {
  contactId: string;
  /** Lista de canais da conta. 0 ou 1 canal => sem menu, comportamento
   *  automático de sempre (canal padrão da conta). */
  channels: PublicChannel[];
  variant?: 'icon' | 'full';
  label: string;
  canAct?: boolean;
  gateReason?: string;
  className?: string;
  onError: (err: unknown) => void;
}

export function ConversarButton({
  contactId,
  channels,
  variant = 'icon',
  label,
  canAct = true,
  gateReason,
  className,
  onError,
}: ConversarButtonProps) {
  const router = useRouter();
  const t = useTranslations('Contacts.channelPicker');
  const [opening, setOpening] = useState(false);
  const [existingByChannel, setExistingByChannel] = useState<Set<string> | null>(null);

  const multiChannel = channels.length > 1;
  const allPhones = channels.map((c) => c.phone_e164).filter((p): p is string => !!p);

  async function go(channelId?: string) {
    setOpening(true);
    try {
      const conversationId = await openConversationForContact(contactId, channelId);
      router.push(`/inbox?c=${conversationId}`);
    } catch (err) {
      onError(err);
      setOpening(false);
    }
  }

  async function loadExistingConversations() {
    const supabase = createClient();
    const { data } = await supabase
      .from('conversations')
      .select('channel_id')
      .eq('contact_id', contactId);
    setExistingByChannel(
      new Set((data ?? []).map((r) => r.channel_id as string | null).filter((id): id is string => !!id)),
    );
  }

  const icon = opening ? (
    <Loader2 className="size-4 animate-spin" />
  ) : (
    <MessageCircle className="size-4" />
  );

  if (!multiChannel) {
    if (variant === 'full') {
      return (
        <GatedButton
          size="sm"
          canAct={canAct}
          gateReason={gateReason}
          onClick={() => go()}
          disabled={opening}
          className={cn('bg-primary text-primary-foreground hover:bg-primary/90', className)}
        >
          {icon}
          {label}
        </GatedButton>
      );
    }
    return (
      <GatedButton
        variant="ghost"
        size="icon-sm"
        canAct={canAct}
        gateReason={gateReason}
        title={label}
        className={cn('text-muted-foreground hover:text-foreground', className)}
        onClick={(e) => {
          e.stopPropagation();
          go();
        }}
        disabled={opening}
      >
        {icon}
      </GatedButton>
    );
  }

  // Conta com 2+ canais e o usuário pode agir: menu de escolha.
  if (canAct) {
    return (
      <DropdownMenu onOpenChange={(open) => open && loadExistingConversations()}>
        <DropdownMenuTrigger
          render={
            variant === 'full' ? (
              <Button
                size="sm"
                disabled={opening}
                className={cn('bg-primary text-primary-foreground hover:bg-primary/90', className)}
              />
            ) : (
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={opening}
                title={label}
                className={cn('text-muted-foreground hover:text-foreground', className)}
                onClick={(e) => e.stopPropagation()}
              />
            )
          }
        >
          {variant === 'full' ? (
            <>
              {icon}
              {label}
            </>
          ) : (
            icon
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="bg-popover border-border">
          {/* DropdownMenuGroup (base-ui Menu.Group) é OBRIGATÓRIO aqui: o
              DropdownMenuLabel abaixo é o Menu.GroupLabel do base-ui, que
              lê um contexto de grupo e lança exceção em render quando ele
              não existe -- derrubando a página inteira (mesmo defeito do
              issue #336, ver dropdown-menu-group-label.test.tsx). */}
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t('chooseChannel')}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {channels.map((channel) => {
              const color = channel.phone_e164 ? channelColor(channel.phone_e164, allPhones) : undefined;
              const hasConversation = existingByChannel?.has(channel.id) ?? false;
              return (
                <DropdownMenuItem
                  key={channel.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    go(channel.id);
                  }}
                >
                  <span className={cn('size-2 rounded-full', color?.dot ?? 'bg-muted-foreground')} />
                  <span className="flex-1 truncate">
                    {channel.label || channel.phone_e164 || channel.id}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {hasConversation ? t('existingConversation') : t('newConversation')}
                  </span>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  // Sem permissão: mesmo tooltip de "somente leitura" de sempre, sem menu.
  return variant === 'full' ? (
    <GatedButton
      size="sm"
      canAct={false}
      gateReason={gateReason}
      className={cn('bg-primary text-primary-foreground hover:bg-primary/90', className)}
    >
      {icon}
      {label}
    </GatedButton>
  ) : (
    <GatedButton
      variant="ghost"
      size="icon-sm"
      canAct={false}
      gateReason={gateReason}
      className={cn('text-muted-foreground hover:text-foreground', className)}
    >
      {icon}
    </GatedButton>
  );
}
