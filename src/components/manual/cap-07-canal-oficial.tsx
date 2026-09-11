import { FileText, Radio } from "lucide-react";

import { Aviso, Botao, Capitulo, Lista, Secao, Termo } from "./manual-ui";

export function CapituloCanalOficial() {
  return (
    <Capitulo
      id="canal-oficial"
      numero={7}
      titulo="Recursos que dependem do canal oficial da Meta"
      resumo="Duas telas existem no menu mas não funcionam com a forma de conexão usada hoje. Este capítulo explica por quê, para ninguém perder tempo tentando."
    >
      <Secao id="dois-caminhos" titulo="Dois jeitos de conectar um WhatsApp">
        <p>
          Existem duas formas de um sistema conversar com o WhatsApp, e elas têm
          regras diferentes:
        </p>
        <Lista>
          <li>
            <Termo>Conexão por QR Code</Termo> — é a que a instituição usa hoje.
            Funciona como o WhatsApp Web: livre para conversar com quem quiser,
            a qualquer momento, com texto, foto, vídeo, documento e áudio.
          </li>
          <li>
            <Termo>API oficial da Meta</Termo> — um contrato direto com a Meta,
            com cadastro de empresa aprovado. Libera envio em massa, mas impõe
            regras: fora de uma janela de 24 horas depois da última mensagem do
            contato, só é permitido enviar <Termo>modelos aprovados</Termo>{" "}
            previamente pela Meta.
          </li>
        </Lista>
      </Secao>

      <Secao id="broadcasts" titulo="Broadcasts">
        <p>
          <Botao icone={Radio}>Broadcasts</Botao> é a tela de envio em massa —
          mandar a mesma mensagem para muitos contatos de uma vez, como um
          comunicado para todos os responsáveis.
        </p>
        <Aviso tipo="atencao">
          <strong>
            Não funciona com a conexão usada hoje pela instituição.
          </strong>{" "}
          O envio em massa exige modelos aprovados da Meta, que só existem na
          API oficial. Uma tentativa de disparo falharia no momento do envio. Se
          o envio em massa passar a ser necessário, o caminho é migrar para a
          API oficial da Meta — uma decisão de projeto, não um ajuste de
          configuração.
        </Aviso>
        <p>
          Enquanto isso, o caminho possível para avisar muita gente é usar
          grupos de WhatsApp, que funcionam normalmente (capítulo 2).
        </p>
      </Secao>

      <Secao id="modelos" titulo="Modelos">
        <p>
          <Botao icone={FileText}>Configurações → Modelos</Botao> guarda os
          modelos aprovados pela Meta. Pelo mesmo motivo acima, a seção não tem
          uso hoje: sem a API oficial, não há modelos para sincronizar nem para
          enviar.
        </p>
      </Secao>

      <Secao id="sem-prazo" titulo="A boa notícia: sem prazo de 24 horas">
        <p>
          O outro lado da moeda é uma vantagem real do formato atual:{" "}
          <Termo>não existe janela de 24 horas</Termo> para vocês. É possível
          escrever para qualquer contato a qualquer momento, sem depender de ele
          ter falado antes e sem precisar de modelo aprovado. Se algum texto do
          sistema mencionar &ldquo;sessão expirada&rdquo; ou &ldquo;use um
          modelo&rdquo;, é uma mensagem pensada para a API oficial e não se
          aplica ao caso de vocês.
        </p>
      </Secao>
    </Capitulo>
  );
}
