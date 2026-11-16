import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  BUCKET_DE_ANEXOS,
  EXTENSAO_DO_TIPO,
  LIMITE_DO_ANEXO_EM_BYTES,
  anexosPorConta,
  caminhoDoAnexo,
  frasesDoHistorico,
  mimeDoArquivo,
  pagaSemComprovante,
  problemaDaDataDoPagamento,
  problemaDoArquivo,
  problemaDoMotivo,
  quantidadeDeArquivos,
  recursoAusente,
  tamanhoLegivel,
  type AnexoDaConta,
} from "../src/domain/financeiro/contas-a-pagar-anexos";

/**
 * CONTAS A PAGAR, FASE 1 (16/11/2026): pagar com confirmação, anexos e estorno com histórico.
 *
 * O comportamento foi provado no banco (docs/ensaio-contas-a-pagar-fase-1.sql, rodado num
 * Postgres descartável com o esqueleto do banco vivo, e com quatro defeitos injetados que ele
 * reprovou). Este teste segura o que o repositório pode vir a mudar: a regra da tela, a guarda
 * no texto da migração e o elo entre os dois (limite de 10 MB, tipos, formato do caminho).
 */

const MIGRACAO = readFileSync(
  "supabase/migrations/20261116160000_contas_a_pagar_confirmar_anexar_estornar.sql",
  "utf8",
);
/** O SQL sem comentários: o cabeçalho cita nomes que o código não pode tocar. */
const SQL = MIGRACAO.replace(/--.*$/gm, "");
const GANCHO = readFileSync(
  "src/components/financeiro/contas-a-pagar/use-conta-a-pagar.ts",
  "utf8",
);
const TELA = readFileSync("src/routes/_authenticated/fluxo-caixa.tsx", "utf8");
const DIALOGO_PAGAR = readFileSync(
  "src/components/financeiro/contas-a-pagar/pagar-conta-dialog.tsx",
  "utf8",
);

function corpo(funcao: string): string {
  const m = SQL.match(
    new RegExp(
      `CREATE OR REPLACE FUNCTION public\\.${funcao}\\([\\s\\S]*?AS \\$function\\$([\\s\\S]*?)\\$function\\$`,
    ),
  );
  expect(m, funcao).not.toBeNull();
  return m![1];
}

/** O primeiro IF da função: a guarda de quem pode chamar. */
function guarda(funcao: string): string {
  const c = corpo(funcao);
  const ini = c.indexOf("IF v_uid IS NULL");
  expect(ini, `${funcao} sem guarda de quem chama`).toBeGreaterThan(-1);
  return c.slice(ini, c.indexOf("END IF;", ini));
}

const anexo = (tipo: "fatura" | "comprovante", conta = "c1"): AnexoDaConta => ({
  id: `${tipo}-${conta}`,
  conta_pagar_id: conta,
  tipo,
  caminho: `${conta}/x.pdf`,
  nome_arquivo: "x.pdf",
  mime: "application/pdf",
  tamanho_bytes: 1000,
  enviado_por_nome: "Cibele",
  enviado_em: "2026-11-16T15:00:00Z",
});

describe("arquivo: PDF, JPG ou PNG, até 10 MB", () => {
  it("aceita os três tipos e olha a extensão só quando o navegador não diz o tipo", () => {
    expect(mimeDoArquivo({ name: "boleto.pdf", type: "application/pdf" })).toBe("application/pdf");
    expect(mimeDoArquivo({ name: "foto.JPG", type: "" })).toBe("image/jpeg");
    expect(mimeDoArquivo({ name: "foto.jpeg", type: "" })).toBe("image/jpeg");
    expect(mimeDoArquivo({ name: "tela.png", type: "image/png" })).toBe("image/png");
    // O tipo declarado é o que o Storage grava e o banco confere: extensão boa não salva gif.
    expect(mimeDoArquivo({ name: "foto.png", type: "image/gif" })).toBeNull();
    expect(mimeDoArquivo({ name: "planilha.xlsx", type: "" })).toBeNull();
  });

  it("recusa vazio e acima de 10 MB, dizendo o nome", () => {
    expect(
      problemaDoArquivo({ name: "a.pdf", type: "application/pdf", size: LIMITE_DO_ANEXO_EM_BYTES }),
    ).toBeNull();
    expect(
      problemaDoArquivo({
        name: "a.pdf",
        type: "application/pdf",
        size: LIMITE_DO_ANEXO_EM_BYTES + 1,
      }),
    ).toMatch(/"a\.pdf".*10 MB/);
    expect(problemaDoArquivo({ name: "b.pdf", type: "application/pdf", size: 0 })).toMatch(/vazio/);
    expect(problemaDoArquivo({ name: "c.doc", type: "application/msword", size: 10 })).toMatch(
      /não é PDF/,
    );
  });

  it("o caminho tem o formato que a policy de envio aceita", () => {
    const re = MIGRACAO.match(/AND name ~ '([^']+)'/);
    expect(re).not.toBeNull();
    const politica = new RegExp(re![1]);
    const conta = "3e95bf36-7cf6-4217-ab7e-0f1f3cca6648";
    const arquivo = "0f8b2c1a-1111-4a2b-9c3d-123456789abc";
    for (const mime of Object.keys(EXTENSAO_DO_TIPO) as (keyof typeof EXTENSAO_DO_TIPO)[]) {
      expect(caminhoDoAnexo(conta, arquivo, mime), mime).toMatch(politica);
    }
    expect(`outra/${arquivo}.pdf`).not.toMatch(politica);
  });

  it("tamanho legível em KB e MB", () => {
    expect(tamanhoLegivel(300)).toBe("1 KB");
    expect(tamanhoLegivel(2048)).toBe("2 KB");
    expect(tamanhoLegivel(1.5 * 1024 * 1024)).toBe("1,5 MB");
  });
});

describe("pagamento: data passada sim, futura não; estorno com motivo", () => {
  const hoje = "2026-11-16";
  it("data", () => {
    expect(problemaDaDataDoPagamento(hoje, hoje)).toBeNull();
    expect(problemaDaDataDoPagamento("2026-09-30", hoje)).toBeNull();
    expect(problemaDaDataDoPagamento("2026-11-17", hoje)).toMatch(/futura/);
    expect(problemaDaDataDoPagamento("", hoje)).toMatch(/Informe/);
    expect(problemaDaDataDoPagamento("16/11/2026", hoje)).toMatch(/inválida/);
  });

  it("motivo", () => {
    expect(problemaDoMotivo("")).toMatch(/obrigatório/);
    expect(problemaDoMotivo("   ")).toMatch(/obrigatório/);
    expect(problemaDoMotivo("erro")).toMatch(/5 caracteres/);
    expect(problemaDoMotivo("conta errada")).toBeNull();
  });

  it("o mínimo do motivo é o mesmo nos dois lados", () => {
    expect(corpo("estornar_conta_pagar")).toContain("length(v_motivo) < 5");
  });
});

describe("aviso de paga sem comprovante e contagem do clipe", () => {
  it("só conta paga avisa; fatura não é comprovante; o comprovante antigo da parcela vale", () => {
    expect(pagaSemComprovante({ status: "paga" }, [])).toBe(true);
    expect(pagaSemComprovante({ status: "paga" }, [anexo("fatura")])).toBe(true);
    expect(pagaSemComprovante({ status: "paga" }, [anexo("comprovante")])).toBe(false);
    expect(
      pagaSemComprovante({ status: "paga", comprovante_url: "compromissos/x/1.pdf" }, []),
    ).toBe(false);
    expect(pagaSemComprovante({ status: "aberta" }, [])).toBe(false);
  });

  it("o clipe soma os anexos e o comprovante antigo", () => {
    expect(quantidadeDeArquivos({ status: "paga", comprovante_url: "x" }, [anexo("fatura")])).toBe(
      2,
    );
    expect(quantidadeDeArquivos({ status: "aberta", comprovante_url: "  " }, [])).toBe(0);
    const mapa = anexosPorConta([
      anexo("fatura", "a"),
      anexo("comprovante", "a"),
      anexo("fatura", "b"),
    ]);
    expect(mapa.get("a")).toHaveLength(2);
    expect(mapa.get("b")).toHaveLength(1);
  });
});

describe("histórico em português", () => {
  it("pagamento diz valor, data e conta de origem; estorno diz o motivo", () => {
    const pago = frasesDoHistorico({
      id: "1",
      evento: "paga",
      usuario_nome: "Cibele",
      ocorrido_em: "2026-11-16T15:00:00Z",
      valor: 1234.56,
      data_pagamento: "2026-10-02",
      motivo: null,
      detalhes: { conta_bancaria: "BEX PRINT" },
    });
    expect(pago.titulo).toBe("Pagou");
    expect(pago.detalhe).toContain("pago em 02/10/2026");
    expect(pago.detalhe).toContain("saiu de BEX PRINT");
    const estorno = frasesDoHistorico({
      id: "2",
      evento: "estornada",
      usuario_nome: "Harison",
      ocorrido_em: "2026-11-16T16:00:00Z",
      valor: 1234.56,
      data_pagamento: "2026-10-02",
      motivo: "conta errada",
      detalhes: {},
    });
    expect(estorno.titulo).toBe("Estornou o pagamento");
    expect(estorno.detalhe).toContain("motivo: conta errada");
    const anexado = frasesDoHistorico({
      id: "3",
      evento: "anexo_enviado",
      usuario_nome: "Cibele",
      ocorrido_em: "2026-11-16T16:00:00Z",
      valor: null,
      data_pagamento: null,
      motivo: null,
      detalhes: { tipo: "fatura", nome_arquivo: "boleto.pdf" },
    });
    expect(anexado.titulo).toBe('Anexou: fatura/boleto "boleto.pdf"');
  });

  it("migração ausente é 'recurso desligado', não erro", () => {
    expect(recursoAusente({ code: "42P01", message: "relation does not exist" })).toBe(true);
    expect(recursoAusente({ code: "PGRST205", message: "Could not find the table" })).toBe(true);
    expect(recursoAusente({ code: "PGRST202", message: "Could not find the function" })).toBe(true);
    expect(recursoAusente({ code: "42501", message: "permission denied" })).toBe(false);
    expect(recursoAusente(null)).toBe(false);
  });
});

describe("migração 20261116160000: quem pode, e o que ela não toca", () => {
  it("estornar e remover anexo: só o PAPEL admin, nenhuma chave abre", () => {
    for (const f of ["estornar_conta_pagar", "remover_anexo_conta_pagar"]) {
      const g = guarda(f);
      expect(g, f).toContain("public.has_role(v_uid, 'admin'::public.app_role)");
      expect(g, f).not.toMatch(/has_permission|gestor|financeiro/);
    }
  });

  it("pagar: admin, ou dar baixa E lançar no caixa (as chaves do botão desde 05/10)", () => {
    const g = guarda("pagar_conta_pagar");
    expect(g).toContain("public.has_role(v_uid, 'admin'::public.app_role)");
    expect(g.replace(/\s+/g, " ")).toContain(
      "(public.has_permission(v_uid, 'pagamentos.confirm') AND public.has_permission(v_uid, 'pagamentos.create'))",
    );
  });

  it("anexar: as chaves que já valem para comprovante; o gestor não entra", () => {
    const g = guarda("anexar_arquivo_conta_pagar");
    for (const k of ["pagamentos.create", "pagamentos.update", "pagamentos.confirm"])
      expect(g).toContain(`'${k}'`);
    expect(g).not.toMatch(/financeiro\.read|can_see_financials|gestor/);
  });

  it("a saída nasce na data informada, nunca na do relógio", () => {
    const c = corpo("pagar_conta_pagar");
    const insert = c.slice(
      c.indexOf("INSERT INTO public.caixa_movimentos"),
      c.indexOf(";", c.indexOf("INSERT INTO public.caixa_movimentos")),
    );
    expect(insert).toContain("p_data_pagamento");
    expect(insert).not.toMatch(/hoje_br|current_date|now\(\)/);
    // E nada reescreve a saída depois de lançada.
    expect(c.match(/caixa_movimentos/g)).toHaveLength(2);
    expect(c).not.toMatch(/UPDATE public\.caixa_movimentos/);
    expect(c).toContain("p_data_pagamento > public.hoje_br()");
    expect(c).toContain("FOR UPDATE");
  });

  it("o estorno apaga só a saída do pagamento; extrato se desliga, não se apaga", () => {
    const c = corpo("estornar_conta_pagar");
    const del = c.slice(
      c.indexOf("DELETE FROM public.caixa_movimentos"),
      c.indexOf("RETURNING", c.indexOf("DELETE FROM public.caixa_movimentos")),
    );
    expect(del).toContain("m.origem = 'conta_pagar'");
    expect(c).toContain("SET conciliado = false, caixa_movimento_id = NULL");
    expect(c).toContain("SET status = 'aprovado', pago_em = NULL");
  });

  it("toda função nova fecha PUBLIC, anon e authenticated, e só as quatro de tela voltam para authenticated", () => {
    const criadas = [...SQL.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g)].map(
      (m) => m[1],
    );
    expect(criadas.sort()).toEqual(
      [
        "_contexto_conta_pagar",
        "anexar_arquivo_conta_pagar",
        "estornar_conta_pagar",
        "pagar_conta_pagar",
        "remover_anexo_conta_pagar",
        "tg_contas_pagar_anexos_historico",
        "tg_contas_pagar_historico",
      ].sort(),
    );
    for (const f of criadas) {
      expect(SQL, f).toMatch(
        new RegExp(
          `REVOKE ALL ON FUNCTION public\\.${f}\\([^)]*\\) FROM PUBLIC, anon, authenticated;`,
        ),
      );
    }
    const devolvidas = [
      ...SQL.matchAll(
        /GRANT EXECUTE ON FUNCTION public\.(\w+)\([^)]*\) TO authenticated, service_role;/g,
      ),
    ].map((m) => m[1]);
    expect(devolvidas.sort()).toEqual(
      [
        "anexar_arquivo_conta_pagar",
        "estornar_conta_pagar",
        "pagar_conta_pagar",
        "remover_anexo_conta_pagar",
      ].sort(),
    );
    // A migração confere antes do COMMIT, porque o REVOKE não reclama quando não surte efeito.
    expect(SQL).toContain("has_function_privilege('anon', v_fn::regprocedure, 'EXECUTE')");
  });

  it("tabelas novas: só leitura pela API, para quem vê o financeiro", () => {
    for (const t of ["contas_pagar_historico", "contas_pagar_anexos"]) {
      expect(SQL).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
      expect(SQL).toContain(`REVOKE ALL ON TABLE public.${t} FROM PUBLIC, anon, authenticated;`);
      expect(SQL).toContain(`GRANT SELECT ON TABLE public.${t} TO authenticated;`);
      expect(SQL).not.toMatch(
        new RegExp(`GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*ON TABLE public\\.${t} TO authenticated`),
      );
    }
  });

  it("bucket privado com o mesmo limite e os mesmos tipos da tela", () => {
    const m = SQL.match(
      /VALUES \('contas-pagar-anexos', 'contas-pagar-anexos', false, (\d+),\s*ARRAY\[([^\]]+)\]\)/,
    );
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(LIMITE_DO_ANEXO_EM_BYTES);
    const tipos = [...m![2].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
    expect(tipos).toEqual(Object.keys(EXTENSAO_DO_TIPO).sort());
    expect(BUCKET_DE_ANEXOS).toBe("contas-pagar-anexos");
    // Ver: quem vê o financeiro. Apagar: só admin. Sem UPDATE: arquivo não se sobrescreve.
    expect(SQL).toMatch(
      /FOR SELECT TO authenticated\s+USING \(bucket_id = 'contas-pagar-anexos'[\s\S]*?can_see_financials/,
    );
    expect(SQL).toMatch(
      /"contas a pagar: so o admin apaga o anexo" ON storage\.objects\s+FOR DELETE TO authenticated\s+USING \(bucket_id = 'contas-pagar-anexos'\s+AND public\.has_role\(\(SELECT auth\.uid\(\)\), 'admin'::public\.app_role\)\);/,
    );
    expect(SQL).not.toMatch(/FOR UPDATE TO authenticated/);
  });

  it("não mexe em fluxo, saldo, compromissos nem nas policies que já existem", () => {
    for (const intocavel of [
      "vw_fluxo_caixa",
      "saldo_contas_bancarias",
      "vw_saldo_conta",
      "baixar_parcela_compromisso",
      "quitar_parcelas_ate",
      "gerar_parcelas_compromisso",
      "anexar_comprovante_parcela",
      "compromissos_financeiros",
      "tg_reembolso_pago_com_a_conta",
    ]) {
      expect(SQL, intocavel).not.toContain(intocavel);
    }
    expect(SQL).not.toMatch(
      /CREATE (OR REPLACE )?VIEW|ALTER POLICY|DROP VIEW|DROP FUNCTION|DROP TABLE/i,
    );
    // DROP POLICY só para as policies que esta migração cria (reaplicar não pode duplicar).
    const derrubadas = [...SQL.matchAll(/DROP POLICY IF EXISTS "([^"]+)"/g)].map((m) => m[1]);
    const criadas = [...SQL.matchAll(/CREATE POLICY "([^"]+)"/g)].map((m) => m[1]);
    expect(derrubadas.sort()).toEqual(criadas.sort());
    // O único ALTER em tabela que já existe: o DEFAULT de quem criou.
    expect(
      [...SQL.matchAll(/ALTER TABLE public\.(\w+) (?!ENABLE ROW LEVEL SECURITY)([^;]+);/g)].map(
        (m) => `${m[1]} ${m[2]}`,
      ),
    ).toEqual(["contas_pagar ALTER COLUMN created_by SET DEFAULT auth.uid()"]);
  });
});

describe("tela: pagar só depois de confirmar; estornar e remover só para admin", () => {
  it("o botão Pagar da lista só abre o diálogo; a gravação não está na tela", () => {
    expect(TELA).toContain("onClick={() => setPagando(c)}");
    expect(TELA).not.toMatch(/pagar\.mutate\(|pagar_conta_pagar|\.update\(\{ status: "paga"/);
  });

  it("o diálogo grava num lugar só: o botão de confirmar", () => {
    expect(DIALOGO_PAGAR.match(/confirmar\.mutate\(/g)).toHaveLength(1);
    expect(DIALOGO_PAGAR).toContain("onClick={() => confirmar.mutate()}");
    expect(DIALOGO_PAGAR).toContain("max={hoje}");
  });

  it("o gancho confere o papel admin antes de estornar e de remover anexo", () => {
    for (const [funcao, rpc] of [
      ["useEstornarConta", "estornar_conta_pagar"],
      ["useRemoverAnexo", "remover_anexo_conta_pagar"],
    ]) {
      const ini = GANCHO.indexOf(`export function ${funcao}(`);
      const trecho = GANCHO.slice(ini, GANCHO.indexOf("\n}\n", ini));
      expect(trecho, funcao).toContain('hasRole("admin")');
      expect(trecho, funcao).toContain("if (!admin) throw");
      expect(trecho, funcao).toContain(`"${rpc}"`);
    }
  });

  it("o caminho de antes da migração também usa a data informada e a conta bancária", () => {
    const ini = GANCHO.indexOf("export function usePagarConta(");
    const trecho = GANCHO.slice(ini, GANCHO.indexOf("\n}\n", ini));
    expect(trecho).toContain("data_pagamento: p.dataPagamento");
    expect(trecho).toContain("data: p.dataPagamento");
    expect(trecho).toContain("conta_id: p.contaBancariaId");
    expect(trecho).toContain('.neq("status", "paga")');
    expect(trecho).not.toMatch(/hoje|new Date/);
  });

  it("arquivo sobe sem sobrescrever, no bucket privado, e só com chave de pagamento", () => {
    expect(GANCHO).toContain(".from(BUCKET_DE_ANEXOS)");
    expect(GANCHO).toContain("upsert: false");
    expect(GANCHO).toMatch(/if \(!podeAnexar\) \{\s*return \{ enviados: 0/);
  });
});
