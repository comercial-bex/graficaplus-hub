import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Custo fora do texto livre (10/11/2026).
 *
 * Valor de custo digitado em campo de texto que a equipe inteira lê (observação de produto e de acabamento,
 * características de material) e chaves de custo, margem e lucro dentro de 4 eventos antigos de fechamento de OS
 * ficavam à vista de quem não vê custo. A migração guarda o ORIGINAL numa tabela só de quem vê custo e troca só a
 * frase com valor. O comportamento foi ensaiado no banco vivo (transação desfeita, 46 conferências); estes testes
 * conferem o TEXTO da migração, para que uma edição futura não desfaça as guardas.
 *
 * O ensaio achou um defeito que os testes agora travam: `EXECUTE ... INTO` não atualiza FOUND, e conferir
 * `IF NOT FOUND` depois dele pulava TODAS as linhas como "ausentes" (nenhuma foi alterada, sem erro nenhum).
 */

const SQL = readFileSync("supabase/migrations/20261110200000_custo_fora_do_texto_livre.sql", "utf8");
const CODIGO = SQL.replace(/--[^\n]*/g, "");
const BLOCO_EVENTOS = CODIGO.slice(CODIGO.indexOf("DO $eventos_e_os$"), CODIGO.indexOf("$eventos_e_os$;"));
const BLOCO_TEXTOS = CODIGO.slice(CODIGO.indexOf("DO $textos$"), CODIGO.indexOf("$textos$;"));

type Linha = {
  tabela: string;
  coluna: string;
  id: string;
  md5: string;
  a1: string;
  t1: string;
  a2: string;
  t2: string;
  soComOk: boolean;
};

const LINHAS: Linha[] = [
  ...BLOCO_TEXTOS.matchAll(
    /\(\s*'(\w+)',\s*'(\w+)',\s*'([0-9a-f-]{36})'(?:::uuid)?,\s*'(?:[^']|'')*',\s*'([0-9a-f]{32})',\s*\$a\$([\s\S]*?)\$a\$,\s*\$a\$([\s\S]*?)\$a\$,\s*\$a\$([\s\S]*?)\$a\$,\s*\$a\$([\s\S]*?)\$a\$,\s*(true|false)\)/g,
  ),
].map((m) => ({
  tabela: m[1],
  coluna: m[2],
  id: m[3],
  md5: m[4],
  a1: m[5],
  t1: m[6],
  a2: m[7],
  t2: m[8],
  soComOk: m[9] === "true",
}));

describe("a tabela onde o original fica guardado", () => {
  it("só quem vê custo lê, e ninguém grava pela API", () => {
    expect(CODIGO).toContain("ALTER TABLE public.custo_em_texto_guardado ENABLE ROW LEVEL SECURITY;");
    expect(CODIGO).toContain("REVOKE ALL ON public.custo_em_texto_guardado FROM PUBLIC, anon, authenticated;");
    expect(CODIGO).toContain("GRANT SELECT ON public.custo_em_texto_guardado TO authenticated;");
    expect(CODIGO).not.toMatch(/GRANT\s+(INSERT|UPDATE|DELETE|ALL)[^;]*custo_em_texto_guardado/i);
    expect(CODIGO).not.toMatch(/GRANT[^;]*custo_em_texto_guardado[^;]*\b(anon|PUBLIC)\b/i);
  });

  it("a regra de leitura é admin, ou financeiro; evento e OS pedem também resultado.read", () => {
    expect(CODIGO).toContain("public.has_role((select auth.uid()), 'admin'::public.app_role)");
    expect(CODIGO).toContain("public.can_see_financials((select auth.uid()))");
    expect(CODIGO).toContain("tabela NOT IN ('eventos_negocio', 'ordens_servico')");
    expect(CODIGO).toContain("public.has_permission((select auth.uid()), 'resultado.read')");
    expect(CODIGO.match(/CREATE POLICY/g)).toHaveLength(1);
    expect(CODIGO).toContain("FOR SELECT TO authenticated");
  });

  it("cada linha guardada é única por lote, tabela, coluna e registro, e tem exatamente um original", () => {
    expect(CODIGO).toContain("UNIQUE (lote, tabela, coluna, registro_id)");
    expect(CODIGO).toContain("CHECK (num_nonnulls(original_texto, original_json) = 1)");
  });
});

describe("os 4 eventos e a OS 212", () => {
  it("cita os 4 eventos de fechamento e a OS 212 pelo id", () => {
    for (const id of [
      "72c10254-1e6d-4899-8568-815a34e08cbc",
      "44b6b2a6-13f9-4f58-b422-75a47036c6e1",
      "357c4c8e-b46b-4f51-87ad-9c3c39f9395d",
      "ee059153-eacb-4f69-9daa-3d3031b0fdd7",
      "325597d1-1511-48b2-bca4-826e93294975",
    ]) {
      expect(BLOCO_EVENTOS, id).toContain(id);
    }
  });

  it("usa os mesmos ajudantes que o fechamento da OS usa desde 04/11", () => {
    expect(BLOCO_EVENTOS).toContain("public.jsonb_sem_custo(r.atual)");
    expect(BLOCO_EVENTOS).toContain("public.estimativas_sem_reais(");
  });

  it("guarda o original ANTES de trocar, e só troca com a linha ainda igual à lida", () => {
    const guarda = BLOCO_EVENTOS.indexOf("INSERT INTO public.custo_em_texto_guardado");
    const troca = BLOCO_EVENTOS.indexOf("UPDATE public.eventos_negocio SET dados_posteriores");
    expect(guarda).toBeGreaterThan(0);
    expect(troca).toBeGreaterThan(guarda);
    expect(BLOCO_EVENTOS).toContain("WHERE id = r.id AND dados_posteriores = r.atual");
    expect(BLOCO_EVENTOS).toContain("WHERE id = c_os_212 AND fechamento_estimativas = v_os_atual");
    const guardaOs = BLOCO_EVENTOS.lastIndexOf("INSERT INTO public.custo_em_texto_guardado");
    expect(BLOCO_EVENTOS.indexOf("UPDATE public.ordens_servico SET fechamento_estimativas")).toBeGreaterThan(guardaOs);
  });

  it("só toca a coluna de cada tabela, nunca custo, preço, estoque ou status", () => {
    const updates = [...BLOCO_EVENTOS.matchAll(/UPDATE\s+public\.(\w+)\s+SET\s+([^;]*?)\s+WHERE/gi)].map((m) => `${m[1]}: ${m[2]}`);
    expect(updates).toEqual([
      "eventos_negocio: dados_posteriores = v_novo",
      "ordens_servico: fechamento_estimativas = v_novo",
    ]);
  });

  it("para tudo se sobrar chave de custo ou valor em reais nas linhas listadas", () => {
    expect(BLOCO_EVENTOS).toContain("k ~* '(custo|margem|lucro|markup|divergencia)'");
    expect(BLOCO_EVENTOS).toContain("ainda sobrou chave de custo, margem ou lucro");
    expect(BLOCO_EVENTOS.match(/ainda sobrou valor em reais/g)).toHaveLength(2);
  });
});

describe("os textos de material, produto e acabamento", () => {
  it("são 20 linhas ativas e 5 de mão de obra que só entram com o OK do dono", () => {
    expect(LINHAS).toHaveLength(25);
    expect(LINHAS.filter((l) => !l.soComOk)).toHaveLength(20);
    expect(LINHAS.filter((l) => l.soComOk)).toHaveLength(5);
    expect(LINHAS.filter((l) => l.soComOk).every((l) => l.tabela === "custos_mao_de_obra")).toBe(true);
    expect(BLOCO_TEXTOS).toContain("c_incluir_mao_de_obra constant boolean := false;");
    expect(BLOCO_TEXTOS).toContain("WHERE NOT v.so_com_ok OR c_incluir_mao_de_obra");
  });

  it("conta por tabela: 7 materiais, 10 produtos, 3 acabamentos", () => {
    const por = (t: string) => LINHAS.filter((l) => !l.soComOk && l.tabela === t).length;
    expect(por("materiais")).toBe(7);
    expect(por("produtos")).toBe(10);
    expect(por("acabamentos")).toBe(3);
  });

  it("cada registro aparece uma vez, com o md5 do texto que foi listado", () => {
    const ids = LINHAS.map((l) => `${l.tabela}:${l.id}`);
    expect(new Set(ids).size).toBe(ids.length);
    for (const l of LINHAS) expect(l.md5).toMatch(/^[0-9a-f]{32}$/);
    expect(BLOCO_TEXTOS).toContain("md5(v_atual) <> r.md5_original");
  });

  it("o trecho trocado tem o valor em reais e o trecho novo não tem", () => {
    for (const l of LINHAS) {
      expect(l.a1 + l.a2, `${l.tabela} ${l.id}: a âncora deve conter o valor`).toContain("R$");
      expect(l.t1 + l.t2, `${l.tabela} ${l.id}: o texto novo não pode ter valor`).not.toContain("R$");
      expect(l.a1.length, `${l.id}: âncora vazia casaria em todo lugar`).toBeGreaterThan(0);
      expect(l.t1.length + l.t2.length, `${l.id}: o texto novo não pode ficar vazio`).toBeGreaterThanOrEqual(0);
    }
  });

  it("a âncora tem de aparecer exatamente uma vez, e o texto novo nunca fica vazio nem com R$", () => {
    expect(BLOCO_TEXTOS).toContain("a primeira âncora aparece % vezes (esperado 1)");
    expect(BLOCO_TEXTOS).toContain("a segunda âncora aparece % vezes (esperado 1)");
    expect(BLOCO_TEXTOS).toContain("IF v_novo ~ 'R\\$' OR btrim(v_novo) = '' THEN");
  });

  it("não mexe no marcador nem nos prefixos que a tabela de preços e as pendências leem", () => {
    expect(BLOCO_TEXTOS).toContain("(v_atual ILIKE '%CUSTO E PREÇO DE BALCÃO PROVISÓRIOS%') <> (v_novo ILIKE '%CUSTO E PREÇO DE BALCÃO PROVISÓRIOS%')");
    expect(BLOCO_TEXTOS).toContain("(v_atual LIKE 'PROVISÓRIO%') <> (v_novo LIKE 'PROVISÓRIO%')");
    expect(BLOCO_TEXTOS).toContain("(v_atual LIKE 'Provisório%') <> (v_novo LIKE 'Provisório%')");
    expect(BLOCO_TEXTOS).toContain("(v_atual LIKE 'Estimativa%') <> (v_novo LIKE 'Estimativa%')");
    // nenhum texto novo apaga o marcador: ele não aparece em nenhuma frase trocada
    for (const l of LINHAS) {
      expect(l.a1 + l.a2 + l.t1 + l.t2).not.toMatch(/CUSTO E PRE[ÇC]O DE BALC[ÃA]O PROVIS[ÓO]RIOS/i);
    }
  });

  it("guarda o original ANTES de trocar e só troca a coluna citada, com o texto ainda igual ao lido", () => {
    const guarda = BLOCO_TEXTOS.indexOf("INSERT INTO public.custo_em_texto_guardado");
    const troca = BLOCO_TEXTOS.indexOf("EXECUTE format('UPDATE public.%I SET %I = $1 WHERE id = $2 AND %I = $3'");
    expect(guarda).toBeGreaterThan(0);
    expect(troca).toBeGreaterThan(guarda);
    expect([...BLOCO_TEXTOS.matchAll(/\bUPDATE\b/g)]).toHaveLength(1);
    expect([...BLOCO_TEXTOS.matchAll(/\b(DELETE|TRUNCATE|DROP)\b/gi)]).toHaveLength(0);
  });

  it("DEFEITO ACHADO NO ENSAIO: depois de EXECUTE ... INTO, a ausência da linha vem do ROW_COUNT, nunca do FOUND", () => {
    const leitura = BLOCO_TEXTOS.indexOf("EXECUTE format('SELECT %I, updated_at FROM public.%I WHERE id = $1'");
    const diagnostico = BLOCO_TEXTOS.indexOf("GET DIAGNOSTICS v_linhas = ROW_COUNT;", leitura);
    expect(leitura).toBeGreaterThan(0);
    expect(diagnostico).toBeGreaterThan(leitura);
    // o ROW_COUNT vem logo depois da leitura, antes de qualquer outro comando
    const entre = BLOCO_TEXTOS.slice(leitura, diagnostico);
    expect(entre.match(/;/g)).toHaveLength(1);
    expect(BLOCO_TEXTOS).toContain("IF v_linhas = 0 THEN");
    expect(BLOCO_TEXTOS).not.toMatch(/IF\s+NOT\s+FOUND/i);
  });

  it("é seguro rodar de novo: o que já foi feito por este lote é pulado", () => {
    expect(BLOCO_TEXTOS).toContain("IF FOUND AND v_atual IS NOT DISTINCT FROM v_guardado THEN");
    expect(BLOCO_TEXTOS).toContain("já existe um original guardado diferente do que está no banco");
  });
});

describe("o que a migração NÃO faz", () => {
  it("não apaga linha, não derruba tabela e não mexe em permissão de outra tabela", () => {
    expect(CODIGO).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(CODIGO).not.toMatch(/\bTRUNCATE\b/i);
    expect(CODIGO).not.toMatch(/\bDROP\s+(TABLE|COLUMN|VIEW|FUNCTION)\b/i);
    expect(CODIGO).not.toMatch(/\bALTER\s+TABLE\s+public\.(?!custo_em_texto_guardado)/i);
    expect(CODIGO).not.toMatch(/\b(GRANT|REVOKE)\b[^;]*\bON\s+(TABLE\s+)?public\.(?!custo_em_texto_guardado)/i);
  });

  it("não troca nenhuma coluna de custo, preço, estoque ou permissão", () => {
    const atualizadas = [...CODIGO.matchAll(/\bSET\s+(\w+)\s*=/gi)].map((m) => m[1].toLowerCase());
    expect(new Set(atualizadas)).toEqual(new Set(["dados_posteriores", "fechamento_estimativas"]));
  });

  it("o que vai ao gateway de IA deixa de ter valor: nenhum texto novo cita R$", () => {
    const novos = LINHAS.filter((l) => !l.soComOk).map((l) => l.t1 + l.t2).join("\n");
    expect(novos).not.toContain("R$");
    expect(novos).not.toMatch(/\d+[.,]\d{2}\s*(\/|por)\s*(m|h|metro|hora)/i);
  });
});
