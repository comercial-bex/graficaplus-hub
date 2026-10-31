import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TooltipProvider } from "../src/components/ui/tooltip";
import { CartaoOs } from "../src/components/kanban/cartao-os";

/**
 * `title=` vira texto à vista ou dica (20/10/2026), começando por Quadro, OS e
 * WhatsApp — as três telas que a oficina e o atendimento usam o dia todo.
 *
 * O `title` só aparece com o mouse PARADO em cima, depois de um segundo; no
 * celular e na TV nunca aparece, e o leitor de tela quase nunca o lê. Nessas
 * telas ele guardava o que importava: as pendências além da primeira ("2
 * pendências"), quem está na OS (só o rosto), de onde a OS veio ("Produção →
 * Arte" é retrabalho), por que um valor está ausente, quantos clientes esperam
 * resposta em cada fila, e o nome das ações da conversa no celular (era só o
 * ícone).
 *
 * Regra: o que é informação fica à vista; o que é explicação longa vai para a
 * Dica/DicaIcone (src/components/bex/Dica.tsx), que abre no teclado e no toque;
 * o que só repetia o texto visível sai.
 */

const ARQUIVOS: Record<string, number> = {
  // Quantos `title=` cada arquivo ainda pode ter — só a prop `title` de
  // componente (o título da tela no SectionHeader), nunca atributo de elemento.
  "src/components/kanban/cartao-os.tsx": 0,
  "src/components/kanban/icone-da-maquina.tsx": 0,
  "src/routes/_authenticated/kanban.tsx": 1,
  "src/routes/_authenticated/os.$id.tsx": 1,
  "src/components/whatsapp/conversa-aberta.tsx": 0,
  "src/components/whatsapp/lista-de-conversas.tsx": 0,
  "src/routes/_authenticated/whatsapp-fila-humana.tsx": 1,
};

describe("nenhum title= nas telas do dia a dia", () => {
  it.each(Object.entries(ARQUIVOS))("%s", (caminho, permitidos) => {
    const texto = readFileSync(caminho, "utf8");
    const titles = [...texto.matchAll(/\stitle=\{|\stitle="/g)];
    expect(titles.length, caminho).toBe(permitidos);
    // Os que sobram são do SectionHeader (o título da tela), não de um elemento.
    for (const m of titles) {
      const antes = texto.slice(0, m.index);
      const tag = antes.slice(antes.lastIndexOf("<"));
      expect(tag, caminho).toMatch(/^<SectionHeader\b/);
    }
  });
});

/**
 * O sistema inteiro (21/10/2026): os outros 58 `title=` de elemento saíram —
 * explicação longa virou DicaIcone (abre no toque), botão só de ícone ganhou a
 * Dica e o aria-label, nome cortado passou a quebrar em duas linhas, e o que
 * só repetia o texto à vista saiu. Sobra a prop `title` dos componentes que a
 * desenham como texto, e o `title` do iframe — que é o nome acessível dele.
 */
const PODE_TER_TITLE = new Set(["SectionHeader", "BexCard", "SummaryCard", "Document", "iframe"]);

function arquivosTsx(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return arquivosTsx(p);
    return p.endsWith(".tsx") ? [p] : [];
  });
}

describe("nenhum elemento do sistema esconde informação no title", () => {
  it("só os componentes que desenham o título como texto (e o iframe) recebem title=", () => {
    const achados: string[] = [];
    for (const f of arquivosTsx("src")) {
      const texto = readFileSync(f, "utf8");
      if (!texto.includes("title=")) continue;
      const sf = ts.createSourceFile(f, texto, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const visitar = (n: ts.Node) => {
        if (ts.isJsxAttribute(n) && n.name.getText(sf) === "title") {
          const tag = (n.parent.parent as ts.JsxOpeningLikeElement).tagName.getText(sf);
          if (!PODE_TER_TITLE.has(tag)) {
            achados.push(`${f}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1} <${tag}>`);
          }
        }
        ts.forEachChild(n, visitar);
      };
      visitar(sf);
    }
    expect(achados, "use texto à vista, DicaIcone (explicação) ou Dica + aria-label (botão só de ícone)").toEqual([]);
  });
});

describe("o cartão do Quadro diz à vista o que o title escondia", () => {
  const os = {
    numero: 44,
    titulo: "Fachada em ACM",
    status: "em_laser_cnc",
    prioridade: 3,
    itens: [],
    designer: { id: "d", nome: "Ana Souza" },
    operador: { id: "o", nome: "Leonardo Silva" },
    ultimo_movimento: { rotulo: "Ana há 2 h", passo: "Produção → Arte", verbo: "movida", mudou_em: null },
  };
  const html = (extra: Record<string, unknown> = {}, bloqueios: { codigo: string; titulo: string; resolver: string }[] = []) =>
    renderToStaticMarkup(
      createElement(TooltipProvider, null, createElement(CartaoOs, { os: { ...os, ...extra }, bloqueios })),
    );

  it("as pendências: todas na mesma linha, em palavras curtas, com o texto inteiro para o leitor de tela (31/10/2026: antes era a primeira e um +N)", () => {
    const h = html({}, [
      { codigo: "sem_pagamento", titulo: "Nenhum pagamento registrado", resolver: "" },
      { codigo: "arte_nao_aprovada", titulo: "Arte ainda não aprovada", resolver: "" },
      { codigo: "sem_arquivo_final", titulo: "Sem arquivo final de produção", resolver: "" },
    ]);
    expect(h).toContain("Falta: pagamento · aceite da arte · arquivo final");
    expect(h).toContain('<span class="sr-only">Nenhum pagamento registrado, Arte ainda não aprovada, Sem arquivo final de produção</span>');
    expect(h).not.toContain("+2");
    expect(h).not.toContain("2 pendências");
  });

  it("trava que a lista curta não conhece aparece pelo título, e margem e desconto contam como um aval só", () => {
    const h = html({}, [
      { codigo: "trava_nova", titulo: "Falta o carimbo", resolver: "" },
      { codigo: "margem_baixa", titulo: "Margem abaixo do mínimo", resolver: "" },
      { codigo: "desconto_alto", titulo: "Desconto acima do limite", resolver: "" },
    ]);
    expect(h).toContain("Falta: Falta o carimbo · aval do gestor");
    expect(h).not.toContain("aval do gestor · aval do gestor");
  });

  it("quem está na OS pelo primeiro nome; sem ninguém, não há aviso em todo cartão (campo vazio não vira linha)", () => {
    expect(html()).toContain("Ana · Leonardo");
    const vazio = html({ designer: null, operador: null });
    expect(vazio).not.toContain("sem designer nem operador");
    expect(vazio).not.toContain("border-t border-border/60");
  });

  it("OS que nunca andou não mostra 'aberta por'; só o movimento de verdade", () => {
    expect(html({ ultimo_movimento: { rotulo: "Yvens · 14/10 16:29", passo: "Abriu em Entrada", verbo: "aberta", mudou_em: null } })).not.toContain("aberta por");
  });

  it("'parada há' só de um dia para cima; o cartão não repete o nome da etapa nem o passo 'Entrada'", () => {
    const dias = (n: number) => new Date(Date.now() - n * 24 * 3600 * 1000).toISOString();
    expect(html({ status: "design", ultimo_movimento: { rotulo: "Ana · 1/1", passo: "Entrada → Design", verbo: "movida", mudou_em: dias(3) } })).toContain("parada há 3d");
    expect(html({ status: "design", ultimo_movimento: { rotulo: "Ana · 1/1", passo: "Entrada → Design", verbo: "movida", mudou_em: new Date(Date.now() - 9 * 3600 * 1000).toISOString() } })).not.toContain("parada há");
    const naEntrada = html({ status: "entrada", ultimo_movimento: null });
    expect(naEntrada).not.toContain(">Atendimento<");
    expect(naEntrada).not.toContain(">Entrada<");
    expect(html({ status: "arte_aprovada", ultimo_movimento: null })).toContain(">Arte aprovada<");
  });

  it("de onde a OS veio fica à vista (Produção → Arte é retrabalho)", () => {
    expect(html()).toContain("movida por Ana há 2 h · Produção → Arte");
  });

  it("a observação do laser é dica, não um ! com title", () => {
    const h = html();
    expect(h).toContain('aria-label="Ajuda: Laser"');
    expect(h).not.toContain("title=");
  });
});

describe("OS e WhatsApp", () => {
  const OS = readFileSync("src/routes/_authenticated/os.$id.tsx", "utf8");
  const CONVERSA = readFileSync("src/components/whatsapp/conversa-aberta.tsx", "utf8");
  const LISTA = readFileSync("src/components/whatsapp/lista-de-conversas.tsx", "utf8");

  it("OS: o motivo do valor ausente à vista; 'Marcar como final' com nome; o Voltar é um link com rótulo", () => {
    expect(OS).toContain("{ausente && campo.motivo && <div");
    expect(OS).toContain("Marcar como final");
    expect(OS).toContain('<Link to="/os" aria-label="Voltar para as ordens de serviço">');
  });

  it("conversa: as ações mostram o nome em todo tamanho; a tecla de atalho vai para a dica", () => {
    expect(CONVERSA).not.toContain('className="hidden sm:inline"');
    for (const [nome, tecla] of [["Assumir", "R"], ["Transferir", "T"], ["Resolver", "E"]]) {
      expect(CONVERSA, nome).toMatch(new RegExp(`<Dica texto="[^"]*\\(tecla ${tecla}\\)">`));
    }
  });

  it("lista: cada fila diz quantos esperam resposta, à vista", () => {
    expect(LISTA).toContain('<span className="sr-only"> esperando resposta</span>');
    expect(LISTA).toContain("{n && n.aguardando > 0 && (");
  });
});
