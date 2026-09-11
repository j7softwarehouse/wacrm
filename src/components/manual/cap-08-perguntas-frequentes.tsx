import { CheckCheck, PlugZap, RefreshCw, XCircle } from "lucide-react";

import {
  Aviso,
  Botao,
  Capitulo,
  Icone,
  Lista,
  Secao,
  Termo,
} from "./manual-ui";

export function CapituloPerguntasFrequentes() {
  return (
    <Capitulo
      id="perguntas-frequentes"
      numero={8}
      titulo="Perguntas frequentes"
      resumo="O que fazer quando algo parece errado."
    >
      <Secao titulo="Não consigo enviar mensagem em nenhuma conversa">
        <p>
          Quando o problema atinge <em>todas</em> as conversas, quase sempre é o
          canal: o WhatsApp da instituição caiu.
        </p>
        <Lista>
          <li>
            Um administrador deve abrir{" "}
            <Botao icone={PlugZap}>Configurações → WhatsApp</Botao> e conferir o
            estado do canal.
          </li>
          <li>
            Se estiver <Termo>Desconectado</Termo>, reconectar pelo QR Code
            resolve (capítulo 6).
          </li>
          <li>
            Antes disso, vale checar o óbvio: o celular do número está ligado,
            com internet e com o WhatsApp aberto?
          </li>
        </Lista>
      </Secao>

      <Secao titulo="Não consigo enviar só nesta conversa">
        <p>O sistema escreve o motivo logo acima do campo de escrita:</p>
        <Lista>
          <li>
            <Termo>Você saiu deste grupo</Termo> — o número não participa mais.
            Alguém precisa adicionar o número de volta pelo WhatsApp; em poucos
            minutos a conversa volta a funcionar sozinha.
          </li>
          <li>
            <Termo>Somente leitura</Termo> — seu papel é Visualizador. Peça a um
            administrador para mudar seu papel para Agente.
          </li>
          <li>
            <Termo>Canal removido</Termo> — o canal daquela conversa foi
            desligado. O histórico fica, mas não dá para responder por ali.
          </li>
        </Lista>
      </Secao>

      <Secao titulo="O que significa (editado) numa mensagem?">
        <p>
          Que aquela mensagem foi corrigida depois de enviada — por você, por um
          colega, ou pelo próprio contato no WhatsApp dele. O texto que aparece
          é sempre a versão mais recente. É o mesmo comportamento do WhatsApp
          comum.
        </p>
      </Secao>

      <Secao titulo="Uma mensagem virou &ldquo;Mensagem apagada&rdquo;. Ela sumiu?">
        <p>
          Da tela, sim: quem apagou foi você, um colega ou o próprio contato. Do
          banco de dados, não — o conteúdo original continua registrado, e um
          administrador consegue recuperá-lo se houver necessidade formal (uma
          auditoria, por exemplo). No dia a dia, trate como apagada.
        </p>
      </Secao>

      <Secao titulo="Enviei e não apareceu o ✓✓">
        <p>Os indicadores contam a história da mensagem:</p>
        <Lista>
          <li>
            Um ✓ — o WhatsApp recebeu, mas ainda não entregou ao celular da
            pessoa. Costuma ser celular desligado ou sem internet.
          </li>
          <li>✓✓ — entregue ao aparelho.</li>
          <li>✓✓ em azul — a pessoa leu.</li>
          <li>
            <Icone icone={XCircle} /> — falhou de verdade. Confira o número do
            contato e o estado do canal.
          </li>
        </Lista>
        <Aviso tipo="dica">
          Nem todo mundo tem a confirmação de leitura ligada no próprio
          WhatsApp. Quando a pessoa desliga, o ✓✓ azul nunca aparece — mesmo que
          ela tenha lido.
        </Aviso>
      </Secao>

      <Secao titulo="A conversa parece travada ou desatualizada">
        <p>
          Use o <Icone icone={RefreshCw} /> no topo da conversa: ele recarrega
          as mensagens e a lista. Se o problema persistir, recarregue a página do
          navegador (F5).
        </p>
      </Secao>

      <Secao titulo="Apareceu uma resposta que ninguém da equipe escreveu">
        <p>
          Foi uma resposta automática. Se tiver o selo <Termo>IA</Termo>, foi o
          assistente; caso contrário, foi uma automação ou um fluxo. Para tomar
          a frente, use <Termo>Assumir</Termo> no aviso do topo da conversa
          (capítulo 5).
        </p>
      </Secao>

      <Secao titulo="Um colega não está vendo o que eu vejo">
        <p>
          Papéis diferentes enxergam coisas diferentes. Atendentes com papel{" "}
          <Termo>Agente</Termo> não veem as seções de WhatsApp e Grupos em
          Configurações, e <Termo>Visualizadores</Termo> não enviam mensagem
          nenhuma. O papel de cada um aparece em{" "}
          <Botao icone={CheckCheck}>Configurações → Membros da equipe</Botao>.
        </p>
      </Secao>

      <Secao titulo="Ainda estou com dúvida">
        <p>
          Fale com a pessoa responsável pelo CRM na instituição. Ao pedir ajuda,
          diga <Termo>o nome do contato</Termo>, <Termo>o horário</Termo> e{" "}
          <Termo>o que apareceu na tela</Termo> — com isso, quem for investigar
          encontra o registro exato do que aconteceu.
        </p>
      </Secao>
    </Capitulo>
  );
}
