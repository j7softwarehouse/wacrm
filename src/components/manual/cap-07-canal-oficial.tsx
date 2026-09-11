import { FileText, Radio } from "lucide-react";

import { Aviso, Botao, Capitulo, Lista, Secao, Termo } from "./manual-ui";

export function CapituloCanalOficial() {
  return (
    <Capitulo
      id="canal-oficial"
      numero={7}
      titulo="Recursos que dependem do canal oficial da Meta"
      resumo="Broadcasts e Modelos não aparecem no menu da instituição hoje. Este capítulo explica por quê — útil se algum colega perguntar, ou se um dia isso mudar."
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

      <Secao id="broadcasts" titulo="Por que não existe Broadcasts no menu">
        <p>
          <Botao icone={Radio}>Broadcasts</Botao> é a tela de envio em massa —
          mandar a mesma mensagem para muitos contatos de uma vez, como um
          comunicado para todos os responsáveis. Ela existe no sistema, mas o
          próprio sistema a esconde do menu quando percebe que não vai
          funcionar.
        </p>
        <Aviso tipo="atencao">
          O envio em massa exige modelos aprovados da Meta, que só existem na
          API oficial — e é por isso que a tela não aparece com a conexão por
          QR Code usada hoje. Se o envio em massa passar a ser necessário, o
          caminho é migrar para a API oficial da Meta — uma decisão de
          projeto, não um ajuste de configuração.
        </Aviso>
        <p>
          Enquanto isso, o caminho possível para avisar muita gente é usar
          grupos de WhatsApp, que funcionam normalmente (capítulo 2).
        </p>
      </Secao>

      <Secao id="modelos" titulo="Por que não existe Modelos em Configurações">
        <p>
          <Botao icone={FileText}>Modelos</Botao> guardaria os modelos
          aprovados pela Meta, mas some da lista de Configurações pelo mesmo
          motivo do Broadcasts: sem a API oficial, não há modelo nenhum para
          sincronizar ou enviar.
        </p>
      </Secao>

      <Secao id="sem-prazo" titulo="A boa notícia: sem prazo de 24 horas">
        <p>
          O outro lado da moeda é uma vantagem real do formato atual:{" "}
          <Termo>não existe janela de 24 horas</Termo> para vocês. É possível
          escrever para qualquer contato a qualquer momento, sem depender de ele
          ter falado antes e sem precisar de modelo aprovado. Textos como
          &ldquo;sessão expirada&rdquo; ou &ldquo;use um modelo&rdquo; existem no
          sistema só porque ele também atende quem usa a API oficial — o próprio
          sistema já sabe que não valem para o canal de vocês, e por isso nunca
          aparecem nas suas conversas.
        </p>
      </Secao>
    </Capitulo>
  );
}
