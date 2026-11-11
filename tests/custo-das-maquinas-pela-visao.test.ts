import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHAVES_COMERCIAIS_DA_FICHA,
  COLUNAS_DA_MAQUINA_SEM_CUSTO,
  COLUNAS_DE_CUSTO_DA_MAQUINA,
  SELECT_DA_MAQUINA_SEM_CUSTO,
} from "../src/domain/maquinas/colunas";

/**
 * O custo das máquinas só chega a quem vê custo (10/11/2026).
 *
 * `maquinas` era lida por toda a equipe com todas as colunas: custo por hora, valor de compra e o texto de compra iam ao
 * navegador de quem só vende, opera ou desenha, embora as telas escondessem. A visão `maquinas_financeiro` entrega a
 * máquina inteira a quem vê custo; os demais leem a tabela só com as colunas sem custo. Estes testes travam o que a
 * tela pede, para que nenhum arquivo volte a pedir custo à tabela depois de a migração de fechamento tirar a leitura.
 */

/** As 32 colunas de `maquinas` em produção em 10/11/2026 (pg_attribute). */
const COLUNAS_VIVAS = [
  "id",
  "nome",
  "tipo",
  "ativa",
  "created_at",
  "custo_hora",
  "potencia_kw",
  "setup_min",
  "velocidade_m2_h",
  "disponibilidade_pct",
  "setor",
  "updated_at",
  "largura_util_m",
  "margem_lateral_m",
  "fabricante",
  "modelo",
  "numero_serie",
  "imagem_url",
  "especificacoes",
  "horas_produtivas_mensais",
  "vida_util_horas",
  "valor_residual",
  "base_cobranca",
  "tempo_minimo_min",
  "velocidade_mm_s",
  "avanco_m",
  "forma_aquisicao",
  "valor_aquisicao",
  "data_aquisicao",
  "alimentacao",
  "comprimento_util_m",
  "especificacoes_comerciais",
];

const ler = (caminho: string) => readFileSync(caminho, "utf8");

describe("as duas listas de colunas de maquinas", () => {
  it("juntas são todas as colunas que a tabela tem, sem repetir nem faltar", () => {
    const juntas = [...COLUNAS_DA_MAQUINA_SEM_CUSTO, ...COLUNAS_DE_CUSTO_DA_MAQUINA];
    expect(new Set(juntas).size).toBe(juntas.length);
    expect([...juntas].sort()).toEqual([...COLUNAS_VIVAS].sort());
  });

  it("a lista aberta à equipe não tem nenhuma coluna de custo, compra ou texto comercial", () => {
    for (const c of COLUNAS_DA_MAQUINA_SEM_CUSTO) {
      expect(c, c).not.toMatch(/custo|valor_|aquisi|residual|vida_util|comercial/);
    }
    expect(COLUNAS_DE_CUSTO_DA_MAQUINA).toEqual([
      "custo_hora",
      "vida_util_horas",
      "valor_residual",
      "forma_aquisicao",
      "valor_aquisicao",
      "data_aquisicao",
      "especificacoes_comerciais",
    ]);
  });

  it("o select de quem não vê custo é a lista aberta, na mesma ordem", () => {
    expect(SELECT_DA_MAQUINA_SEM_CUSTO).toBe(COLUNAS_DA_MAQUINA_SEM_CUSTO.join(", "));
    expect(SELECT_DA_MAQUINA_SEM_CUSTO).not.toContain("custo_hora");
    expect(SELECT_DA_MAQUINA_SEM_CUSTO).not.toContain("*");
  });

  it("as colunas que o simulador de encaixe e o cartão do rolo leem estão na lista aberta", () => {
    for (const c of [
      "nome",
      "largura_util_m",
      "margem_lateral_m",
      "avanco_m",
      "alimentacao",
      "comprimento_util_m",
      "base_cobranca",
      "velocidade_m2_h",
    ]) {
      expect(COLUNAS_DA_MAQUINA_SEM_CUSTO, c).toContain(c);
    }
  });

  it("coluna nova de maquinas, em migração depois da visão do custo, entra em uma das duas listas", () => {
    const CORTE = "20261110250000";
    const conhecidas = new Set<string>([
      ...COLUNAS_DA_MAQUINA_SEM_CUSTO,
      ...COLUNAS_DE_CUSTO_DA_MAQUINA,
    ]);
    const sem: string[] = [];
    for (const arquivo of readdirSync("supabase/migrations")) {
      if (!arquivo.endsWith(".sql") || arquivo.slice(0, 14) <= CORTE) continue;
      const sql = ler(`supabase/migrations/${arquivo}`).replace(/^--[^\n]*$/gm, "");
      for (const m of sql.matchAll(
        /ALTER\s+TABLE\s+(?:IF EXISTS\s+)?(?:ONLY\s+)?public\.maquinas\s+([^;]*);/gi,
      )) {
        for (const col of m[1].matchAll(/ADD\s+COLUMN\s+(?:IF NOT EXISTS\s+)?"?(\w+)"?/gi)) {
          if (!conhecidas.has(col[1])) sem.push(`${arquivo}: ${col[1]}`);
        }
      }
    }
    expect(
      sem,
      "coluna nova em maquinas: ponha em src/domain/maquinas/colunas.ts e no GRANT",
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

const PROIBIDAS = COLUNAS_DE_CUSTO_DA_MAQUINA.map((c) => new RegExp(`\\b${c}\\b`));

describe("nenhum arquivo pede custo da máquina à tabela", () => {
  const ARQUIVOS = fontes("src");

  it('`.from("maquinas").select(...)` nunca cita coluna de custo nem usa asterisco', () => {
    const culpados: string[] = [];
    for (const arquivo of ARQUIVOS) {
      const texto = ler(arquivo);
      for (const m of texto.matchAll(/\.from\(\s*(["'])maquinas\1\s*\)/g)) {
        const arg = argumentoDoSelect(texto, m.index! + m[0].length);
        if (arg === null) continue; // update, insert ou delete: não lê
        if (/^\s*["'`]\s*\*?\s*["'`]\s*$/.test(arg) || arg.trim() === "")
          culpados.push(`${arquivo}: select com asterisco ou vazio`);
        for (const re of PROIBIDAS) if (re.test(arg)) culpados.push(`${arquivo}: ${re.source}`);
      }
    }
    expect(culpados).toEqual([]);
  });

  it("nenhum embed pede custo da máquina (`maquinas(nome, custo_hora)`)", () => {
    const culpados: string[] = [];
    for (const arquivo of ARQUIVOS) {
      const texto = ler(arquivo);
      for (const m of texto.matchAll(/maquinas(?::\w+)?\(([^)]*)\)/g)) {
        for (const re of PROIBIDAS) if (re.test(m[1])) culpados.push(`${arquivo}: ${m[0]}`);
      }
    }
    expect(culpados).toEqual([]);
  });

  it("o cartão de apontamento escolhe a visão pelo nível e a tabela só com id e nome", () => {
    const fonte = ler("src/components/os/apontamento-card.tsx");
    expect(fonte).toContain('.from(canSeeFinancials ? "maquinas_financeiro" : "maquinas")');
    expect(fonte).toContain('.select(canSeeFinancials ? "id, nome, custo_hora" : "id, nome")');
    expect(fonte).toContain("maquinas(nome)");
    expect(fonte).toContain('.from("maquinas_financeiro")');
  });

  it("calculadora de custo, precificação e compromissos leem o custo por hora da visão financeira", () => {
    for (const arquivo of [
      "src/components/orcamento/calculadora-custo.tsx",
      "src/routes/_authenticated/precificacao.tsx",
      "src/routes/_authenticated/compromissos.tsx",
    ]) {
      const fonte = ler(arquivo);
      expect(fonte, arquivo).toContain('.from("maquinas_financeiro" as never)');
      expect(fonte, arquivo).not.toMatch(/\.from\("maquinas"\)/);
    }
  });
});

describe("a tela de máquinas e a agenda", () => {
  it("a tela de máquinas lê pelo nível de quem olha, com o nível na chave do cache", () => {
    const fonte = ler("src/routes/_authenticated/maquinas.tsx");
    expect(fonte).toContain('queryKey: ["maquinas", canSeeFinancials]');
    expect(fonte).toContain("lerMaquinas(canSeeFinancials)");
    expect(fonte).not.toMatch(/\.from\("maquinas"\)\s*\.select\("\*"\)/);
  });

  it("a agenda tem chave própria e só pede o que usa (antes dividia ['maquinas'] com formato diferente)", () => {
    const fonte = ler("src/routes/_authenticated/maquinas-agenda.tsx");
    expect(fonte).toContain('queryKey: ["maquinas", "agenda"]');
    expect(fonte).toContain('.select("id, nome, tipo, ativa, setor")');
    expect(fonte).not.toContain('db.from("maquinas").select("*")');
  });

  it("o bloco 'Compra e custo' só aparece para quem vê custo, com letra de pelo menos 15 px", () => {
    const fonte = ler("src/routes/_authenticated/maquinas.tsx");
    const inicio = fonte.indexOf("data-compra-e-custo");
    const bloco = fonte.slice(fonte.lastIndexOf("{canSeeFinancials &&", inicio), inicio + 900);
    expect(bloco).toContain("especificacoes_comerciais");
    expect(bloco).toContain("text-sm");
    expect(bloco).not.toMatch(/\btext-xs\b/);
    expect(bloco).not.toMatch(/\btitle=/);
  });
});

describe("a leitura das máquinas pelo nível", () => {
  const fonte = ler("src/lib/supabase-financial-views.ts");
  const funcao = fonte.slice(fonte.indexOf("export function lerMaquinas"));

  it("quem vê custo lê a visão inteira; os demais, a tabela com a lista aberta", () => {
    expect(funcao).toContain('.from("maquinas_financeiro").select("*")');
    expect(funcao).toContain('.from("maquinas").select(SELECT_DA_MAQUINA_SEM_CUSTO)');
  });

  it("aceita o nível novo ou o boolean canSeeFinancials", () => {
    expect(funcao).toContain('nivel === true || nivel === "financeiro"');
  });
});

describe("as chaves de compra que saíram da ficha técnica", () => {
  it("são as seis que a limpeza das máquinas move para a coluna restrita", () => {
    expect([...CHAVES_COMERCIAIS_DA_FICHA]).toEqual([
      "compra",
      "custo_hora_base",
      "custo_hora_atualizado_em",
      "preco_referencia",
      "situacao",
      "custo_hora_provisorio",
    ]);
  });
});
