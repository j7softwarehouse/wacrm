import {
  KeyRound,
  MessageCircle,
  PlugZap,
  Settings,
  Tags,
  Users,
  UsersRound,
  Zap,
} from "lucide-react";

import {
  Aviso,
  Botao,
  Capitulo,
  Lista,
  Onde,
  Passo,
  Passos,
  Secao,
  Termo,
} from "./manual-ui";

export function CapituloConfiguracoes() {
  return (
    <Capitulo
      id="configuracoes"
      numero={6}
      titulo="Configurações (administração)"
      resumo="A parte de quem administra: conectar o WhatsApp, controlar grupos, organizar conteúdo e gerenciar a equipe."
    >
      <Secao id="config-visao" titulo="Como a tela se organiza">
        <Onde>
          <Botao icone={Settings}>Configurações</Botao> no menu lateral.
        </Onde>
        <p>
          As seções ficam em duas famílias. <Termo>Conta</Termo> é o que é seu e
          todo mundo enxerga — perfil, senha, aparência (capítulo 1).{" "}
          <Termo>Espaço de trabalho</Termo> é o que vale para a instituição
          inteira, e parte dele só aparece para administradores.
        </p>
        <Aviso tipo="admin">
          As seções <Termo>WhatsApp</Termo> e <Termo>Grupos</Termo> só aparecem
          para Administrador e Proprietário. Elas expõem credenciais e controlam
          por onde as mensagens entram e saem — por isso não ficam visíveis para
          o atendente comum.
        </Aviso>
      </Secao>

      <Secao id="config-whatsapp" titulo="Conectar o WhatsApp (canais)">
        <Onde>
          <Botao icone={PlugZap}>Configurações → WhatsApp</Botao>
        </Onde>
        <p>
          É aqui que o número de WhatsApp da instituição se conecta ao sistema.
          A conexão é feita por <Termo>QR Code</Termo>, do mesmo jeito que o
          WhatsApp Web.
        </p>
        <Passos>
          <Passo>
            Na lista de canais, clique em <Termo>Conectar</Termo> no canal
            desejado. Para cadastrar um número novo, use{" "}
            <Termo>Adicionar canal</Termo> e informe o rótulo, o subdomínio e o
            token da instância — a credencial é testada antes de salvar.
          </Passo>
          <Passo>
            Um QR Code aparece na tela. No celular que tem o número, abra o
            WhatsApp, vá em <Termo>Aparelhos conectados</Termo> e escaneie.
          </Passo>
          <Passo>
            Assim que o WhatsApp confirmar, a janela fecha sozinha e o canal
            passa a <Termo>Conectado</Termo>.
          </Passo>
        </Passos>
        <p>Cada canal mostra o próprio estado:</p>
        <Lista>
          <li>
            <Termo>Conectado</Termo> — funcionando, recebendo e enviando.
          </li>
          <li>
            <Termo>Conectando</Termo> — em processo de conexão.
          </li>
          <li>
            <Termo>Desconectado</Termo> — ninguém consegue enviar por esse
            número. É o estado que trava o atendimento inteiro.
          </li>
          <li>
            <Termo>Hibernado</Termo> — adormecido por inatividade.
          </li>
        </Lista>
        <Aviso tipo="atencao">
          O QR Code vale por cerca de 2 minutos. Se expirar, use{" "}
          <Termo>Gerar novo QR Code</Termo> — não adianta insistir no código
          antigo.
        </Aviso>
        <Aviso tipo="dica">
          Se o atendimento parar de repente e todo mundo reclamar que não
          consegue enviar, este é o primeiro lugar a checar. Um celular sem
          bateria, sem internet ou com o WhatsApp desconectado derruba o canal —
          e a solução costuma ser reconectar pelo QR Code.
        </Aviso>
        <p>
          <Termo>Remover</Termo> desliga o canal: as conversas dele viram
          histórico somente leitura. Nada é apagado, mas aquelas conversas param
          de receber mensagens novas.
        </p>
      </Secao>

      <Secao id="config-grupos" titulo="Grupos de WhatsApp">
        <Onde>
          <Botao icone={Users}>Configurações → Grupos</Botao>
        </Onde>
        <p>
          Esta tela decide <Termo>quais grupos aparecem na Caixa de entrada</Termo>
          . O número conectado pode participar de dezenas de grupos, e nem todos
          interessam ao atendimento.
        </p>
        <Lista>
          <li>
            <Termo>Sincronizar grupos</Termo> — busca no WhatsApp a lista
            atualizada de grupos de que o número participa.
          </li>
          <li>
            A chave <Termo>Na caixa de entrada</Termo> liga ou desliga a
            exibição de cada grupo.
          </li>
          <li>
            <Botao icone={MessageCircle}>Conversar</Botao> — abre a conversa
            daquele grupo, útil para mandar a primeira mensagem num grupo recém
            criado, antes de alguém escrever nele.
          </li>
          <li>
            <Termo>Gerenciar</Termo> — renomear o grupo, ver e alterar
            participantes, ou <Termo>Sair do grupo</Termo>.
          </li>
        </Lista>
        <Aviso tipo="atencao">
          Sair de um grupo tem efeito real no WhatsApp: o número deixa o grupo
          de verdade. A conversa vira somente leitura no sistema e, para voltar,
          alguém precisa adicionar o número de novo pelo WhatsApp. Quando isso
          acontece, o sistema percebe sozinho em poucos minutos.
        </Aviso>
      </Secao>

      <Secao id="config-respostas" titulo="Respostas rápidas">
        <Onde>
          <Botao icone={Zap}>Configurações → Respostas rápidas</Botao>
        </Onde>
        <p>
          A lista de textos prontos que a equipe usa na Caixa de entrada. Vale
          investir aqui: cada resposta bem escrita economiza digitação todos os
          dias e padroniza o que a instituição responde.
        </p>
        <p>
          Atendentes também podem criar respostas rápidas direto da conversa,
          pela opção <Termo>Salvar como resposta rápida</Termo> — e elas passam
          a valer para a equipe inteira.
        </p>
      </Secao>

      <Secao id="config-campos" titulo="Campos e tags">
        <Onde>
          <Botao icone={Tags}>Configurações → Campos e tags</Botao>
        </Onde>
        <p>Duas coisas diferentes convivem nesta seção:</p>
        <Lista>
          <li>
            <Termo>Tags</Termo> — etiquetas para classificar contatos e
            conversas (responsável, aluno, fornecedor). Viram filtro na Caixa de
            entrada e em Contatos.
          </li>
          <li>
            <Termo>Campos personalizados</Termo> — informações extras que todo
            contato passa a ter (turma, matrícula, série). Aqui você define
            quais campos existem; o preenchimento acontece em cada contato.
          </li>
        </Lista>
        <Aviso tipo="dica">
          Poucas tags bem escolhidas funcionam melhor que dezenas parecidas. Se
          a equipe não souber qual usar, a classificação perde o valor.
        </Aviso>
      </Secao>

      <Secao id="config-membros" titulo="Membros da equipe e papéis">
        <Onde>
          <Botao icone={UsersRound}>Configurações → Membros da equipe</Botao>
        </Onde>
        <p>
          Lista quem tem acesso, com o papel de cada um e se está online. Para
          incluir alguém, use <Termo>Convidar membro</Termo>: o sistema gera um
          link de convite.
        </p>
        <Aviso tipo="atencao">
          O link de convite aparece <Termo>uma única vez</Termo>, no momento da
          criação. Se você fechar a tela sem copiar, não há como ver de novo — é
          preciso revogar o convite e criar outro.
        </Aviso>
        <p>Os quatro papéis:</p>
        <Lista>
          <li>
            <Termo>Proprietário</Termo> — controle total sobre a conta.
          </li>
          <li>
            <Termo>Administrador</Termo> — gerencia membros e todas as
            configurações, incluindo canais e grupos.
          </li>
          <li>
            <Termo>Agente</Termo> — usa o sistema para atender, mas não mexe nas
            configurações sensíveis (canais e grupos ficam invisíveis).
          </li>
          <li>
            <Termo>Visualizador</Termo> — só leitura: navega e acompanha, mas
            não envia mensagens.
          </li>
        </Lista>
        <Aviso tipo="dica">
          Para a maioria da equipe de atendimento, <Termo>Agente</Termo> é o
          papel certo. Deixe Administrador para quem realmente precisa mexer na
          configuração do WhatsApp.
        </Aviso>
      </Secao>

      <Secao id="config-api" titulo="Chaves de API">
        <Onde>
          <Botao icone={KeyRound}>Configurações → Chaves de API</Botao>
        </Onde>
        <p>
          Credenciais para outro sistema conversar com este CRM — por exemplo um
          site que cadastra interessados automaticamente. Só faz sentido se
          houver uma integração sendo construída.
        </p>
        <Aviso tipo="atencao">
          Uma chave de API dá acesso programático aos dados da instituição.
          Trate como senha: não compartilhe por mensagem, e revogue assim que a
          integração deixar de ser usada.
        </Aviso>
      </Secao>
    </Capitulo>
  );
}
