import { channelLabel } from "@/lib/inbox/conversations";
import type { PublicChannel } from "@/app/api/whatsapp/channels/route";

export interface GroupChannelOption {
  id: string;
  label: string;
  /** Só canal conectado consegue criar grupo. */
  selectable: boolean;
}

/**
 * Canais que aparecem no seletor de "Criar grupo". Só a UAZAPI cria
 * grupo (a Cloud API da Meta não tem a operação). Canal desconectado
 * continua listado, mas não selecionável, para a pessoa entender por que
 * aquele número não está disponível.
 */
export function channelsForGroupCreation(channels: PublicChannel[]): GroupChannelOption[] {
  return channels
    .filter((c) => c.provider === "uazapi")
    .map((c) => ({
      id: c.id,
      label: channelLabel(c) ?? c.id,
      selectable: c.status === "connected",
    }));
}

/**
 * Canal já escolhido ao abrir o diálogo: só quando existe UM canal
 * selecionável (nada a decidir). Com 2+ fica vazio de propósito — o
 * grupo nascia sempre no canal mais antigo e ninguém percebia; agora a
 * pessoa precisa escolher.
 */
export function defaultGroupChannelId(options: GroupChannelOption[]): string {
  const selectable = options.filter((o) => o.selectable);
  return selectable.length === 1 ? selectable[0].id : "";
}
