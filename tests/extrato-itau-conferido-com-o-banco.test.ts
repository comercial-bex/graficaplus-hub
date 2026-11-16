import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  REGRA_LINHA_DE_SALDO,
  ehLinhaDeSaldo,
  jaConferida,
  lerExtrato,
  lerExtratoSemSaldos,
} from "@/lib/extrato";

// Extrato do Itaú conferido com o OFX do banco (16/11/2026): o card "Saldo em conta" mostrava
// R$ 28.009,06; o banco, R$ 385,83. 27 linhas de saldo entraram como crédito, 10 créditos repetidos,
// faltavam débitos até 29/10 e tudo depois. A migração 20261116230000 corrige os dados (com cópia de
// tudo em correcoes_de_extrato) e a importação passa a ignorar linha de saldo e período já conferido.
const RAIZ = join(__dirname, "..");
const ler = (c: string) => readFileSync(join(RAIZ, c), "utf8");
const MIGRACAO = ler("supabase/migrations/20261116230000_extrato_itau_conferido_com_o_banco.sql");
const ANTERIOR = ler("supabase/migrations/20260905012532_f91910da-d0ef-45d3-8415-c4173a9ebb2e.sql");
const ENSAIO = ler("docs/ensaio-extrato-itau-conferido.sql");
const TELA = ler("src/routes/_authenticated/contas-bancarias.tsx");

const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");
const corpoDe = (sql: string) => {
  const m = sql.match(
    /CREATE OR REPLACE FUNCTION public\.importar_extrato\(p_conta_id uuid, p_linhas jsonb\)[\s\S]*?AS \$function\$([\s\S]*?)\$function\$/,
  );
  expect(m).not.toBeNull();
  return m![1];
};
const doBeginAoCommit = (sql: string) =>
  sql.slice(sql.indexOf("\nBEGIN;\n"), sql.indexOf("\nCOMMIT;\n"));

/** Um OFX no formato do Itaú: o saldo de cada dia vem como STMTTRN de crédito. */
const OFX = `OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260817100000[-03:EST]<TRNAMT>0.00<FITID>20260817001<MEMO>SALDO ANTERIOR</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260908100000[-03:EST]<TRNAMT>148.00<FITID>20260908001<MEMO>PIX TRANSF MAX WIL08/09</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260908100000[-03:EST]<TRNAMT>148.00<FITID>20260908002<MEMO>SALDO TOTAL DISPONÍVEL DIA</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260916100000[-03:EST]<TRNAMT>-1000.00<FITID>20260916002<MEMO>PIX ENVIADO YVENS FRANCI</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261117100000[-03:EST]<TRNAMT>21.20<FITID>20261117001<MEMO>REDE ELO DB0108719065</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261117100000[-03:EST]<TRNAMT>-830.80<FITID>20261117002<MEMO>SALDO TOTAL DISPONÍVEL DIA</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

describe("leitor do extrato: linha de saldo não é lançamento", () => {
  it("reconhece as linhas de saldo do banco e só elas", () => {
    for (const s of [
      "SALDO TOTAL DISPONÍVEL DIA",
      "SALDO ANTERIOR",
      "saldo do dia",
      "  SDO CTA/APL AUTOMATICAS",
      "SALDO",
    ]) {
      expect(ehLinhaDeSaldo(s), s).toBe(true);
    }
    for (const s of [
      "PIX ENVIADO YVENS FRANCI",
      "REND PAGO APLIC AUT MAIS",
      "SALDOS DE CONVENIO",
      "PAGAMENTO SALDO DEVEDOR OS 212",
      "SISPAG PIX QR-CODE",
    ]) {
      expect(ehLinhaDeSaldo(s), s).toBe(false);
    }
  });

  it("o OFX do Itaú sai sem as linhas de saldo, contando quantas ficaram de fora", () => {
    const { linhas, saldosIgnorados } = lerExtratoSemSaldos("extrato.ofx", OFX);
    // SALDO ANTERIOR tem valor 0 e já caía antes; as 2 de SALDO TOTAL agora também caem.
    expect(saldosIgnorados).toBe(2);
    expect(linhas.map((l) => [l.data, l.tipo, l.valor, l.fitid])).toEqual([
      ["2026-09-08", "credito", 148, "20260908001"],
      ["2026-09-16", "debito", 1000, "20260916002"],
      ["2026-11-17", "credito", 21.2, "20261117001"],
    ]);
    expect(lerExtrato("extrato.ofx", OFX)).toEqual(linhas);
  });

  it("CSV com a linha de saldo também sai sem ela", () => {
    const csv =
      "Data;Descrição;Valor\n08/09/2026;PIX RECEBIDO;148,00\n08/09/2026;SALDO DO DIA;148,00\n";
    const r = lerExtratoSemSaldos("extrato.csv", csv);
    expect(r.saldosIgnorados).toBe(1);
    expect(r.linhas).toHaveLength(1);
  });

  it("a regra da tela é a mesma do banco", () => {
    expect(REGRA_LINHA_DE_SALDO.source).toBe("^\\s*(saldo|sdo)(\\s|$)");
    expect(REGRA_LINHA_DE_SALDO.flags).toContain("i");
    expect(corpoDe(MIGRACAO)).toContain("IF v_desc ~* '^\\s*(saldo|sdo)(\\s|$)' THEN");
  });

  it("linha até o dia conferido com o banco fica de fora; sem data conferida, nada fica", () => {
    const l = { data: "2026-11-16", descricao: "PIX", valor: 1, tipo: "credito" as const };
    expect(jaConferida(l, "2026-11-16")).toBe(true);
    expect(jaConferida({ ...l, data: "2026-11-17" }, "2026-11-16")).toBe(false);
    expect(jaConferida(l, null)).toBe(false);
    expect(jaConferida(l, undefined)).toBe(false);
  });
});

describe("migração 20261116230000: os dados do Itaú batem com o banco", () => {
  it("o md5 do corpo de importar_extrato é o retrato anotado; a guarda é a definição de 05/09", () => {
    expect(md5(corpoDe(MIGRACAO))).toBe("6f2880eddae8a07775fa9680162f92b9");
    expect(MIGRACAO).toContain("importar_extrato(uuid, jsonb) = 6f2880eddae8a07775fa9680162f92b9");
    expect(md5(corpoDe(ANTERIOR))).toBe("aad0d901efe9b8f15312c8d62bdcc9fe");
    expect(MIGRACAO).toContain("IS DISTINCT FROM 'aad0d901efe9b8f15312c8d62bdcc9fe'");
  });

  it("a função nova só acrescenta: mesma chave, mesmo hash de duplicidade, mesma gravação", () => {
    const nova = corpoDe(MIGRACAO);
    const velha = corpoDe(ANTERIOR);
    expect(nova).toContain("v_uid := public.require_permission('pagamentos.confirm');");
    for (const trecho of [
      "v_hash := md5(p_conta_id::text || '|' || v_data::text || '|' || v_valor::text || '|'",
      "AND (t.hash_dedup = v_hash OR (v_fitid IS NOT NULL AND t.fitid = v_fitid))",
      "'extrato', v_desc, 'banco', v_valor, v_data, true, p_conta_id, v_uid,",
      "'saldo_atual', (SELECT saldo_atual FROM public.vw_saldo_conta WHERE conta_id = p_conta_id)",
    ]) {
      expect(velha, trecho).toContain(trecho);
      expect(nova, trecho).toContain(trecho);
    }
    // O período conferido vem da conta e vale antes da busca de duplicidade.
    expect(nova).toContain("IF v_conferido IS NOT NULL AND v_data <= v_conferido THEN");
    expect(nova.indexOf("v_data <= v_conferido")).toBeLessThan(nova.indexOf("v_hash := md5("));
    expect(nova).toMatch(/'saldos_ignorados', v_saldos,\s+'ja_conferidas', v_ja_conferidas,/);
  });

  it("anon não executa; a cópia de segurança só o admin lê e ninguém grava pela tela", () => {
    expect(MIGRACAO).toContain(
      "REVOKE ALL ON FUNCTION public.importar_extrato(uuid, jsonb) FROM PUBLIC, anon;",
    );
    expect(MIGRACAO).toContain(
      "GRANT EXECUTE ON FUNCTION public.importar_extrato(uuid, jsonb) TO authenticated, service_role;",
    );
    expect(MIGRACAO).toContain(
      "has_function_privilege('anon', 'public.importar_extrato(uuid, jsonb)'::regprocedure, 'EXECUTE')",
    );
    expect(MIGRACAO).toContain(
      "ALTER TABLE public.correcoes_de_extrato ENABLE ROW LEVEL SECURITY;",
    );
    expect(MIGRACAO).toContain(
      "REVOKE ALL ON TABLE public.correcoes_de_extrato FROM PUBLIC, anon, authenticated;",
    );
    expect(MIGRACAO).toContain(
      "GRANT SELECT ON TABLE public.correcoes_de_extrato TO authenticated;",
    );
    expect(MIGRACAO).toContain(
      "USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));",
    );
    expect(MIGRACAO).not.toMatch(
      /GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*correcoes_de_extrato TO authenticated/,
    );
  });

  it("antes de apagar, tudo vai para a cópia; o que sai é só do Itaú", () => {
    const corpo = doBeginAoCommit(MIGRACAO);
    const copia = corpo.indexOf("'apagada', 'banco_transacoes'");
    expect(copia).toBeGreaterThan(0);
    expect(copia).toBeLessThan(corpo.indexOf("DELETE FROM public.banco_transacoes"));
    expect(corpo.indexOf("'apagada', 'caixa_movimentos'")).toBeLessThan(
      corpo.indexOf("DELETE FROM public.caixa_movimentos"),
    );
    // Os dois DELETE só alcançam a lista separada e conferida (27 saldos e 10 cópias do Itaú).
    expect(corpo.match(/DELETE FROM/g)).toHaveLength(2);
    expect(corpo).toContain(
      "DELETE FROM public.banco_transacoes WHERE id IN (SELECT id FROM _apagar);",
    );
    expect(corpo).toContain(
      "DELETE FROM public.caixa_movimentos WHERE id IN (SELECT caixa_movimento_id FROM _apagar);",
    );
    expect(corpo).toContain(
      "IF v_saldos <> 27 OR v_soma_saldos <> 23043.30 OR v_copias <> 10 OR v_soma_copias <> 543.03 THEN",
    );
    // Nada de contas a pagar, compromissos, reembolsos nem pagamentos.
    expect(corpo).not.toMatch(
      /(UPDATE|DELETE FROM|INSERT INTO) public\.(contas_pagar|compromissos_financeiros|reembolsos|pagamentos)\b/,
    );
    // "ON COMMIT DROP" das tabelas temporárias não conta: nada do banco é derrubado.
    expect(corpo).not.toMatch(
      /\bDROP\s+(TABLE|FUNCTION|VIEW|POLICY|COLUMN|INDEX|TRIGGER)\b|TRUNCATE/,
    );
  });

  it("os 41 lançamentos e os 38 dias do arquivo do banco somam R$ 385,82", () => {
    const novas = [
      ...MIGRACAO.matchAll(/^ {2}\('([^']+)', DATE '(\d{4}-\d{2}-\d{2})', (-?\d+\.\d{2}), '/gm),
    ];
    expect(novas).toHaveLength(41);
    expect(new Set(novas.map((m) => m[1])).size).toBe(41);
    const centavos = (s: string) => Math.round(Number(s) * 100);
    expect(novas.reduce((a, m) => a + centavos(m[3]), 0)).toBe(-432591);
    const dias = [
      ...MIGRACAO.matchAll(/^ {2}\(DATE '(\d{4}-\d{2}-\d{2})', (\d+\.\d{2}), (\d+\.\d{2})\)/gm),
    ];
    expect(dias).toHaveLength(38);
    // Saldo inicial do arquivo (R$ 0,00 em 17/08) + créditos − débitos = o que o card passa a mostrar.
    expect(dias.reduce((a, m) => a + centavos(m[2]) - centavos(m[3]), 0)).toBe(38582);
    expect(MIGRACAO).toContain("SET saldo_inicial = 0, saldo_inicial_data = DATE '2026-08-17',");
    expect(MIGRACAO).toContain("IF v_n <> 95 OR v_saldo <> 385.82 OR v_view <> 385.82 THEN");
  });

  it("o ensaio guardado roda exatamente o corpo da migração", () => {
    const corpo = MIGRACAO.slice(
      MIGRACAO.indexOf("\nBEGIN;\n") + "\nBEGIN;\n".length,
      MIGRACAO.indexOf("\nCOMMIT;\n"),
    );
    expect(ENSAIO).toContain(corpo);
    expect(ENSAIO).toMatch(/RAISE EXCEPTION 'ENSAIO EXTRATO OK \(nada gravado\)/);
    expect(ENSAIO).not.toMatch(/^COMMIT;/m);
  });
});

describe("tela Contas bancárias", () => {
  it("lê o arquivo sem as linhas de saldo e mostra o que fica de fora", () => {
    expect(TELA).toContain("lerExtratoSemSaldos(file.name, texto)");
    expect(TELA).not.toMatch(/\blerExtrato\(/);
    expect(TELA).toContain("linha(s) de saldo do banco fora");
    expect(TELA).toContain("jaConferida(l, conferidaAte)");
    expect(TELA).toContain('.select("id, extrato_conferido_ate")');
  });

  it("não promete mais que reenviar o extrato é sem risco", () => {
    expect(TELA).not.toContain("sem medo de duplicar o saldo");
    expect(TELA).toContain("r.saldos_ignorados");
    expect(TELA).toContain("r.ja_conferidas");
  });
});
