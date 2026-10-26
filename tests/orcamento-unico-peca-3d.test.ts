import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const le = (p: string) => readFileSync(p, "utf8");
const sql = le("supabase/migrations/20261027300000_orcamento_unico_peca_3d.sql");
const calc = le("src/components/impressao3d/calculadora-3d.tsx");
const escolha = le("src/components/orcamento/escolha-de-produto.tsx");
const pagina = le("src/routes/_authenticated/orcamentos.$id.tsx");
const detalhe = le("src/routes/_authenticated/orcamento-3d.$id.tsx");
const hub = le("src/routes/_authenticated/impressao-3d.tsx");
const rota = le("src/routes/_authenticated/orcamento-3d-novo.tsx");

describe("peça 3D como item do orçamento (banco)", () => {
  it("a peça embutida tem item e o espelho não sobrescreve o orçamento", () => {
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS embutido boolean NOT NULL DEFAULT false");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS item_id uuid REFERENCES public.orcamento_itens(id) ON DELETE SET NULL");
    expect(sql).toContain("IF COALESCE(NEW.embutido, false) THEN RETURN NULL; END IF;");
  });
  it("gravar exige a permissão de quem cria orçamento e grava item + cálculo versionado", () => {
    expect(sql).toContain("v_uid := public.require_permission('orcamentos.create');");
    expect(sql).toContain("origem_calculo, especificacao, parametros, arquivo_id)");
    expect(sql).toContain("SELECT COALESCE(max(versao), 0) + 1 INTO v_versao");
    expect(sql).toContain("Informe o tempo de impressão");
  });
  it("a conversão comum cria os jobs de impressão e só desvia para o 3D no legado", () => {
    expect(sql).toContain("AND NOT COALESCE(t3.embutido, false)) THEN");
    expect(sql).toContain("public.criar_jobs_3d_da_os(v_t3.id, v_os_id)");
    expect(sql).toContain("'jobs_3d', v_jobs_3d");
  });
  it("a OS só é 'de impressão 3D' quando todos os itens são peças 3D", () => {
    expect(sql).toContain("COALESCE(i.origem_calculo, '') NOT IN ('orcamento_3d', 'taxa_prazo')");
    expect(sql).toContain("AND NOT public.os_e_impressao_3d(os_bloqueios_para.os_id, v_os.orcamento_id) THEN");
  });
  it("apagar a peça inteira passa; alterar um cálculo avulso continua proibido", () => {
    expect(sql).toContain("IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM public.orcamentos_3d WHERE id = OLD.orcamento_3d_id)");
    expect(sql).toContain("orcamento_3d_calculos é imutável; gere nova versão");
  });
});

describe("peça 3D como item do orçamento (tela)", () => {
  it("a calculadora é uma só, com dois modos, e grava pela função nova", () => {
    expect(calc).toContain('modo: "embutido" | "novo-orcamento"');
    expect(calc).toContain('"salvar_item_3d_no_orcamento"');
    expect(calc).toContain('"ler_item_3d"');
    expect(calc).toContain("enviarLayout(fotoModelo, orcId");
    expect(rota).toContain('modo="novo-orcamento"');
    expect(rota).toContain('to: "/orcamentos/$id"');
  });
  it("o cartão Impressão 3D abre a calculadora; a peça gravada reabre nela e sai pela função do banco", () => {
    expect(escolha).toContain('if (t.chave === "impressao_3d" && onCalcularPeca3d) onCalcularPeca3d();');
    expect(escolha).toContain('data-testid="calcular-peca-3d"');
    expect(pagina).toContain("setCalculadora3d({ orcamento3dId: pecaDoItem.get(i.id)!.id })");
    expect(pagina).toContain('"remover_item_3d_do_orcamento"');
    expect(pagina).toContain('data-testid="botao-peca-3d"');
  });
  it("o resumo mostra a metragem por material", () => {
    expect(pagina).toContain('data-testid="metragem-por-material"');
    expect(pagina).toContain("metragemPorMaterial(itensDeProduto");
  });
  it("as telas do módulo 3D levam ao orçamento e não convertem a peça embutida por fora", () => {
    expect(detalhe).toContain("Abrir o orçamento");
    expect(detalhe).toContain("Converter pelo orçamento");
    expect(detalhe).toContain('sessionStorage.setItem("bex.orcamento.editar3d", orc.id)');
    expect(hub).toContain('to="/orcamentos/$id"');
    expect(hub).toContain("o.embutido && o.orcamento_id");
  });
});
