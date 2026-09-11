"use client";

import { useEffect } from "react";
import { BookOpen, Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CapituloPrimeirosPassos } from "@/components/manual/cap-01-primeiros-passos";
import { CapituloCaixaDeEntrada } from "@/components/manual/cap-02-caixa-de-entrada";

// ============================================================
// Manual do sistema.
//
// O conteúdo é prosa longa em português, escrita direto nos
// componentes em vez de passar pelos arquivos de tradução: são dezenas
// de páginas de documentação, não rótulos de interface, e manter
// en/ko em paralelo não serviria a ninguém aqui (a equipe é
// brasileira). Só o item do menu lateral passa pelo i18n, para não
// quebrar o padrão da barra lateral.
//
// "Baixar PDF" é a janela de impressão do navegador: as regras
// `@media print` em globals.css (escopadas por `manual-print-scope`)
// tiram a casca do app e soltam o conteúdo para paginar. Isso evita
// depender de um gerador de PDF no servidor e mantém o manual sempre
// igual ao que está publicado — sem arquivo desatualizado circulando.
// ============================================================

const SUMARIO = [
  { id: "primeiros-passos", titulo: "1. Primeiros passos" },
  { id: "caixa-de-entrada", titulo: "2. Caixa de entrada" },
];

export default function ManualPage() {
  // A classe no <body> escopa as regras de impressão a esta página —
  // imprimir qualquer outra tela do sistema segue inalterado.
  useEffect(() => {
    document.body.classList.add("manual-print-scope");
    return () => document.body.classList.remove("manual-print-scope");
  }, []);

  return (
    <div className="mx-auto max-w-4xl pb-16" data-manual-root>
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4 border-b border-border pb-6">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft">
            <BookOpen className="size-5 text-primary" aria-hidden />
          </span>
          <div>
            <h1 className="text-2xl font-bold text-foreground sm:text-3xl">
              Manual do sistema
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Como usar o CRM no dia a dia do atendimento — e como
              administrá-lo. Escrito para ser lido na tela ou impresso.
            </p>
          </div>
        </div>
        <Button onClick={() => window.print()} className="print:hidden">
          <Printer className="size-4" aria-hidden />
          Baixar PDF
        </Button>
      </header>

      <nav
        aria-label="Sumário"
        className="mb-10 rounded-lg border border-border bg-card-2 p-5 print:break-after-page"
      >
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Sumário
        </h2>
        <ol className="space-y-1.5 text-sm">
          {SUMARIO.map((item) => (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                className="text-foreground hover:text-primary hover:underline"
              >
                {item.titulo}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="space-y-14">
        <CapituloPrimeirosPassos />
        <CapituloCaixaDeEntrada />
      </div>

      <footer className="mt-16 border-t border-border pt-6 text-xs text-muted-foreground print:mt-8">
        <p>
          Este manual acompanha o sistema: sempre que uma tela muda, ele é
          atualizado junto. Se encontrar algo diferente do que está escrito
          aqui, avise a equipe responsável pelo CRM.
        </p>
      </footer>
    </div>
  );
}
