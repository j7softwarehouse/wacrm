import {
  Check,
  CheckCheck,
  ChevronDown,
  Clock,
  Copy,
  CornerUpLeft,
  FileText,
  Image as ImageIcon,
  Mic,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Send,
  SmilePlus,
  Sparkles,
  Square,
  StickyNote,
  Tag as TagIcon,
  Trash2,
  UserPlus,
  Video,
  X,
  XCircle,
  Zap,
} from "lucide-react";

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

export function CapituloCaixaDeEntrada() {
  return (
    <Capitulo
      id="caixa-de-entrada"
      numero={2}
      titulo="Caixa de entrada"
      resumo="O dia a dia do atendimento: encontrar a conversa certa, responder, organizar e passar adiante."
    >
      <Secao id="como-chegam" titulo="Como as conversas chegam">
        <p>
          Quando alguém manda mensagem para o número de WhatsApp da instituição,
          a conversa aparece sozinha na lista à esquerda, com um ponto colorido
          indicando o status e a contagem de mensagens não lidas. Não é preciso
          atualizar a página: mensagens novas entram na hora.
        </p>
        <p>
          A tela se divide em três colunas: a <Termo>lista de conversas</Termo>{" "}
          à esquerda, a <Termo>conversa aberta</Termo> no meio e o{" "}
          <Termo>painel do contato</Termo> à direita, com os dados da pessoa.
        </p>
        <Aviso tipo="dica">
          Se desconfiar que alguma coisa não chegou, use o{" "}
          <Icone icone={RefreshCw} /> no topo da conversa para recarregar. Ele
          busca de novo as mensagens e a lista.
        </Aviso>
      </Secao>

      <Secao id="encontrar" titulo="Encontrar uma conversa">
        <p>Acima da lista existem duas ferramentas:</p>
        <Lista>
          <li>
            <Botao icone={Search}>Procurar conversas...</Botao> — busca por nome
            ou telefone.
          </li>
          <li>
            <Botao icone={ChevronDown}>Todos</Botao> — o filtro. Ele abre as
            opções <Termo>Todos</Termo>, <Termo>Não lido</Termo>,{" "}
            <Termo>Aberto</Termo>, <Termo>Pendente</Termo> e{" "}
            <Termo>Fechado</Termo>, e também permite filtrar por{" "}
            <Termo>Tags</Termo> e por <Termo>Empresa</Termo>.
          </li>
        </Lista>
        <p>
          Quando vários filtros estiverem ligados ao mesmo tempo, o botão{" "}
          <Termo>Limpar tudo</Termo> devolve a lista ao normal.
        </p>
        <Aviso tipo="dica">
          O filtro <Termo>Não lido</Termo> é o melhor jeito de começar o
          expediente: ele mostra só o que ainda ninguém respondeu.
        </Aviso>
      </Secao>

      <Secao id="responder" titulo="Ler e responder">
        <Passos>
          <Passo>Clique na conversa na lista à esquerda.</Passo>
          <Passo>
            Leia o histórico. As mensagens do contato ficam à esquerda; as que a
            instituição enviou ficam à direita, coloridas.
          </Passo>
          <Passo>
            Escreva no campo <Termo>Digite uma mensagem...</Termo> lá embaixo e
            aperte <Termo>Enter</Termo> ou clique em <Icone icone={Send} />.
          </Passo>
        </Passos>
        <p>
          Para quebrar linha sem enviar, use <Termo>Shift + Enter</Termo>.
        </p>
        <p>
          Cada mensagem enviada mostra um indicador do que aconteceu com ela:
        </p>
        <Lista>
          <li>
            <Icone icone={Clock} /> saindo — ainda está sendo enviada.
          </li>
          <li>
            <Icone icone={Check} /> enviada — chegou ao WhatsApp.
          </li>
          <li>
            <Icone icone={CheckCheck} /> entregue — chegou ao celular da pessoa.
          </li>
          <li>
            <Icone icone={CheckCheck} /> em azul — a pessoa leu.
          </li>
          <li>
            <Icone icone={XCircle} /> falhou — não foi enviada. Veja o capítulo
            7 para os motivos mais comuns.
          </li>
        </Lista>
        <Aviso tipo="atencao">
          Toda mensagem enviada pelo CRM sai assinada com o seu nome. O contato
          vê quem está falando com ele, e seus colegas também identificam quem
          atendeu.
        </Aviso>
      </Secao>

      <Secao id="acoes-na-mensagem" titulo="Ações em uma mensagem">
        <p>
          Passe o mouse sobre qualquer mensagem (ou segure o dedo, no celular) e
          aparece uma barrinha com as ações disponíveis:
        </p>
        <Lista>
          <li>
            <Botao icone={SmilePlus}>Reagir</Botao> — responde com um emoji, sem
            escrever nada.
          </li>
          <li>
            <Botao icone={CornerUpLeft}>Responder</Botao> — cita aquela mensagem
            na sua resposta, para não haver dúvida sobre o que você está
            respondendo.
          </li>
          <li>
            <Botao icone={Copy}>Copiar texto</Botao> — copia o conteúdo.
          </li>
          <li>
            <Botao icone={Pencil}>Editar</Botao> — corrige uma mensagem de texto
            que <em>você</em> enviou.
          </li>
          <li>
            <Botao icone={Trash2}>Deletar</Botao> — apaga para todos no
            WhatsApp.
          </li>
        </Lista>
        <p>
          Para cancelar uma citação antes de enviar, clique no{" "}
          <Icone icone={X} /> ao lado dela.
        </p>
      </Secao>

      <Secao id="editar" titulo="Editar uma mensagem já enviada">
        <Passos>
          <Passo>
            Passe o mouse sobre a sua mensagem e clique em{" "}
            <Botao icone={Pencil}>Editar</Botao>.
          </Passo>
          <Passo>
            O texto aparece preenchido no campo de escrita, com o aviso{" "}
            <Termo>Editando mensagem</Termo> logo acima.
          </Passo>
          <Passo>Corrija o texto e envie normalmente.</Passo>
        </Passos>
        <p>
          A mensagem é corrigida no WhatsApp do contato também, e passa a exibir{" "}
          <Termo>(editado)</Termo> ao lado do horário — igual ao WhatsApp comum.
          Para desistir no meio, clique no <Icone icone={X} /> do aviso.
        </p>
        <Aviso tipo="atencao">
          Só dá para editar mensagens de texto que você mesmo enviou, e o
          WhatsApp só aceita a edição dentro de um prazo curto depois do envio.
          Passado esse prazo, o sistema avisa que não foi possível editar — e o
          texto que você digitou continua no campo, sem se perder.
        </Aviso>
      </Secao>

      <Secao id="apagar" titulo="Apagar uma mensagem">
        <Passos>
          <Passo>
            Passe o mouse sobre a mensagem e clique em{" "}
            <Botao icone={Trash2}>Deletar</Botao>.
          </Passo>
          <Passo>Confirme na pergunta que aparece.</Passo>
        </Passos>
        <p>
          A mensagem some do WhatsApp do contato e, na conversa, o balão vira{" "}
          <Termo>Mensagem apagada</Termo>. Se ela estava citada em alguma
          resposta, a citação também passa a mostrar o mesmo aviso.
        </p>
        <Aviso tipo="dica">
          O conteúdo original continua guardado no banco de dados da
          instituição, mesmo sumindo da tela. Isso é proposital: serve de
          registro caso alguém precise auditar um atendimento depois.
        </Aviso>
      </Secao>

      <Secao id="anexos" titulo="Enviar foto, vídeo, documento ou áudio">
        <p>
          O <Icone icone={Paperclip} /> ao lado do campo de escrita abre as
          opções de anexo:
        </p>
        <Lista>
          <li>
            <Botao icone={ImageIcon}>Foto</Botao>
          </li>
          <li>
            <Botao icone={Video}>Vídeo</Botao>
          </li>
          <li>
            <Botao icone={FileText}>Documento</Botao>
          </li>
          <li>
            <Botao icone={Mic}>Nota de voz</Botao>
          </li>
        </Lista>
        <p>
          Depois de escolher o arquivo, aparece uma pré-visualização com o campo{" "}
          <Termo>Adicionar legenda…</Termo>. Escreva a legenda se quiser e envie
          em <Icone icone={Send} />. Para trocar de arquivo, use{" "}
          <Termo>Remover anexo</Termo>.
        </p>
        <p>
          Para gravar um áudio na hora: escolha <Botao icone={Mic}>Nota de voz</Botao>,
          fale, e finalize em <Botao icone={Square}>Parar e anexar</Botao>.
          Enquanto grava, o sistema mostra o tempo corrido. Se mudar de ideia,{" "}
          <Termo>Cancelar</Termo> descarta a gravação.
        </p>
        <Aviso tipo="atencao">
          Vídeos podem ter até 30 MB. Arquivos recebidos ficam disponíveis por
          48 horas — depois disso, o histórico guarda o registro da mensagem,
          mas o arquivo em si não abre mais. Se for algo importante, baixe e
          guarde.
        </Aviso>
      </Secao>

      <Secao id="respostas-rapidas" titulo="Respostas rápidas">
        <p>
          São textos prontos para o que você responde toda hora — horário de
          funcionamento, endereço, documentos necessários para matrícula.
        </p>
        <Passos>
          <Passo>
            Clique em <Icone icone={Plus} /> ao lado do campo de escrita e
            escolha <Botao icone={Zap}>Respostas rápidas</Botao>.
          </Passo>
          <Passo>Clique na resposta desejada: o texto entra no campo.</Passo>
          <Passo>Ajuste o que precisar e envie.</Passo>
        </Passos>
        <p>
          Para transformar algo que você acabou de escrever em resposta rápida,
          use <Termo>Salvar como resposta rápida</Termo> no mesmo menu — o
          sistema pede um nome e guarda para a equipe inteira usar.
        </p>
        <Onde>
          Para criar e organizar a lista completa:{" "}
          <Termo>Configurações → Respostas rápidas</Termo>.
        </Onde>
      </Secao>

      <Secao id="rascunho-ia" titulo="Rascunhar uma resposta com IA">
        <p>
          O <Icone icone={Sparkles} /> ao lado do campo de escrita pede ao
          assistente de IA uma sugestão de resposta com base na conversa até
          ali. O texto entra no campo como rascunho.
        </p>
        <Aviso tipo="atencao">
          É um rascunho, não uma resposta pronta. <strong>Leia e corrija antes
          de enviar</strong> — quem assina a mensagem é você, e a IA pode errar
          detalhes como datas, valores e nomes.
        </Aviso>
      </Secao>

      <Secao id="status" titulo="Organizar com o status da conversa">
        <p>
          No topo da conversa há um seletor de status. Ele é a forma da equipe
          combinar em que pé está cada atendimento:
        </p>
        <Lista>
          <li>
            <Termo>Aberto</Termo> — em andamento, precisa de atenção.
          </li>
          <li>
            <Termo>Pendente</Termo> — esperando algo: o retorno do contato, um
            documento, uma decisão interna.
          </li>
          <li>
            <Termo>Fechado</Termo> — resolvido.
          </li>
        </Lista>
        <p>
          Cada status tem uma cor, que aparece como um pontinho na lista de
          conversas — assim dá para bater o olho e saber o que está pendente sem
          abrir nada. O status também alimenta os filtros da lista.
        </p>
        <Aviso tipo="dica">
          Fechar a conversa não apaga nem esconde nada. Ela continua na lista, e
          se o contato escrever de novo ela volta a aparecer normalmente.
        </Aviso>
      </Secao>

      <Secao id="atribuir" titulo="Passar a conversa para um colega">
        <Passos>
          <Passo>
            No topo da conversa, clique em <Botao icone={UserPlus}>Atribuir</Botao>.
          </Passo>
          <Passo>Escolha o colega na lista.</Passo>
        </Passos>
        <p>
          A pessoa recebe um aviso em <Termo>Notificações</Termo> e passa a
          constar como responsável. Para desfazer, abra o mesmo menu e escolha{" "}
          <Termo>Desatribuir</Termo>.
        </p>
      </Secao>

      <Secao id="painel-contato" titulo="O painel do contato">
        <p>
          À direita da conversa fica o painel com os dados de quem está do outro
          lado: telefone, e-mail e empresa. Ali você também gerencia:
        </p>
        <Lista>
          <li>
            <Botao icone={TagIcon}>Tags</Botao> — etiquetas para classificar o
            contato (por exemplo: responsável, aluno, fornecedor). Elas viram
            filtro na lista de conversas e na tela de Contatos.
          </li>
          <li>
            <Botao icone={StickyNote}>Notas</Botao> — anotações internas sobre o
            atendimento. <strong>O contato nunca vê as notas</strong>; elas são
            só para a equipe.
          </li>
        </Lista>
        <p>
          Precisando de mais espaço na tela, dá para esconder esse painel pelo
          botão de painel no topo da conversa, e trazer de volta pelo mesmo
          lugar.
        </p>
      </Secao>

      <Secao id="grupos" titulo="Conversas de grupo">
        <p>
          Grupos de WhatsApp aparecem na Caixa de entrada como qualquer outra
          conversa. Duas diferenças no dia a dia:
        </p>
        <Lista>
          <li>
            Acima de cada mensagem recebida aparece o nome de{" "}
            <Termo>qual participante</Termo> escreveu.
          </li>
          <li>
            Mensagem com botões não pode ser enviada em grupo — qualquer
            participante poderia clicar, e a resposta ficaria ambígua.
          </li>
        </Lista>
        <p>
          Se o número da instituição sair do grupo, a conversa fica somente
          leitura, com o aviso <Termo>Você saiu deste grupo</Termo>. O histórico
          continua disponível para consulta. Caso o número seja adicionado de
          volta, o sistema percebe sozinho em poucos minutos e a conversa volta
          a funcionar.
        </p>
        <Aviso tipo="admin">
          Escolher quais grupos aparecem na Caixa de entrada, sair de um grupo,
          renomear ou mexer nos participantes é feito em{" "}
          <Termo>Configurações → Grupos</Termo>, e exige papel de administrador.
        </Aviso>
      </Secao>

      <Secao id="nao-consigo-enviar" titulo="Quando o envio está bloqueado">
        <p>
          Se o campo de escrita aparecer desabilitado, o próprio sistema explica
          o motivo logo acima dele. Os casos possíveis:
        </p>
        <Lista>
          <li>
            <Termo>Somente leitura</Termo> — seu papel é Visualizador, que
            navega mas não responde.
          </li>
          <li>
            <Termo>Canal indisponível</Termo> — o WhatsApp da instituição está
            desconectado, ou o canal daquela conversa foi removido.
          </li>
          <li>
            <Termo>Você saiu deste grupo</Termo> — o número não participa mais
            daquele grupo.
          </li>
        </Lista>
        <p>
          Os dois últimos casos são resolvidos por um administrador. O capítulo
          7 traz o que fazer em cada situação.
        </p>
      </Secao>
    </Capitulo>
  );
}
