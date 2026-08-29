import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  dispatchInboundToFlows: vi.fn(),
  runAutomationsForTrigger: vi.fn(),
}));

vi.mock('@/lib/flows/engine', () => ({
  dispatchInboundToFlows: mocks.dispatchInboundToFlows,
}));
vi.mock('@/lib/automations/engine', () => ({
  runAutomationsForTrigger: mocks.runAutomationsForTrigger,
}));

import { shouldDispatchEngines } from './ingest';

describe('shouldDispatchEngines', () => {
  beforeEach(() => vi.clearAllMocks());

  it('permite disparo em mensagem 1:1', () => {
    expect(shouldDispatchEngines({ group: undefined })).toBe(true);
  });

  it('BLOQUEIA disparo em mensagem de grupo', () => {
    // Sem esta trava o bot responde dentro de grupos — inclusive
    // grupos pessoais do numero conectado. A mensagem indevida ja
    // foi entregue a terceiros quando o erro aparece; nao ha desfazer.
    expect(
      shouldDispatchEngines({
        group: {
          groupJid: '123@g.us',
          participantJid: '5511999999999@s.whatsapp.net',
        },
      }),
    ).toBe(false);
  });
});
