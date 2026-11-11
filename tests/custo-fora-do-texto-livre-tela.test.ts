import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { colunasDoSeletorDeProdutos } from "../src/domain/catalogo/colunas-do-seletor";
import { AVISO_VALOR_NO_TEXTO, textoTemValorEmReais } from "../src/domain/custos/valor-no-texto";

/**
 * A volta do custo ao texto livre (10/11/2026), a parte da tela e do repositório da limpeza
 * `20261110200000_custo_fora_do_texto_livre.sql`.
 *
 * 1. Os dois seletores de produto pedem só as colunas que usam e nunca a nota interna do produto
 *    (`observacoes_internas`): até hoje faziam `select("*")` e a nota chegava ao navegador de quem não vê custo.
 * 2. Quem digita "R$" em observação de produto, observação de acabamento ou características de material
 *    recebe um aviso na hora (o banco achou custo digitado ali em 25/10, 27/10 e 03/11).
 * 3. Migração nova que grave "R$" nesses campos reprova o teste.
 */

const ler = (caminho: string) => readFileSync(caminho, "utf8");

/** Colunas de cada view de produto em produção, conferidas em 10/11/2026 (pg_attribute). */
const COLUNAS_DA_VIEW = {
  operacional:
    "id,nome,descricao,ativo,created_at,sku,categoria,tipo,unidade,tempo_producao_min,imagem_url,observacoes_internas,updated_at,maquina_padrao_id,material_principal_id,exigencias,sugestoes_operacionais,area_minima_cobrada,espacamento_pecas_m,familia",
  comercial:
    "id,nome,descricao,ativo,created_at,sku,categoria,tipo,unidade,tempo_producao_min,imagem_url,observacoes_internas,updated_at,maquina_padrao_id,material_principal_id,exigencias,sugestoes_operacionais,area_minima_cobrada,espacamento_pecas_m,preco_base,preco_publico,preco_sugerido,preco_parceiro,familia",
  financeiro:
    "id,nome,descricao,ativo,created_at,sku,categoria,tipo,unidade,tempo_producao_min,imagem_url,observacoes_internas,updated_at,maquina_padrao_id,material_principal_id,exigencias,sugestoes_operacionais,preco_base,custo_medio,margem_minima,margem_sugerida,preco_minimo,preco_sugerido,preco_publico,area_minima_cobrada,preco_parceiro,familia",
} as const;

const NIVEIS = ["operacional", "comercial", "financeiro"] as const;
const colunas = (nivel: (typeof NIVEIS)[number]) => colunasDoSeletorDeProdutos(nivel).split(", ");

describe("as colunas do seletor de produtos", () => {
  it("nunca incluem a nota interna do produto", () => {
    for (const nivel of NIVEIS) expect(colunas(nivel), nivel).not.toContain("observacoes_internas");
  });

  it("só pedem coluna que a view do nível tem (coluna que falta derruba a consulta inteira e o catálogo abre vazio)", () => {
    for (const nivel of NIVEIS) {
      const daView = COLUNAS_DA_VIEW[nivel].split(",");
      for (const c of colunas(nivel)) expect(daView, `${nivel}: ${c}`).toContain(c);
    }
  });

  it("não repetem coluna", () => {
    for (const nivel of NIVEIS) expect(new Set(colunas(nivel)).size).toBe(colunas(nivel).length);
  });

  it("o operacional não pede nenhum valor; o comercial pede preço, nunca custo nem margem; o financeiro pede tudo", () => {
    const valor = /^(preco_|custo_|margem_)/;
    expect(colunas("operacional").filter((c) => valor.test(c))).toEqual([]);
    expect(
      colunas("comercial")
        .filter((c) => valor.test(c))
        .sort(),
    ).toEqual(["preco_base", "preco_parceiro"]);
    expect(
      colunas("financeiro")
        .filter((c) => valor.test(c))
        .sort(),
    ).toEqual(["custo_medio", "margem_minima", "preco_base", "preco_parceiro"]);
  });

  it("cobrem o que a escolha em cartões e o catálogo da OS leem (contrato de ProdutoDaEscolha)", () => {
    const sempre = [
      "id",
      "nome",
      "sku",
      "descricao",
      "categoria",
      "tipo",
      "unidade",
      "imagem_url",
      "area_minima_cobrada",
      "tempo_producao_min",
      "familia",
    ];
    for (const nivel of NIVEIS)
      for (const c of sempre) expect(colunas(nivel), `${nivel}: ${c}`).toContain(c);
    expect(colunas("comercial")).toContain("preco_base");
    expect(colunas("financeiro")).toEqual(
      expect.arrayContaining(["preco_base", "custo_medio", "margem_minima"]),
    );
  });
});

describe("os dois seletores usam a lista, não o asterisco", () => {
  const ARQUIVOS = [
    "src/components/orcamento/use-produtos-para-escolha.ts",
    "src/components/produto-autocomplete.tsx",
  ];

  it("os dois pedem as colunas do nível de quem olha, as mesmas (dividem a chave de cache)", () => {
    for (const arquivo of ARQUIVOS) {
      const fonte = ler(arquivo);
      expect(fonte, arquivo).toContain(".select(colunasDoSeletorDeProdutos(nivelDeVisao))");
      expect(fonte, arquivo).toContain('queryKey: ["produtos-catalog-picker", nivelDeVisao]');
    }
  });

  it("nenhum dos dois faz select('*') na view de produtos", () => {
    for (const arquivo of ARQUIVOS) {
      const codigo = ler(arquivo)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "");
      expect(codigo, arquivo).not.toMatch(/\.select\(\s*["'`]\*["'`]\s*\)/);
      expect(codigo, arquivo).not.toContain("observacoes_internas");
    }
  });
});

describe("o aviso ao digitar R$ em texto que a equipe inteira lê", () => {
  it("reconhece a marca de reais em qualquer lugar do texto, e só ela", () => {
    expect(textoTemValorEmReais("custo R$ 24,17/h")).toBe(true);
    expect(textoTemValorEmReais("(R$ 21,50 por metro)")).toBe(true);
    expect(textoTemValorEmReais("R$12")).toBe(true);
    expect(textoTemValorEmReais("Pedido de 2 kits.")).toBe(false);
    expect(textoTemValorEmReais("")).toBe(false);
    expect(textoTemValorEmReais(null)).toBe(false);
    expect(textoTemValorEmReais(undefined)).toBe(false);
  });

  it("a frase diz onde o valor vai e quem enxerga", () => {
    expect(AVISO_VALOR_NO_TEXTO).toContain("toda a equipe");
    expect(AVISO_VALOR_NO_TEXTO).toContain("campo de custo");
    expect(AVISO_VALOR_NO_TEXTO).toContain("financeiro");
  });

  it("o componente é legível: 16 px, cor do texto, sem title e sem cor de marca como letra", () => {
    const fonte = ler("src/components/custos/aviso-de-valor-no-texto.tsx");
    expect(fonte).toContain("text-base text-foreground");
    expect(fonte).not.toMatch(/\btitle=/);
    expect(fonte).not.toMatch(/text-(primary|accent)\b/);
    expect(fonte).not.toContain("#fd4746");
    expect(fonte).not.toMatch(/\btext-(xs|sm)\b/);
    expect(fonte).toContain('role="status"');
  });

  const CAMPOS: [string, string, string][] = [
    [
      "src/routes/_authenticated/produtos.tsx",
      "observação interna do produto (edição rápida)",
      "<AvisoDeValorNoTexto texto={form.observacoes_internas} />",
    ],
    [
      "src/routes/_authenticated/produtos_.$id.tsx",
      "observação interna do produto (pasta)",
      "<AvisoDeValorNoTexto texto={cadastro.observacoes_internas} />",
    ],
    [
      "src/routes/_authenticated/materiais.tsx",
      "características do material",
      "<AvisoDeValorNoTexto texto={form.caracteristicas} />",
    ],
    [
      "src/components/acabamentos/gerenciador-de-acabamentos.tsx",
      "observação do acabamento",
      "<AvisoDeValorNoTexto texto={form.observacao} />",
    ],
  ];

  it.each(CAMPOS)("%s mostra o aviso embaixo de: %s", (arquivo, _campo, uso) => {
    const fonte = ler(arquivo);
    expect(fonte).toContain(uso);
    expect(fonte).toContain(
      'import { AvisoDeValorNoTexto } from "@/components/custos/aviso-de-valor-no-texto";',
    );
  });
});

/**
 * Migração nova não pode gravar "R$" em observação de produto, observação de acabamento ou característica de
 * material. As anteriores à limpeza (e a própria limpeza, que tem os textos antigos como âncora) ficam de fora.
 */
const CORTE_DA_LIMPEZA = "20261110200000";

function migracaoGravaValorNoTexto(sql: string): string[] {
  const codigo = sql.replace(/--[^\n]*/g, "");
  // Bloco DO $tag$ ... $tag$ é uma unidade só (tem `;` por dentro); o resto vale comando a comando.
  const blocos = [...codigo.matchAll(/\bDO\s+(\$\w*\$)([\s\S]*?)\1/gi)].map((m) => m[2]);
  const comandos = codigo.replace(/\bDO\s+(\$\w*\$)[\s\S]*?\1/gi, ";").split(";");
  return [...blocos, ...comandos]
    .filter(
      (trecho) =>
        /\b(INSERT|UPDATE)\b/i.test(trecho) &&
        /\b(produtos|acabamentos|materiais)\b/i.test(trecho) &&
        /\b(observacoes_internas|observacao|caracteristicas)\b/i.test(trecho) &&
        /R\$/.test(trecho),
    )
    .map((trecho) => trecho.trim().slice(0, 120));
}

describe("migração nova não grava valor em reais nos campos de texto livre", () => {
  it("nenhuma migração depois da limpeza grava R$ nesses campos", () => {
    const culpadas: Record<string, string[]> = {};
    for (const arquivo of readdirSync("supabase/migrations")) {
      if (!arquivo.endsWith(".sql") || arquivo.slice(0, 14) <= CORTE_DA_LIMPEZA) continue;
      const achados = migracaoGravaValorNoTexto(ler(`supabase/migrations/${arquivo}`));
      if (achados.length > 0) culpadas[arquivo] = achados;
    }
    expect(culpadas).toEqual({});
  });

  it("o detector pega UPDATE e INSERT com R$ e deixa passar o que não grava valor", () => {
    expect(
      migracaoGravaValorNoTexto(
        "UPDATE public.produtos SET observacoes_internas = 'custo R$ 12,00/m²' WHERE sku = 'X';",
      ),
    ).toHaveLength(1);
    expect(
      migracaoGravaValorNoTexto(
        "INSERT INTO public.materiais (nome, caracteristicas) VALUES ('Lona', 'R$ 9,10 o metro');",
      ),
    ).toHaveLength(1);
    expect(
      migracaoGravaValorNoTexto(
        "UPDATE public.acabamentos SET observacao = 'Custo da hora R$ 24,17' WHERE id = 1;",
      ),
    ).toHaveLength(1);
    expect(
      migracaoGravaValorNoTexto(
        "UPDATE public.produtos SET observacoes_internas = 'Preço pela regra da casa.' WHERE sku = 'X';",
      ),
    ).toHaveLength(0);
    expect(
      migracaoGravaValorNoTexto(
        "DO $x$ DECLARE v text; BEGIN v := 'R$ 5,00'; UPDATE public.materiais SET caracteristicas = v WHERE id = 1; END $x$;",
      ),
    ).toHaveLength(1);
    expect(migracaoGravaValorNoTexto("-- custo R$ 12,00 só no comentário\nSELECT 1;")).toHaveLength(
      0,
    );
    expect(
      migracaoGravaValorNoTexto(
        "UPDATE public.produto_precos SET custo_medio = 12 WHERE produto_id = 1;",
      ),
    ).toHaveLength(0);
  });

  it("a própria limpeza fica de fora do corte (é a que tem os textos antigos como âncora)", () => {
    expect("20261110200000" <= CORTE_DA_LIMPEZA).toBe(true);
    expect(
      migracaoGravaValorNoTexto(
        ler("supabase/migrations/20261110200000_custo_fora_do_texto_livre.sql"),
      ).length,
    ).toBeGreaterThan(0);
  });
});
