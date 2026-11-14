import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { seloDaTriagem } from "../../src/domain/whatsapp/triagem/selo";
import {
  diaCurto,
  duracaoEmTexto,
  estaZerado,
  mediaDoDia,
  percentualEmTexto,
  resumirJanela,
  taxa,
  concorda,
  linhasDaTabela,
  outrosDoDia,
  plural,
  type LinhaDoDia,
  type LinhaDa30Dias,
} from "../../src/domain/whatsapp/triagem/metricas";
import { semComentarios } from "./sql-lido-como-texto";

const SQL = semComentarios(
  readFileSync(
    join(__dirname, "..", "..", "supabase", "migrations", "20261114110000_triagem_metricas.sql"),
    "utf8",
  ),
);

describe("selo da triagem (B9)", () => {
  it("mostra os quatro estados pedidos, com texto legível", () => {
    expect(seloDaTriagem("ativa", "real")?.frase).toBe("Triagem automática: em andamento");
    expect(seloDaTriagem("concluida", "real")?.frase).toBe("Triagem automática: concluída");
    expect(seloDaTriagem("entregue_equipe", "real")?.frase).toBe("Triagem automática: entregue à equipe");
    expect(seloDaTriagem("pausada_humano", "real")?.frase).toBe("Triagem automática: pausada pela equipe");
  });

  it("sem registro, simulação e conversa pulada não têm selo", () => {
    expect(seloDaTriagem(undefined)).toBeNull();
    expect(seloDaTriagem(null)).toBeNull();
    expect(seloDaTriagem("ativa", "ensaio")).toBeNull();
    expect(seloDaTriagem("ensaio", "ensaio")).toBeNull();
    expect(seloDaTriagem("pulada", "real")).toBeNull();
    expect(seloDaTriagem("status_que_nao_existe")).toBeNull();
  });

  it("nenhum texto cita preço, a palavra proibida ou travessão", () => {
    for (const s of ["ativa", "concluida", "entregue_equipe", "pausada_humano", "expirada", "pausada_desligada", "parada_pelo_contato"]) {
      const t = seloDaTriagem(s)!;
      const tudo = `${t.estado} ${t.frase} ${t.explicacao}`.toLowerCase();
      expect(tudo).not.toMatch(/revend|pre[cç]o|r\$|—|–/);
    }
  });
});

describe("métricas da triagem (B10): contas", () => {
  const linha = (o: Partial<LinhaDa30Dias>): LinhaDa30Dias => ({
    ramo: "cliente",
    triadas: 0,
    puladas: 0,
    concluidas: 0,
    entregues_equipe: 0,
    abandonadas: 0,
    pausadas_humano: 0,
    triagens_com_pausa_humano: 0,
    enviou_boas_vindas: 0,
    respondeu_nome: 0,
    pediu_preco: 0,
    concluidas_com_tempo: 0,
    mediana_segundos_ate_concluir: null,
    ...o,
  });

  it("taxa sem denominador é 'sem base', nunca zero por cento", () => {
    const t = taxa(0, 0);
    expect(t.percentual).toBeNull();
    expect(percentualEmTexto(t)).toBe("sem base ainda");
    expect(percentualEmTexto(taxa(1, 3))).toBe("33%");
  });

  it("zerado quando ninguém foi triado, mesmo com puladas", () => {
    expect(estaZerado(resumirJanela([]))).toBe(true);
    expect(estaZerado(resumirJanela([linha({ puladas: 5 })]))).toBe(true);
    expect(estaZerado(resumirJanela([linha({ triadas: 1 })]))).toBe(false);
  });

  it("cada taxa usa o seu denominador: nome sobre quem recebeu mensagem, o resto sobre as triadas", () => {
    const r = resumirJanela([
      linha({ triadas: 10, enviou_boas_vindas: 8, respondeu_nome: 4, pediu_preco: 2, concluidas: 5, entregues_equipe: 1, abandonadas: 3 }),
      linha({ ramo: "parceiro", triadas: 10, enviou_boas_vindas: 2, respondeu_nome: 2, pediu_preco: 0, concluidas: 5 }),
    ]);
    expect(r.triadas).toBe(20);
    expect(r.resposta_ao_nome).toMatchObject({ numerador: 6, denominador: 10, percentual: 60 });
    expect(r.pediu_preco).toMatchObject({ numerador: 2, denominador: 20, percentual: 10 });
    expect(r.concluidas_taxa.percentual).toBe(50);
    expect(r.medianaPorRamo).toHaveLength(2);
  });

  it("duração e dia em texto", () => {
    expect(duracaoEmTexto(200)).toBe("3 min 20 s");
    expect(duracaoEmTexto(45)).toBe("45 s");
    expect(duracaoEmTexto(7300)).toBe("2 h 1 min");
    expect(duracaoEmTexto(null)).toBe("sem conclusão ainda");
    expect(diaCurto("2026-11-14")).toBe("14/11");
    expect(mediaDoDia({ soma_segundos_ate_concluir: 360, concluidas_com_tempo: 2 })).toBe(180);
    expect(mediaDoDia({ soma_segundos_ate_concluir: 0, concluidas_com_tempo: 0 })).toBeNull();
  });

  it("plural concorda singular e plural, sem parênteses", () => {
    expect(plural(1, "conversa", "conversas")).toBe("1 conversa");
    expect(plural(0, "conversa", "conversas")).toBe("0 conversas");
    expect(plural(2, "conversa", "conversas")).toBe("2 conversas");
    expect(concorda(1, "pausada", "pausadas")).toBe("pausada");
    expect(concorda(3, "pausada", "pausadas")).toBe("pausadas");
  });

  it("'outros' fecha a soma: concluídas, entregues, sem resposta, pausadas e outros dão o total de triadas", () => {
    const r = resumirJanela([
      linha({ triadas: 20, concluidas: 8, entregues_equipe: 3, abandonadas: 4, pausadas_humano: 2, triagens_com_pausa_humano: 5 }),
      linha({ ramo: "parceiro", triadas: 5, concluidas: 1 }),
    ]);
    expect(r.outros).toBe(7);
    expect(r.concluidas + r.entregues_equipe + r.abandonadas + r.pausadas_humano + r.outros).toBe(r.triadas);
    expect(r.triagens_com_pausa_humano).toBe(5);
  });

  it("'outros' nunca fica negativo", () => {
    expect(resumirJanela([linha({ triadas: 1, concluidas: 3 })]).outros).toBe(0);
  });

  const dia = (o: Partial<LinhaDoDia>): LinhaDoDia => ({
    dia: "2026-11-14",
    ramo: "cliente",
    triadas: 1,
    puladas: 0,
    em_andamento: 0,
    concluidas: 0,
    entregues_equipe: 0,
    abandonadas: 0,
    pausadas_humano: 0,
    pausadas_desligada: 0,
    paradas_pelo_contato: 0,
    enviou_boas_vindas: 0,
    respondeu_nome: 0,
    pediu_preco: 0,
    concluidas_com_tempo: 0,
    soma_segundos_ate_concluir: 0,
    ...o,
  });

  it("a tabela por dia ignora dia só com pulada antes de escolher os dias", () => {
    const dias: LinhaDoDia[] = [];
    // 3 dias recentes só com puladas, depois 14 dias com triagem
    for (const d of ["30", "29", "28"]) dias.push(dia({ dia: `2026-11-${d}`, triadas: 0, puladas: 9 }));
    for (let i = 1; i <= 14; i++) dias.push(dia({ dia: `2026-10-${String(i).padStart(2, "0")}`, triadas: 2 }));
    const linhas = linhasDaTabela(dias, 14);
    expect(new Set(linhas.map((l) => l.dia)).size).toBe(14);
    expect(linhas.every((l) => l.triadas > 0)).toBe(true);
    expect(linhas[0].dia).toBe("2026-10-14");
  });

  it("a tabela por dia mantém os dois ramos do mesmo dia e corta no número pedido", () => {
    const linhas = linhasDaTabela(
      [dia({ dia: "2026-11-02" }), dia({ dia: "2026-11-02", ramo: "parceiro" }), dia({ dia: "2026-11-01" })],
      1,
    );
    expect(linhas.map((l) => `${l.dia}/${l.ramo}`)).toEqual(["2026-11-02/cliente", "2026-11-02/parceiro"]);
  });

  it("outros do dia", () => {
    expect(outrosDoDia(dia({ triadas: 10, concluidas: 4, entregues_equipe: 1, abandonadas: 2, pausadas_humano: 1 }))).toBe(2);
  });
});

describe("migração das métricas (B10), lida como texto", () => {
  it("só cria views security_invoker e GRANTs: nada de tabela, função, gatilho ou escrita", () => {
    expect(SQL).not.toMatch(/\b(CREATE\s+(TABLE|FUNCTION|TRIGGER|POLICY)|ALTER\s+TABLE|INSERT\s+INTO|UPDATE\s+public|DELETE\s+FROM|DROP)\b/i);
    const views = SQL.match(/CREATE OR REPLACE VIEW public\.\w+ WITH \(security_invoker = true\)/g) ?? [];
    expect(views).toHaveLength(3);
    expect(SQL.match(/CREATE OR REPLACE VIEW/g)).toHaveLength(3);
  });

  it("só o servidor lê: revoga de PUBLIC, anon e authenticated pelo nome e concede a service_role", () => {
    for (const v of ["triagem_metricas_dia", "triagem_metricas_30_dias", "triagem_metricas_pausas_dia"]) {
      expect(SQL).toContain(`REVOKE ALL ON public.${v} FROM PUBLIC, anon, authenticated;`);
      expect(SQL).toContain(`GRANT SELECT ON public.${v} TO service_role;`);
      expect(SQL).not.toMatch(new RegExp(`GRANT[^;]*ON public\\.${v} TO[^;]*(anon|authenticated|PUBLIC)`));
    }
  });

  it("nenhuma coluna de dado pessoal sai das views", () => {
    const colunas = SQL.split("CREATE OR REPLACE VIEW")
      .slice(1)
      .flatMap((v) => [...v.matchAll(/\bAS (\w+)\b/g)].map((m) => m[1]));
    expect(colunas.length).toBeGreaterThan(20);
    for (const c of colunas) {
      expect(c).not.toMatch(/^nome|(^|_)(cep|telefone|phone|endereco|texto|email|lid)(_|$)/);
    }
  });

  it("a pausa por humano aceita o evento do banco e o do motor TypeScript, cada triagem uma vez", () => {
    const v = SQL.slice(SQL.indexOf("triagem_metricas_pausas_dia WITH"));
    expect(v).toContain("e.detalhe ->> 'status' = 'pausada_humano' OR e.detalhe ->> 'motivo' = 'humano'");
    expect(v).toContain("count(DISTINCT e.triagem_id)");
    const trinta = SQL.slice(SQL.indexOf("triagem_metricas_30_dias WITH"), SQL.indexOf("triagem_metricas_pausas_dia WITH"));
    expect(trinta).toContain("AS triagens_com_pausa_humano");
    expect(trinta).toContain("e.detalhe ->> 'motivo' = 'humano'");
  });

  it("conta só modo real e a palavra proibida do dono não aparece", () => {
    expect(SQL.match(/modo = 'real'/g)!.length).toBe(3);
    expect(SQL.toLowerCase()).not.toContain("revend");
  });
});

describe("leitura das triagens da caixa (B9)", () => {
  it("vale a triagem mais recente de cada conversa", async () => {
    const { juntarTriagens } = await import("../../src/components/whatsapp/usar-triagens-da-caixa");
    // as linhas chegam da mais nova para a mais velha
    const r = juntarTriagens([
      {
        data: [
          { conversa_id: "a", status: "ativa" },
          { conversa_id: "a", status: "expirada" },
          { conversa_id: "b", status: "concluida" },
        ],
        error: null,
      },
    ]);
    expect(r.porConversa.get("a")?.status).toBe("ativa");
    expect(r.porConversa.get("b")?.status).toBe("concluida");
    expect(r.truncado).toBe(false);
  });

  it("erro de leitura vira erro, e o corte de mil linhas avisa 'truncado'", async () => {
    const { juntarTriagens, lerTriagens } = await import("../../src/components/whatsapp/usar-triagens-da-caixa");
    expect(() => juntarTriagens([{ data: null, error: { message: "RLS" } }])).toThrow("RLS");
    const mil = Array.from({ length: 1000 }, (_, i) => ({ conversa_id: `c${i}`, status: "ativa" }));
    expect(juntarTriagens([{ data: mil, error: null }]).truncado).toBe(true);

    // 170 conversas viram 3 pedidos de no máximo 80 ids
    const tamanhos: number[] = [];
    const ids = Array.from({ length: 170 }, (_, i) => `c${i}`);
    await lerTriagens(ids, async (p) => {
      tamanhos.push(p.length);
      return { data: [], error: null };
    });
    expect(tamanhos).toEqual([80, 80, 10]);
  });
});
