import {
  KeyRound,
  MessageCircle,
  PlugZap,
  Settings,
  Tags,
  Users,
  UserPlus,
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
          todo mundo enxerga: perfil, senha, aparência (capítulo 1).{" "}
          <Termo>Espaço de trabalho</Termo> é o que vale para a instituição
          inteira, e parte dele só aparece para administradores.
        </p>
        <Aviso tipo="admin">
          As seções <Termo>WhatsApp</Termo>, <Termo>Membros da equipe</Termo> e{" "}
          <Termo>Chaves de API</Termo> só aparecem para Administrador e
          Proprietário; para um Agente ou Visualizador, elas nem constam na
          lista. <Termo>Respostas rápidas</Termo>, <Termo>Campos e tags</Termo>{" "}
          e <Termo>Grupos</Termo> continuam abertas para qualquer atendente,
          embora em Grupos só administradores consigam de fato alterar algo.
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
            token da instância; a credencial é testada antes de salvar.
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
            <Termo>Conectado</Termo>: funcionando, recebendo e enviando.
          </li>
          <li>
            <Termo>Conectando</Termo>: em processo de conexão.
          </li>
          <li>
            <Termo>Desconectado</Termo>: ninguém consegue enviar por esse
            número. É o estado que trava o atendimento inteiro.
          </li>
          <li>
            <Termo>Hibernado</Termo>: adormecido por inatividade.
          </li>
        </Lista>
        <Aviso tipo="atencao">
          O QR Code vale por cerca de 2 minutos. Se expirar, use{" "}
          <Termo>Gerar novo QR Code</Termo>; não adianta insistir no código
          antigo.
        </Aviso>
        <Aviso tipo="dica">
          Se o atendimento parar de repente e todo mundo reclamar que não
          consegue enviar, este é o primeiro lugar a checar. Um celular sem
          bateria, sem internet ou com o WhatsApp desconectado derruba o canal,
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
        <p>
          Qualquer atendente pode abrir esta tela para ver a lista de grupos e
          usar <Botao icone={MessageCircle}>Conversar</Botao>, útil para
          começar a primeira mensagem de um grupo recém-criado, mesmo sem
          nenhuma conversa registrada ainda ali. As demais ações continuam
          reservadas a administradores:
        </p>
        <Lista>
          <li>
            <Termo>Sincronizar grupos</Termo>: busca no WhatsApp a lista
            atualizada de grupos de que o número participa.
          </li>
          <li>
            A chave <Termo>Na caixa de entrada</Termo> liga ou desliga a
            exibição de cada grupo.
          </li>
          <li>
            <Termo>Gerenciar</Termo>: renomear o grupo, ver e alterar
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
          pela opção <Termo>Salvar como resposta rápida</Termo>, e elas passam
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
            <Termo>Tags</Termo>: etiquetas para classificar contatos e
            conversas (responsável, aluno, fornecedor). Viram filtro na Caixa de
            entrada e em Contatos.
          </li>
          <li>
            <Termo>Campos personalizados</Termo>: informações extras que todo
            contato passa a ter (turma, matrícula, série). Aqui você define
            quais campos existem; o preenchimento acontece em cada contato.
          </li>
        </Lista>
        <Aviso tipo="dica">
          Poucas tags bem escolhidas funcionam melhor que dezenas parecidas. Se
          a equipe não souber qual usar, a classificação perde o valor.
        </Aviso>
        <Aviso tipo="admin">
          Qualquer atendente cria e usa <Termo>tags</Termo> livremente. Já a
          lista de <Termo>campos personalizados</Termo>, ou seja, quais campos
          existem para todo contato, só administradores conseguem criar ou
          editar; um atendente comum nem vê esse bloco da tela.
        </Aviso>
      </Secao>

      <Secao id="config-membros" titulo="Membros da equipe e papéis">
        <Onde>
          <Botao icone={UsersRound}>Configurações → Membros da equipe</Botao>
        </Onde>
        <p>
          Lista quem tem acesso, com o papel de cada um e se está online. Esta
          tela é exclusiva de Administrador e Proprietário; um Agente ou
          Visualizador não a vê no menu.
        </p>
        <p>
          Para incluir alguém, um administrador usa{" "}
          <Termo>Convidar membro</Termo>: o sistema gera um link de convite.
        </p>
        <Aviso tipo="atencao">
          O link de convite aparece <Termo>uma única vez</Termo>, no momento da
          criação. Se você fechar a tela sem copiar, não há como ver de novo; é
          preciso revogar o convite e criar outro.
        </Aviso>
        <p>Os quatro papéis:</p>
        <Lista>
          <li>
            <Termo>Proprietário</Termo>: controle total sobre a conta.
          </li>
          <li>
            <Termo>Administrador</Termo>: gerencia membros e todas as
            configurações, incluindo canais e o que se pode alterar em grupos.
          </li>
          <li>
            <Termo>Agente</Termo>: usa o sistema para atender, mas não mexe nas
            configurações sensíveis (a seção de canais fica invisível, e em
            Grupos só consegue ver a lista e conversar).
          </li>
          <li>
            <Termo>Visualizador</Termo>: só leitura, navega e acompanha, mas
            não envia mensagens.
          </li>
        </Lista>
        <Aviso tipo="dica">
          Para a maioria da equipe de atendimento, <Termo>Agente</Termo> é o
          papel certo. Deixe Administrador para quem realmente precisa mexer na
          configuração do WhatsApp.
        </Aviso>
      </Secao>

      <Secao id="config-escopo" titulo="Restringir um agente só ao que é dele">
        <p>
          Por padrão, um <Termo>Agente</Termo> vê a Caixa de entrada inteira.
          Quando alguém deve responder <em>só</em> as conversas atribuídas a
          ela, por exemplo quem cuida de um assunto específico e não deve se
          misturar no restante do atendimento, dá para restringir isso sem
          criar um papel novo.
        </p>
        <p>
          Na linha da pessoa (papel <Termo>Agente</Termo> ou{" "}
          <Termo>Visualizador</Termo>), ao lado do papel aparece um segundo
          seletor com duas opções:
        </p>
        <Lista>
          <li>
            <Termo>Todas as conversas</Termo>: o comportamento de sempre
            (padrão).
          </li>
          <li>
            <Termo>Só as atribuídas</Termo>: a pessoa passa a ver, responder e
            aparecer no menu <em>somente</em> o que estiver atribuído a ela.
            Ela não inicia conversa nova com um contato, não se desatribui e
            não repassa a conversa para outra pessoa. O menu lateral também
            encolhe: sobram só Notificações e Contatos.
          </li>
        </Lista>
        <p>
          A troca aplica na hora, sem precisar salvar. Depois de restringir,
          use <Botao icone={UserPlus}>Atribuir</Botao> dentro de cada conversa
          para dar acesso; sem isso, a pessoa fica restrita e sem nenhuma
          conversa visível.
        </p>
        <Aviso tipo="dica">
          Pense nesse seletor como um segundo eixo, independente do papel: o
          papel decide <em>o que</em> a pessoa pode fazer (responder,
          configurar); o escopo decide <em>quanto</em> da Caixa de entrada ela
          enxerga.
        </Aviso>
      </Secao>

      <Secao id="config-escopo-canal" titulo="Restringir um agente a um canal específico">
        <p>
          Quando a instituição tem <em>mais de um número</em> de WhatsApp
          conectado, dá para limitar um Agente ou Visualizador a atender só um
          canal (ou alguns), em vez da conta inteira. É um eixo separado do
          escopo de conversas explicado acima, e os dois podem ser usados ao
          mesmo tempo: uma pessoa pode estar restrita ao próprio canal{" "}
          <em>e</em> só às conversas atribuídas a ela.
        </p>
        <p>
          Na mesma linha da pessoa, em{" "}
          <Botao icone={UsersRound}>Configurações → Membros da equipe</Botao>,
          existe um seletor de canal com duas opções:
        </p>
        <Lista>
          <li>
            <Termo>Todos os canais</Termo>: o comportamento de sempre
            (padrão).
          </li>
          <li>
            <Termo>Só alguns</Termo>: libera o botão{" "}
            <Termo>Escolher canais</Termo>, que abre uma lista de caixinhas
            com os canais da conta; marque os que essa pessoa atende. Ela
            passa a ver só as conversas e os grupos dos canais marcados.
          </li>
        </Lista>
        <p>
          Quem está restrito a um canal e ainda não tem nenhuma conversa
          visível vê um aviso explicando que ainda não foi atribuído a nenhum
          canal, em vez de uma Caixa de entrada vazia sem explicação.
        </p>
        <Aviso tipo="dica">
          Ninguém muda de comportamento sozinho: por padrão, toda a equipe
          continua enxergando todos os canais até um administrador restringir
          alguém explicitamente.
        </Aviso>
      </Secao>

      <Secao id="config-api" titulo="Chaves de API">
        <Onde>
          <Botao icone={KeyRound}>Configurações → Chaves de API</Botao>
        </Onde>
        <p>
          Credenciais para outro sistema conversar com este CRM, por exemplo um
          site que cadastra interessados automaticamente. Só faz sentido se
          houver uma integração sendo construída.
        </p>
        <Aviso tipo="admin">
          Esta seção é exclusiva de Administrador e Proprietário; um
          atendente comum nem a vê no menu de Configurações.
        </Aviso>
        <Aviso tipo="atencao">
          Uma chave de API dá acesso programático aos dados da instituição.
          Trate como senha: não compartilhe por mensagem, e revogue assim que a
          integração deixar de ser usada.
        </Aviso>
      </Secao>
    </Capitulo>
  );
}
