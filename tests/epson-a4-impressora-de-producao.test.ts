import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXEMPLO_HOJE, modoDeExemplo, painelDeExemplo } from "../src/domain/tv/exemplo";
import {
  LINHAS_DE_UM_CARTAO_ACOPLADO,
  trabalhosPorPagina,
  trabalhosPorPaginaComAcoplados,
} from "../src/domain/tv/paginacao";
import { lerPainel, type PainelDaOficina } from "../src/domain/tv/painel";
import { GRUPO_DA_PAREDE, montarTela, organizarParede } from "../src/domain/tv/tela";

/**
 * A Epson EcoTank A4 vira impressora de produção (19/11/2026): o contrato da migração, lido como TEXTO, e a parede da TV.
 * O que o SQL faz de verdade foi provado no banco vivo, numa transação desfeita, e está em
 * docs/ensaio-epson-a4-impressora-de-producao-19-11-2026.md.
 *
 * A máquina estava ativa com o tipo em texto livre "Impressão jato de tinta A4": ninguém conseguia começar nela nem pô-la
 * na fila (o banco recusa tipo sem etapa), e a TV contava seis colunas numa parede de cinco (conferência R6). Não dava
 * para desativar: é a máquina padrão de um produto ativo e a OS 232 tem a reserva dela.
 */

const RAIZ = join(__dirname, "..");
const PASTA = join(RAIZ, "supabase", "migrations");
const NOME = "20261119210000_epson_a4_impressora_de_producao.sql";
const sql = readFileSync(join(PASTA, NOME), "utf8");
const doc = readFileSync(join(RAIZ, "docs", "ensaio-epson-a4-impressora-de-producao-19-11-2026.md"), "utf8");

const semComentarios = (t: string) =>
  t
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
const codigo = semComentarios(sql);

describe("migração 20261119210000: a Epson A4 como impressora de produção", () => {
  it("tem prefixo único e é uma transação só, com lock_timeout curto", () => {
    expect(readdirSync(PASTA).filter((n) => n.startsWith(NOME.slice(0, 14)))).toEqual([NOME]);
    expect(codigo).toMatch(/^\s*BEGIN;/m);
    expect(codigo).toContain("SET LOCAL lock_timeout = '5s';");
    expect(sql.trimEnd().endsWith("COMMIT;")).toBe(true);
  });

  it("só troca as funções se o corpo vivo for o que foi lido, e só mexe na Epson se ela estiver como foi lida", () => {
    expect(codigo).toContain("'7f0504c31265408dd5dad767ff6980ba'");
    expect(codigo).toContain("'0b4c9dc00c71f34f583ff645d31d2160'");
    expect(codigo).toContain("IS DISTINCT FROM 'Impressão jato de tinta A4'");
    expect(codigo.indexOf("DO $guarda$")).toBeLessThan(codigo.indexOf("CREATE OR REPLACE FUNCTION"));
  });

  it("a Epson entra em tipos_de_maquina na etapa da plotter, com tipo próprio, e as ordens ficam de 1 a 6", () => {
    const corpo = /AS \$function\$([\s\S]*?)\$function\$/.exec(codigo)?.[1] ?? "";
    const linhas = [...corpo.matchAll(/\(\s*'([a-z0-9_]+)'(?:::text)?\s*,\s*'([a-z0-9_]+)'(?:::public\.status_os)?\s*,\s*(\d+)\s*,\s*'([^']+)'/g)].map(
      (m) => ({ tipo: m[1], status: m[2], ordem: Number(m[3]), etapa: m[4] }),
    );
    expect(linhas.map((l) => `${l.ordem}:${l.tipo}:${l.status}`)).toEqual([
      "1:plotter_impressao:em_impressao",
      "2:impressora_a4:em_impressao",
      "3:plotter_recorte:em_corte",
      "4:laser_co2:em_laser_cnc",
      "5:laser_fiber:em_laser_cnc",
      "6:impressora_3d:em_3d",
    ]);
    // A etapa gravada no apontamento é a mesma da plotter: "Impressão".
    expect(linhas.find((l) => l.tipo === "impressora_a4")?.etapa).toBe("Impressão");
    expect(codigo).toContain("IMMUTABLE ROWS 6");
  });

  it("o tipo da plotter NÃO é reaproveitado: a tela de importar Flexi lista as máquinas de plotter_impressao", () => {
    expect(codigo).toContain("SET tipo = 'impressora_a4'");
    expect(codigo).not.toMatch(/SET tipo = 'plotter_impressao'/);
    const flexi = readFileSync(join(RAIZ, "src", "routes", "_authenticated", "importar-flexi.tsx"), "utf8");
    expect(flexi).toContain('.eq("tipo", "plotter_impressao")');
  });

  it("a Epson muda de tipo só pelo id e só se estiver como foi lida, guardando o texto antigo e deixando rastro", () => {
    expect(codigo).toMatch(/WHERE id = 'eb76a98b-8555-4a5b-b0ab-00c3a22e6c95' AND tipo = 'Impressão jato de tinta A4';/);
    expect(codigo).toContain("jsonb_build_object('tipo_anterior', 'Impressão jato de tinta A4')");
    expect(codigo).toContain("'tipo_da_maquina_corrigido'");
    expect(codigo).toContain("IF v_n <> 1 THEN");
  });

  it("a R6 é alterada pelo caminho do projeto: texto vivo, trecho achado uma vez só, EXECUTE", () => {
    expect(codigo).toContain("pg_get_functiondef('public.tv_painel_maquinas()'::regprocedure)");
    expect(codigo).toContain("<> length(v_velho) THEN");
    expect(codigo).toContain("o trecho da R6 não aparece exatamente uma vez na tv_painel_maquinas");
    expect(codigo).toContain("EXECUTE v_novo;");
    // O trecho novo conta as de impressão como UMA coluna, como já contava as 3D.
    expect(codigo).toContain("t.status_producao is distinct from ''em_3d'' and t.status_producao is distinct from ''em_impressao''");
    expect(codigo).toContain("case when count(*) filter (where t.status_producao = ''em_impressao'') > 0 then 1 else 0 end");
    // O limite de colunas NÃO muda: a parede continua com cinco.
    expect(codigo).not.toMatch(/c_colunas\s+constant integer := \d+/);
  });

  it("confere no fim o que foi ensaiado: md5 dos dois corpos, nenhuma máquina ativa sem etapa, parede de até cinco colunas, acessos", () => {
    expect(codigo).toContain("'b720ff2751c005fca3dda9dac304f81a'");
    expect(codigo).toContain("'3dedfd97cef70d65d02d364d90c09df4'");
    expect(codigo).toContain("WHERE m.ativa AND t.tipo IS NULL");
    expect(codigo).toContain("IF v_colunas > 5 THEN");
    expect(codigo).toContain("has_function_privilege('anon', 'public.tv_painel_maquinas()', 'EXECUTE')");
    expect(codigo).toContain("NOT has_function_privilege('service_role', 'public.tv_painel_maquinas()', 'EXECUTE')");
  });

  it("não toca em preço, custo, orçamento nem OS: só maquinas e o rastro", () => {
    const fora = codigo.replace(/AS \$function\$[\s\S]*?\$function\$/g, "");
    const escritas = [...fora.matchAll(/\b(?:UPDATE|INSERT INTO|DELETE FROM)\s+(public\.\w+)/gi)].map((m) => m[1]);
    expect([...new Set(escritas)].sort()).toEqual(["public.logs_auditoria", "public.maquinas"]);
    expect(fora).not.toMatch(/\bDELETE\b/i);
  });
});

/* ------------------------------------------------------------------------- */
/* A parede da TV                                                              */
/* ------------------------------------------------------------------------- */

type Maquina = PainelDaOficina["maquinas"][number];

const EPSON: Maquina = {
  ...EXEMPLO_HOJE.maquinas[0],
  id: "eb76a98b-8555-4a5b-b0ab-00c3a22e6c95",
  tipo: "impressora_a4",
  rotulo: "Epson EcoTank L3250 (A4)",
};

/** A ordem que tipos_de_maquina() dá depois da migração. */
const ORDEM: Record<string, number> = {
  plotter_impressao: 1,
  impressora_a4: 2,
  plotter_recorte: 3,
  laser_co2: 4,
  laser_fiber: 5,
  impressora_3d: 6,
};

function comAEpson(base: PainelDaOficina, tirar: string[] = []): PainelDaOficina {
  const maquinas = [...base.maquinas, EPSON]
    .filter((m) => !tirar.includes(m.tipo))
    .map((m) => ({ ...m, ordem: ORDEM[m.tipo] ?? m.ordem }));
  return { ...base, maquinas, rodando: { ...base.rodando, de: maquinas.length } };
}

describe("a parede da TV com a Epson A4 (19/11/2026)", () => {
  const sobre = (p: PainelDaOficina) => Date.parse(p.gerado_em) + 20_000;

  it("o painel com a Epson passa pelo leitor do contrato: o tipo é texto livre", () => {
    const p = comAEpson(EXEMPLO_HOJE);
    expect(lerPainel(JSON.parse(JSON.stringify(p))).ok).toBe(true);
  });

  it("seis máquinas, cinco colunas: a plotter e a Epson dividem a coluna Impressão, no lugar da plotter", () => {
    const p = comAEpson(EXEMPLO_HOJE);
    const tela = montarTela(p, sobre(p));
    expect(tela.colunas).toHaveLength(6);
    expect(tela.parede).toHaveLength(5);
    const [primeira, ...resto] = tela.parede;
    expect(primeira.tipo).toBe("grupo_impressao");
    if (primeira.tipo !== "grupo_impressao") return;
    expect(primeira.id).toBe("grupo-impressao");
    // O título da coluna é a etapa; os cartões são as duas máquinas, com nomes curtos que cabem numa linha.
    expect(primeira.identidade.curto).toBe("Impressão");
    expect(primeira.subs.map((s) => s.identidade.curto)).toEqual(["Plotter", "Impressora A4"]);
    expect(primeira.subs.map((s) => s.rotulo)).toEqual([null, "Epson EcoTank L3250 (A4)"]);
    expect(resto.map((c) => (c.tipo === "maquina" ? c.c.identidade.chave : c.tipo))).toEqual([
      "plotter_recorte",
      "laser_co2",
      "laser_fiber",
      "impressora_3d",
    ]);
    expect(tela.falhas).toEqual([]);
  });

  it("a fila da coluna é a soma da fila das duas", () => {
    const p = comAEpson(EXEMPLO_HOJE);
    const tela = montarTela(p, sobre(p));
    const g = tela.parede[0];
    expect(g.tipo === "grupo_impressao" ? g.filaTotal : -1).toBe(
      tela.colunas.slice(0, 2).reduce((t, c) => t + c.filaTotal, 0),
    );
  });

  it("o estado real da casa: plotter e Epson juntas, as quatro Bambu juntas, e a parede com cinco colunas", () => {
    const p = comAEpson(painelDeExemplo("tres_d"));
    const tela = montarTela(p, sobre(p));
    expect(tela.colunas).toHaveLength(9);
    expect(tela.parede.map((c) => c.tipo)).toEqual(["grupo_impressao", "maquina", "maquina", "maquina", "grupo_3d"]);
    expect(tela.falhas).toEqual([]);
  });

  it("com uma impressora só (a Epson sozinha ou a plotter sozinha), a parede fica como sempre foi", () => {
    const sozinhaEpson = comAEpson(EXEMPLO_HOJE, ["plotter_impressao"]);
    const telaEpson = montarTela(sozinhaEpson, sobre(sozinhaEpson));
    expect(telaEpson.parede.every((c) => c.tipo === "maquina")).toBe(true);
    expect(telaEpson.parede).toHaveLength(5);
    expect(telaEpson.colunas[0].identidade.curto).toBe("Impressora A4");

    const telaPlotter = montarTela(EXEMPLO_HOJE, sobre(EXEMPLO_HOJE));
    expect(telaPlotter.parede.every((c) => c.tipo === "maquina")).toBe(true);
    expect(telaPlotter.parede).toHaveLength(5);
  });

  it("organizarParede agrupa cada família uma vez, no lugar do primeiro membro, e ignora tipo desconhecido", () => {
    const col = (id: string) => ({ id, filaTotal: 1, identidade: { chave: id, curto: id, icone: "Printer", cor: "#fff" } }) as never;
    const colunas = [col("a"), col("b"), col("c"), col("d"), col("e")];
    const tipos = ["laser_co2", "plotter_impressao", "tipo_novo", "impressora_a4", "impressora_3d"];
    const parede = organizarParede(colunas, tipos);
    expect(parede.map((p) => p.tipo)).toEqual(["maquina", "grupo_impressao", "maquina", "maquina"]);
    const grupo = parede[1];
    expect(grupo.tipo === "grupo_impressao" ? grupo.subs.map((s) => s.id) : []).toEqual(["b", "d"]);
    expect(organizarParede([], [])).toEqual([]);
  });

  it("GRUPO_DA_PAREDE é o que a conferência R6 do banco agrupa", () => {
    expect(GRUPO_DA_PAREDE).toEqual({ impressora_3d: "3d", plotter_impressao: "impressao", impressora_a4: "impressao" });
  });
});

describe("a coluna da plotter com a Epson acoplada no pé (19/11/2026)", () => {
  it("a página da fila cede duas linhas por cartão acoplado e nunca fica com menos de uma", () => {
    expect(trabalhosPorPaginaComAcoplados(5, 0)).toBe(5);
    expect(trabalhosPorPaginaComAcoplados(5, 1)).toBe(5 - LINHAS_DE_UM_CARTAO_ACOPLADO);
    expect(trabalhosPorPaginaComAcoplados(trabalhosPorPagina(false), 1)).toBe(3);
    expect(trabalhosPorPaginaComAcoplados(trabalhosPorPagina(true), 1)).toBe(2);
    expect(trabalhosPorPaginaComAcoplados(5, 2)).toBe(1);
    expect(trabalhosPorPaginaComAcoplados(2, 3)).toBe(1);
  });

  it("?demo=impressoras mostra a oficina de hoje: cinco colunas, a Epson rodando a OS 232 no pé da plotter, nenhum número inconsistente", () => {
    expect(modoDeExemplo("impressoras")).toBe("impressoras");
    expect(modoDeExemplo("qualquer")).toBeUndefined();
    const p = painelDeExemplo("impressoras");
    expect(lerPainel(JSON.parse(JSON.stringify(p))).ok).toBe(true);
    const tela = montarTela(p, Date.parse(p.gerado_em) + 20_000);
    expect(tela.colunas).toHaveLength(9);
    expect(tela.parede.map((c) => c.tipo)).toEqual(["grupo_impressao", "maquina", "maquina", "maquina", "grupo_3d"]);
    expect(tela.falhas).toEqual([]);
    expect(tela.faixa).toBeNull();
    const g = tela.parede[0];
    if (g.tipo !== "grupo_impressao") throw new Error("a primeira coluna devia ser a de impressão");
    expect(g.subs[0].identidade.curto).toBe("Plotter");
    const [epson] = g.subs.slice(1);
    expect([epson.identidade.curto, epson.estado, epson.agora?.osNumero]).toEqual(["Impressora A4", "rodando", 232]);
  });

  it("no desenho, só as Bambu usam o cartão de grupo; a de impressão é a coluna da plotter com a Epson acoplada", () => {
    const tsx = readFileSync(join(RAIZ, "src", "components", "tv", "tela-da-oficina.tsx"), "utf8");
    expect(tsx).toContain('p.tipo === "grupo_3d" ? (');
    expect(tsx).toContain("acoplados={p.subs.slice(1)}");
    expect(tsx).toContain("trabalhosPorPaginaComAcoplados(porPagina, p.subs.length - 1)");
    expect(tsx).not.toContain("GrupoDaParede");
    const css = readFileSync(join(RAIZ, "src", "components", "tv", "tv-oficina.css"), "utf8");
    expect(css).toMatch(/\.tvo \.maq \.acoplados \{[^}]*flex: none;/);
    expect(css).toMatch(/\.tvo \.maq \.acoplados \.sub3d \{[^}]*flex: none;/);
  });
});

describe("o roteiro de ensaio", () => {
  it("registra a decisão, o ensaio desfeito, o que mudou de comportamento e o estado de aplicação", () => {
    expect(doc).toContain(NOME);
    expect(doc).toContain("RAISE EXCEPTION");
    expect(doc).toContain("Certificado A4");
    expect(doc).toContain("OS 232");
    expect(doc).toContain("maquinas_ativas_demais");
    expect(doc).toContain("em_impressao");
    expect(doc).toMatch(/[Aa]plicad/);
  });
});
