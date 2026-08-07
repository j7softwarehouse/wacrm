import { describe, expect, it } from 'vitest';

import { stripMimeTypeParams } from './store-inbound-media';

describe('stripMimeTypeParams', () => {
  it('remove o parametro codecs de audio/ogg', () => {
    // Reproduz o bug real: o webhook do WhatsApp manda
    // "audio/ogg; codecs=opus" para nota de voz. O bucket chat-media
    // tem "audio/ogg" na lista permitida (allowed_mime_types), mas o
    // Supabase Storage faz correspondencia exata — com o parametro
    // sobrando, o upload falha mesmo o tipo base sendo permitido.
    expect(stripMimeTypeParams('audio/ogg; codecs=opus')).toBe('audio/ogg');
  });

  it('mantem tipo simples sem parametro inalterado', () => {
    expect(stripMimeTypeParams('image/jpeg')).toBe('image/jpeg');
  });

  it('remove parametro charset de texto', () => {
    expect(stripMimeTypeParams('text/plain; charset=utf-8')).toBe('text/plain');
  });

  it('tira espaco em volta do tipo base', () => {
    expect(stripMimeTypeParams('  audio/mpeg  ;bitrate=128')).toBe('audio/mpeg');
  });
});
