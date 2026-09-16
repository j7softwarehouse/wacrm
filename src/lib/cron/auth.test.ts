import { describe, expect, it } from 'vitest';

import { isAuthorizedCronRequest } from './auth';

const SECRET = 'sup3r-secret-value';

function req(headers: Record<string, string>): Request {
  return new Request('https://example.com/api/cron', { headers });
}

describe('isAuthorizedCronRequest', () => {
  it('aceita o header Authorization: Bearer que a Vercel Cron envia', () => {
    // A Vercel Cron nao permite header customizado: ela sempre manda
    // `Authorization: Bearer $CRON_SECRET`. Sem isso, a cron nativa
    // nunca conseguiria autenticar.
    expect(
      isAuthorizedCronRequest(req({ authorization: `Bearer ${SECRET}` }), SECRET),
    ).toBe(true);
  });

  it('aceita o header x-cron-secret ja usado pelas rotas existentes', () => {
    // Compatibilidade: se houver algum pinger externo configurado, ele
    // continua funcionando.
    expect(
      isAuthorizedCronRequest(req({ 'x-cron-secret': SECRET }), SECRET),
    ).toBe(true);
  });

  it('recusa segredo errado', () => {
    expect(
      isAuthorizedCronRequest(req({ 'x-cron-secret': 'errado' }), SECRET),
    ).toBe(false);
    expect(
      isAuthorizedCronRequest(req({ authorization: 'Bearer errado' }), SECRET),
    ).toBe(false);
  });

  it('recusa requisicao sem nenhum header de autenticacao', () => {
    expect(isAuthorizedCronRequest(req({}), SECRET)).toBe(false);
  });

  it('recusa quando nao ha segredo configurado no ambiente', () => {
    // Sem segredo provisionado o endpoint precisa ser inacessivel, nunca
    // aberto — senao qualquer um dispara a varredura.
    expect(
      isAuthorizedCronRequest(req({ 'x-cron-secret': 'qualquer' }), undefined),
    ).toBe(false);
    expect(isAuthorizedCronRequest(req({ 'x-cron-secret': '' }), ''), 'vazio').toBe(
      false,
    );
  });
});
