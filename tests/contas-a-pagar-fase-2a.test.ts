import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  FORMA_DINHEIRO,
  ORIGEM_DINHEIRO,
  frasesDoHistorico,
  problemaDaOrigem,
  recusaDoBanco,
  type LinhaDoHistorico,
} from "../src/domain/financeiro/contas-a-pagar-anexos";
import {
  conferirContasPagas,
  linhasSuspeitasDoExtrato,
  somaDosValores,
  type ContaPagaParaConferir,
} from "../src/domain/financeiro/conferencia-do-caixa";

const RAIZ = join(__dirname, "..");
const ler = (f: string) => readFileSync(join(RAIZ, f), "utf8");
const M = "supabase/migrations/";
const SQL = ler(`${M}20261116210000_contas_a_pagar_fase_2a_permissao_e_conta_de_origem.sql`);
const F160 = ler(`${M}20261116160000_contas_a_pagar_confirmar_anexar_estornar.sql`);
const F170 = ler(`${M}20261116170000_contas_a_pagar_so_quem_ve_o_financeiro.sql`);
const F1005 = ler(`${M}20261005100000_financeiro_ver_nao_e_lancar.sql`);
const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");

/** Corpo de cada função como o Postgres guarda em prosrc: o texto entre os $function$. */
function corpos(texto: string): Map<string, string> {
  const re =
    /CREATE (?:OR REPLACE )?FUNCTION public\.(\w+)\([\s\S]*?AS \$function\$([\s\S]*?)\$function\$/g;
  return new Map([...texto.matchAll(re)].map((m) => [m[1], m[2]]));
}
const NOVOS = corpos(SQL);

describe("migração 20261116210000: o que troca é o que estava vivo", () => {
  it("a guarda confere o md5 dos corpos que estão nas migrações aplicadas", () => {
    const vivos: [string, string][] = [
      ["pagar_conta_pagar", F170],
      ["anexar_arquivo_conta_pagar", F170],
      ["estornar_conta_pagar", F160],
      ["remover_anexo_conta_pagar", F160],
      ["anexar_comprovante_parcela", F1005],
      ["baixar_parcela_compromisso", F1005],
      ["quitar_parcelas_ate", F1005],
    ];
    for (const [f, arquivo] of vivos) {
      const corpo = corpos(arquivo).get(f);
      expect(corpo, f).toBeDefined();
      expect(SQL, f).toContain(`'${md5(corpo!)}'`);
    }
  });

  it("estornar, remover e anexar só trocam a guarda: o resto do corpo é idêntico ao vivo", () => {
    const tirarGuarda = (c: string) =>
      c.replace(/\n {2}IF v_uid IS NULL OR NOT [\s\S]*?\n {2}END IF;\n/, "\n<guarda>\n");
    for (const [f, arquivo] of [
      ["estornar_conta_pagar", F160],
      ["remover_anexo_conta_pagar", F160],
      ["anexar_arquivo_conta_pagar", F170],
    ] as const) {
      const antes = tirarGuarda(corpos(arquivo).get(f)!);
      const depois = tirarGuarda(NOVOS.get(f)!);
      expect(depois, f).toBe(antes);
    }
  });
});

describe("retrato do que foi aplicado", () => {
  it("o md5 anotado no cabeçalho é o do corpo no arquivo, para as 8 funções", () => {
    const anotados = new Map(
      [...SQL.matchAll(/^--\s+(\w+)\s+([0-9a-f]{32})\b/gm)].map((m) => [m[1], m[2]]),
    );
    expect(anotados.size).toBe(8);
    for (const [f, corpo] of NOVOS) expect(md5(corpo), f).toBe(anotados.get(f));
  });
});

describe("permissão no banco", () => {
  it("estornar e remover anexo continuam só do admin (decisão do dono)", () => {
    for (const f of ["estornar_conta_pagar", "remover_anexo_conta_pagar"]) {
      const c = NOVOS.get(f)!;
      expect(c, f).toContain(
        "IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.app_role) THEN",
      );
      expect(c, f).not.toMatch(/'gestor'|can_see_financials|has_permission/);
    }
  });

  it("dar baixa, quitar em lote e anexar comprovante de parcela passam a exigir ver o financeiro", () => {
    for (const f of [
      "baixar_parcela_compromisso",
      "quitar_parcelas_ate",
      "anexar_comprovante_parcela",
    ]) {
      const c = NOVOS.get(f)!;
      expect(c, f).toContain("public.can_see_financials(v_uid)");
      expect(c, f).toContain("public.has_role(v_uid, 'admin'::public.app_role)");
      // E nos corpos de 05/10 não exigia: era o furo.
      expect(corpos(F1005).get(f), f).not.toContain("can_see_financials");
    }
  });

  it("toda recusa por permissão vira linha no histórico em vez de erro (o erro desfaria a linha)", () => {
    for (const f of [
      "pagar_conta_pagar",
      "estornar_conta_pagar",
      "remover_anexo_conta_pagar",
      "anexar_arquivo_conta_pagar",
      "anexar_comprovante_parcela",
      "baixar_parcela_compromisso",
      "quitar_parcelas_ate",
    ]) {
      const c = NOVOS.get(f)!;
      expect(c, f).toContain("public._negar_conta_pagar(");
      expect(c, f).not.toContain("ERRCODE = '42501'");
      expect(c, f).not.toMatch(/RAISE EXCEPTION 'Sem permiss|RAISE EXCEPTION 'Só o administrador/i);
    }
    const negar = NOVOS.get("_negar_conta_pagar")!;
    expect(negar).toContain("'tentativa_negada'");
    expect(negar).toContain("'negado', true");
    expect(negar).toContain("v_uid");
  });

  it("o histórico aceita tentativa_negada sem perder nenhum evento de antes", () => {
    const m = SQL.match(
      /ADD CONSTRAINT contas_pagar_historico_evento_check\s+CHECK \(evento = ANY \(ARRAY\[([\s\S]*?)\]\)\)/,
    );
    expect(m).not.toBeNull();
    const eventos = [...m![1].matchAll(/'(\w+)'::text/g)].map((x) => x[1]).sort();
    expect(eventos).toEqual(
      [
        "anexo_enviado",
        "anexo_removido",
        "cancelada",
        "criada",
        "estornada",
        "excluida",
        "paga",
        "reaberta",
        "tentativa_negada",
      ].sort(),
    );
  });

  it("ninguém logado chama _negar_conta_pagar direto, e anon não chama nada", () => {
    expect(SQL).toContain(
      "REVOKE ALL ON FUNCTION public._negar_conta_pagar(uuid, text, text) FROM PUBLIC, anon, authenticated;",
    );
    expect(SQL).toContain(
      "REVOKE ALL ON FUNCTION public.baixar_parcela_compromisso(uuid, date, text, text, boolean, uuid) FROM PUBLIC, anon, authenticated;",
    );
    expect(SQL).toContain(
      "GRANT EXECUTE ON FUNCTION public.baixar_parcela_compromisso(uuid, date, text, text, boolean, uuid) TO authenticated, service_role;",
    );
    expect(SQL).toContain(
      "DROP FUNCTION public.baixar_parcela_compromisso(uuid, date, text, text, boolean);",
    );
    expect(SQL).not.toMatch(/TO (anon|PUBLIC)\b/);
    expect(SQL).toMatch(/has_function_privilege\('anon', f::regprocedure, 'EXECUTE'\)/);
  });

  it("não mexe em policy, view, tabela de dinheiro nem em linha já gravada", () => {
    // Fora dos corpos das funções e dos comentários: o que a migração executa ao ser aplicada.
    const executavel = SQL.replace(/AS \$function\$[\s\S]*?\$function\$/g, "").replace(
      /^--.*$/gm,
      "",
    );
    expect(executavel).not.toMatch(/CREATE (OR REPLACE )?VIEW|POLICY|DROP TABLE|TRUNCATE/i);
    expect(executavel).not.toMatch(/^\s*(UPDATE|DELETE FROM|INSERT INTO)\s+public\./im);
    expect([...executavel.matchAll(/ALTER TABLE public\.(\w+)/g)].map((m) => m[1])).toEqual([
      "contas_pagar_historico",
      "contas_pagar_historico",
    ]);
  });
});

describe("conta de origem obrigatória", () => {
  it("pagar exige conta bancária ativa, ou dinheiro com comprovante enviado depois do último estorno", () => {
    const c = NOVOS.get("pagar_conta_pagar")!;
    expect(c).toContain("RAISE EXCEPTION 'Escolha de onde saiu o dinheiro");
    expect(c).toContain(
      "RAISE EXCEPTION 'Pagamento em dinheiro exige o comprovante anexado antes de pagar.'",
    );
    expect(c).toContain("a.tipo = 'comprovante'");
    expect(c).toContain("h.evento = 'estornada'");
    expect(c).toContain("WHERE b.id = p_conta_bancaria_id AND b.ativo");
    expect(c).toContain("v_forma := 'Dinheiro'");
  });

  it("a baixa de parcela exige origem só quando lança a saída no caixa, e grava a conta na saída", () => {
    const c = NOVOS.get("baixar_parcela_compromisso")!;
    expect(c).toContain("v_lancou := p_lancar_caixa AND v_ja_no_caixa = 0;");
    expect(c).toMatch(/IF v_lancou THEN\s+IF p_conta_bancaria_id IS NOT NULL THEN/);
    expect(c).toContain("RAISE EXCEPTION 'Pagamento em dinheiro exige o comprovante nesta baixa.'");
    expect(c).toContain("p_data_pagamento, true, p_conta_id, p_conta_bancaria_id, v_uid");
  });
});

describe("recusa do banco e origem, no domínio", () => {
  it("negado vira mensagem; qualquer outra resposta não", () => {
    expect(recusaDoBanco({ negado: true, mensagem: "Só o administrador estorna." })).toBe(
      "Só o administrador estorna.",
    );
    expect(recusaDoBanco({ negado: true })).toBe("O banco recusou: sem permissão.");
    expect(recusaDoBanco({ negado: false, mensagem: "x" })).toBeNull();
    expect(recusaDoBanco({ conta_id: "1" })).toBeNull();
    expect(recusaDoBanco(null)).toBeNull();
    expect(recusaDoBanco("negado")).toBeNull();
  });

  it("origem: vazia não passa; dinheiro só com comprovante; conta bancária passa sem", () => {
    expect(problemaDaOrigem("", 0)).toMatch(/Escolha de onde saiu/);
    expect(problemaDaOrigem("", 3)).toMatch(/Escolha de onde saiu/);
    expect(problemaDaOrigem(ORIGEM_DINHEIRO, 0)).toMatch(/exige o comprovante/);
    expect(problemaDaOrigem(ORIGEM_DINHEIRO, 1)).toBeNull();
    expect(problemaDaOrigem("d91b5d74-e754-48aa-8444-2f30ceb86eb2", 0)).toBeNull();
    expect(FORMA_DINHEIRO).toBe("Dinheiro");
  });

  it("o histórico diz quem tentou o quê, e o pagamento em dinheiro", () => {
    const base: LinhaDoHistorico = {
      id: "1",
      evento: "tentativa_negada",
      usuario_nome: "Cibele",
      ocorrido_em: "2026-11-16T20:00:00Z",
      valor: null,
      data_pagamento: null,
      motivo: "Só o administrador estorna pagamento de conta a pagar.",
      detalhes: { acao: "estornar" },
    };
    expect(frasesDoHistorico(base)).toEqual({
      titulo: "Tentativa negada: estornar",
      detalhe: "Só o administrador estorna pagamento de conta a pagar.",
    });
    const paga = frasesDoHistorico({
      ...base,
      evento: "paga",
      valor: 10,
      data_pagamento: "2026-11-16",
      motivo: null,
      detalhes: { forma_pagamento: "Dinheiro" },
    });
    expect(paga.detalhe).toContain("em dinheiro");
  });
});

describe("telas", () => {
  const DIALOGO = ler("src/components/financeiro/contas-a-pagar/pagar-conta-dialog.tsx");
  const GANCHO = ler("src/components/financeiro/contas-a-pagar/use-conta-a-pagar.ts");
  const COMPROMISSOS = ler("src/routes/_authenticated/compromissos.tsx");
  const CONFERENCIA = ler("src/routes/_authenticated/conferencia-do-caixa.tsx");

  it("o diálogo não tem mais 'Não informar' nem origem escolhida pela tela", () => {
    // O comentário do componente conta a história; a opção em si não pode existir.
    expect(DIALOGO).not.toMatch(/>\s*Não informar|SEM_CONTA|nao-informada/);
    expect(DIALOGO).toContain('const [origem, setOrigem] = useState("");');
    expect(DIALOGO).toContain("Dinheiro / caixa físico");
    expect(DIALOGO).toContain("!!problemaDeOrigem");
  });

  it("no dinheiro o comprovante sobe antes de pagar; sem ele, não paga", () => {
    const ini = DIALOGO.indexOf("if (emDinheiro) {");
    const trecho = DIALOGO.slice(ini, DIALOGO.indexOf("return envio;", ini));
    expect(trecho.indexOf("await enviar(")).toBeGreaterThan(-1);
    expect(trecho.indexOf("await enviar(")).toBeLessThan(trecho.indexOf("await pagar("));
    expect(trecho).toContain("if (envio.enviados === 0)");
  });

  it("todo gancho que chama função que pode negar confere a recusa", () => {
    for (const rpc of [
      "pagar_conta_pagar",
      "estornar_conta_pagar",
      "remover_anexo_conta_pagar",
      "anexar_arquivo_conta_pagar",
    ]) {
      const ini = GANCHO.indexOf(`"${rpc}"`);
      expect(ini, rpc).toBeGreaterThan(-1);
      expect(GANCHO.slice(ini, ini + 700), rpc).toContain("recusaDoBanco(data)");
    }
    for (const rpc of [
      "baixar_parcela_compromisso",
      "anexar_comprovante_parcela",
      "quitar_parcelas_ate",
    ]) {
      const ini = COMPROMISSOS.indexOf(`"${rpc}"`);
      expect(ini, rpc).toBeGreaterThan(-1);
      expect(COMPROMISSOS.slice(ini, ini + 900), rpc).toContain("recusaDoBanco(data)");
    }
  });

  it("dar baixa lançando no caixa pede a origem e manda a conta para o banco", () => {
    expect(COMPROMISSOS).toContain(
      "p_conta_bancaria_id: v.caixa && !dinheiro ? v.origem || null : null",
    );
    expect(COMPROMISSOS).toContain("!!problemaDaBaixa");
    expect(COMPROMISSOS).toContain("Dinheiro / caixa físico");
  });

  it("a Conferência só lê e abre com a porta do Caixa", () => {
    expect(CONFERENCIA).not.toMatch(/\.(insert|update|upsert|delete)\(|\.rpc\(|\.remove\(/);
    expect(ler("src/lib/permissions.ts")).toContain(
      '{ path: "/conferencia-do-caixa", permissions: ["financeiro.read"] }',
    );
    expect(ler("src/lib/menu.ts")).toContain('aba("Conferência", "/conferencia-do-caixa")');
  });
});

describe("conferência do caixa", () => {
  const conta = (o: Partial<ContaPagaParaConferir>): ContaPagaParaConferir => ({
    id: "c",
    descricao: "Conta",
    fornecedor: null,
    valor: 100,
    vencimento: "2026-10-05",
    data_pagamento: "2026-10-05",
    status: "paga",
    forma_pagamento: null,
    comprovante_url: null,
    compromisso_id: null,
    ...o,
  });

  it("separa sem origem, sem comprovante, sem data e saída repetida, e ignora o que não está pago", () => {
    const contas = [
      conta({ id: "ok" }),
      conta({ id: "sem-saida", data_pagamento: null, compromisso_id: "x" }),
      conta({ id: "saida-sem-conta" }),
      conta({ id: "dinheiro", forma_pagamento: "Dinheiro" }),
      conta({ id: "duas" }),
      conta({ id: "aberta", status: "aberta" }),
      conta({ id: "parcela-com-comprovante", comprovante_url: "compromissos/x.pdf" }),
    ];
    const saidas = [
      { conta_pagar_id: "ok", conta_id: "itau", origem: "conta_pagar" },
      { conta_pagar_id: "saida-sem-conta", conta_id: null, origem: "conta_pagar" },
      { conta_pagar_id: "dinheiro", conta_id: null, origem: "conta_pagar" },
      { conta_pagar_id: "duas", conta_id: "itau", origem: "conta_pagar" },
      { conta_pagar_id: "duas", conta_id: "itau", origem: "conta_pagar" },
      // Linha do extrato ligada à conta não é a saída do pagamento.
      { conta_pagar_id: "parcela-com-comprovante", conta_id: "itau", origem: "extrato" },
    ];
    const anexos = [
      { conta_pagar_id: "ok", tipo: "comprovante" },
      { conta_pagar_id: "dinheiro", tipo: "comprovante" },
      { conta_pagar_id: "duas", tipo: "fatura" },
    ];
    const r = conferirContasPagas(contas, saidas, anexos);
    expect(r.semOrigem.map((x) => [x.conta.id, x.motivo])).toEqual([
      ["sem-saida", "sem_saida_no_caixa"],
      ["saida-sem-conta", "saida_sem_conta"],
      ["parcela-com-comprovante", "sem_saida_no_caixa"],
    ]);
    expect(r.semComprovante.map((c) => c.id)).toEqual(["sem-saida", "saida-sem-conta", "duas"]);
    expect(r.semData.map((c) => c.id)).toEqual(["sem-saida"]);
    expect(r.saidaRepetida).toEqual([{ conta: contas[4], saidas: 2 }]);
  });

  it("no extrato, aponta as linhas de saldo do dia e as repetidas, sem misturar as duas", () => {
    const l = (id: string, data: string, descricao: string, valor: number, tipo = "credito") => ({
      id,
      conta_id: "itau",
      data,
      descricao,
      valor,
      tipo,
    });
    const r = linhasSuspeitasDoExtrato([
      l("1", "2026-09-10", "SALDO TOTAL DISPONÍVEL DIA", 665),
      l("2", "2026-09-10", "PIX RECEBIDO MAX", 42),
      l("3", "2026-09-10", "PIX RECEBIDO MAX", 192),
      l("4", "2026-10-14", "PIX RECEBIDO AMAPUER14/10", 372.5),
      l("5", "2026-10-14", "PIX RECEBIDO AMAPUER14/10", 372.5),
      l("6", "2026-10-14", "SALDO TOTAL DISPONÍVEL DIA", 822.47),
      l("7", "2026-10-14", "PIX RECEBIDO AMAPUER14/10", 372.5, "debito"),
      l("8", "2026-10-15", "SDO CTA/APL AUTOMATICAS", 10),
    ]);
    expect(r.saldoDoDia.map((x) => x.id)).toEqual(["1", "6", "8"]);
    expect(somaDosValores(r.saldoDoDia)).toBeCloseTo(1497.47, 2);
    expect(r.repetidas.map((g) => g.linhas.map((x) => x.id))).toEqual([["4", "5"]]);
  });
});
