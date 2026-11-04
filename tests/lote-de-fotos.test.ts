import { describe, expect, it, vi } from "vitest";
import {
  comTempoLimite,
  ehErroDeAcesso,
  ESPERAS_DO_LIMITE_S,
  FALHAS_SEGUIDAS_QUE_PARAM,
  filaDoLote,
  produtosSemFoto,
  resumoDoLote,
  rodarLote,
  type ProdutoDoLote,
  type SaidaDoLote,
} from "../src/domain/catalogo/lote-de-fotos";
import type { FotoGerada } from "../src/lib/api/produtos-foto-ia.functions";

/**
 * Revisão adversarial de 03/11/2026 sobre o lote de fotos por IA (#417): o laço só
 * parava para sem_ia, sem_saldo e limite. Com a sessão vencida ou o gateway fora do ar
 * seguia pelos 57 produtos, um aviso vermelho cada, e terminava com aviso verde.
 */

const produto = (n: number, extra: Partial<ProdutoDoLote> = {}): ProdutoDoLote => ({ id: `p${n}`, nome: `Produto ${n}`, ...extra });
const lista = (n: number) => Array.from({ length: n }, (_, i) => produto(i + 1));
const saidaDe = (x: Partial<SaidaDoLote>): SaidaDoLote => ({ geradas: 0, puladas: 0, descartadas: 0, falhas: 0, motivo: "fim", falhados: [], ...x });
const ok: FotoGerada = { estado: "ok", url: "https://x/ia/1.png", modelo: "m" };
const falhou: FotoGerada = { estado: "falhou", detalhe: "HTTP 500" };

async function rodar(
  produtos: ProdutoDoLote[],
  respostas: (id: string, chamada: number) => FotoGerada | Error | undefined,
  extra: { pararNaChamada?: number; motivoDaParada?: "pediu" | "saiu" } = {},
) {
  const chamadas: string[] = [];
  // Relógio falso: cada soneca de 1 s adianta o relógio 1 s, como se o navegador estivesse em dia.
  let agora = 0;
  const dormir = vi.fn(async (ms: number) => {
    agora += ms;
  });
  const resultados: string[] = [];
  const eventos: string[] = [];
  const saida = await rodarLote({
    produtos,
    gerar: async (id) => {
      chamadas.push(id);
      const r = respostas(id, chamadas.length);
      if (r instanceof Error) throw r;
      return r as FotoGerada;
    },
    devePararAgora: () => (extra.pararNaChamada !== undefined && chamadas.length >= extra.pararNaChamada ? (extra.motivoDaParada ?? "pediu") : false),
    aoComecar: () => undefined,
    aoResultado: (p, r) => resultados.push(`${p.id}:${"erro" in r ? "erro" : r.resultado?.estado}`),
    aoEsperarLimite: (seg) => eventos.push(`espera ${seg}`),
    aoRetomar: () => eventos.push("retoma"),
    dormir,
    agora: () => agora,
  });
  return { saida, chamadas, resultados, eventos, dormir };
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
    expect(r.saida).toMatchObject({ geradas: 5, puladas: 0, descartadas: 0, falhas: 0, motivo: "fim", falhados: [] });
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
    expect(r.saida).toMatchObject({ geradas: 1, puladas: 4, falhas: 0, motivo: "fim" });
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

describe("o que o servidor devolve de inesperado (segunda rodada, 04/11/2026)", () => {
  it("resposta vazia ou estado desconhecido é falha daquele produto: não derruba o lote", async () => {
    const r = await rodar(lista(3), (_id, n) => (n === 1 ? undefined : ({ estado: "estado_novo_da_versao_nova" } as unknown as FotoGerada)));
    expect(r.saida.motivo).toBe("falhas_seguidas");
    expect(r.saida.falhas).toBe(3);
    expect(r.saida.falhados.map((f) => f.id)).toEqual(["p1", "p2", "p3"]);
    expect(r.saida.falhados[1].motivo).toContain("estado_novo_da_versao_nova");
  });

  it("em_andamento (outra aba gerando) e mudou_no_meio (a foto mudou depois do pagamento) são pulados, e o segundo conta como descartado", async () => {
    const seq: FotoGerada[] = [{ estado: "em_andamento" }, { estado: "mudou_no_meio" }, ok];
    const r = await rodar(lista(3), (_id, n) => seq[n - 1]);
    expect(r.saida).toMatchObject({ geradas: 1, puladas: 2, descartadas: 1, falhas: 0, motivo: "fim" });
  });

  it("a lista de falhas guarda o nome e o motivo de cada produto", async () => {
    const r = await rodar(lista(3), (_id, n) => (n === 2 ? ({ estado: "falhou", detalhe: "a IA respondeu sem imagem" } as FotoGerada) : ok));
    expect(r.saida.falhados).toEqual([{ id: "p2", nome: "Produto 2", motivo: "a IA respondeu sem imagem" }]);
  });

  it("'sair da tela' é um motivo próprio, e o resumo não diz 'a pedido'", async () => {
    const r = await rodar(lista(5), () => ok, { pararNaChamada: 2, motivoDaParada: "saiu" });
    expect(r.saida.motivo).toBe("saiu");
    const resumo = resumoDoLote(r.saida, 5);
    expect(resumo.texto).toContain("Você saiu da tela");
    expect(resumo.texto).not.toContain("a pedido");
  });
});

describe("a espera do 429 conta pelo relógio", () => {
  it("avisa quando a espera acaba, e só tenta de novo depois do tempo (não por número de sonecas)", async () => {
    const seq: FotoGerada[] = [{ estado: "limite" }, ok];
    const r = await rodar(lista(1), (_id, n) => seq[n - 1]);
    expect(r.eventos).toEqual([`espera ${ESPERAS_DO_LIMITE_S[0]}`, "retoma"]);
    expect(r.saida.geradas).toBe(1);
  });

  it("um navegador que atrasa as sonecas não estica a espera: o relógio manda", async () => {
    // Soneca que dorme 3 segundos de verdade a cada "1 s": a espera de 30 s acaba em 10 sonecas, não em 30.
    let agora = 0;
    const dormir = vi.fn(async () => {
      agora += 3000;
    });
    const seq: FotoGerada[] = [{ estado: "limite" }, ok];
    let n = 0;
    const saida = await rodarLote({
      produtos: lista(1),
      gerar: async () => seq[n++],
      devePararAgora: () => false,
      aoComecar: () => undefined,
      aoResultado: () => undefined,
      dormir,
      agora: () => agora,
    });
    expect(saida.geradas).toBe(1);
    expect(dormir).toHaveBeenCalledTimes(10);
  });

  it("'Parar' no meio da espera para sem tentar de novo, no segundo em que foi pedido", async () => {
    let agora = 0;
    let chamadasDeDormir = 0;
    const seq: FotoGerada[] = [{ estado: "limite" }, ok];
    let n = 0;
    const saida = await rodarLote({
      produtos: lista(2),
      gerar: async () => seq[n++],
      // O Parar chega no 5º segundo da espera.
      devePararAgora: () => (chamadasDeDormir >= 5 ? "pediu" : false),
      aoComecar: () => undefined,
      aoResultado: () => undefined,
      dormir: async (ms) => {
        chamadasDeDormir += 1;
        agora += ms;
      },
      agora: () => agora,
    });
    expect(saida.motivo).toBe("pediu");
    expect(saida.geradas).toBe(0);
    expect(n).toBe(1);
    expect(chamadasDeDormir).toBe(5);
  });
});

describe("a fila e o prazo da chamada", () => {
  it("quem falhou vai para o fim da fila: três produtos que recusam sempre não travam mais o lote no mesmo lugar", () => {
    const todos = lista(6);
    expect(filaDoLote(todos, new Set()).map((p) => p.id)).toEqual(["p1", "p2", "p3", "p4", "p5", "p6"]);
    expect(filaDoLote(todos, new Set(["p1", "p2", "p3"])).map((p) => p.id)).toEqual(["p4", "p5", "p6", "p1", "p2", "p3"]);
    expect(filaDoLote(todos, new Set(["p9"])).map((p) => p.id)).toEqual(["p1", "p2", "p3", "p4", "p5", "p6"]);
  });

  it("uma chamada que nunca volta cai por tempo, e a que volta a tempo passa direto", async () => {
    vi.useFakeTimers();
    try {
      const nuncaVolta = comTempoLimite(new Promise<string>(() => undefined), 1000, "demorou demais");
      const capturada = nuncaVolta.catch((e: Error) => e.message);
      await vi.advanceTimersByTimeAsync(1001);
      expect(await capturada).toBe("demorou demais");

      const aTempo = comTempoLimite(Promise.resolve("ok"), 1000, "demorou demais");
      expect(await aTempo).toBe("ok");
      await expect(comTempoLimite(Promise.reject(new Error("falhou antes")), 1000, "demorou demais")).rejects.toThrow("falhou antes");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("o aviso do fim do lote", () => {
  it("verde só quando gerou foto; nunca verde para um lote que não gerou nada", () => {
    expect(resumoDoLote(saidaDe({ geradas: 43 }), 43)).toEqual({
      nivel: "sucesso",
      texto: "43 fotos geradas. Todos os produtos ativos que levam foto têm foto.",
    });
    expect(resumoDoLote(saidaDe({ geradas: 1 }), 5).texto).toBe("1 foto gerada. Faltam 4.");
    expect(resumoDoLote(saidaDe({ falhas: 3 }), 3).nivel).toBe("aviso");
    expect(resumoDoLote(saidaDe({ puladas: 3 }), 3).nivel).toBe("info");
  });

  it("'Faltam' desconta os pulados e diz 'Falta 1' no singular", () => {
    expect(resumoDoLote(saidaDe({ geradas: 3, puladas: 2 }), 5).texto).toBe("3 fotos geradas. Todos os produtos ativos que levam foto têm foto.");
    expect(resumoDoLote(saidaDe({ geradas: 42 }), 43).texto).toBe("42 fotos geradas. Falta 1.");
    expect(resumoDoLote(saidaDe({ geradas: 1, puladas: 2, motivo: "pediu" }), 10).texto).toContain("Faltam 7.");
  });

  it("gerações descartadas e a lista de falhas entram no texto; motivo desconhecido nunca deixa a tela sem aviso", () => {
    const comDescartada = resumoDoLote(saidaDe({ geradas: 2, puladas: 1, descartadas: 1 }), 3);
    expect(comDescartada.texto).toContain("1 geração foi descartada");
    const comFalhas = resumoDoLote(saidaDe({ geradas: 1, falhas: 1, falhados: [{ id: "p2", nome: "B", motivo: "x" }] }), 3);
    expect(comFalhas.texto).toContain("estão listados abaixo");
    const desconhecido = resumoDoLote({ ...saidaDe({ geradas: 2 }), motivo: "motivo_novo" as unknown as SaidaDoLote["motivo"] }, 5);
    expect(desconhecido.nivel).toBe("aviso");
    expect(desconhecido.texto).toContain("2 fotos geradas");
  });

  it("cada parada diz por que parou", () => {
    const base = saidaDe({ geradas: 2 });
    expect(resumoDoLote({ ...base, motivo: "falhas_seguidas" }, 10).texto).toContain("3 falhas seguidas");
    expect(resumoDoLote({ ...base, motivo: "acesso" }, 10).texto).toContain("Entre de novo");
    expect(resumoDoLote({ ...base, motivo: "sem_saldo" }, 10).texto).toContain("saldo de IA");
    expect(resumoDoLote({ ...base, motivo: "sem_ia" }, 10).texto).toContain("não está ligada");
    expect(resumoDoLote({ ...base, motivo: "limite" }, 10).texto).toContain("limite de chamadas");
    expect(resumoDoLote({ ...base, motivo: "pediu" }, 10)).toMatchObject({ nivel: "info" });
    expect(resumoDoLote({ ...base, motivo: "saiu" }, 10)).toMatchObject({ nivel: "info" });
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
