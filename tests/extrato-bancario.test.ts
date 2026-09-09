import { describe, expect, it } from "vitest";
import {
  dataFlexivel,
  dataOFX,
  lerExtrato,
  lerExtratoCSV,
  lerOFX,
  somarExtrato,
} from "../src/domain/financeiro/extrato";

/**
 * Extrato bancário de verdade.
 *
 * A propriedade que mais importa não é ler o arquivo — é NÃO SOMAR DUAS VEZES.
 * Extrato se reimporta o tempo todo: o usuário baixa "últimos 30 dias" toda
 * semana e as janelas se sobrepõem. Sem chave estável por lançamento, o saldo
 * sobe sozinho a cada importação.
 */

const OFX_BANCO = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<CURDEF>BRL
<BANKACCTFROM>
<BANKID>001
<BRANCHID>1234
<ACCTID>56789-0
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260901120000[-3:BRT]
<TRNAMT>1250.00
<FITID>202609010001
<MEMO>PIX RECEBIDO CLIENTE ABC
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260902093000[-3:BRT]
<TRNAMT>-380.50
<FITID>202609020007
<MEMO>PAGTO FORNECEDOR LONAS
<CHECKNUM>4417
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260903
<TRNAMT>-119.90
<FITID>202609030002
<NAME>ENERGIA ELETRICA
</STMTTRN>
</BANKTRANLIST>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`;

describe("OFX do banco", () => {
  const r = lerOFX(OFX_BANCO);

  it("lê os três lançamentos", () => {
    expect(r.formato).toBe("ofx");
    expect(r.lancamentos).toHaveLength(3);
  });

  it("identifica a conta, para não importar na conta errada", () => {
    expect(r.conta).toEqual({ banco: "001", agencia: "1234", numero: "56789-0" });
  });

  it("entende data com fuso e data curta", () => {
    expect(r.lancamentos[0].data).toBe("2026-09-01");
    expect(r.lancamentos[2].data).toBe("2026-09-03");
  });

  it("sinal do valor separa entrada de saída", () => {
    expect(r.lancamentos[0]).toMatchObject({ valor: 1250, tipo: "credito" });
    expect(r.lancamentos[1]).toMatchObject({ valor: -380.5, tipo: "debito" });
  });

  it("usa MEMO e cai em NAME quando não há MEMO", () => {
    expect(r.lancamentos[0].descricao).toBe("PIX RECEBIDO CLIENTE ABC");
    expect(r.lancamentos[2].descricao).toBe("ENERGIA ELETRICA");
  });

  it("guarda o número do documento", () => {
    expect(r.lancamentos[1].documento).toBe("4417");
  });

  it("preserva o FITID do banco — é ele que evita somar duas vezes", () => {
    expect(r.lancamentos.map((l) => l.fitid)).toEqual([
      "202609010001",
      "202609020007",
      "202609030002",
    ]);
  });

  it("REIMPORTAR o mesmo arquivo dá exatamente as mesmas chaves", () => {
    // É esta a propriedade que protege o saldo.
    const denovo = lerOFX(OFX_BANCO);
    expect(denovo.lancamentos.map((l) => l.fitid)).toEqual(r.lancamentos.map((l) => l.fitid));
  });

  it("soma bate com o que o banco mostra", () => {
    expect(somarExtrato(r.lancamentos)).toEqual({
      entradas: 1250,
      saidas: -500.4,
      liquido: 749.6,
    });
  });
});

describe("CSV de extrato", () => {
  it("lê o formato pt-BR com coluna única de valor", () => {
    const csv =
      "Data;Histórico;Valor;Documento\r\n" +
      "01/09/2026;PIX RECEBIDO;1.250,00;\r\n" +
      "02/09/2026;PAGTO FORNECEDOR;-380,50;4417\r\n";
    const r = lerExtratoCSV(csv);
    expect(r.lancamentos).toHaveLength(2);
    expect(r.lancamentos[0]).toMatchObject({ data: "2026-09-01", valor: 1250, tipo: "credito" });
    expect(r.lancamentos[1]).toMatchObject({ valor: -380.5, documento: "4417" });
  });

  it("lê extrato com colunas separadas de crédito e débito", () => {
    const csv = "data;descricao;credito;debito\n01/09/2026;Venda;500,00;\n02/09/2026;Aluguel;;1.200,00\n";
    const r = lerExtratoCSV(csv);
    expect(r.lancamentos[0].valor).toBe(500);
    // Débito informado como positivo tem que virar saída.
    expect(r.lancamentos[1].valor).toBe(-1200);
    expect(r.lancamentos[1].tipo).toBe("debito");
  });

  it("sem FITID, deriva chave estável dos dados", () => {
    const csv = "data;descricao;valor\n01/09/2026;PIX;100,00\n";
    const a = lerExtratoCSV(csv).lancamentos[0].fitid;
    const b = lerExtratoCSV(csv).lancamentos[0].fitid;
    expect(a).toBe(b);
    expect(a).toContain("2026-09-01");
  });

  it("dois lançamentos idênticos no mesmo arquivo não colidem", () => {
    // Duas compras iguais no mesmo dia existem. Se colidissem, a segunda seria
    // descartada como duplicata e o saldo ficaria maior que o do banco.
    const csv = "data;descricao;valor\n01/09/2026;CAFE;-10,00\n01/09/2026;CAFE;-10,00\n";
    const r = lerExtratoCSV(csv);
    expect(r.lancamentos).toHaveLength(2);
    expect(r.lancamentos[0].fitid).not.toBe(r.lancamentos[1].fitid);
  });

  it("respeita o FITID quando o arquivo traz um", () => {
    const csv = "fitid;data;descricao;valor\nABC123;01/09/2026;PIX;100,00\n";
    expect(lerExtratoCSV(csv).lancamentos[0].fitid).toBe("ABC123");
  });

  it("ignora linha sem data ou sem valor, e diz quais", () => {
    const csv = "data;descricao;valor\n;SEM DATA;100,00\n01/09/2026;SEM VALOR;\n01/09/2026;BOA;50,00\n";
    const r = lerExtratoCSV(csv);
    expect(r.lancamentos).toHaveLength(1);
    expect(r.ignoradas).toEqual(["SEM DATA", "SEM VALOR"]);
  });

  it("valor zero não entra", () => {
    const r = lerExtratoCSV("data;descricao;valor\n01/09/2026;MARCADOR;0,00\n");
    expect(r.lancamentos).toHaveLength(0);
  });
});

describe("escolha do leitor", () => {
  it("reconhece OFX pelo conteúdo, não pela extensão", () => {
    // Banco que entrega .txt com OFX dentro é comum.
    expect(lerExtrato(OFX_BANCO).formato).toBe("ofx");
  });
  it("cai no CSV quando não é OFX", () => {
    expect(lerExtrato("data;descricao;valor\n01/09/2026;X;1,00\n").formato).toBe("csv");
  });
});

describe("datas", () => {
  it("aceita as formas que aparecem em extrato", () => {
    expect(dataOFX("20260904120000[-3:BRT]")).toBe("2026-09-04");
    expect(dataOFX("20260904")).toBe("2026-09-04");
    expect(dataFlexivel("04/09/2026")).toBe("2026-09-04");
    expect(dataFlexivel("2026-09-04")).toBe("2026-09-04");
    expect(dataFlexivel("04-09-2026")).toBe("2026-09-04");
  });
  it("recusa data impossível em vez de inventar", () => {
    expect(dataOFX("20261304")).toBeNull();
    expect(dataFlexivel("sem data")).toBeNull();
    expect(dataFlexivel(undefined)).toBeNull();
  });
});
