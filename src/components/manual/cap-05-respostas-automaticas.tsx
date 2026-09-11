import { Bot, Sparkles, Workflow, Zap } from "lucide-react";

import {
  Aviso,
  Botao,
  Capitulo,
  Icone,
  Lista,
  Onde,
  Passo,
  Passos,
  Secao,
  Termo,
} from "./manual-ui";

export function CapituloRespostasAutomaticas() {
  return (
    <Capitulo
      id="respostas-automaticas"
      numero={5}
      titulo="Quando o sistema responde sozinho"
      resumo="Automações, Fluxos e Agentes IA: o que cada um é, como reconhecer uma resposta automática e como assumir o atendimento."
    >
      <Secao id="tres-formas" titulo="Três formas, um mesmo resultado">
        <p>
          O sistema tem três maneiras de responder sem ninguém digitar. Todas
          desembocam no mesmo lugar — a conversa na Caixa de entrada — e é por
          isso que vale saber diferenciá-las:
        </p>
        <Lista>
          <li>
            <Botao icone={Zap}>Automações</Botao> — regras do tipo{" "}
            <em>quando acontecer isso, faça aquilo</em>. O gatilho pode ser uma
            palavra-chave na mensagem do contato, um horário programado ou o
            clique num botão. Serve para tarefas repetitivas: responder
            &ldquo;horário de funcionamento&rdquo;, marcar uma tag, avisar
            alguém.
          </li>
          <li>
            <Botao icone={Workflow}>Fluxos</Botao> — conversas em árvore, com
            botões. O contato toca numa opção e é levado ao próximo passo. É o
            formato de menu: &ldquo;1 para matrículas, 2 para financeiro&rdquo;.
            Bom para triagem antes de chegar numa pessoa.
          </li>
          <li>
            <Botao icone={Bot}>Agentes IA</Botao> — um assistente que entende
            texto livre e responde com as próprias palavras, usando a base de
            conhecimento da instituição. Quando não sabe ou percebe que o
            assunto é delicado, ele repassa para um humano.
          </li>
        </Lista>
        <Aviso tipo="dica">
          Resumindo a diferença: <Termo>Automação</Termo> é uma regra fixa,{" "}
          <Termo>Fluxo</Termo> é um menu de botões e <Termo>Agente IA</Termo> é
          uma conversa em linguagem natural.
        </Aviso>
      </Secao>

      <Secao id="reconhecer" titulo="Reconhecer uma resposta automática">
        <p>
          Na conversa, mensagens enviadas pelo assistente de IA trazem o selo{" "}
          <Termo>IA</Termo> ao lado do horário. É a forma de saber, batendo o
          olho, que aquilo não foi escrito por um colega.
        </p>
        <p>
          Quando um agente de IA está cuidando de uma conversa, aparece um aviso
          no topo dela: <Termo>Assistente de IA respondendo automaticamente</Termo>.
        </p>
      </Secao>

      <Secao id="assumir" titulo="Assumir o atendimento da IA">
        <p>
          Em qualquer momento você pode tomar a frente — e deve, sempre que o
          assunto for sensível, envolver dinheiro, prazo ou uma reclamação.
        </p>
        <Passos>
          <Passo>
            No aviso no topo da conversa, clique em <Termo>Assumir</Termo>.
          </Passo>
          <Passo>
            O assistente para de responder naquela conversa e o aviso muda para{" "}
            <Termo>Assistente de IA pausado aqui</Termo>. A partir daí, quem
            responde é você.
          </Passo>
          <Passo>
            Terminado o assunto, se quiser devolver o atendimento ao
            assistente, clique em <Termo>Retomar IA</Termo> no mesmo aviso.
          </Passo>
        </Passos>
        <Aviso tipo="atencao">
          A pausa vale <Termo>só para aquela conversa</Termo>, e continua valendo
          até alguém retomar. Ela não desliga o assistente nas outras conversas
          nem no sistema todo.
        </Aviso>
      </Secao>

      <Secao id="ia-rascunho" titulo="Usar a IA sem deixá-la responder sozinha">
        <p>
          Existe um meio-termo: o <Icone icone={Sparkles} /> no campo de escrita
          pede uma sugestão de resposta, que entra como rascunho para você ler,
          corrigir e enviar. A IA ajuda a redigir, mas a palavra final é sua e a
          assinatura é sua.
        </p>
      </Secao>

      <Secao id="ver-configurado" titulo="Ver o que está configurado">
        <Onde>
          <Botao icone={Zap}>Automações</Botao>,{" "}
          <Botao icone={Workflow}>Fluxos</Botao> e{" "}
          <Botao icone={Bot}>Agentes IA</Botao> no menu lateral.
        </Onde>
        <p>
          Você pode abrir essas telas para entender o que está no ar. Em
          Automações, cada item mostra se está <Termo>Ativo</Termo>, quantas
          vezes já executou e quando foi a última — e o botão{" "}
          <Termo>Ver Logs</Termo> abre o histórico de execuções, útil para
          descobrir por que uma resposta automática saiu (ou não saiu). Em
          Fluxos, cada um aparece como <Termo>Rascunho</Termo>,{" "}
          <Termo>Ativo</Termo> ou <Termo>Arquivado</Termo>. Em Agentes IA existe
          um <Termo>Playground</Termo>, onde dá para testar como o assistente
          responderia a uma pergunta, sem falar com cliente nenhum.
        </p>
        <Aviso tipo="admin">
          Criar, editar, ativar ou desativar automações, fluxos e agentes é
          tarefa de quem administra o sistema. Se uma resposta automática estiver
          errada ou atrapalhando, o caminho é avisar a pessoa responsável — não
          tente corrigir a regra no meio de um atendimento.
        </Aviso>
      </Secao>
    </Capitulo>
  );
}
