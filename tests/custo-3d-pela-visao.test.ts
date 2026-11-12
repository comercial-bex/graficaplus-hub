import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import {
  COLUNAS_DA_IMPRESSORA_3D_SEM_CUSTO,
  COLUNAS_DE_CUSTO_DA_IMPRESSORA_3D,
  COLUNAS_DE_CUSTO_DO_FILAMENTO,
  COLUNAS_DO_FILAMENTO_SEM_CUSTO,
  SELECT_DA_IMPRESSORA_3D_SEM_CUSTO,
  SELECT_DO_FILAMENTO_SEM_CUSTO,
} from "../src/domain/impressao3d/colunas";
import { calcularPeca3D } from "../src/domain/impressao3d/calcular-peca";
import { contaInlineDeHoje } from "./apoio/impressao3d/conta-inline-de-hoje";

/**
 * O custo da impressão 3D só chega a quem vê custo (onda C, 11/11/2026).
 *
 * A calculadora 3D fazia a conta inteira no navegador e, para isso, lia o custo por grama de cada filamento, o
 * custo por hora de cada impressora e a base de preço inteira, para TODOS que cotam, embora a tela escondesse. Agora:
 *   * quem vê custo (impressao3d.cost.read) lê pelas visões *_financeiro e calcula no navegador pelo módulo;
 *   * quem não vê lê só as colunas abertas das tabelas, NÃO lê a base de preço e recebe o preço do servidor.
 * A migração de fechamento (C3) tira a leitura das colunas de custo. Coluna sem GRANT derruba a consulta inteira de
 * quem a cita, para todos os papéis: estes testes travam o que o front pede, antes e depois do fechamento.
 */

// ---- A tela de verdade, sem banco: só o que a renderização e a tradução das entradas precisam -------------------
const permissoes = vi.hoisted(() => ({ atuais: new Set<string>() }));
const tabelasPedidas = vi.hoisted(() => ({ lista: [] as string[] }));

vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  Link: ({ children }: { children?: ReactNode }) => createElement("a", null, children),
}));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ hasPermission: (p: string) => permissoes.atuais.has(p) }),
}));
vi.mock("@/integrations/supabase/client", () => {
  const consulta: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit", "maybeSingle"]) consulta[m] = () => consulta;
  return {
    supabase: {
      from: (t: string) => {
        tabelasPedidas.lista.push(t);
        return consulta;
      },
      rpc: () => Promise.resolve({ data: null, error: null }),
      storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: null }) }) },
    },
  };
});
vi.mock("@/lib/api/orcamento-3d.functions", () => ({
  cotarPeca3d: vi.fn(),
  salvarPeca3dNoOrcamento: vi.fn(),
}));
vi.mock("@/lib/api/fatiador.functions", () => ({ lerArquivoDoFatiador: vi.fn() }));
vi.mock("@/components/orcamento/layouts-do-item", () => ({ enviarLayout: vi.fn() }));
vi.mock("@/components/bex/Dica", () => ({
  DicaIcone: () => null,
  Dica: ({ children }: { children?: ReactNode }) => children,
}));

import { Calculadora3D, entradasDaContaNaTela } from "../src/components/impressao3d/calculadora-3d";

/** As 36 colunas de `maquinas_3d_config` em produção em 11/11/2026 (pg_attribute). */
const COLUNAS_VIVAS_DA_IMPRESSORA = [
  "maquina_id",
  "fabricante",
  "modelo",
  "serial",
  "tecnologia",
  "custo_aquisicao",
  "frete_aquisicao",
  "instalacao",
  "acessorios_capitalizados",
  "valor_residual",
  "vida_util_horas",
  "horas_acumuladas",
  "manutencao_por_hora",
  "consumiveis_por_hora",
  "infraestrutura_por_hora",
  "potencia_media_w",
  "potencia_aquecimento_w",
  "potencia_standby_w",
  "horas_produtivas_mensais",
  "metodo_custo_hora",
  "custo_hora_calculado",
  "custo_hora_manual",
  "motivo_custo_manual",
  "custo_hora_manual_usuario_id",
  "custo_hora_manual_at",
  "capacidade_x",
  "capacidade_y",
  "capacidade_z",
  "possui_ams",
  "quantidade_slots",
  "bico_padrao",
  "placa_padrao",
  "consumiveis_json",
  "ativa",
  "created_at",
  "updated_at",
];

/** As 25 colunas de `materiais_3d_filamento` em produção em 11/11/2026 (pg_attribute). */
const COLUNAS_VIVAS_DO_FILAMENTO = [
  "material_id",
  "tipo",
  "marca",
  "linha",
  "cor",
  "codigo",
  "diametro",
  "densidade",
  "peso_nominal",
  "peso_liquido",
  "tara_carretel",
  "custo_compra",
  "frete_rateado",
  "tributos_aquisicao",
  "descontos",
  "outros_custos",
  "fator_aproveitamento",
  "exige_secagem",
  "tempo_secagem",
  "potencia_secador",
  "temperatura_secagem",
  "armazenamento",
  "custo_por_grama_calculado",
  "created_at",
  "updated_at",
];

const ler = (caminho: string) => readFileSync(caminho, "utf8");

describe("as listas de colunas da impressora e do filamento", () => {
  it("juntas são todas as colunas que cada tabela tem, sem repetir nem faltar", () => {
    const imp = [...COLUNAS_DA_IMPRESSORA_3D_SEM_CUSTO, ...COLUNAS_DE_CUSTO_DA_IMPRESSORA_3D];
    expect(new Set(imp).size).toBe(imp.length);
    expect([...imp].sort()).toEqual([...COLUNAS_VIVAS_DA_IMPRESSORA].sort());
    const fil = [...COLUNAS_DO_FILAMENTO_SEM_CUSTO, ...COLUNAS_DE_CUSTO_DO_FILAMENTO];
    expect(new Set(fil).size).toBe(fil.length);
    expect([...fil].sort()).toEqual([...COLUNAS_VIVAS_DO_FILAMENTO].sort());
    expect(COLUNAS_DA_IMPRESSORA_3D_SEM_CUSTO).toHaveLength(18);
    expect(COLUNAS_DE_CUSTO_DA_IMPRESSORA_3D).toHaveLength(18);
    expect(COLUNAS_DO_FILAMENTO_SEM_CUSTO).toHaveLength(19);
    expect(COLUNAS_DE_CUSTO_DO_FILAMENTO).toHaveLength(6);
  });

  it("a lista aberta não tem custo, compra, depreciação nem hora produtiva", () => {
    for (const c of [...COLUNAS_DA_IMPRESSORA_3D_SEM_CUSTO, ...COLUNAS_DO_FILAMENTO_SEM_CUSTO]) {
      expect(c, c).not.toMatch(
        /custo|aquisi|residual|vida_util|manutencao|consumiveis|infraestrutura|frete|instalacao|acessorios|tributos|descontos|horas_/,
      );
    }
    expect(COLUNAS_DE_CUSTO_DO_FILAMENTO).toContain("custo_por_grama_calculado");
    expect(COLUNAS_DE_CUSTO_DA_IMPRESSORA_3D).toContain("custo_hora_calculado");
    expect(COLUNAS_DE_CUSTO_DA_IMPRESSORA_3D).toContain("custo_hora_manual");
  });

  it("o select de quem não vê custo é a lista aberta, na mesma ordem, mais o nome do cadastro", () => {
    expect(SELECT_DA_IMPRESSORA_3D_SEM_CUSTO).toBe(
      `${COLUNAS_DA_IMPRESSORA_3D_SEM_CUSTO.join(", ")}, maquinas(nome)`,
    );
    expect(SELECT_DO_FILAMENTO_SEM_CUSTO).toBe(
      `${COLUNAS_DO_FILAMENTO_SEM_CUSTO.join(", ")}, materiais(nome)`,
    );
    for (const s of [SELECT_DA_IMPRESSORA_3D_SEM_CUSTO, SELECT_DO_FILAMENTO_SEM_CUSTO]) {
      expect(s).not.toContain("*");
      expect(s).not.toMatch(/custo/);
    }
  });

  it("coluna nova nas duas tabelas, em migração depois da C1, entra em uma das listas", () => {
    const CORTE = "20261110270000";
    const conhecidas: Record<string, Set<string>> = {
      maquinas_3d_config: new Set<string>([
        ...COLUNAS_DA_IMPRESSORA_3D_SEM_CUSTO,
        ...COLUNAS_DE_CUSTO_DA_IMPRESSORA_3D,
      ]),
      materiais_3d_filamento: new Set<string>([
        ...COLUNAS_DO_FILAMENTO_SEM_CUSTO,
        ...COLUNAS_DE_CUSTO_DO_FILAMENTO,
      ]),
    };
    const sem: string[] = [];
    for (const arquivo of readdirSync("supabase/migrations")) {
      if (!arquivo.endsWith(".sql") || arquivo.slice(0, 14) <= CORTE) continue;
      const sql = ler(`supabase/migrations/${arquivo}`).replace(/^--[^\n]*$/gm, "");
      for (const m of sql.matchAll(
        /ALTER\s+TABLE\s+(?:IF EXISTS\s+)?(?:ONLY\s+)?public\.(maquinas_3d_config|materiais_3d_filamento)\s+([^;]*);/gi,
      )) {
        for (const col of m[2].matchAll(/ADD\s+COLUMN\s+(?:IF NOT EXISTS\s+)?"?(\w+)"?/gi)) {
          if (!conhecidas[m[1].toLowerCase()].has(col[1]))
            sem.push(`${arquivo}: ${m[1]}.${col[1]}`);
        }
      }
    }
    expect(
      sem,
      "coluna nova: ponha em src/domain/impressao3d/colunas.ts e no GRANT da migração",
    ).toEqual([]);
  });
});

/** Todos os .ts e .tsx de src, menos os tipos gerados. */
function fontes(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return nome === "integrations" ? [] : fontes(caminho);
    return /\.(ts|tsx)$/.test(nome) ? [caminho] : [];
  });
}

/** O texto do `.select(...)` que vem depois da posição, respeitando aspas e parênteses. */
function argumentoDoSelect(texto: string, desde: number): string | null {
  const i = texto.indexOf(".select(", desde);
  if (i < 0 || i - desde > 400) return null;
  let fundo = 0;
  let aspas: string | null = null;
  for (let k = i + ".select(".length; k < texto.length; k++) {
    const c = texto[k];
    if (aspas) {
      if (c === "\\") k++;
      else if (c === aspas) aspas = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") aspas = c;
    else if (c === "(") fundo++;
    else if (c === ")") {
      if (fundo === 0) return texto.slice(i + ".select(".length, k);
      fundo--;
    }
  }
  return null;
}

/**
 * A função do servidor lê as taxas com a CHAVE DE SERVIÇO (é ela que cota para quem não vê custo). É a única
 * exceção, e o teste confere que ela continua sendo do servidor.
 */
const LE_COM_A_CHAVE_DE_SERVICO = "src/lib/api/orcamento-3d.functions.ts";

const PROIBIDAS: Record<string, RegExp[]> = {
  maquinas_3d_config: COLUNAS_DE_CUSTO_DA_IMPRESSORA_3D.map((c) => new RegExp(`\\b${c}\\b`)),
  materiais_3d_filamento: COLUNAS_DE_CUSTO_DO_FILAMENTO.map((c) => new RegExp(`\\b${c}\\b`)),
};

describe("nenhum arquivo do navegador pede custo da impressão 3D às tabelas", () => {
  const ARQUIVOS = fontes("src").filter((a) => a !== LE_COM_A_CHAVE_DE_SERVICO);

  it("`.from(tabela).select(...)` nunca cita coluna de custo nem usa asterisco", () => {
    const culpados: string[] = [];
    for (const arquivo of ARQUIVOS) {
      const texto = ler(arquivo);
      for (const m of texto.matchAll(
        /\.from\(\s*(["'])(maquinas_3d_config|materiais_3d_filamento)\1\s*\)/g,
      )) {
        const arg = argumentoDoSelect(texto, m.index! + m[0].length);
        if (arg === null) continue; // update, insert ou delete: não lê
        if (/^\s*["'`]\s*\*?\s*["'`]\s*$/.test(arg) || arg.trim() === "")
          culpados.push(`${arquivo}: select com asterisco ou vazio em ${m[2]}`);
        for (const re of PROIBIDAS[m[2]])
          if (re.test(arg)) culpados.push(`${arquivo}: ${m[2]} ${re.source}`);
      }
    }
    expect(culpados).toEqual([]);
  });

  it("nenhum embed pede custo da impressora ou do filamento (`maquinas_3d_config(custo_...)`)", () => {
    const culpados: string[] = [];
    for (const arquivo of ARQUIVOS) {
      const texto = ler(arquivo);
      for (const m of texto.matchAll(
        /(maquinas_3d_config|materiais_3d_filamento)(?::\w+)?\(([^)]*)\)/g,
      )) {
        if (m[2].trim().startsWith('"') || m[2].trim().startsWith("'")) continue; // .from("...")
        for (const re of PROIBIDAS[m[1]]) if (re.test(m[2])) culpados.push(`${arquivo}: ${m[0]}`);
      }
    }
    expect(culpados).toEqual([]);
  });

  it("a única leitura das taxas fora das visões é a do servidor, com a chave de serviço", () => {
    const fonte = ler(LE_COM_A_CHAVE_DE_SERVICO);
    expect(fonte).toContain('await import("@/integrations/supabase/client.server")');
    expect(fonte).toMatch(/const db = supabaseAdmin/);
    expect(fonte).not.toMatch(/context\.supabase[\s\S]{0,40}\.from\(/);
  });

  it("os leitores por nível: quem vê custo lê a visão inteira; os demais, a tabela com a lista aberta", () => {
    const fonte = ler("src/lib/supabase-financial-views.ts");
    const imp = fonte.slice(fonte.indexOf("export function lerImpressoras3d"));
    expect(imp).toContain('.from("maquinas_3d_config_financeiro").select("*")');
    expect(imp).toContain('.from("maquinas_3d_config").select(SELECT_DA_IMPRESSORA_3D_SEM_CUSTO)');
    const fil = fonte.slice(fonte.indexOf("export function lerFilamentos3d"));
    expect(fil).toContain('.from("materiais_3d_filamento_financeiro").select("*")');
    expect(fil).toContain('.from("materiais_3d_filamento").select(SELECT_DO_FILAMENTO_SEM_CUSTO)');
  });
});

describe("a calculadora 3D por ramo (texto)", () => {
  const tela = ler("src/components/impressao3d/calculadora-3d.tsx");

  it("lê impressoras e filamentos pelo nível, com o nível na chave do cache, e falha não vira lista vazia", () => {
    expect(tela).toContain("lerImpressoras3d(podeVerCusto)");
    expect(tela).toContain("lerFilamentos3d(podeVerCusto)");
    expect(tela).toContain('queryKey: ["impressoras-sel", podeVerCusto]');
    expect(tela).toContain('queryKey: ["filamentos-sel", podeVerCusto]');
    // `(await ...).data ?? []` engolia o erro e mostrava "Nenhuma impressora ativa": agora o erro sobe.
    expect(tela).toMatch(
      /lerImpressoras3d\(podeVerCusto\)\.eq\("ativa", true\);\s*if \(error\) throw error;/,
    );
    expect(tela).toMatch(/lerFilamentos3d\(podeVerCusto\);\s*if \(error\) throw error;/);
    expect(tela).not.toContain('.from("maquinas_3d_config")');
    expect(tela).not.toContain('.from("materiais_3d_filamento")');
    expect(tela).toContain("listaDeImpressoras.isError");
    expect(tela).toContain("listaDeFilamentos.isError");
  });

  it("a base de preço só é lida por quem vê custo, e base que não chega trava o salvar", () => {
    expect(tela.match(/\.from\("config_precificacao_3d"\)/g)).toHaveLength(1);
    const consulta = tela.slice(
      tela.indexOf('queryKey: ["config-precificacao-3d"]'),
      tela.indexOf('.from("config_precificacao_3d")'),
    );
    expect(consulta).toContain("enabled: podeVerCusto,");
    expect(tela).toContain(
      'const precoPronto = podeVerCusto ? baseDePreco === "ok" : !!cotacaoAtual;',
    );
    expect(tela).toContain("disabled={salvar.isPending || faltando.length > 0 || !precoPronto}");
  });

  it("quem não vê custo cota no servidor: espera de 400 ms, sem preço velho, falha em voz alta", () => {
    expect(tela).toContain("cotarPeca3d({ data:");
    expect(tela).toContain("useAtrasado(chaveDaCotacao, 400)");
    expect(tela).toContain('queryKey: ["cotar-peca-3d", chaveAtrasada]');
    expect(tela).not.toContain("placeholderData");
    expect(tela).not.toContain("keepPreviousData");
    expect(tela).toContain(
      "Não consegui calcular o preço agora. Tente de novo; se continuar, avise a gerência.",
    );
    expect(tela).toContain(
      "cotavel && !esperandoDigitar && cotacao.isSuccess ? cotacao.data : null",
    );
  });

  it("'O preço mudou' no salvar pede a cotação nova na hora (senão a tela fica com o preço velho e o salvar falha em laço)", () => {
    const onError = tela.slice(
      tela.indexOf("onError: (e: any) => {"),
      tela.indexOf("});", tela.indexOf("onError: (e: any) => {")),
    );
    expect(onError).toContain("toast.error(mensagemErro(e))");
    expect(onError).toContain("mensagemErro(e) === PRECO_MUDOU_3D");
    expect(onError).toContain("cotacao.refetch()");
    // A frase é uma só, nos dois lados: se o servidor mudar o texto, a tela continua reconhecendo.
    const servidor = ler("src/lib/api/orcamento-3d.functions.ts");
    expect(servidor).toContain("const PRECO_MUDOU = PRECO_MUDOU_3D;");
    expect(ler("src/domain/impressao3d/calcular-peca.ts")).toContain(
      'export const PRECO_MUDOU_3D =\n  "O preço mudou desde a última conta.',
    );
  });

  it("quem não vê custo salva pelo servidor, sem mandar preço nem custo; quem vê, pela função do banco", () => {
    const ramo = tela.slice(
      tela.indexOf("if (!podeVerCusto) {\n        if (!cotacaoAtual)"),
      tela.indexOf("return { orcamentoId: r.orcamentoId"),
    );
    expect(ramo).toContain("salvarPeca3dNoOrcamento({");
    expect(ramo).toContain("precoVisto: cotacaoAtual.preco");
    expect(ramo).not.toMatch(/p_preco|p_custo|markup|custoPorGrama|custo_hora|tarifa/);
    expect(tela).toContain('"salvar_item_3d_no_orcamento"');
    expect(tela).toContain("inputsDoItem3d(entradasDaConta, calc,");
    expect(tela).toContain("resultadosDoItem3d(entradasDaConta, calc)");
  });

  it("custo/hora, potência e preset só entram no ramo de custo", () => {
    expect(tela).toContain("if (!podeVerCusto || !impressora) return;");
    expect(tela).toContain("}, [f.maquina_id, podeVerCusto]);");
    expect(tela).toContain('if (!podeVerCusto || typeof window === "undefined") return;');
    expect(tela).toContain("podeVerCusto ? calcularPeca3D(entradasDaConta) : null");
  });
});

describe("impressoras e filamentos (telas de cadastro) pelas visões", () => {
  for (const [arquivo, leitor, chave] of [
    [
      "src/routes/_authenticated/impressoras-3d.tsx",
      "lerImpressoras3d(veCusto)",
      '["impressoras-3d", veCusto]',
    ],
    [
      "src/routes/_authenticated/filamentos-3d.tsx",
      "lerFilamentos3d(veCusto)",
      '["filamentos-3d", veCusto]',
    ],
  ] as const) {
    it(`${arquivo}: lê pelo nível, com o nível na chave, e falha aparece como falha`, () => {
      const fonte = ler(arquivo);
      expect(fonte).toContain(leitor);
      expect(fonte).toContain(`queryKey: ${chave}`);
      expect(fonte).toContain(
        'const veCusto = hasPermission("impressao3d.cost.read") || hasPermission("financeiro.read");',
      );
      expect(fonte).toContain(") : isError ? (");
      expect(fonte).toContain("É uma falha de leitura, não uma lista vazia.");
      expect(fonte).not.toMatch(/\bisLoading\b/);
    });
  }

  it("a tarifa das impressoras não vira R$ 0 por hora quando não chega", () => {
    const fonte = ler("src/routes/_authenticated/impressoras-3d.tsx");
    expect(fonte).not.toContain("tarifa_kwh_padrao ?? 0");
    expect(fonte).toContain('"sem tarifa"');
  });
});

// ---- A tradução do formulário de quem vê custo para o módulo dá o mesmo que a conta inline de antes ----------

/** Gerador com semente fixa (mulberry32): o mesmo sorteio em toda execução. */
function sorteio(semente: number) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Os componentes do resultado, em texto comparável (Decimal com 6 casas; o resto como está). */
function emTexto(r: Record<string, unknown>, chaves: string[]) {
  const s: Record<string, unknown> = {};
  for (const k of chaves) {
    const v = r[k] as { toString?: (n: number) => string } | number | boolean;
    s[k] =
      typeof v === "object" && v !== null && typeof v.toString === "function" ? v.toString(6) : v;
  }
  return s;
}

describe("a tela de quem vê custo monta as entradas como a conta inline montava", () => {
  it("em 5.000 formulários sorteados (vírgula, vazio, lixo, piso, placas), todos os componentes iguais", () => {
    const r = sorteio(20261111);
    const escolha = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
    const numero = (max: number, casas: number) => (r() * max).toFixed(casas);
    const texto = (max: number, casas: number) =>
      escolha([
        "",
        "abc",
        "0",
        numero(max, casas),
        numero(max, casas).replace(".", ","),
        numero(max, casas),
      ]);
    let comparados = 0;
    for (let i = 0; i < 5000; i++) {
      const f = {
        quantidade: escolha([
          "",
          "1",
          "2",
          "10",
          "40",
          "100",
          "2,5",
          "0",
          "-3",
          String(1 + Math.floor(r() * 2000)),
        ]),
        gramas: texto(3000, 2),
        peso_suporte: texto(200, 2),
        peso_purga: texto(200, 2),
        pecas_placa: escolha(["", "1", "4", "12", "0", String(1 + Math.floor(r() * 30))]),
        custo_hora: texto(3, 4),
        potencia_w: texto(400, 0),
        tarifa_kwh: texto(2, 4),
        mo_custo_hora: texto(80, 2),
        mo_horas: escolha(["0", "", "0,5", "1", numero(3, 2)]),
        pct_acabamento: texto(15, 1),
        pct_falha: texto(15, 1),
        custo_admin: texto(20, 2),
        markup: escolha(["", "2", "1,4", "2.3", "0", numero(4, 2)]),
      };
      const tempoMinutos = escolha([0, 1, 123, 135, Math.floor(r() * 30000)]);
      const custoPorGramaCalculado = escolha([undefined, null, 0.05932, "0.29676", r() * 0.3]);
      const markupAtacadoPadrao = escolha([undefined, null, 1.5, "1.4", 0]);
      const embalagemIncluida = r() < 0.5;

      let antigo: Record<string, unknown> | Error;
      let novo: Record<string, unknown> | Error;
      try {
        antigo = contaInlineDeHoje({
          f,
          tempoMinutos,
          custoPorGramaCalculado,
          embalagemIncluida,
          markupAtacadoPadrao,
        }) as unknown as Record<string, unknown>;
      } catch (e) {
        antigo = e as Error;
      }
      try {
        novo = calcularPeca3D(
          entradasDaContaNaTela({
            f,
            tempoMinutos,
            custoPorGramaCalculado,
            embalagemIncluida,
            markupAtacadoPadrao,
          }),
        ) as unknown as Record<string, unknown>;
      } catch (e) {
        novo = e as Error;
      }
      if (antigo instanceof Error || novo instanceof Error) {
        expect(novo instanceof Error, JSON.stringify(f)).toBe(antigo instanceof Error);
        continue;
      }
      const chaves = Object.keys(antigo);
      expect(emTexto(novo, chaves), JSON.stringify({ f, tempoMinutos })).toEqual(
        emTexto(antigo, chaves),
      );
      comparados++;
    }
    expect(comparados).toBeGreaterThan(4000);
  });
});

// ---- A tela desenhada (HTML do servidor), nos dois ramos --------------------------------------------------------

const IMPRESSORA = "39807c59-0000-4000-8000-000000000001";
const FILAMENTO = "5b1e0000-0000-4000-8000-000000000002";

function desenhar(verCusto: boolean, config?: Record<string, unknown> | null) {
  permissoes.atuais = new Set(verCusto ? ["impressao3d.cost.read"] : []);
  tabelasPedidas.lista = [];
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(
    ["impressoras-sel", verCusto],
    verCusto
      ? [
          {
            maquina_id: IMPRESSORA,
            nome: "3D 01",
            maquinas: { nome: "3D 01" },
            custo_hora_calculado: 7.7777,
            potencia_media_w: 150,
          },
        ]
      : [{ maquina_id: IMPRESSORA, maquinas: { nome: "3D 01" } }],
  );
  qc.setQueryData(
    ["filamentos-sel", verCusto],
    verCusto
      ? [
          {
            material_id: FILAMENTO,
            nome: "PLA Preto",
            materiais: { nome: "PLA Preto" },
            tipo: "PLA",
            cor: "Preto",
            custo_por_grama_calculado: 0.1234,
          },
        ]
      : [{ material_id: FILAMENTO, materiais: { nome: "PLA Preto" }, tipo: "PLA", cor: "Preto" }],
  );
  if (config !== undefined) qc.setQueryData(["config-precificacao-3d"], config);
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: qc },
      createElement(Calculadora3D, {
        modo: "embutido",
        orcamentoId: "0b0b0b0b-0000-4000-8000-000000000003",
        clienteId: null,
        onSalvo: () => undefined,
      }),
    ),
  );
}

describe("a calculadora desenhada", () => {
  it("quem não vê custo: sem presets, sem parâmetros, sem custo; o preço espera o servidor", () => {
    const html = desenhar(false);
    expect(html).not.toContain("Presets de custo");
    expect(html).not.toContain("De onde vem o custo");
    expect(html).not.toContain("Mão de obra (R$/h)");
    expect(html).not.toContain("· markup");
    expect(html).not.toContain("de margem");
    expect(html).not.toContain("7,7777");
    expect(html).toContain("a conta é feita no servidor");
    expect(html).toContain('data-testid="preco-3d-sem-valor"');
    expect(tabelasPedidas.lista).not.toContain("config_precificacao_3d");
  });

  it("quem vê custo: presets e parâmetros; sem a base de preço ainda, nada de número no lugar do preço", () => {
    const html = desenhar(true);
    expect(html).toContain("Presets de custo");
    expect(html).toContain("De onde vem o custo");
    expect(html).not.toContain('data-testid="preco-3d-sem-valor"');
    expect(html).not.toContain('data-testid="base-de-preco-3d-faltou"');
  });

  it("quem vê custo e a base não chega: aviso em voz alta (não os números de fábrica em silêncio)", () => {
    const html = desenhar(true, null);
    expect(html).toContain('data-testid="base-de-preco-3d-faltou"');
    expect(html).toContain("A base de preço 3D não chegou para o seu perfil.");
    expect(html).toContain("Salvar fica bloqueado até a base chegar.");
  });
});
