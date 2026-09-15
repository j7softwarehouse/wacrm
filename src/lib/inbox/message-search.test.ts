import { describe, expect, it } from 'vitest';

import { findMessageMatches, splitHighlight } from './message-search';
import type { Message } from '@/types';

function msg(id: string, text: string | null, extra: Partial<Message> = {}): Message {
  return {
    id,
    conversation_id: 'conv-1',
    sender_type: 'customer',
    content_type: 'text',
    content_text: text,
    status: 'delivered',
    created_at: '2026-09-15T12:00:00.000Z',
    ...extra,
  } as Message;
}

describe('findMessageMatches', () => {
  const messages = [
    msg('m1', 'Bom dia, tudo bem?'),
    msg('m2', 'Segue o comprovante de pagamento'),
    msg('m3', null),
    msg('m4', 'PAGAMENTO confirmado'),
  ];

  it('devolve as mensagens que casam, em ordem, ignorando maiúsculas', () => {
    expect(findMessageMatches(messages, 'pagamento')).toEqual(['m2', 'm4']);
  });

  it('ignora acentos nos dois lados da comparação', () => {
    // Digitar sem acento é o caso comum em busca; o WhatsApp também acha.
    const acentuadas = [msg('a1', 'Enviei o currículo ontem')];
    expect(findMessageMatches(acentuadas, 'curriculo')).toEqual(['a1']);
    expect(findMessageMatches([msg('a2', 'Enviei o curriculo')], 'currículo')).toEqual(['a2']);
  });

  it('não casa nada com busca vazia ou só espaços', () => {
    expect(findMessageMatches(messages, '')).toEqual([]);
    expect(findMessageMatches(messages, '   ')).toEqual([]);
  });

  it('ignora mensagens sem texto (mídia sem legenda)', () => {
    expect(findMessageMatches(messages, 'bom')).toEqual(['m1']);
  });

  it('não casa mensagem apagada', () => {
    // O conteúdo de uma mensagem apagada continua no banco (apagar nunca
    // toca content_text), mas a bolha mostra "Mensagem apagada" — achar
    // por um texto que o atendente não consegue ver seria confuso.
    const comApagada = [msg('d1', 'pagamento', { deleted_at: '2026-09-15T13:00:00.000Z' })];
    expect(findMessageMatches(comApagada, 'pagamento')).toEqual([]);
  });
});

describe('splitHighlight', () => {
  it('reparte o texto em pedaços marcando as ocorrências', () => {
    expect(splitHighlight('Pagamento e pagamento', 'pagamento')).toEqual([
      { text: 'Pagamento', match: true },
      { text: ' e ', match: false },
      { text: 'pagamento', match: true },
    ]);
  });

  it('acha o trecho mesmo com acento diferente, preservando o texto original', () => {
    expect(splitHighlight('Meu currículo', 'curriculo')).toEqual([
      { text: 'Meu ', match: false },
      { text: 'currículo', match: true },
    ]);
  });

  it('devolve o texto inteiro sem marcação quando não há busca', () => {
    expect(splitHighlight('Bom dia', '')).toEqual([{ text: 'Bom dia', match: false }]);
  });
});
