import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dicaTela } from "../../src/lib/dicas";
import {
  AVISO_BASE_NAO_INSTALADA,
  EXPLICACAO_DO_STATUS,
  ROTULO_DO_EVENTO,
  ROTULO_DO_STATUS,
  explicarAviso,
  TEXTO_SALVOU_MAS_NAO_APROVOU,
} from "../../src/domain/agente-base/fila";
import { TEXTO_DE_VERSAO_TROCADA } from "../../src/domain/agente-base/erros";

/**
 * A tela de aprovação e as funções do servidor da base de respostas (C2), no
 * que é contrato: legível (16 px, 44 px), sem símbolo proibido, sem nome de
 * permissão em código na tela, registrada como as outras de Configurações, e
 * sem caminho de escrita direta nas tabelas.
 */

const arquivosDaTela = [
  ...readdirSync("src/components/agente-base").map((n) => join("src/components/agente-base", n)),
  "src/routes/_authenticated/configuracoes-agente-base.tsx",
];
const servidor = readFileSync("src/lib/api/agente-base.functions.ts", "utf8");
const semComentarios = (t: string) =>
  t
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n");

describe("a tela é legível", () => {
  it("encontra os arquivos da tela", () => {
    expect(arquivosDaTela.length).toBeGreaterThanOrEqual(4);
  });

  it("nenhuma classe de letra menor que 16 px", () => {
    for (const a of arquivosDaTela) {
      expect(readFileSync(a, "utf8"), a).not.toMatch(/\btext-(xs|sm)\b|text-\[(1[0-5]|[0-9])px\]|text-\[0\.[0-9]+rem\]/);
    }
  });

  it("todo botão da tela tem 44 px de altura pela constante BOTAO", () => {
    for (const a of arquivosDaTela.filter((x) => x.endsWith(".tsx"))) {
      const src = readFileSync(a, "utf8");
      for (const b of [...src.matchAll(/<Button\b[^>]*>/g)].map((m) => m[0])) {
        expect(/className=\{?[^>]*(BOTAO|min-h-1[1-9]|min-h-14)/.test(b), `${a}: ${b}`).toBe(true);
      }
    }
  });

  it("toda confirmação pede o tamanho grande", () => {
    for (const a of arquivosDaTela) {
      const src = readFileSync(a, "utf8");
      const usos = src.match(/<ConfirmarAcao\b/g)?.length ?? 0;
      const grandes = src.match(/<ConfirmarAcao\b[^>]*\bgrande\b/gs)?.length ?? 0;
      expect(grandes, a).toBe(usos);
    }
  });

  it("nenhum travessão ou seta em texto de tela, e a palavra do mercado que o dono não usa não aparece", () => {
    for (const a of [...arquivosDaTela, "src/domain/agente-base/fila.ts", "src/domain/agente-base/casar.ts", "src/domain/agente-base/erros.ts"]) {
      const linhas = readFileSync(a, "utf8")
        .split("\n")
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l) && !/title:|<title>/.test(l));
      for (const l of linhas) {
        expect(l, `${a}: ${l}`).not.toMatch(/[—–―→←⇒]/);
        expect(l, `${a}: ${l}`).not.toMatch(/revend/i);
      }
    }
  });

  it("os textos que a tela mostra, do domínio e da dica, não têm travessão, seta nem parênteses", () => {
    const textos = [
      ...Object.values(ROTULO_DO_STATUS),
      ...Object.values(EXPLICACAO_DO_STATUS),
      ...Object.values(ROTULO_DO_EVENTO),
      AVISO_BASE_NAO_INSTALADA,
      dicaTela("/configuracoes-agente-base"),
      ...[
        "vazio",
        "preco_com_numero",
        "prazo_prometido",
        "palavra_que_a_casa_nao_usa",
        "tabela",
        "pix",
        "codigo_novo",
        "forma_de_pagamento",
        "pagamento_com_numero",
        "preco_especial",
        "preco_diferenciado",
        "valor_em_reais",
      ].map(explicarAviso),
      ...[
        "Texto produzido pelo tradutor de erros, sem parênteses",
        "Não aprovei. Fala em tabela.",
        TEXTO_SALVOU_MAS_NAO_APROVOU,
        TEXTO_DE_VERSAO_TROCADA,
      ],
    ];
    for (const t of textos) expect(t, t).not.toMatch(/[—–―→←⇒()]/);
  });

  it("nenhum texto de tela traz o nome de permissão em código", () => {
    for (const a of arquivosDaTela) {
      for (const linha of semComentarios(readFileSync(a, "utf8")).split("\n")) {
        expect(linha, `${a}: ${linha}`).not.toMatch(/(whatsapp|configuracoes)\.manage/);
      }
    }
  });

  it("a rota usa o cabeçalho legível e a dica em 16 px, sem o ícone de dica de 20 px", () => {
    const rota = readFileSync("src/routes/_authenticated/configuracoes-agente-base.tsx", "utf8");
    expect(rota).toMatch(/<SectionHeader\s+legivel\b/);
    expect(rota).not.toMatch(/ajuda=\{/);
    expect(rota).toMatch(/dicaTela\("\/configuracoes-agente-base"\)/);
  });

  it("mostra o contador, a fila uma por vez, os botões pedidos e NÃO tem aprovar tudo", () => {
    const fila = readFileSync("src/components/agente-base/fila-de-aprovacao.tsx", "utf8");
    for (const rotulo of ["Aprovar", "Editar e aprovar", "Voltar a rascunho", "Arquivar"]) {
      expect(fila, rotulo).toContain(rotulo);
    }
    expect(fila).toMatch(/contador\.texto/);
    expect(semComentarios(fila)).not.toMatch(/aprovar tudo|Aprovar todas|aprovarTodas|aprovarEmLote/i);
    // a aprovação leva o id e a versão que o dono viu, de UMA resposta
    expect(fila).toMatch(/aprovar\(\{\s*data: \{\s*id: resposta\.id,\s*versaoVista: resposta\.versao/);
    expect(fila).toMatch(/Histórico|HistoricoDaResposta/);
  });

  it("a área de ensaio casa só pela função pura de frase gatilho e não chama servidor", () => {
    const ensaio = readFileSync("src/components/agente-base/ensaio-da-pergunta.tsx", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^import type [^;]*;$/gm, "");
    expect(ensaio).toMatch(/casamentosDaPergunta/);
    expect(ensaio).not.toMatch(/createServerFn|useServerFn|supabase|\bfetch\s*\(|\.rpc\s*\(|useMutation|openai|anthropic|embedding/i);
  });
});

describe("a fila de aprovação trata o que dava errado em silêncio", () => {
  const fila = readFileSync("src/components/agente-base/fila-de-aprovacao.tsx", "utf8");
  const codigoDaFila = semComentarios(fila);

  it("sem frase vale pelas frases normalizadas: uma linha com ponto de interrogação não conta", () => {
    expect(codigoDaFila).toMatch(/const semFrase = \(editando \? normalizadas\.length : resposta\.frases_gatilho\.length\) === 0;/);
    expect(codigoDaFila).not.toMatch(/frasesLimpas\.length/);
    expect(codigoDaFila).toMatch(/frasesGatilhoDoTexto\(frases\)/);
    expect(codigoDaFila).not.toMatch(/new Set\(frasesLimpas/);
  });

  it("Editar e aprovar com frases, ramo ou produto mudados salva e aprova pela função que marca a falha", () => {
    expect(codigoDaFila).toMatch(/salvarDepoisAprovar\(/);
    expect(codigoDaFila).toMatch(/versaoVista: versaoSalva/);
    // a aprovação de uma resposta ainda leva o id e a versão que o dono viu
    expect(codigoDaFila).toMatch(/aprovar\(\{\s*data: \{\s*id: resposta\.id,\s*versaoVista: resposta\.versao/);
  });

  it("se o salvar passa e o aprovar falha, recarrega o painel e diz que o rascunho foi salvo", () => {
    const aoFalhar = codigoDaFila.slice(codigoDaFila.indexOf("const aoFalhar"), codigoDaFila.indexOf("function dadosParaSalvar"));
    expect(aoFalhar).toMatch(/e instanceof SalvouMasNaoAprovou/);
    expect(aoFalhar).toMatch(/aoMudar\(\)/);
    expect(aoFalhar).toMatch(/TEXTO_SALVOU_MAS_NAO_APROVOU/);
    expect(aoFalhar).toMatch(/toast\.error/);
    expect(TEXTO_SALVOU_MAS_NAO_APROVOU).toBe("O rascunho foi salvo, mas a aprovação não passou");
  });

  it("produto desativado aparece como Produto desativado e a lista de edição traz o produto atual", () => {
    expect(codigoDaFila).toMatch(/rotuloDoProduto\(/);
    expect(codigoDaFila).toMatch(/produtosParaEscolher\(painel\.produtos, resposta\.produto_id, produtoId\)/);
    expect(codigoDaFila).toMatch(/produtosDaLista\.map/);
    expect(codigoDaFila).toMatch(/rotuloDaOpcaoDeProduto\(p\)/);
    expect(codigoDaFila).not.toMatch(/painel\.produtos\.map\(\(p\) => \(\s*<option/);
  });
});

describe("a área de ensaio separa a aprovada que perdeu no desempate", () => {
  const ensaio = semComentarios(readFileSync("src/components/agente-base/ensaio-da-pergunta.tsx", "utf8"));

  it("usa separarOsOutros e escreve cada grupo com o texto certo", () => {
    expect(ensaio).toMatch(/separarOsOutros\(achados\)/);
    expect(ensaio).toMatch(/perderamNoDesempate\.map/);
    expect(ensaio).toMatch(/aindaNaoServem\.map/);
    expect(ensaio).toMatch(/Também casa, mas outra resposta aprovada tem prioridade/);
    expect(ensaio).toMatch(/então não serve até ser aprovada/);
    // o texto de "não serve até ser aprovada" fica só no grupo de rascunho e arquivada
    const aprovadas = ensaio.slice(ensaio.indexOf("perderamNoDesempate.length"), ensaio.indexOf("aindaNaoServem.length"));
    expect(aprovadas).not.toMatch(/não serve até ser aprovada/);
  });

  it("o produto da conversa só oferece produto ativo", () => {
    expect(ensaio).toMatch(/painel\.produtos\.filter\(\(p\) => p\.ativo\)/);
    expect(ensaio).toMatch(/produtosAtivos\.map/);
  });
});

describe("as funções do servidor", () => {
  const codigo = semComentarios(servidor);

  it("nenhuma escrita direta nas tabelas da base: só funções do banco", () => {
    expect(codigo).not.toMatch(/\.(insert|update|upsert|delete)\s*\(/);
    for (const fn of ["agente_resposta_salvar", "agente_resposta_aprovar", "agente_resposta_rascunho", "agente_resposta_arquivar"]) {
      expect(codigo, fn).toContain(`"${fn}"`);
    }
  });

  it("aprovar exige whatsapp.manage; ler e as outras escritas aceitam as duas permissões", () => {
    const aprovar = codigo.slice(codigo.indexOf("export const aprovarRespostaDoAgente"), codigo.indexOf("const soId"));
    expect(aprovar).toMatch(/await exigir\(context\.supabase, context\.userId, "whatsapp\.manage"\)/);
    expect(aprovar).not.toMatch(/configuracoes\.manage/);
    expect(aprovar).toMatch(/p_versao_vista: data\.versaoVista/);
    for (const nome of [
      "lerPainelDaBase",
      "lerHistoricoDaResposta",
      "verificarTextoDoAgente",
      "salvarRespostaDoAgente",
      "voltarARascunhoDoAgente",
      "arquivarRespostaDoAgente",
    ]) {
      const ini = codigo.indexOf(`export const ${nome}`);
      expect(ini, nome).toBeGreaterThan(0);
      const fim = codigo.indexOf("export const", ini + 10);
      const corpo = codigo.slice(ini, fim < 0 ? undefined : fim);
      expect(corpo, nome).toMatch(/exigirUma\(context\.supabase, context\.userId, AS_DUAS\)/);
    }
  });

  it("não lê preço: produtos só com id, nome, família e se está ativo", () => {
    const leituras = [...codigo.matchAll(/\.from\("produtos"\)\.select\("([^"]*)"\)/g)].map((m) => m[1]);
    expect(leituras.length).toBeGreaterThanOrEqual(2);
    for (const colunas of leituras) expect(colunas).toBe("id, nome, familia, ativo");
    expect(codigo).not.toMatch(/preco|custo|margem/i);
  });

  it("lê também os produtos que as respostas citam, mesmo desativados", () => {
    expect(codigo).toMatch(/\.in\("id", citados\)/);
    expect(codigo).toMatch(/respostas\.map\(\(r\) => r\.produto_id\)/);
    // a primeira leitura é só dos ativos; a segunda, por id, sem filtrar por ativo
    const [primeira, segunda] = codigo.split(/const outros = /);
    expect(primeira).toMatch(/\.eq\("ativo", true\)/);
    expect(segunda.slice(0, 200)).not.toMatch(/\.eq\("ativo"/);
  });

  it("a tela abre mesmo antes de a migração ser aplicada", () => {
    expect(codigo).toMatch(/PGRST205/);
    expect(codigo).toMatch(/instalada: false/);
  });

  it("todo servidor passa pelo middleware de sessão", () => {
    const fns = codigo.match(/createServerFn\(/g)?.length ?? 0;
    const mw = codigo.match(/\.middleware\(\[requireSupabaseAuth\]\)/g)?.length ?? 0;
    expect(fns).toBe(7);
    expect(mw).toBe(fns);
  });
});

describe("a tela está registrada como as outras de Configurações", () => {
  it("permissão, menu, dica, árvore de rotas e atalho em Dados da empresa", () => {
    const perm = readFileSync("src/lib/permissions.ts", "utf8");
    expect(perm).toMatch(/path: "\/configuracoes-agente-base", permissions: \["configuracoes\.manage", "whatsapp\.manage"\]/);
    expect(perm.indexOf('"/configuracoes-agente-base"')).toBeLessThan(perm.indexOf('{ path: "/configuracoes", permissions: [] }'));
    expect(readFileSync("src/lib/menu.ts", "utf8")).toMatch(/"\/configuracoes-agente-base": \{\s*titulo: "Respostas do agente"/);
    expect(readFileSync("src/lib/dicas.ts", "utf8")).toMatch(/"\/configuracoes-agente-base": \{\s*menu:/);
    const arvore = readFileSync("src/routeTree.gen.ts", "utf8");
    expect(arvore).toMatch(/'\/_authenticated\/configuracoes-agente-base': \{/);
    expect(arvore).toMatch(/AuthenticatedConfiguracoesAgenteBaseRoute:\s+AuthenticatedConfiguracoesAgenteBaseRoute,/);
    expect(readFileSync("src/routes/_authenticated/configuracoes-empresa.tsx", "utf8")).toMatch(/to="\/configuracoes-agente-base"/);
  });
});
