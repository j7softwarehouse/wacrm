import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// ============================================================
// Primitivos do Manual.
//
// Por que existem: o manual é texto longo escrito à mão, e sem peças
// prontas cada capítulo inventaria a própria formatação. Estes
// componentes são o vocabulário visual fechado do documento.
//
// A peça central é <Botao>: ela renderiza o ÍCONE REAL que a tela usa
// (o mesmo componente do lucide-react importado pelo código da
// interface) ao lado do rótulo real em português. Foi escolha explícita
// do usuário — o desenho do manual tem que ser idêntico ao que a pessoa
// vê na tela, não uma imitação aproximada.
//
// O texto do manual fica em português direto no componente, fora dos
// arquivos de tradução: é prosa longa de documentação, não rótulo de
// interface, e traduzir 40 páginas para en/ko não serve a ninguém aqui
// (a equipe é brasileira). Só a moldura da página passa pelo i18n.
// ============================================================

/** Um capítulo do manual. O `id` vira âncora do sumário. */
export function Capitulo({
  id,
  numero,
  titulo,
  resumo,
  children,
}: {
  id: string;
  numero: number;
  titulo: string;
  resumo?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      // `break-before-page` só vale na impressão: cada capítulo começa
      // numa folha nova, como num livro.
      className="scroll-mt-24 print:break-before-page"
    >
      <header className="mb-6 border-b border-border pb-4">
        <p className="text-sm font-semibold text-primary">Capítulo {numero}</p>
        <h2 className="mt-1 text-2xl font-bold text-foreground sm:text-3xl">
          {titulo}
        </h2>
        {resumo && (
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{resumo}</p>
        )}
      </header>
      <div className="space-y-8">{children}</div>
    </section>
  );
}

/** Uma tarefa ou tópico dentro do capítulo. */
export function Secao({
  id,
  titulo,
  children,
}: {
  id?: string;
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 print:break-inside-avoid-page">
      <h3 className="mb-3 text-lg font-semibold text-foreground">{titulo}</h3>
      <div className="space-y-3 text-sm leading-relaxed text-foreground/90">
        {children}
      </div>
    </section>
  );
}

/**
 * Representação de um botão da interface: ícone real + rótulo real.
 * Use sempre que o texto mandar a pessoa clicar em algo — assim ela
 * reconhece o alvo na tela sem precisar de captura de tela.
 */
export function Botao({
  icone: Icone,
  children,
}: {
  icone?: LucideIcon;
  children?: React.ReactNode;
}) {
  return (
    <span className="mx-0.5 inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-card-2 px-1.5 py-0.5 align-middle text-[0.9em] font-medium text-foreground">
      {Icone && <Icone className="size-3.5 shrink-0 text-primary" aria-hidden />}
      {children}
    </span>
  );
}

/** Ícone solto, para quando o alvo na tela não tem rótulo escrito. */
export function Icone({ icone: I }: { icone: LucideIcon }) {
  return (
    <span className="mx-0.5 inline-flex size-6 items-center justify-center rounded-md border border-border bg-card-2 align-middle">
      <I className="size-3.5 text-primary" aria-hidden />
    </span>
  );
}

/** Caminho até a tela: "Configurações → Grupos". */
export function Onde({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-sm text-muted-foreground">
      <span className="font-medium text-foreground">Onde fica: </span>
      {children}
    </p>
  );
}

/** Passo a passo numerado. */
export function Passos({ children }: { children: React.ReactNode }) {
  return (
    <ol className="list-decimal space-y-2 pl-5 marker:font-semibold marker:text-primary">
      {children}
    </ol>
  );
}

export function Passo({ children }: { children: React.ReactNode }) {
  return <li className="pl-1">{children}</li>;
}

/** Lista simples, sem ordem. */
export function Lista({ children }: { children: React.ReactNode }) {
  return (
    <ul className="list-disc space-y-2 pl-5 marker:text-primary">{children}</ul>
  );
}

type AvisoTipo = "dica" | "atencao" | "admin";

const AVISO_ESTILO: Record<AvisoTipo, { borda: string; rotulo: string }> = {
  dica: { borda: "border-l-status-open", rotulo: "Dica" },
  atencao: { borda: "border-l-status-pending", rotulo: "Atenção" },
  admin: { borda: "border-l-primary", rotulo: "Só para administradores" },
};

/** Destaque lateral. `admin` marca o que o atendente comum não consegue fazer. */
export function Aviso({
  tipo = "dica",
  children,
}: {
  tipo?: AvisoTipo;
  children: React.ReactNode;
}) {
  const estilo = AVISO_ESTILO[tipo];
  return (
    <div
      className={cn(
        "rounded-r-md border-l-4 bg-card-2 px-4 py-3 text-sm print:break-inside-avoid",
        estilo.borda,
      )}
    >
      <p className="mb-1 font-semibold text-foreground">{estilo.rotulo}</p>
      <div className="text-foreground/90">{children}</div>
    </div>
  );
}

/** Termo da interface citado no meio da frase: "o campo Rótulo". */
export function Termo({ children }: { children: React.ReactNode }) {
  return <span className="font-semibold text-foreground">{children}</span>;
}
