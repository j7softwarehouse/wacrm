import {
  Filter,
  MessageCircle,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  Upload,
  Users,
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

export function CapituloContatos() {
  return (
    <Capitulo
      id="contatos"
      numero={3}
      titulo="Contatos"
      resumo="A agenda da instituição: quem é cada pessoa, como classificá-la e como puxar conversa."
    >
      <Secao id="contatos-onde" titulo="Para que serve">
        <Onde>
          <Botao icone={Users}>Contatos</Botao> no menu lateral.
        </Onde>
        <p>
          Todo mundo que manda mensagem para o WhatsApp da instituição vira um
          contato automaticamente; você não precisa cadastrar ninguém à mão
          para atender. Esta tela existe para <em>organizar</em> essas pessoas:
          dar nome a quem chegou só como número, classificar com tags, anotar
          informações e encontrar alguém depois.
        </p>
      </Secao>

      <Secao id="contatos-novo" titulo="O selo &ldquo;Novo&rdquo;">
        <p>
          Um contato criado a partir de uma mensagem recebida, e que ainda
          ninguém confirmou quem é, ganha o selo <Termo>Novo</Termo> na lista
          e no painel da conversa. É um lembrete de que falta identificar
          aquela pessoa: dar um nome de verdade em vez de só o telefone.
        </p>
        <p>O selo desaparece quando qualquer uma destas coisas acontece:</p>
        <Lista>
          <li>
            Alguém abre o contato e salva, mesmo sem mudar nada; o próprio ato
            de abrir e confirmar já conta como identificação.
          </li>
          <li>
            O telefone aparece numa planilha importada, na lista de uma
            campanha de Broadcasts, ou é tocado por uma integração externa.
          </li>
        </Lista>
        <Aviso tipo="dica">
          Use o botão <Botao>Somente não identificados</Botao> para listar de
          uma vez só quem ainda está com o selo <Termo>Novo</Termo>, e ir
          confirmando aos poucos.
        </Aviso>
      </Secao>

      <Secao id="contatos-encontrar" titulo="Encontrar alguém">
        <Lista>
          <li>
            <Botao icone={Search}>Procurar por nome, telefone ou email...</Botao>
            : busca nos três campos ao mesmo tempo.
          </li>
          <li>
            <Botao icone={Filter}>Filtrar por tags</Botao>: mostra só quem tem
            as etiquetas escolhidas. O número ao lado indica quantas tags estão
            ligadas no filtro.
          </li>
        </Lista>
        <p>
          Clicando no cabeçalho de uma coluna a lista é reordenada por ela. No
          rodapé ficam a contagem total e a navegação entre páginas.
        </p>
      </Secao>

      <Secao id="contatos-adicionar" titulo="Adicionar um contato">
        <Passos>
          <Passo>
            Clique em <Botao icone={Plus}>Adicionar Contato</Botao>.
          </Passo>
          <Passo>
            Preencha os dados. <Termo>O telefone é obrigatório</Termo>, pois é
            ele que liga o contato ao WhatsApp. Nome, e-mail e empresa são
            opcionais, mas o nome ajuda muito a equipe inteira.
          </Passo>
          <Passo>Salve.</Passo>
        </Passos>
        <Aviso tipo="atencao">
          Informe o telefone com código do país e DDD, sem espaços ou traços,
          por exemplo <Termo>5531999998888</Termo>. Um número incompleto
          impede o envio da mensagem.
        </Aviso>
      </Secao>

      <Secao id="contatos-editar" titulo="Editar, classificar e apagar">
        <p>
          Clique no contato para abrir os detalhes, ou use o menu de três
          pontinhos na linha dele para <Botao icone={Pencil}>Editar</Botao> e{" "}
          <Botao icone={Trash2}>Deletar</Botao>.
        </p>
        <p>Dentro do contato você encontra:</p>
        <Lista>
          <li>
            <Termo>Informações de contato</Termo>: telefone, e-mail, empresa.
          </li>
          <li>
            <Termo>Tags</Termo>: etiquetas livres que a instituição define (por
            exemplo: responsável, aluno, ex-aluno, fornecedor). São a principal
            forma de segmentar depois, inclusive para disparos em massa.
          </li>
          <li>
            <Termo>Campos personalizados</Termo>: informações próprias da
            instituição, como turma, matrícula ou série. Aqui você preenche o
            valor de cada um.
          </li>
        </Lista>
        <Aviso tipo="admin">
          O botão <Botao icone={SlidersHorizontal}>Campos personalizados</Botao>{" "}
          no topo da tela, que <em>cria</em> a lista de campos que todo contato
          passa a ter, só aparece para administradores. O atendente preenche os
          campos, mas não define quais existem.
        </Aviso>
        <Aviso tipo="atencao">
          Apagar um contato não pode ser desfeito. Para tirar alguém do caminho
          sem perder o histórico, prefira uma tag (por exemplo{" "}
          <Termo>inativo</Termo>) em vez de apagar.
        </Aviso>
      </Secao>

      <Secao id="contatos-conversar" titulo="Começar uma conversa pelo contato">
        <p>
          Use <Botao icone={MessageCircle}>Conversar</Botao>, na linha do
          contato ou dentro dos detalhes dele. O sistema abre a conversa daquela
          pessoa na Caixa de entrada, criando-a se ainda não existir.
        </p>
        <Aviso tipo="dica">
          É o caminho para falar com alguém que <em>ainda não</em> escreveu para
          a instituição: sem isso, a conversa só apareceria depois que a pessoa
          mandasse a primeira mensagem.
        </Aviso>
      </Secao>

      <Secao id="contatos-importar" titulo="Importar uma lista">
        <p>
          <Botao icone={Upload}>Importar</Botao> sobe vários contatos de uma vez
          a partir de uma planilha. O assistente mostra as colunas encontradas e
          pede para você indicar qual coluna é o telefone, qual é o nome e assim
          por diante, antes de confirmar.
        </p>
        <p>
          Reimportar a mesma lista não duplica ninguém: um telefone que já
          existe tem o nome, o e-mail e a empresa atualizados se a planilha
          trouxer algo diferente, e o contato sai da fila de{" "}
          <Termo>Novo</Termo> caso ainda estivesse lá.
        </p>
        <Aviso tipo="dica">
          Antes de importar uma lista grande, teste com poucas linhas. Assim dá
          para conferir se os telefones foram lidos no formato certo sem sujar a
          base inteira.
        </Aviso>
      </Secao>

      <Secao id="contatos-massa" titulo="Ações em vários contatos">
        <p>
          As caixinhas de seleção à esquerda de cada linha permitem marcar
          vários contatos. Com pelo menos um marcado, aparece no topo quantos
          estão selecionados e a opção de apagar todos de uma vez; o sistema
          pede confirmação, porque também não há volta.
        </p>
      </Secao>
    </Capitulo>
  );
}
