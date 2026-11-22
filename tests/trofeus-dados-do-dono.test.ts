import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MATERIAL, REGRAS, TAXAS } from "./apoio/trofeus";

/**
 * 22/11/2026. O dono respondeu às pendências do troféu: o espelhado dourado custa R$ 480 a folha, o laser tem a
 * velocidade pesquisada, a máquina só corta até 10 mm e a DTF UV continua desativada, com aviso. A migração
 * 20261122300000 grava isso; aqui o SQL é comparado com o fixture que a conta usa, para os dois nunca discordarem.
 */
const arquivo = "20261122300000_trofeu_dados_do_dono.sql";
const sql = readFileSync(`supabase/migrations/${arquivo}`, "utf8");
const codigo = sql.replace(/--[^\n]*/g, "");

describe("migração: os dados que o dono respondeu para o troféu", () => {
  it("o prefixo é único e a migração é uma transação só", () => {
    expect(readdirSync("supabase/migrations").filter((f) => f.startsWith("20261122300000"))).toEqual([arquivo]);
    expect(sql).toMatch(/^BEGIN;$/m);
    expect(sql).toMatch(/^COMMIT;$/m);
  });

  it("para sem gravar nada se o banco não está como ela espera", () => {
    for (const guarda of [
      "aplique antes a migração 20261122200000",
      "esta migração já foi aplicada",
      "as regras do laser já não são as plantadas em 20261122200000",
      "o dourado já não está a 174,18 (unitário) e 87,09 (médio)",
      "o dourado já tem medida de chapa",
      "esperava um lote ABERTURA de 4 m² a R$ 87,09 do dourado",
      "esperava uma impressora DTF UV, inativa",
    ]) {
      expect(sql, guarda).toContain(guarda);
    }
  });

  it("as velocidades e a gravação gravadas são as do fixture da conta", () => {
    const velocidades = JSON.parse(codigo.match(/SET velocidade_de_corte = '(\{[^']+\})'::jsonb/)![1]);
    expect(velocidades).toEqual(TAXAS.velocidadeDeCorteMPorMin);
    expect(codigo).toContain(`gravacao_min_por_m2 = ${TAXAS.gravacaoMinPorM2.toFixed(2)}`);
    // a conferência final repete os mesmos números: nada gravado sem conferir
    expect(JSON.parse(codigo.match(/trofeu_regras\) <> '(\{"2"[^']+\})'::jsonb THEN\s+RAISE EXCEPTION 'velocidades/)![1])).toEqual(
      TAXAS.velocidadeDeCorteMPorMin,
    );
    expect(codigo).toContain(`gravacao_min_por_m2 FROM public.trofeu_regras) <> ${TAXAS.gravacaoMinPorM2} THEN`);
  });

  it("o limite de corte de 10 mm é coluna das regras, com o valor do fixture", () => {
    expect(codigo).toContain("ADD COLUMN espessura_maxima_de_corte_mm numeric(4, 1) NOT NULL DEFAULT 10 CHECK (espessura_maxima_de_corte_mm > 0)");
    expect(REGRAS.espessuraMaximaDeCorteMm).toBe(10);
    expect(codigo).toContain("espessura_maxima_de_corte_mm FROM public.trofeu_regras) <> 10 THEN");
  });

  it("toda espessura do catálogo cabe no limite e tem velocidade de corte", () => {
    // as espessuras dos modelos plantados (2, 3 e 6 mm) e o limite (10 mm) precisam ter velocidade
    for (const mm of [2, 3, 6, REGRAS.espessuraMaximaDeCorteMm]) {
      expect(TAXAS.velocidadeDeCorteMPorMin[String(mm)], `${mm} mm`).toBeGreaterThan(0);
    }
  });

  it("as regras apontam o vinil, a laminação, a tinta e a cola por id (o servidor não adivinha pelo nome)", () => {
    for (const coluna of ["material_vinil_id", "material_laminacao_id", "material_tinta_id", "material_cola_id"]) {
      expect(codigo, coluna).toContain(`ADD COLUMN ${coluna} uuid REFERENCES public.materiais(id)`);
      expect(codigo, coluna).toContain(`ALTER COLUMN ${coluna} SET NOT NULL`);
    }
    for (const nome of ["Vinil adesivo branco brilho", "Laminação polimérica", "Tinta solvente (conjunto)", "Cola para acrílico antimancha 250 ml"]) {
      expect(codigo, nome).toContain(`'${nome}'`);
    }
    expect(codigo).toContain("ADD COLUMN cola_ml_por_frasco numeric(6, 1) NOT NULL DEFAULT 250 CHECK (cola_ml_por_frasco > 0)");
    // a conferência final exige a unidade certa de cada um
    expect(codigo).toContain("v.unidade = 'm²'");
    expect(codigo).toContain("t.unidade = 'ml'");
    expect(codigo).toContain("c.unidade = 'un'");
  });

  it("o dourado vai a R$ 240 o m² (folha de R$ 480 por 2,00 m²), no cadastro e no lote de abertura", () => {
    const custo = TAXAS.custoM2PorMaterial[MATERIAL.dourado2];
    expect(custo).toBe(240);
    expect(480 / 2).toBe(custo);
    expect(codigo).toContain("custo_unitario = 240.00,\n       custo_medio = 240.00,");
    expect(codigo).toContain("largura_util_m = 1.000, comprimento_util_m = 2.000");
    expect(codigo).toContain("SET custo_unitario_snapshot = 240.00, custo_total = round(l.quantidade * 240.00, 2)");
    expect(codigo).toContain("custo_total FROM public.material_lotes l JOIN public.materiais m ON m.id = l.material_id");
    expect(codigo).toContain("<> 960 THEN");
  });

  it("diz no material o que NÃO é fato (sem nota, medida da folha presumida) e não grava valor em reais no texto livre", () => {
    const texto = codigo.match(/caracteristicas = '([^']+)'/)![1];
    expect(texto).toContain("SEM nota de compra");
    expect(texto).toContain("medida presumida");
    expect(texto).toContain("Confirmar a medida da folha e lançar a nota quando chegar.");
    // `caracteristicas` é lido pela equipe toda: o custo fica nos campos de custo (catraca custo-fora-do-texto-livre)
    expect(texto).not.toContain("R$");
  });

  it("a lista de provisórios troca o custo do dourado pelo aviso certo e abre o aviso da DTF UV", () => {
    const lista = codigo.match(/provisorios = ARRAY\[([^\]]+)\]/)![1];
    expect(lista).toContain("'espelhado_dourado_sem_nota'");
    expect(lista).toContain("'dtf_uv_compra_externa'");
    expect(lista).not.toContain("'custo_do_espelhado_dourado'");
    // o que continua estimado continua listado
    for (const nome of ["velocidade_de_corte", "gravacao_min_por_m2", "medidas_dos_modelos", "tinta_ml_m2"]) {
      expect(lista, nome).toContain(`'${nome}'`);
    }
  });

  it("a DTF UV continua INATIVA: a migração nunca a liga e o aviso entra no cadastro", () => {
    expect(codigo).not.toMatch(/ativa\s*=\s*true/i);
    expect(codigo).toContain("a DTF UV não pode ficar ativa nesta migração");
    expect(codigo).toContain("WHERE tipo = 'impressora_dtf_uv' AND ativa = false;");
    expect(codigo).toContain("'aviso_22_11_2026'");
    expect(sql).toContain("COMPRA EXTERNA");
  });

  it("não cria função, não abre nada para anon e registra o que valia antes", () => {
    expect(codigo).not.toMatch(/CREATE (OR REPLACE )?FUNCTION/);
    expect(codigo).not.toMatch(/GRANT /);
    expect(codigo).toContain("has_table_privilege('anon', 'public.trofeu_regras', 'SELECT')");
    expect(codigo).toContain("'trofeu_dados_do_dono'");
    expect(codigo).toContain("'antes'");
  });

  it("o cadastro do laser (30 mm da ficha) não é tocado: só vale a regra da oficina", () => {
    expect(codigo).not.toMatch(/UPDATE public\.maquinas[\s\S]{0,200}corte_max_mm/);
    expect(codigo).not.toMatch(/laser_co2/);
  });

  it("confere o resultado antes do COMMIT e traz o DESFAZER", () => {
    expect(codigo.indexOf("DO $final$")).toBeLessThan(codigo.indexOf("COMMIT;"));
    const desfazer = sql.slice(sql.indexOf("DESFAZER"));
    expect(desfazer).toContain("DROP COLUMN espessura_maxima_de_corte_mm, DROP COLUMN material_vinil_id");
    expect(desfazer).toContain("DROP COLUMN cola_ml_por_frasco;");
    expect(desfazer).toContain("custo_unitario = 174.18, custo_medio = 87.09");
    expect(desfazer).toContain("custo_total = 348.36");
    expect(desfazer).toContain("- 'aviso_22_11_2026'");
  });
});
