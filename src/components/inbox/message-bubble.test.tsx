import { describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";

import pt from "../../../messages/pt.json";
import type { Message } from "@/types";
import { MessageBubble } from "./message-bubble";

// Componentes pesados sem relação com o placeholder: não precisam carregar.
vi.mock("@/components/interactive/interactive-preview", () => ({
  InteractivePreview: () => null,
}));
vi.mock("@/components/inbox/poll-message", () => ({
  PollMessage: () => null,
}));

const PLACEHOLDER =
  "[Undecryptable] [media] [image] Não foi possível descriptografar a mensagem. Abra o WhatsApp no seu celular para visualizá-la.";
const NOTICE = "Mensagem não disponível neste CRM";
const RAW_FRAGMENT = "Abra o WhatsApp no seu celular";

function mensagem(overrides: Partial<Message>): Message {
  return {
    id: "msg-1",
    conversation_id: "conv-1",
    sender_type: "customer",
    content_type: "text",
    content_text: "Bom dia",
    media_url: null,
    status: "delivered",
    created_at: "2026-11-09T12:00:00.000Z",
    deleted_at: null,
    ...overrides,
  } as Message;
}

function renderBolha(
  message: Message,
  extra: Partial<ComponentProps<typeof MessageBubble>> = {},
): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="pt" messages={pt}>
      <MessageBubble message={message} {...extra} />
    </NextIntlClientProvider>,
  );
}

describe("MessageBubble — placeholder de mensagem indecifrável", () => {
  it("texto com placeholder mostra o aviso único, nunca o texto cru", () => {
    const html = renderBolha(mensagem({ content_type: "text", content_text: PLACEHOLDER }));

    expect(html).toContain(NOTICE);
    expect(html).not.toContain(RAW_FRAGMENT);
    expect(html).not.toContain("[Undecryptable]");
  });

  it("imagem com placeholder e sem media_url mostra o aviso, não 'Foto indisponível'", () => {
    const html = renderBolha(
      mensagem({ content_type: "image", content_text: PLACEHOLDER, media_url: undefined }),
    );

    expect(html).toContain(NOTICE);
    expect(html).not.toContain("Foto indisponível");
    expect(html).not.toContain(RAW_FRAGMENT);
  });

  it("vídeo com placeholder e mídia real mostra o vídeo e não o placeholder", () => {
    const html = renderBolha(
      mensagem({
        content_type: "video",
        content_text: PLACEHOLDER,
        media_url: "https://storage.example/v.mp4",
      }),
    );

    expect(html).toContain('src="https://storage.example/v.mp4"');
    expect(html).not.toContain(NOTICE);
    expect(html).not.toContain(RAW_FRAGMENT);
  });

  it("imagem com placeholder e mídia real não exibe o placeholder como legenda", () => {
    const html = renderBolha(
      mensagem({
        content_type: "image",
        content_text: PLACEHOLDER,
        media_url: "https://storage.example/x.jpg",
      }),
    );

    expect(html).not.toContain(NOTICE);
    expect(html).not.toContain(RAW_FRAGMENT);
  });

  it("mensagem comum renderiza o texto e não mostra o aviso", () => {
    const html = renderBolha(mensagem({ content_text: "Bom dia, tudo bem?" }));

    expect(html).toContain("Bom dia, tudo bem?");
    expect(html).not.toContain(NOTICE);
  });
});

describe("MessageBubble — botão fixo de recuperação", () => {
  it("sem onRequestRecovery não renderiza o botão", () => {
    const html = renderBolha(mensagem({ content_text: PLACEHOLDER }));

    expect(html).not.toContain("Tentar recuperar");
  });

  it("com onRequestRecovery renderiza o botão visível (sem depender de hover)", () => {
    const html = renderBolha(mensagem({ content_text: PLACEHOLDER }), {
      onRequestRecovery: () => {},
    });

    expect(html).toContain("Tentar recuperar");
    expect(html).not.toContain("opacity-0");
    expect(html).not.toMatch(/<button[^>]* disabled=/);
  });

  it("enquanto o pedido está em andamento, o botão fica desabilitado", () => {
    const html = renderBolha(mensagem({ content_text: PLACEHOLDER }), {
      onRequestRecovery: () => {},
      recoveryPending: true,
    });

    expect(html).toMatch(/<button[^>]*disabled/);
  });
});
