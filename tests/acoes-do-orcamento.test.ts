import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MENSAGEM_APAGAR_BLOQUEADO,
  MENSAGEM_FUNCAO_AUSENTE,
  acoesDoOrcamento,
  codigoDoErro,
  funcaoAusente,
  mensagemDaExclusao,
  mensagemDaFuncao,
  rotuloDoStatus,
} from "../src/domain/orcamentos/acoes-do-orcamento";
import { ROTULO_DO_STATUS } from "../src/components/orcamento/tela/comum";

const ler = (c: string) => readFileSync(c, "utf8");
const AGORA = new Date("2026-11-17T12:00:00-03:00");
const dias = (n: number) => new Date(AGORA.getTime() + n * 86_400_000).toISOString();
const TUDO = { aprovar: true, alterar: true, renovar: true, apagar: true };
const NADA = { aprovar: false, alterar: false, renovar: false, apagar: false };
const base = { valor_total: 100, enviado_em: dias(-2), validade_dias: 15, os_id: null };

describe("quais botões aparecem", () => {
  it("enviado dentro da validade: aprovar, recusar e expirar; renovar e apagar não", () => {
    expect(acoesDoOrcamento({ ...base, status: "enviado" }, TUDO, AGORA)).toEqual({
      aprovar: true, recusar: true, expirar: true, renovar: false, apagar: false,
    });
  });

  it("enviado vencido também oferece renovar", () => {
    const a = acoesDoOrcamento({ ...base, status: "enviado", enviado_em: dias(-30) }, TUDO, AGORA);
    expect(a.renovar).toBe(true);
  });

  it("expirado só renova; rascunho só apaga; recusado e aprovado não têm botão", () => {
    expect(acoesDoOrcamento({ ...base, status: "expirado" }, TUDO, AGORA)).toEqual({
      aprovar: false, recusar: false, expirar: false, renovar: true, apagar: false,
    });
    expect(acoesDoOrcamento({ ...base, status: "rascunho" }, TUDO, AGORA)).toEqual({
      aprovar: false, recusar: false, expirar: false, renovar: false, apagar: true,
    });
    for (const status of ["rejeitado", "aprovado"]) {
      expect(Object.values(acoesDoOrcamento({ ...base, status }, TUDO, AGORA)).some(Boolean), status).toBe(false);
    }
  });

  it("com OS ou convertido nada aparece, mesmo com todas as permissões", () => {
    for (const o of [{ ...base, status: "convertido" }, { ...base, status: "enviado", os_id: "x" }, { ...base, status: "rascunho", os_id: "x" }]) {
      expect(Object.values(acoesDoOrcamento(o, TUDO, AGORA)).some(Boolean)).toBe(false);
    }
  });

  it("sem permissão não aparece botão", () => {
    for (const status of ["rascunho", "enviado", "expirado"]) {
      expect(Object.values(acoesDoOrcamento({ ...base, status, enviado_em: dias(-30) }, NADA, AGORA)).some(Boolean), status).toBe(false);
    }
  });

  it("status desconhecido não oferece botão e o rótulo não some", () => {
    expect(Object.values(acoesDoOrcamento({ ...base, status: "cancelado" }, TUDO, AGORA)).some(Boolean)).toBe(false);
    expect(rotuloDoStatus(ROTULO_DO_STATUS, "cancelado")).toBe("cancelado");
    expect(rotuloDoStatus(ROTULO_DO_STATUS, "rejeitado")).toBe("Recusado");
    expect(rotuloDoStatus(ROTULO_DO_STATUS, null)).toBe("Situação não reconhecida");
  });
});

describe("tradução dos erros do banco", () => {
  it("função ausente é reconhecida pelos dois códigos e pelo texto", () => {
    expect(funcaoAusente({ code: "42883", message: "x" })).toBe(true);
    expect(funcaoAusente({ code: "PGRST202", message: "x" })).toBe(true);
    expect(funcaoAusente({ message: "Could not find the function public.aprovar_orcamento" })).toBe(true);
    expect(funcaoAusente({ code: "42501", message: "permission denied" })).toBe(false);
    expect(funcaoAusente(null)).toBe(false);
  });

  it("função ausente vira a mensagem simples, e o código de máquina nunca vai para a tela", () => {
    expect(mensagemDaFuncao({ code: "PGRST202", message: "Could not find the function" }, "padrão")).toBe(MENSAGEM_FUNCAO_AUSENTE);
    const erro = { code: "P0001", message: "Este orçamento já virou ordem de serviço e não pode ser renovado.", details: "tem_os" };
    expect(mensagemDaFuncao(erro, "padrão")).toBe("Este orçamento já virou ordem de serviço e não pode ser renovado.");
    expect(codigoDoErro(erro)).toBe("tem_os");
    expect(mensagemDaFuncao({ message: "Permissão necessária: orcamentos.approve" }, "padrão")).toBe("Permissão necessária: orcamentos.approve");
    expect(mensagemDaFuncao({ message: "boom in english" }, "Não foi possível aprovar.")).toBe("Não foi possível aprovar.");
  });

  it("a exclusão barrada pelo gatilho mostra o texto do banco; outra trava vira o texto neutro", () => {
    const texto = "Este orçamento não pode ser apagado: ele já foi enviado ao cliente. Fale com o gestor.";
    expect(mensagemDaExclusao({ code: "23001", message: texto })).toBe(texto);
    expect(mensagemDaExclusao({ code: "23001", message: "restrict_violation" })).toBe(MENSAGEM_APAGAR_BLOQUEADO);
    expect(mensagemDaExclusao({ code: "23503", message: "violates foreign key" })).toBe(MENSAGEM_APAGAR_BLOQUEADO);
    expect(MENSAGEM_APAGAR_BLOQUEADO).toContain("Fale com o gestor");
    expect(mensagemDaExclusao({ code: "42883", message: "x" })).toBe(MENSAGEM_FUNCAO_AUSENTE);
  });
});

describe("a tela dos passos do status", () => {
  const tela = ler("src/components/orcamento/acoes-do-status.tsx");
  const rota = ler("src/routes/_authenticated/orcamentos.$id.tsx");

  it("a rota troca o Select por AcoesDoStatus e não grava mais status por conta própria", () => {
    expect(rota).toContain("<AcoesDoStatus orc={orc} podeAlterar={podeEditar} />");
    expect(rota).not.toContain("<Select ");
    expect(rota).not.toContain("async function setStatus");
    expect(rota).not.toMatch(/update\(update\)/);
  });

  it("aprovar e renovar chamam as funções do banco, com permissão", () => {
    expect(tela).toContain('(supabase.rpc as any)("aprovar_orcamento"');
    expect(tela).toContain("(supabase.rpc as any)(FUNCAO_DE_RENOVACAO");
    expect(tela).toContain('hasPermission("orcamentos.approve")');
    expect(tela).toContain('hasPermission("orcamentos.create") && hasPermission("orcamentos.send")');
  });

  it("recusar e expirar só partem de enviado, conferem a contagem e mostram o erro", () => {
    const corpo = tela.slice(tela.indexOf("const mudarDeEnviadoPara"), tela.indexOf("const apagar"));
    expect(corpo).toContain('.eq("status", "enviado")');
    expect(corpo).toContain('.select("id")');
    expect(corpo).toContain("data.length === 0");
    expect(corpo).toContain("MENSAGEM_PERFIL_NAO_ALTERA");
  });

  it("apagar só em rascunho, para admin e gestor, e confere a contagem", () => {
    expect(tela).toContain('hasRole("admin") || hasRole("gestor")');
    const corpo = tela.slice(tela.indexOf("const apagar"), tela.indexOf("const botao"));
    expect(corpo).toContain('.eq("status", "rascunho")');
    expect(corpo).toContain("mensagemDaExclusao(error)");
    expect(corpo).toContain("MENSAGEM_PERFIL_NAO_APAGA");
  });

  it("toda ação que muda estado passa por ConfirmarAcao, a de apagar é destrutiva, e há letra de 16 px", () => {
    expect(tela.match(/<ConfirmarAcao/g)).toHaveLength(5);
    expect(tela).toMatch(/destrutivo\n\s+titulo="Apagar este rascunho\?"/);
    expect(tela).toContain("grande");
    expect(tela).toContain("registra a aprovação do cliente");
    expect(tela).toContain("O cliente pode receber um aviso");
  });

  it("função ausente nunca cai em UPDATE direto de status", () => {
    const aprovar = tela.slice(tela.indexOf("const aprovar"), tela.indexOf("const mudarDeEnviadoPara"));
    expect(aprovar).not.toContain(".update(");
    expect(aprovar).toContain("mensagemDaFuncao");
  });

  it("textos de tela sem travessão, seta nem parênteses", () => {
    const textos = [...tela.matchAll(/(?:titulo|descricao|rotuloConfirmar)="([^"]+)"/g)].map((m) => m[1]);
    expect(textos.length).toBeGreaterThan(8);
    for (const t of textos) expect(t, t).not.toMatch(/[—–→()]/);
  });
});
