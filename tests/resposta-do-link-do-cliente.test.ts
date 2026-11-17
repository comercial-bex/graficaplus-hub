import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MENSAGEM_LINK_INDISPONIVEL,
  diaEmBrasilia,
  interpretarRespostaDoBanco,
  mensagemDaSituacao,
  situacaoDoLink,
  situacaoParaAPagina,
  validoAteDoLink,
} from "../src/domain/orcamentos/resposta-do-link";

const ler = (c: string) => readFileSync(c, "utf8");

describe("a resposta do banco vira texto para o cliente", () => {
  it("ok só conta com ok verdadeiro e codigo ok", () => {
    expect(interpretarRespostaDoBanco({ ok: true, codigo: "ok", status: "aprovado", orcamento_id: "x" })).toMatchObject({ ok: true, status: "aprovado" });
    expect(interpretarRespostaDoBanco({ ok: true, codigo: "outro" }).ok).toBe(false);
  });

  it("cada código do contrato tem texto próprio", () => {
    for (const codigo of ["ja_aprovado", "ja_virou_pedido", "vencido", "encerrado", "nao_liberado", "nao_encontrado", "decisao_invalida", "dados_invalidos"]) {
      const r = interpretarRespostaDoBanco({ ok: false, codigo, status: "x" });
      expect(r.ok).toBe(false);
      expect(r.codigo).toBe(codigo);
      expect(r.mensagem).not.toBe(MENSAGEM_LINK_INDISPONIVEL);
      expect(r.mensagem).not.toMatch(/[—–→()]/);
    }
  });

  it("formato inesperado falha fechado", () => {
    for (const ruim of [null, undefined, "ok", 3, [], {}, { ok: false }, { codigo: "novo_codigo_desconhecido" }]) {
      const r = interpretarRespostaDoBanco(ruim);
      expect(r.ok).toBe(false);
      expect(r.mensagem).toBe(MENSAGEM_LINK_INDISPONIVEL);
    }
  });
});

describe("situação que a página mostra", () => {
  const AGORA = new Date("2026-11-17T15:00:00Z");
  const env = (extra = {}) => ({ status: "enviado", enviado_em: "2026-11-10T15:00:00Z", validade_dias: 7, ...extra });

  it("a validade conta do envio e o último dia vale inteiro, no horário de Brasília", () => {
    expect(validoAteDoLink(env())).toBe("2026-11-17");
    expect(situacaoDoLink(env(), new Date("2026-11-18T02:59:00Z"))).toBe("aceita"); // 17/11 23:59 em Brasília
    expect(situacaoDoLink(env(), new Date("2026-11-18T03:00:00Z"))).toBe("vencido"); // 18/11 00:00 em Brasília
    expect(diaEmBrasilia(new Date("2026-11-18T02:59:00Z"))).toBe("2026-11-17");
  });

  it("na falta de enviado_em conta da criação; renovado conta do novo envio", () => {
    expect(validoAteDoLink({ created_at: "2026-11-01T12:00:00Z", validade_dias: 15 })).toBe("2026-11-16");
    expect(situacaoDoLink(env({ enviado_em: "2026-11-16T12:00:00Z" }), AGORA)).toBe("aceita");
    expect(validoAteDoLink({ validade_dias: 7 })).toBeNull();
  });

  it("cada status que não aceita resposta tem a situação certa", () => {
    expect(situacaoDoLink({ status: "rascunho" }, AGORA)).toBe("nao_liberado");
    expect(situacaoDoLink({ status: "rejeitado" }, AGORA)).toBe("recusado");
    expect(situacaoDoLink({ status: "expirado" }, AGORA)).toBe("vencido");
    expect(situacaoDoLink({ status: "aprovado" }, AGORA)).toBe("aprovado");
    expect(situacaoDoLink({ status: "convertido" }, AGORA)).toBe("ja_virou_pedido");
    expect(situacaoDoLink(env({ os_id: "x" }), AGORA)).toBe("ja_virou_pedido");
    expect(situacaoDoLink({ status: "qualquer" }, AGORA)).toBe("encerrado");
  });

  it("servidor antigo sem situacao: a página deduz do status", () => {
    expect(situacaoParaAPagina({ status: "enviado" })).toBe("aceita");
    expect(situacaoParaAPagina({ status: "aprovado" })).toBe("aprovado");
    expect(situacaoParaAPagina({ status: "convertido" })).toBe("aprovado");
    expect(situacaoParaAPagina({ status: "rejeitado" })).toBe("recusado");
    expect(situacaoParaAPagina({ status: "expirado" })).toBe("vencido");
    expect(situacaoParaAPagina({ status: "rascunho" })).toBe("nao_liberado");
    expect(situacaoParaAPagina({ status: "enviado", situacao: "vencido" })).toBe("vencido");
  });

  it("só aceita e aprovado dispensam o Card de mensagem", () => {
    expect(mensagemDaSituacao("aceita")).toBeNull();
    expect(mensagemDaSituacao("aprovado")).toBeNull();
    for (const s of ["recusado", "vencido", "nao_liberado", "ja_virou_pedido", "encerrado"] as const) {
      const m = mensagemDaSituacao(s);
      expect(m, s).not.toBeNull();
      expect(`${m!.titulo} ${m!.texto}`).not.toMatch(/[—–→()]/);
    }
  });
});

describe("a server function e a página", () => {
  const api = ler("src/lib/api/orcamento-publico.functions.ts");
  const pagina = ler("src/routes/orcamento-publico.$token.tsx");

  it("a resposta passa pela função do banco, falha fechado e não duplica a regra em TypeScript", () => {
    const corpo = api.slice(api.indexOf("export const responderOrcamentoPublico"));
    expect(corpo).toContain('"responder_orcamento_publico"');
    expect(corpo).toContain("throw new Error(MENSAGEM_LINK_INDISPONIVEL)");
    expect(corpo).not.toContain(".update(");
    expect(corpo).not.toContain('"convertido"');
    expect(corpo).not.toContain("validade_dias");
  });

  it("a página mostra o Card de mensagem e tolera servidor sem o campo situacao", () => {
    expect(pagina).toContain("situacaoParaAPagina(o)");
    expect(pagina).toContain('data-testid="link-sem-resposta"');
    expect(pagina).toContain("if (!r.ok) toast.error(r.mensagem)");
    expect(pagina).toContain("{jaRespondido && <EnviarComprovanteDoCliente token={token} />}");
  });
});
