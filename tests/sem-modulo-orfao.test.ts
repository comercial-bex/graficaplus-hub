import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Trava contra módulo órfão: código escrito, testado, e que ninguém chama.
 *
 * Esta trava nasce de um prejuízo concreto. Em 08/09/2026 uma fusão trouxe a
 * tela de orçamento refeita, e ela deixou de importar a calculadora de custo, o
 * aproveitamento de bobina, o card de prazos e o aviso de faixa de preço. Os
 * 325 testes continuaram passando, o tsc continuou limpo e o build continuou
 * verde — porque nada disso pergunta se alguém CHAMA o código. Duas semanas de
 * trabalho de precificação ficaram no repositório sem estar no sistema, e o
 * único jeito de descobrir foi ir procurar de propósito.
 *
 * É o mesmo padrão do "elo morto" que já mordeu esta base: peça modelada que
 * nada preenche. Aqui é a versão do front — peça escrita que nada importa.
 *
 * A lista de exceções é a parte importante. Ela não existe para calar o teste:
 * existe para que cada morto tenha um dono e um motivo escrito. Órfão NOVO
 * quebra o teste; órfão conhecido fica listado, e a lista encolhendo é o
 * progresso.
 */

const RAIZ = "src";

/**
 * Onde um órfão dói. Rotas ficam de fora porque quem as carrega é o roteador
 * pelo nome do arquivo, não um import — e `src/lib` guarda muito utilitário de
 * infraestrutura que o framework chama por convenção.
 */
const VIGIADOS = ["src/domain/", "src/components/"];

/** Carregados pelo framework, não por import. */
const INFRAESTRUTURA = new Set(["routeTree.gen", "types", "styles", "router", "server", "start", "client"]);

/**
 * Órfãos conhecidos, cada um com o motivo. Tirar da lista sem religar o módulo
 * quebra o teste — que é exatamente o ponto.
 */
const CONHECIDOS: Record<string, string> = {
  // Desligados pela fusão de 08/09, quando a tela de orçamento foi refeita.
  //   calculadora   → RELIGADA: é diálogo, coube sem mexer no layout.
  //   faixa-de-preco → APAGADA: `domain/orcamentos/faixas.ts` dele faz o mesmo.
  //                    Só a exigência legal do produto era única, e virou
  //                    `restricao-do-produto.tsx`, já religada.
  // Os dois abaixo são BLOCOS: ocupam área e mudariam o desenho da tela.
  "src/components/orcamento/aproveitamento-card.tsx": "tela de orçamento refeita não chama mais — aguarda decisão de religar",
  "src/components/orcamento/prazos-card.tsx": "idem",

  // Mortos que já vinham de antes da fusão.
  "src/domain/clientes/normalizacao.ts": "morto antes da fusão; a normalização de telefone acontece no banco",
  "src/domain/crm/schemas.ts": "schema sem consumidor",
  "src/domain/custos/categorias.ts": "as telas declaram a lista de categorias localmente",
  "src/domain/financeiro/schemas.ts": "schema sem consumidor",
  "src/domain/impressao3d/slicer-import.ts": "o assistente 3D lê o .3mf por outro caminho",
  "src/domain/orcamentos/schemas.ts": "schema sem consumidor",
  "src/domain/whatsapp/schemas.ts": "schema sem consumidor",
};

function arquivosDe(dir: string): string[] {
  const saida: string[] = [];
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) {
      saida.push(...arquivosDe(caminho));
    } else if (/\.tsx?$/.test(nome)) {
      saida.push(caminho);
    }
  }
  return saida;
}

/**
 * Conta quem é importado, por nome de arquivo.
 *
 * Aspas simples E duplas: a primeira versão desta busca só olhava aspas duplas
 * e acusou de órfão um módulo que o `client.ts` importa com aspa simples. Uma
 * trava que dá falso positivo é pior que trava nenhuma — ninguém confia nela
 * duas vezes.
 *
 * Pega também `import(...)` dinâmico e `export ... from`.
 */
function contarImports(arquivos: string[]): Map<string, number> {
  const conta = new Map<string, number>();
  const re = /(?:from|import\(|require\()\s*['"]([^'"]+)['"]/g;
  for (const f of arquivos) {
    const texto = readFileSync(f, "utf8");
    for (const m of texto.matchAll(re)) {
      const base = m[1].split("/").pop()!.replace(/\.tsx?$/, "");
      conta.set(base, (conta.get(base) ?? 0) + 1);
    }
  }
  return conta;
}

const arquivos = arquivosDe(RAIZ);
const importados = contarImports(arquivos);

function stem(caminho: string) {
  return caminho.split("/").pop()!.replace(/\.tsx?$/, "");
}

const orfaos = arquivos
  .filter((f) => VIGIADOS.some((v) => f.startsWith(v)))
  .filter((f) => !f.includes("/ui/"))
  .filter((f) => !INFRAESTRUTURA.has(stem(f)))
  .filter((f) => (importados.get(stem(f)) ?? 0) === 0);

describe("nenhum módulo novo fica órfão", () => {
  it("todo órfão está na lista, com motivo escrito", () => {
    const novos = orfaos.filter((f) => !(f in CONHECIDOS));
    expect(
      novos,
      novos.length === 0
        ? ""
        : `Estes módulos não são importados por ninguém:\n  ${novos.join("\n  ")}\n\n` +
          "Ou religue o módulo em alguma tela, ou apague-o, ou adicione em CONHECIDOS " +
          "com o motivo. Código testado que ninguém chama passa em todos os testes e " +
          "não existe no sistema — foi assim que a calculadora de custo ficou duas " +
          "semanas fora do ar sem nada acusar.",
    ).toEqual([]);
  });

  it("a lista de conhecidos não guarda morto que já foi religado", () => {
    // Sem isto a lista só cresce: alguém religa o módulo e a exceção fica lá,
    // escondendo o próximo órfão que aparecer no mesmo arquivo.
    const religados = Object.keys(CONHECIDOS).filter((f) => !orfaos.includes(f));
    expect(
      religados,
      `Estes já estão sendo importados de novo — tire de CONHECIDOS:\n  ${religados.join("\n  ")}`,
    ).toEqual([]);
  });

  it("a busca enxerga aspas simples e duplas, e import dinâmico", () => {
    // O falso positivo que a primeira versão deu: `client.ts` importa
    // `previewAuthStorage` com aspa simples e o módulo foi acusado de morto.
    expect(importados.get("previewAuthStorage") ?? 0).toBeGreaterThan(0);
    expect(importados.get("cost-engine") ?? 0).toBeGreaterThan(0);
  });
});

describe("o que a calculadora leva junto quando é religada", () => {
  it("barra, decapagem e tempo-de-máquina só chegam à tela pela calculadora", () => {
    // Estes três NÃO estão na lista de órfãos porque a calculadora os importa.
    // Mas a calculadora está órfã — então eles também não rodam. Este teste
    // existe para que a corrente fique escrita: religar a calculadora religa os
    // três, e apagá-la mata os três.
    const calc = readFileSync("src/components/orcamento/calculadora-custo.tsx", "utf8");
    for (const dep of ["barra-de-composicao", "decapagem-segue-o-recorte", "tempo-de-maquina"]) {
      expect(calc, `a calculadora deveria importar ${dep}`).toContain(dep);
    }
  });
});
