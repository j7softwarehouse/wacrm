import {
  Bell,
  Bot,
  LayoutDashboard,
  MessageSquare,
  Settings,
  Users,
  Workflow,
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

export function CapituloPrimeirosPassos() {
  return (
    <Capitulo
      id="primeiros-passos"
      numero={1}
      titulo="Primeiros passos"
      resumo="Entrar no sistema, reconhecer as áreas da tela e deixar sua conta do seu jeito."
    >
      <Secao id="entrar" titulo="Entrar no sistema">
        <Passos>
          <Passo>
            Abra o endereço do CRM no navegador. Recomendamos o Google Chrome no
            computador — é onde tudo foi testado.
          </Passo>
          <Passo>
            Digite o seu <Termo>e-mail</Termo> e a sua <Termo>senha</Termo> e
            confirme.
          </Passo>
          <Passo>
            Você cai direto na <Termo>Caixa de entrada</Termo>, que é onde o
            atendimento acontece.
          </Passo>
        </Passos>
        <p>
          Esqueceu a senha? Na tela de entrada existe o link{" "}
          <Termo>Esqueci minha senha</Termo>. Você informa o e-mail e recebe uma
          mensagem com o link para cadastrar uma senha nova. O link vale por
          tempo limitado — se demorar para abrir, é só pedir outro.
        </p>
        <Aviso tipo="atencao">
          Cada pessoa da equipe usa o próprio login. Não compartilhe o seu: as
          conversas que você atende, as notas que escreve e as mensagens que
          envia ficam registradas com o seu nome, e quem recebe no WhatsApp vê a
          sua assinatura na mensagem.
        </Aviso>
      </Secao>

      <Secao id="conhecendo-a-tela" titulo="Conhecendo a tela">
        <p>
          A tela tem três regiões fixas: o <Termo>menu lateral</Termo> à
          esquerda, o <Termo>cabeçalho</Termo> no topo e a{" "}
          <Termo>área de trabalho</Termo> no centro, que muda conforme o que
          você escolhe no menu.
        </p>
        <p>No menu lateral você encontra:</p>
        <Lista>
          <li>
            <Botao icone={LayoutDashboard}>Dashboard</Botao> — o resumo do dia
            em números.
          </li>
          <li>
            <Botao icone={MessageSquare}>Caixa de entrada</Botao> — todas as
            conversas de WhatsApp. É aqui que você passa o dia.
          </li>
          <li>
            <Botao icone={Bell}>Notificações</Botao> — avisos de conversas que
            alguém passou para você.
          </li>
          <li>
            <Botao icone={Users}>Contatos</Botao> — a lista de pessoas, com
            telefone, e-mail, tags e anotações.
          </li>
          <li>
            <Botao icone={Zap}>Automações</Botao>,{" "}
            <Botao icone={Workflow}>Fluxos</Botao> e{" "}
            <Botao icone={Bot}>Agentes IA</Botao> — as três formas de o sistema
            responder sozinho. O capítulo 6 explica cada uma.
          </li>
          <li>
            <Botao icone={Settings}>Configurações</Botao> — sua conta e os
            ajustes do espaço de trabalho.
          </li>
        </Lista>
        <p>
          No canto inferior do menu aparece o seu nome e o seu papel
          (Proprietário, Administrador, Agente ou Visualizador). O papel decide
          o que você consegue ver e fazer — por isso alguns colegas enxergam
          opções que você não vê, e vice-versa. Além do papel, a lista também
          pode variar conforme a forma como o WhatsApp da instituição está
          conectado — é o caso de <Termo>Broadcasts</Termo>, que o capítulo 7
          explica.
        </p>
        <Aviso tipo="dica">
          Em celular ou tablet o menu lateral fica escondido. Toque no ícone de
          três traços no canto superior esquerdo para abri-lo.
        </Aviso>
      </Secao>

      <Secao id="seu-perfil" titulo="Seu perfil, sua senha e a aparência">
        <Onde>
          <Botao icone={Settings}>Configurações</Botao> no menu lateral.
        </Onde>
        <p>
          Três seções ali são suas e ninguém mais mexe nelas — elas aparecem
          para todo mundo, independente do papel:
        </p>
        <Lista>
          <li>
            <Termo>Seu perfil</Termo> — seu nome e sua foto. O nome que você
            colocar aqui é o que aparece assinado nas mensagens que você envia
            pelo WhatsApp, então vale caprichar.
          </li>
          <li>
            <Termo>Entrada e segurança</Termo> — trocar a sua senha.
          </li>
          <li>
            <Termo>Aparência</Termo> — tema claro ou escuro e a cor de destaque
            do sistema. É só uma preferência visual sua; não muda nada para os
            colegas.
          </li>
        </Lista>
        <Aviso tipo="dica">
          O tema claro ou escuro também pode ser trocado direto pelo ícone de
          sol/lua no cabeçalho, sem precisar entrar em Configurações.
        </Aviso>
      </Secao>
    </Capitulo>
  );
}
