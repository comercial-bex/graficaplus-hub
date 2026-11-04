import { describe, expect, it, vi } from "vitest";
import {
  ehErroDeAcesso,
  ESPERAS_DO_LIMITE_S,
  FALHAS_SEGUIDAS_QUE_PARAM,
  produtosSemFoto,
  resumoDoLote,
  rodarLote,
  type ProdutoDoLote,
} from "../src/domain/catalogo/lote-de-fotos";
import type { FotoGerada } from "../src/lib/api/produtos-foto-ia.functions";

/**
 * Revisão adversarial de 03/11/2026 sobre o lote de fotos por IA (#417): o laço só
 * parava para sem_ia, sem_saldo e limite. Com a sessão vencida ou o gateway fora do ar
 * seguia pelos 57 produtos, um aviso vermelho cada, e terminava com aviso verde.
 */

const produto = (n: number, extra: Partial<ProdutoDoLote> = {}): ProdutoDoLote => ({ id: `p${n}`, nome: `Produto ${n}`, ...extra });
const lista = (n: number) => Array.from({ length: n }, (_, i) => produto(i + 1));
const ok: FotoGerada = { estado: "ok", url: "https://x/ia/1.png", modelo: "m" };
const falhou: FotoGerada = { estado: "falhou", detalhe: "HTTP 500" };

async function rodar(
  produtos: ProdutoDoLote[],
  respostas: (id: string, chamada: number) => FotoGerada | Error,
  extra: { pararNaChamada?: number } = {},
) {
  const chamadas: string[] = [];
  const dormir = vi.fn(async () => undefined);
  const resultados: string[] = [];
  const saida = await rodarLote({
    produtos,
    gerar: async (id) => {
      chamadas.push(id);
      const r = respostas(id, chamadas.length);
      if (r instanceof Error) throw r;
      return r;
    },
    devePararAgora: () => extra.pararNaChamada !== undefined && chamadas.length >= extra.pararNaChamada,
    aoComecar: () => undefined,
    aoResultado: (p, r) => resultados.push(`${p.id}:${"erro" in r ? "erro" : r.resultado.estado}`),
    dormir,
  });
  return { saida, chamadas, resultados, dormir };
}

describe("quem entra no lote", () => {
  it("ativo, sem foto e que não é serviço: o botão diz 43, não 57", () => {
    const todos: ProdutoDoLote[] = [
      produto(1, { tipo: "produto" }),
      produto(2, { tipo: "servico" }),
      produto(3, { tipo: "produto", imagem_url: "https://x/y.png" }),
      produto(4, { tipo: "produto", ativo: false }),
      produto(5), // sem tipo informado continua entrando
      produto(6, { tipo: "produto", imagem_url: "   " }),
    ];
    expect(produtosSemFoto(todos).map((p) => p.id)).toEqual(["p1", "p5", "p6"]);
  });
});

describe("quando o lote para", () => {
  it("tudo bem: gera todas e termina em 'fim'", async () => {
    const r = await rodar(lista(5), () => ok);
    expect(r.saida).toEqual({ geradas: 5, puladas: 0, falhas: 0, motivo: "fim" });
    expect(r.chamadas).toHaveLength(5);
  });

  it("3 falhas seguidas encerram o lote (antes seguia pelos 57 produtos)", async () => {
    const r = await rodar(lista(57), () => falhou);
    expect(r.saida).toMatchObject({ geradas: 0, falhas: FALHAS_SEGUIDAS_QUE_PARAM, motivo: "falhas_seguidas" });
    expect(r.chamadas).toHaveLength(3);
  });

  it("uma foto boa no meio zera a contagem: falha, falha, ok, falha, falha, ok segue até o fim", async () => {
    const seq = [falhou, falhou, ok, falhou, falhou, ok];
    const r = await rodar(lista(6), (_id, n) => seq[n - 1]);
    expect(r.saida).toMatchObject({ geradas: 2, falhas: 4, motivo: "fim" });
    expect(r.chamadas).toHaveLength(6);
  });

  it("exceção do servidor (rede) também conta como falha seguida", async () => {
    const r = await rodar(lista(10), () => new Error("Failed to fetch"));
    expect(r.saida.motivo).toBe("falhas_seguidas");
    expect(r.chamadas).toHaveLength(3);
    expect(r.resultados.every((x) => x.endsWith(":erro"))).toBe(true);
  });

  it("erro de acesso (sessão vencida, perfil sem papel) para na primeira chamada", async () => {
    const r = await rodar(lista(10), () => new Error("Unauthorized: Invalid token"));
    expect(r.saida.motivo).toBe("acesso");
    expect(r.chamadas).toHaveLength(1);
    const r2 = await rodar(lista(10), () => new Error("Gerar foto de produto é de administrador e gerência."));
    expect(r2.saida.motivo).toBe("acesso");
    expect(r2.chamadas).toHaveLength(1);
  });

  it("sem IA e sem saldo param na hora, com o motivo certo", async () => {
    const a = await rodar(lista(10), () => ({ estado: "sem_saldo" }));
    expect(a.saida.motivo).toBe("sem_saldo");
    expect(a.chamadas).toHaveLength(1);
    const b = await rodar(lista(10), () => ({ estado: "sem_ia" }));
    expect(b.saida.motivo).toBe("sem_ia");
    expect(b.chamadas).toHaveLength(1);
  });

  it("quem já tem foto e serviço são pulados sem contar como falha nem parar o lote", async () => {
    const seq: FotoGerada[] = [{ estado: "ja_tem_foto" }, { estado: "servico" }, { estado: "ja_tem_foto" }, { estado: "servico" }, ok];
    const r = await rodar(lista(5), (_id, n) => seq[n - 1]);
    expect(r.saida).toEqual({ geradas: 1, puladas: 4, falhas: 0, motivo: "fim" });
    expect(r.chamadas).toHaveLength(5);
  });

  it("'Parar' vale antes do próximo produto", async () => {
    const r = await rodar(lista(10), () => ok, { pararNaChamada: 2 });
    expect(r.saida).toMatchObject({ geradas: 2, motivo: "pediu" });
    expect(r.chamadas).toHaveLength(2);
  });
});

describe("o limite de chamadas do gateway (429)", () => {
  it("espera e tenta o mesmo produto de novo, e o lote continua até o fim", async () => {
    // p1: limite, limite, ok; p2: ok
    const seq: FotoGerada[] = [{ estado: "limite" }, { estado: "limite" }, ok, ok];
    const r = await rodar(lista(2), (_id, n) => seq[n - 1]);
    expect(r.saida).toMatchObject({ geradas: 2, motivo: "fim" });
    expect(r.chamadas).toEqual(["p1", "p1", "p1", "p2"]);
    // 30 s + 60 s de espera, de 1 em 1 segundo
    expect(r.dormir).toHaveBeenCalledTimes(ESPERAS_DO_LIMITE_S[0] + ESPERAS_DO_LIMITE_S[1]);
  });

  it("limite que as esperas não resolvem encerra o lote com o motivo 'limite'", async () => {
    const r = await rodar(lista(5), () => ({ estado: "limite" }));
    expect(r.saida.motivo).toBe("limite");
    expect(r.chamadas).toHaveLength(1 + ESPERAS_DO_LIMITE_S.length);
  });

  it("'Parar' durante a espera encerra sem tentar de novo", async () => {
    const r = await rodar(lista(5), () => ({ estado: "limite" }), { pararNaChamada: 1 });
    expect(r.saida.motivo).toBe("pediu");
    expect(r.chamadas).toHaveLength(1);
  });
});

describe("o aviso do fim do lote", () => {
  it("verde só quando gerou foto; nunca verde para um lote que não gerou nada", () => {
    expect(resumoDoLote({ geradas: 43, puladas: 0, falhas: 0, motivo: "fim" }, 43)).toEqual({
      nivel: "sucesso",
      texto: "43 fotos geradas. Todos os produtos ativos têm foto.",
    });
    expect(resumoDoLote({ geradas: 1, puladas: 0, falhas: 0, motivo: "fim" }, 5).texto).toBe("1 foto gerada. Faltam 4.");
    expect(resumoDoLote({ geradas: 0, puladas: 0, falhas: 3, motivo: "fim" }, 3).nivel).toBe("aviso");
    expect(resumoDoLote({ geradas: 0, puladas: 3, falhas: 0, motivo: "fim" }, 3).nivel).toBe("info");
  });

  it("cada parada diz por que parou", () => {
    const base = { geradas: 2, puladas: 0, falhas: 0 };
    expect(resumoDoLote({ ...base, motivo: "falhas_seguidas" }, 10).texto).toContain("3 falhas seguidas");
    expect(resumoDoLote({ ...base, motivo: "acesso" }, 10).texto).toContain("Entre de novo");
    expect(resumoDoLote({ ...base, motivo: "sem_saldo" }, 10).texto).toContain("saldo de IA");
    expect(resumoDoLote({ ...base, motivo: "sem_ia" }, 10).texto).toContain("não está ligada");
    expect(resumoDoLote({ ...base, motivo: "limite" }, 10).texto).toContain("limite de chamadas");
    expect(resumoDoLote({ ...base, motivo: "pediu" }, 10)).toMatchObject({ nivel: "info" });
    for (const m of ["falhas_seguidas", "acesso", "sem_saldo", "sem_ia", "limite"] as const) {
      expect(resumoDoLote({ ...base, motivo: m }, 10).nivel).toBe("aviso");
    }
  });
});

describe("erro de acesso", () => {
  it("reconhece sessão, token e perfil; o resto é falha comum", () => {
    expect(ehErroDeAcesso(new Error("Unauthorized: Invalid token"))).toBe(true);
    expect(ehErroDeAcesso(new Error("Sessão inválida. Faça login novamente."))).toBe(true);
    expect(ehErroDeAcesso(new Error("Gerar foto de produto é de administrador e gerência."))).toBe(true);
    expect(ehErroDeAcesso(new Error("Não foi possível conferir o seu perfil. Tente de novo."))).toBe(true);
    expect(ehErroDeAcesso(new Error("Failed to fetch"))).toBe(false);
    expect(ehErroDeAcesso("Produto não encontrado.")).toBe(false);
    expect(ehErroDeAcesso(null)).toBe(false);
  });
});
