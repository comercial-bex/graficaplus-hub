import { describe, expect, it } from "vitest";
import {
  REFAZER_AO_VOLTAR_DEPOIS_DE_MS,
  RELER_PERMISSOES_A_CADA_MS,
  VALIDADE_DO_ACESSO_GUARDADO_MS,
  lerAcessoGuardado,
  refazerAoVoltar,
  relerPermissoesAoVoltar,
  sessaoSalvaNoAparelho,
  textoDoAcessoGuardado,
  trocouDeConta,
  type AcessoGuardado,
} from "@/domain/acesso/sessao";

function armazenamento(itens: Record<string, string>) {
  const chaves = Object.keys(itens);
  return {
    length: chaves.length,
    key: (i: number) => chaves[i] ?? null,
    getItem: (k: string) => itens[k] ?? null,
  };
}

describe("sessaoSalvaNoAparelho: a sessão que a biblioteca guardou", () => {
  const sessao = { access_token: "a", refresh_token: "r", expires_at: 1, user: { id: "pessoa-a", email: "a@b.c" } };

  it("acha a sessão na chave sb-<projeto>-auth-token", () => {
    const s = sessaoSalvaNoAparelho(
      armazenamento({
        "bexprint:acesso:v1": "{}",
        "sb-xzllbjbcdhkjrsiiytvn-auth-token-code-verifier": "x",
        "sb-xzllbjbcdhkjrsiiytvn-auth-token": JSON.stringify(sessao),
      }),
    );
    expect(s?.userId).toBe("pessoa-a");
    expect(s?.user.email).toBe("a@b.c");
  });

  it("sem refresh_token ou sem usuário não serve", () => {
    expect(sessaoSalvaNoAparelho(armazenamento({ "sb-abc-auth-token": JSON.stringify({ ...sessao, refresh_token: "" }) }))).toBeNull();
    expect(sessaoSalvaNoAparelho(armazenamento({ "sb-abc-auth-token": JSON.stringify({ ...sessao, user: null }) }))).toBeNull();
  });

  it("texto estragado ou aparelho vazio: espera a biblioteca", () => {
    expect(sessaoSalvaNoAparelho(armazenamento({ "sb-abc-auth-token": "{quebrado" }))).toBeNull();
    expect(sessaoSalvaNoAparelho(armazenamento({}))).toBeNull();
  });
});

/**
 * Medido no painel em 07/10/2026, antes desta regra: 59 chamadas ao banco a
 * cada volta à aba e papéis/permissões lidos 3 vezes cada na abertura. A
 * biblioteca de login avisa "SIGNED_IN" a cada volta e "TOKEN_REFRESHED" a
 * cada hora; nenhum dos dois troca a pessoa logada.
 */
describe("trocouDeConta: só a troca de pessoa recarrega a tela", () => {
  it("a primeira leitura da sessão não é troca", () => {
    expect(trocouDeConta(undefined, "pessoa-a")).toBe(false);
    expect(trocouDeConta(undefined, null)).toBe(false);
  });

  it("a mesma pessoa de novo (aba que voltou, token renovado) não é troca", () => {
    expect(trocouDeConta("pessoa-a", "pessoa-a")).toBe(false);
    expect(trocouDeConta(null, null)).toBe(false);
  });

  it("entrar, sair e entrar com outra conta são trocas", () => {
    expect(trocouDeConta(null, "pessoa-a")).toBe(true);
    expect(trocouDeConta("pessoa-a", null)).toBe(true);
    expect(trocouDeConta("pessoa-a", "pessoa-b")).toBe(true);
  });

  it("a sequência real de uma manhã refaz tudo só no login e na saída", () => {
    // abertura sem sessão → login → volta à aba 3× → token renovado → saída
    const avisos: (string | null)[] = [null, "pessoa-a", "pessoa-a", "pessoa-a", "pessoa-a", "pessoa-a", null];
    let dono: string | null | undefined = undefined;
    let recargas = 0;
    for (const atual of avisos) {
      if (trocouDeConta(dono, atual)) recargas += 1;
      dono = atual;
    }
    expect(recargas).toBe(2);
  });
});

describe("refazerAoVoltar: dado de menos de um minuto não é relido", () => {
  const agora = 1_800_000_000_000;

  it("lido há 10 segundos: não refaz", () => {
    expect(refazerAoVoltar(agora - 10_000, agora)).toBe(false);
  });

  it("lido há mais de um minuto: refaz", () => {
    expect(refazerAoVoltar(agora - REFAZER_AO_VOLTAR_DEPOIS_DE_MS - 1, agora)).toBe(true);
  });

  it("nunca carregou (dataUpdatedAt 0): refaz", () => {
    expect(refazerAoVoltar(0, agora)).toBe(true);
  });
});

describe("relerPermissoesAoVoltar: no máximo uma leitura por minuto", () => {
  const agora = 1_800_000_000_000;
  it("acabou de ler: não relê", () => {
    expect(relerPermissoesAoVoltar(agora - 5_000, agora)).toBe(false);
  });
  it("passou um minuto: relê", () => {
    expect(relerPermissoesAoVoltar(agora - RELER_PERMISSOES_A_CADA_MS, agora)).toBe(true);
  });
});

describe("lerAcessoGuardado: a cópia do aparelho só vale para a mesma pessoa e por 7 dias", () => {
  const agora = 1_800_000_000_000;
  const bom: AcessoGuardado = {
    donoId: "pessoa-a",
    papeis: ["vendedor"],
    efetivas: ["orcamentos.read", "orcamentos.create"],
    guardadoEmMs: agora - 60_000,
  };
  const texto = (a: unknown) => JSON.stringify(a);

  it("lê a cópia boa da mesma pessoa", () => {
    expect(lerAcessoGuardado(textoDoAcessoGuardado(bom), "pessoa-a", agora)).toEqual(bom);
  });

  it("cópia de outra pessoa não vale (aparelho compartilhado)", () => {
    expect(lerAcessoGuardado(textoDoAcessoGuardado(bom), "pessoa-b", agora)).toBeNull();
  });

  it("cópia com mais de 7 dias não vale", () => {
    const velho = { ...bom, guardadoEmMs: agora - VALIDADE_DO_ACESSO_GUARDADO_MS - 1 };
    expect(lerAcessoGuardado(texto(velho), "pessoa-a", agora)).toBeNull();
  });

  it("cópia sem papel nenhum não vale: 'Aguardando liberação' vem do banco", () => {
    expect(lerAcessoGuardado(texto({ ...bom, papeis: [] }), "pessoa-a", agora)).toBeNull();
  });

  it("efetivas null é aceita (a função do banco não respondeu na última vez)", () => {
    expect(lerAcessoGuardado(texto({ ...bom, efetivas: null }), "pessoa-a", agora)?.efetivas).toBeNull();
  });

  it("texto estragado, vazio ou com tipo errado não derruba nada", () => {
    expect(lerAcessoGuardado(null, "pessoa-a", agora)).toBeNull();
    expect(lerAcessoGuardado("{quebrado", "pessoa-a", agora)).toBeNull();
    expect(lerAcessoGuardado(texto({ ...bom, papeis: "admin" }), "pessoa-a", agora)).toBeNull();
    expect(lerAcessoGuardado(texto({ ...bom, efetivas: [1, 2] }), "pessoa-a", agora)).toBeNull();
    expect(lerAcessoGuardado(texto({ ...bom, guardadoEmMs: "ontem" }), "pessoa-a", agora)).toBeNull();
  });

  it("data no futuro (relógio do aparelho adiantado) não vale", () => {
    expect(lerAcessoGuardado(texto({ ...bom, guardadoEmMs: agora + 3_600_000 }), "pessoa-a", agora)).toBeNull();
  });
});
