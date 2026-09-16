import {
  AlertTriangle,
  Bell,
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
          Esta tela tem uma função específica:{" "}
          <Termo>
            avisar quando um colega passa uma conversa para você
          </Termo>
          . Não é um resumo de mensagens novas — mensagens novas aparecem
          sozinhas na Caixa de entrada, com o contador de não lidas.
        </p>
        <p>
          Quando alguém usa <Botao icone={UserPlus}>Atribuir</Botao> e escolhe o
          seu nome, cai um aviso aqui e o menu lateral mostra um contador ao
          lado de Notificações.
        </p>
        <Lista>
          <li>Clique no aviso para abrir a conversa correspondente.</li>
          <li>
            <Botao icone={CheckCheck}>Marcar tudo como lido</Botao> limpa a
            lista de uma vez.
          </li>
        </Lista>
        <Aviso tipo="dica">
          Se o contador não zera, provavelmente ainda há avisos antigos não
          lidos mais abaixo na lista. Marcar tudo como lido resolve — a conversa
          em si continua intacta.
        </Aviso>
      </Secao>

      <Secao id="dashboard" titulo="Dashboard">
        <Onde>É a primeira tela depois de entrar no sistema.</Onde>
        <p>
          O Dashboard responde, em números, à pergunta &ldquo;como está o
          atendimento agora?&rdquo;. Os quatro cartões do topo são:
        </p>
        <Lista>
          <li>
            <Botao icone={MessageSquare}>Conversas Ativas</Botao> — conversas em
            andamento no momento.
          </li>
          <li>
            <Botao icone={UserPlus}>Novos Contatos Hoje</Botao> — quantas
            pessoas novas apareceram hoje, comparado a ontem.
          </li>
          <li>
            <Botao icone={Send}>Mensagens Enviadas Hoje</Botao> — o volume que a
            equipe produziu.
          </li>
          <li>
            O quarto cartão acompanha negócios, quando esse módulo está ligado.
          </li>
        </Lista>
      </Secao>

      <Secao id="sem-resposta" titulo="O painel &ldquo;Sem resposta há +30 min&rdquo;">
        <p>
          É a parte mais útil do Dashboard no dia a dia. Ele lista as conversas
          em que <Termo>o contato falou por último</Termo> e já se passaram mais
          de 30 minutos de expediente sem ninguém responder.
        </p>
        <Lista>
          <li>
            <Icone icone={AlertTriangle} /> com itens na lista — tem gente
            esperando. Cada linha leva direto à conversa.
          </li>
          <li>
            <Icone icone={CheckCircle2} /> <Termo>Tudo respondido</Termo> —
            ninguém esperando.
          </li>
          <li>
            <Icone icone={Clock} /> <Termo>Fora do horário de atendimento</Termo>{" "}
            — o relógio de 30 minutos só corre durante o expediente, então
            mensagens que chegam de madrugada não acusam atraso.
          </li>
        </Lista>
        <Aviso tipo="dica">
          Um bom hábito de início de turno: abrir o Dashboard, zerar esse painel
          e só depois ir para a Caixa de entrada. Ele mostra exatamente quem
          está sendo deixado esperando.
        </Aviso>
      </Secao>
    </Capitulo>
  );
}
