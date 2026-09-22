import {
  AlertTriangle,
  Bell,
  Bookmark,
  CheckCheck,
  CheckCircle2,
  Clock,
  MessageSquare,
  Send,
  UserPlus,
} from "lucide-react";

import {
  Aviso,
  Botao,
  Capitulo,
  Icone,
  Lista,
  Onde,
  Secao,
  Termo,
} from "./manual-ui";

export function CapituloNotificacoesDashboard() {
  return (
    <Capitulo
      id="notificacoes-dashboard"
      numero={4}
      titulo="Notificações e Dashboard"
      resumo="Onde o sistema chama a sua atenção e onde ele mostra como anda o atendimento."
    >
      <Secao id="notificacoes" titulo="Notificações">
        <Onde>
          <Botao icone={Bell}>Notificações</Botao> no menu lateral.
        </Onde>
        <p>
          Esta tela avisa quando algo pede a sua atenção em outra conversa. Não
          é um resumo de mensagens novas; mensagens novas aparecem sozinhas na
          Caixa de entrada, com o contador de não lidas. A tela tem duas abas:
        </p>
        <Lista>
          <li>
            <Termo>Notificações</Termo>: avisa quando um colega usa{" "}
            <Botao icone={UserPlus}>Atribuir</Botao> e escolhe o seu nome. Cai
            um aviso aqui, e o menu lateral mostra um contador ao lado de
            Notificações.
          </li>
          <li>
            <Termo>Meus marcadores</Termo>: reúne todo{" "}
            <Icone icone={Bookmark} /> marcador que você deixou (ou que um
            colega atribuiu a você) em qualquer conversa. Clicar num deles leva
            direto para o ponto exato marcado. Veja o capítulo 2 para como
            marcar.
          </li>
        </Lista>
        <Lista>
          <li>Clique no aviso para abrir a conversa correspondente.</li>
          <li>
            <Botao icone={CheckCheck}>Marcar tudo como lido</Botao> limpa a
            aba Notificações de uma vez; não afeta os marcadores.
          </li>
        </Lista>
        <Aviso tipo="dica">
          Se o contador não zera, provavelmente ainda há avisos antigos não
          lidos mais abaixo na lista. Marcar tudo como lido resolve; a conversa
          em si continua intacta.
        </Aviso>
      </Secao>

      <Secao id="dashboard" titulo="Dashboard">
        <Onde>É a primeira tela depois de entrar no sistema.</Onde>
        <p>
          O Dashboard responde, em números, à pergunta &ldquo;como está o
          atendimento agora?&rdquo;. Os seis cartões do topo são:
        </p>
        <Lista>
          <li>
            <Botao icone={MessageSquare}>Conversas Ativas</Botao>: conversas em
            andamento no momento.
          </li>
          <li>
            <Botao icone={UserPlus}>Novos Contatos Hoje</Botao>: quantas
            pessoas novas apareceram hoje, comparado a ontem.
          </li>
          <li>
            <Botao icone={AlertTriangle}>Sem resposta há +30 min</Botao>:
            veja a seção seguinte.
          </li>
          <li>
            <Botao icone={AlertTriangle}>Pendências</Botao>: veja a seção logo
            depois.
          </li>
          <li>
            <Botao icone={Send}>Mensagens Enviadas Hoje</Botao>: o volume que a
            equipe produziu.
          </li>
          <li>
            <Botao icone={Clock}>Tempo médio de resposta</Botao>: quanto tempo,
            em média, a equipe leva para responder, comparado com a semana
            passada.
          </li>
        </Lista>
        <p>
          Um sétimo cartão acompanha negócios, quando esse módulo está ligado.
        </p>
      </Secao>

      <Secao id="sem-resposta" titulo="O cartão &ldquo;Sem resposta há +30 min&rdquo;">
        <p>
          É a parte mais útil do Dashboard no dia a dia. Ele conta as conversas
          em que <Termo>o contato falou por último</Termo> e já se passaram mais
          de 30 minutos de expediente sem ninguém responder. Clicar no cartão
          leva direto para a Caixa de entrada já com esse filtro aplicado.
        </p>
        <Lista>
          <li>
            <Icone icone={AlertTriangle} /> com um número maior que zero: tem
            gente esperando.
          </li>
          <li>
            <Icone icone={CheckCircle2} /> <Termo>Tudo respondido</Termo>:
            ninguém esperando.
          </li>
          <li>
            <Icone icone={Clock} /> <Termo>Fora do horário de atendimento</Termo>
            : o relógio de 30 minutos só corre durante o expediente, então
            mensagens que chegam de madrugada não acusam atraso.
          </li>
        </Lista>
        <p>
          O mesmo aviso também aparece direto na lista de conversas, como um
          selo laranja em cada linha atrasada; veja o capítulo 2.
        </p>
        <Aviso tipo="dica">
          Um bom hábito de início de turno: abrir o Dashboard, zerar esse
          cartão e só depois ir para a Caixa de entrada. Ele mostra exatamente
          quem está sendo deixado esperando.
        </Aviso>
      </Secao>

      <Secao id="pendencias" titulo="O cartão &ldquo;Pendências&rdquo;">
        <p>
          Conta as conversas marcadas com o status <Termo>Pendente</Termo>{" "}
          (capítulo 2). Diferente do cartão anterior, uma conversa pendente não
          é necessariamente uma conversa esquecida: pode ser algo que depende
          de um retorno externo e vai demorar mais que 30 minutos para
          resolver. O que este cartão vigia é outra coisa: que toda pendência
          tenha um dono.
        </p>
        <p>
          Quando alguém marca uma conversa como <Termo>Pendente</Termo> sem
          que exista responsável, o sistema atribui a conversa a essa pessoa
          na hora, automaticamente. Por isso o cartão também destaca, em
          vermelho, quantas pendências ainda estão{" "}
          <Termo>sem responsável</Termo>: são as que já existiam antes dessa
          regra entrar em vigor, ou que vieram de um caminho automático sem
          usuário logado.
        </p>
        <p>
          O número exibido muda conforme o seu papel:
        </p>
        <Lista>
          <li>
            Administrador e Proprietário veem o total da conta inteira.
          </li>
          <li>
            Agente e Visualizador veem só as pendências das quais são
            responsáveis.
          </li>
        </Lista>
        <p>Clicar no cartão leva para a Caixa de entrada filtrada por Pendente.</p>
      </Secao>
    </Capitulo>
  );
}
