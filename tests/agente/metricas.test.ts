import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  agenteSemDados,
  diaAntes,
  motivosDaAcao,
  QUANTAS_MAIS_USADAS,
  resumirCobertura,
  semRespostaPorDia,
  usoDasRespostas,
  type LinhaDeMotivo,
  type LinhaDeResposta,
  type LinhaDoDiaDoAgente,
  type LinhaSemResposta,
} from "../../src/domain/agente/metricas";

/**
 * As contas das métricas do agente (C4) e o contrato da migração 20261115110000, lido como TEXTO. Cada taxa carrega o seu
 * denominador, real e ensaio nunca se somam, e taxa sem denominador é "sem base ainda", nunca zero por cento.
 */

const HOJE = "2026-11-15";
const dia = (o: Partial<LinhaDoDiaDoAgente> = {}): LinhaDoDiaDoAgente => ({
  dia: HOJE,
  modo: "real",
  ramo: "cliente",
  decisoes: 0,
  escolhidas: 0,
  entregues: 0,
  barradas: 0,
  sensiveis: 0,
  ...o,
});
const motivo = (o: Partial<LinhaDeMotivo>): LinhaDeMotivo => ({
  modo: "real",
  ramo: "cliente",
  acao: "entregar",
  motivo: "sem_resposta",
  n: 1,
  ...o,
});
const resp = (o: Partial<LinhaDeResposta>): LinhaDeResposta => ({
  resposta_id: "r1",
  tema: "tema",
  status: "aprovada",
  versao: 1,
  usos_real_30_dias: 0,
  usos_ensaio_30_dias: 0,
  usos_total: 0,
  ultimo_uso: null,
  ...o,
});

describe("cobertura: perguntas respondidas por resposta aprovada, de quantas", () => {
  const dias = [
    dia({ decisoes: 9, escolhidas: 3, entregues: 3, barradas: 3, sensiveis: 2 }),
    dia({ ramo: "parceiro", decisoes: 2, escolhidas: 1, entregues: 1 }),
    dia({ dia: "2026-11-01", decisoes: 4, escolhidas: 2, entregues: 2 }),
    dia({ modo: "ensaio", decisoes: 4, escolhidas: 2, entregues: 1, barradas: 1 }),
    dia({ dia: "2026-09-01", decisoes: 100, escolhidas: 100 }), // fora da janela de 30 dias
  ];

  it("perguntas = escolhidas + entregues; o silêncio não entra no denominador", () => {
    const r = resumirCobertura(dias, "real", HOJE);
    expect(r).toMatchObject({
      decisoes: 15,
      escolhidas: 6,
      entregues: 6,
      barradas: 3,
      perguntas: 12,
      sensiveis: 2,
    });
    expect(r.cobertura).toEqual({ numerador: 6, denominador: 12, percentual: 50 });
    expect(r.voltaParaEquipe).toEqual({ numerador: 6, denominador: 12, percentual: 50 });
    expect(r.deValor).toEqual({ numerador: 2, denominador: 12, percentual: 17 });
  });

  it("REAL e ENSAIO nunca se misturam", () => {
    const real = resumirCobertura(dias, "real", HOJE);
    const ensaio = resumirCobertura(dias, "ensaio", HOJE);
    expect(ensaio).toMatchObject({ escolhidas: 2, entregues: 1, perguntas: 3, barradas: 1 });
    expect(ensaio.cobertura.percentual).toBe(67);
    expect(real.escolhidas + ensaio.escolhidas).toBe(8);
  });

  it("só a janela de 30 dias: o dia 30 entra e o 31 não", () => {
    const limite = diaAntes(HOJE, 29);
    const fora = diaAntes(HOJE, 30);
    const r = resumirCobertura(
      [
        dia({ dia: limite, escolhidas: 1, decisoes: 1 }),
        dia({ dia: fora, escolhidas: 5, decisoes: 5 }),
      ],
      "real",
      HOJE,
    );
    expect(r.escolhidas).toBe(1);
    expect(diaAntes("2026-03-01", 1)).toBe("2026-02-28");
  });

  it("sem pergunta nenhuma a taxa é 'sem base', não zero por cento", () => {
    const r = resumirCobertura([dia({ decisoes: 2, barradas: 2 })], "real", HOJE);
    expect(r.perguntas).toBe(0);
    expect(r.cobertura).toEqual({ numerador: 0, denominador: 0, percentual: null });
    expect(r.voltaParaEquipe.percentual).toBeNull();
  });

  it("zerado de verdade: nenhuma decisão na janela, em modo nenhum", () => {
    expect(agenteSemDados([], HOJE)).toBe(true);
    expect(agenteSemDados([dia({ dia: "2026-09-01", decisoes: 5 })], HOJE)).toBe(true);
    expect(agenteSemDados([dia({ modo: "ensaio", decisoes: 1 })], HOJE)).toBe(false);
  });
});

describe("volta à equipe por motivo", () => {
  const linhas = [
    motivo({ motivo: "sem_resposta", n: 6 }),
    motivo({ ramo: "parceiro", motivo: "sem_resposta", n: 2 }),
    motivo({ motivo: "preco_de_novo", n: 1 }),
    motivo({ motivo: "passou_com_a_resposta", n: 1 }),
    motivo({ acao: "barrar", motivo: "cortesia", n: 4 }),
    motivo({ acao: "parar", motivo: "parar", n: 1 }),
    motivo({ modo: "ensaio", motivo: "sem_resposta", n: 9 }),
  ];

  it("soma os ramos, ordena do mais frequente e o denominador é a soma da própria lista", () => {
    const l = motivosDaAcao(linhas, "real", ["entregar"]);
    expect(l.total).toBe(10);
    expect(l.itens.map((i) => [i.motivo, i.n])).toEqual([
      ["sem_resposta", 8],
      ["passou_com_a_resposta", 1],
      ["preco_de_novo", 1],
    ]);
    expect(l.itens[0].parte).toEqual({ numerador: 8, denominador: 10, percentual: 80 });
    expect(l.itens.reduce((a, i) => a + i.n, 0)).toBe(l.total);
  });

  it("silêncio junta barrar e parar; ensaio fica à parte", () => {
    expect(motivosDaAcao(linhas, "real", ["barrar", "parar"]).total).toBe(5);
    expect(motivosDaAcao(linhas, "ensaio", ["entregar"]).total).toBe(9);
    expect(motivosDaAcao(linhas, "ensaio", ["barrar", "parar"])).toEqual({ total: 0, itens: [] });
  });
});

describe("respostas mais usadas e nunca usadas", () => {
  const base = [
    { id: "a", pergunta: "Qual o horário?", tema: "horario" },
    { id: "b", pergunta: "Qual o valor?", tema: "valor" },
    { id: "c", pergunta: "Vocês entregam?", tema: "entrega" },
    { id: "d", pergunta: "Rascunho ainda", tema: "rascunho" },
  ];
  const respostas = [
    resp({ resposta_id: "a", usos_real_30_dias: 5, usos_total: 7 }),
    resp({ resposta_id: "b", usos_real_30_dias: 2, usos_ensaio_30_dias: 9, usos_total: 11 }),
    resp({ resposta_id: "c" }),
    resp({ resposta_id: "d", status: "rascunho" }),
  ];

  it("mais usadas por modo, com a pergunta que o dono escreveu", () => {
    const real = usoDasRespostas(respostas, base, "real");
    expect(real.maisUsadas.map((r) => [r.pergunta, r.usos_real_30_dias])).toEqual([
      ["Qual o horário?", 5],
      ["Qual o valor?", 2],
    ]);
    const ensaio = usoDasRespostas(respostas, base, "ensaio");
    expect(ensaio.maisUsadas.map((r) => r.pergunta)).toEqual(["Qual o valor?"]);
  });

  it("nunca usadas: só aprovada, com o denominador das aprovadas", () => {
    const u = usoDasRespostas(respostas, base, "real");
    expect(u.aprovadas).toBe(3);
    expect(u.nuncaUsadas.map((r) => r.pergunta)).toEqual(["Vocês entregam?"]);
    expect(u.nuncaUsadasTaxa).toEqual({ numerador: 1, denominador: 3, percentual: 33 });
  });

  it("sem aprovada nenhuma, a taxa é 'sem base'; e resposta sem pergunta na base mostra o tema, nunca vazio", () => {
    const u = usoDasRespostas([resp({ resposta_id: "x", tema: "tema_sem_base" })], [], "real");
    expect(u.nuncaUsadas[0].pergunta).toBe("tema sem base");
    expect(usoDasRespostas([], [], "real").nuncaUsadasTaxa.percentual).toBeNull();
  });

  it("a lista de mais usadas tem teto", () => {
    const muitas = Array.from({ length: 25 }, (_, i) =>
      resp({ resposta_id: `r${i}`, usos_real_30_dias: i + 1, usos_total: i + 1 }),
    );
    expect(usoDasRespostas(muitas, [], "real").maisUsadas).toHaveLength(QUANTAS_MAIS_USADAS);
  });
});

describe("perguntas sem resposta: só a contagem por dia, com as perguntas do dia ao lado", () => {
  const sem: LinhaSemResposta[] = [
    { dia: HOJE, modo: "real", ramo: "cliente", perguntas_sem_resposta: 2 },
    { dia: HOJE, modo: "real", ramo: "parceiro", perguntas_sem_resposta: 1 },
    { dia: diaAntes(HOJE, 3), modo: "real", ramo: "cliente", perguntas_sem_resposta: 4 },
    { dia: HOJE, modo: "ensaio", ramo: "cliente", perguntas_sem_resposta: 7 },
    { dia: "2026-08-01", modo: "real", ramo: "cliente", perguntas_sem_resposta: 99 },
  ];
  const dias = [
    dia({ escolhidas: 3, entregues: 3 }),
    dia({ ramo: "parceiro", escolhidas: 1, entregues: 1 }),
    dia({ dia: diaAntes(HOJE, 3), escolhidas: 4, entregues: 4 }),
  ];

  it("soma os ramos do dia, mais recente primeiro, e traz o denominador do dia", () => {
    expect(semRespostaPorDia(sem, dias, "real", HOJE)).toEqual([
      { dia: HOJE, semResposta: 3, perguntas: 8 },
      { dia: diaAntes(HOJE, 3), semResposta: 4, perguntas: 8 },
    ]);
  });

  it("modo à parte e janela de 30 dias", () => {
    expect(semRespostaPorDia(sem, dias, "ensaio", HOJE)).toEqual([
      { dia: HOJE, semResposta: 7, perguntas: 0 },
    ]);
  });
});

describe("a migração 20261115110000 lida como texto", () => {
  const PASTA = join(__dirname, "..", "..", "supabase", "migrations");
  const NOME = "20261115110000_agente_metricas.sql";
  const sql = readFileSync(join(PASTA, NOME), "utf8");
  const codigo = sql
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");

  it("só cria views: nada de tabela, função, gatilho, coluna, UPDATE, DELETE nem enum", () => {
    // sem o que está entre aspas: "INSERT,UPDATE,DELETE" dentro de has_table_privilege não é comando
    const comandos = codigo.replace(/'(?:[^']|'')*'/g, "''");
    expect(comandos).not.toMatch(
      /\b(CREATE\s+TABLE|ALTER\s+TABLE|CREATE\s+(OR\s+REPLACE\s+)?FUNCTION|CREATE\s+TRIGGER|DROP\s+|TRUNCATE|ADD\s+COLUMN|ALTER\s+TYPE|CREATE\s+TYPE)\b/i,
    );
    expect(comandos).not.toMatch(/\b(UPDATE\s+[\w.]+\s+SET|DELETE\s+FROM|INSERT\s+INTO)\b/i);
    expect([...codigo.matchAll(/CREATE\s+VIEW\s+public\.(\w+)/gi)].map((m) => m[1])).toEqual([
      "agente_metricas_dia",
      "agente_metricas_motivos_30_dias",
      "agente_metricas_respostas",
      "agente_metricas_sem_resposta_dia",
    ]);
  });

  it("toda view é security_invoker e só o service_role lê, com REVOKE pelo nome", () => {
    expect([...codigo.matchAll(/WITH \(security_invoker = true\)/g)]).toHaveLength(4);
    for (const v of [
      "agente_metricas_dia",
      "agente_metricas_motivos_30_dias",
      "agente_metricas_respostas",
      "agente_metricas_sem_resposta_dia",
    ]) {
      // o service_role também sai do REVOKE: o default do Supabase concede tudo a ele em objeto novo, view inclusive
      expect(codigo).toContain(
        `REVOKE ALL ON public.${v} FROM PUBLIC, anon, authenticated, service_role;`,
      );
      expect(codigo).toContain(`GRANT SELECT ON public.${v} TO service_role;`);
    }
    expect(
      [...codigo.matchAll(/GRANT\s+[^;]*TO\s+([^;]+);/gi)].every(
        (m) => m[1].trim() === "service_role",
      ),
    ).toBe(true);
  });

  it("o service_role só lê: o REVOKE tira o service_role ANTES do GRANT SELECT, e a conferência prova que nada além do SELECT sobrou", () => {
    const revoke = codigo.lastIndexOf("REVOKE ALL ON public.agente_metricas_");
    const grant = codigo.indexOf("GRANT SELECT ON public.agente_metricas_dia TO service_role;");
    expect(revoke).toBeGreaterThan(-1);
    expect(revoke).toBeLessThan(grant);
    // o default do Supabase concede tudo ao service_role em objeto novo: o REVOKE precisa citá-lo
    expect(
      [...codigo.matchAll(/REVOKE ALL ON public\.agente_metricas_\w+ FROM ([^;]+);/g)].map(
        (m) => m[1],
      ),
    ).toEqual(Array(4).fill("PUBLIC, anon, authenticated, service_role"));
    const conf = codigo.slice(codigo.indexOf("DO $conferencia$"));
    expect(conf).toContain(
      "has_table_privilege('service_role', 'public.' || v, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')",
    );
    expect(conf).toContain("aclexplode(coalesce(c.relacl, acldefault('r', c.relowner)))");
    expect(conf).toContain("SET LOCAL ROLE service_role;");
    expect(conf).toContain("INSERT INTO public.%I SELECT * FROM public.%I LIMIT 0");
    expect(conf).toMatch(
      /WHEN insufficient_privilege OR feature_not_supported OR object_not_in_prerequisite_state THEN/,
    );
    expect(conf).toContain("o INSERT na view % passou para o servidor");
  });

  it("abre com lock_timeout, uma transação, para se já existir e confere no fim", () => {
    expect(codigo).toMatch(/BEGIN;\s*SET LOCAL lock_timeout = '5s';/);
    expect(codigo.trim().endsWith("COMMIT;")).toBe(true);
    expect(codigo).toMatch(/Já existe: %/);
    expect(codigo).toMatch(
      /has_table_privilege\('service_role', 'public\.agente_eventos', 'SELECT'\)/,
    );
    expect(codigo).toMatch(/DO \$conferencia\$/);
  });

  it("nenhuma coluna identifica conversa ou pessoa e nenhuma tem nome de dinheiro", () => {
    const selects = [...codigo.matchAll(/CREATE VIEW[\s\S]*?;\n/g)].map((m) => m[0]).join("\n");
    expect(selects).not.toMatch(
      /\bAS\s+(conversa_id|mensagem_id|saida_id|nome|telefone|texto|frase|pergunta|resposta|cep)\b/i,
    );
    expect(selects).not.toMatch(/\bAS\s+\w*(preco|valor|custo|desconto|orcamento|revend)\w*\b/i);
    expect(selects).toMatch(/AS sensiveis/);
  });

  it("real e ensaio são colunas separadas, e só decisão (com mensagem_id) conta no dia", () => {
    const dia = codigo.slice(
      codigo.indexOf("CREATE VIEW public.agente_metricas_dia"),
      codigo.indexOf("CREATE VIEW public.agente_metricas_motivos"),
    );
    expect(dia).toMatch(/CASE WHEN e\.tipo = 'ensaio' THEN 'ensaio' ELSE 'real' END AS modo/);
    expect(dia).toMatch(/e\.mensagem_id IS NOT NULL/);
    expect(dia).not.toMatch(/'enviado'/);
  });

  it("vem depois da C3 e o prefixo de data é único", () => {
    expect(NOME > "20261115100000_agente_escolhe_respostas.sql").toBe(true);
  });
});

describe("a seção 8 do roteiro cobre a migração das métricas", () => {
  const doc = readFileSync(join(__dirname, "..", "..", "docs", "ensaio-agente-escolhe.md"), "utf8");
  const secao = doc.slice(doc.indexOf("## 8. A migração das métricas"));
  const blocos = [...secao.matchAll(/```sql\n([\s\S]*?)```/g)].map((m) => m[1]);
  const ensaio = blocos.find((b) => b.includes("DO $ensaio$"))!;
  const volta = blocos.find((b) => b.includes("DO $volta$"))!;
  const semComentarios = (t: string) =>
    t
      .split("\n")
      .map((l) => l.replace(/--.*$/, ""))
      .join("\n");

  it("tem ANTES, aplicar, DEPOIS, ENSAIO, DEPOIS do ensaio e voltar atrás", () => {
    for (const t of [
      "## 8.0 ANTES de aplicar",
      "## 8.1 Aplicar",
      "## 8.2 DEPOIS: estrutura",
      "## 8.3 ENSAIO",
      "## 8.4 DEPOIS do ensaio",
      "## 8.5 Voltar atrás",
    ]) {
      expect(secao).toContain(t);
    }
  });

  it("o ensaio abre com lock_timeout de 2 s, termina em RAISE EXCEPTION e não tem DDL nem UPDATE ou DELETE sem WHERE", () => {
    expect(ensaio).toMatch(/SET LOCAL lock_timeout = '2s';/);
    expect(ensaio).toMatch(/set_config\('lock_timeout', '2s', true\)/);
    expect(ensaio).toMatch(/RAISE EXCEPTION E'ENSAIO PASSOU[^']*desfaz tudo/);
    const c = semComentarios(ensaio).replace(/'(?:[^']|'')*'/g, "''");
    expect(c).not.toMatch(/\b(CREATE|ALTER|DROP|TRUNCATE|COMMIT|ROLLBACK)\b/i);
    expect(c).not.toMatch(/\b(UPDATE|DELETE)\b/i);
    // a última coisa do bloco é o erro que desfaz tudo
    expect(ensaio.trimEnd().endsWith("END $ensaio$;")).toBe(true);
    expect(semComentarios(ensaio).trimEnd().split("\n").slice(-2)[0]).toMatch(
      /RAISE EXCEPTION E'ENSAIO PASSOU/,
    );
  });

  it("o ensaio confere real e ensaio separados, a janela de 30 dias, as colunas e o acesso", () => {
    expect(ensaio).toMatch(/modo = 'real'/);
    expect(ensaio).toMatch(/modo = 'ensaio'/);
    expect(ensaio).toMatch(/interval '45 days'/);
    expect(ensaio).toMatch(/SET LOCAL ROLE anon/);
    expect(ensaio).toMatch(/SET LOCAL ROLE authenticated/);
    expect(ensaio).toMatch(/SET LOCAL ROLE service_role/);
    expect(ensaio).toMatch(/insufficient_privilege/);
  });

  it("o ensaio tem a prova 8: o servidor só lê, por privilégio, por ACL e pelo INSERT que falha", () => {
    expect(ensaio).toContain("-- 8) O SERVIDOR SÓ LÊ.");
    expect(ensaio).toContain(
      "has_table_privilege('service_role', 'public.' || v_q, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')",
    );
    expect(ensaio).toContain("aclexplode(coalesce(c.relacl, acldefault('r', c.relowner)))");
    expect(ensaio).toContain("o INSERT em % passou para o service_role");
    expect(secao).toContain("ENSAIO PASSOU (8 provas)");
    expect(secao).toMatch(/^8\) o service_role só lê/m);
    expect(secao).toContain(
      "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role",
    );
    expect(secao).toContain("acl_alem_do_select");
  });

  it("a volta derruba só as quatro views, sem CASCADE, dentro de uma transação com lock_timeout", () => {
    expect(volta).toMatch(/BEGIN;\s*SET LOCAL lock_timeout = '2s';/);
    expect([...volta.matchAll(/DROP VIEW public\.(\w+);/g)].map((m) => m[1])).toHaveLength(4);
    expect(semComentarios(volta)).not.toMatch(/CASCADE/i);
    expect(volta.trimEnd().endsWith("COMMIT;")).toBe(true);
  });

  it("as seções 6 e 7 do roteiro da C3 não dizem mais que a tela não existe", () => {
    expect(doc).not.toMatch(/Não há tela nem função de servidor para o dono mexer no agente/);
    expect(doc).toMatch(/A tela `\/configuracoes-agente`/);
  });
});
