import { describe, expect, it, vi } from "vitest";
import {
  enviarPdfAoCliente,
  type DependenciasDoFluxo,
} from "../src/components/whatsapp/fluxo-enviar-pdf-ao-cliente";
import type { ResultadoDoEnvioDoDocumento } from "../src/lib/api/documento-whatsapp.functions";

const SEM_TRAVESSAO = /[—–→←⇒➜➔]/;
const ORC = "11111111-1111-4111-8111-111111111111";
const DOC = "22222222-2222-4222-8222-222222222222";

function resultado(extra: Partial<ResultadoDoEnvioDoDocumento> = {}): ResultadoDoEnvioDoDocumento {
  return {
    conversaId: "c1",
    mensagemId: "m1",
    filaId: "fila-1",
    comPdf: true,
    nomeArquivo: "orcamento-123.pdf",
    link: null,
    pix: null,
    registro: { ok: true, envioId: "e1", statusMudou: true, enviadoEmGravado: true },
    ...extra,
  };
}

function montar(over: Partial<DependenciasDoFluxo> = {}) {
  const chamadas: string[] = [];
  const dep: DependenciasDoFluxo = {
    tipo: "orcamento",
    referenciaId: ORC,
    numero: 123,
    gerarPdf: vi.fn(async () => {
      chamadas.push("gerar");
      return { documentoId: DOC, numero: 123 };
    }),
    perguntarSoOLink: vi.fn(async () => {
      chamadas.push("perguntar");
      return false;
    }),
    enviar: vi.fn(async () => {
      chamadas.push("enviar");
      return resultado();
    }),
    acionar: vi.fn(async () => {
      chamadas.push("acionar");
      return {
        status: 200,
        corpo: { resultados: [{ fila_id: "fila-1", mensagem_id: "m1", situacao: "enviada", erro: null }] },
      };
    }),
    confirmar: vi.fn(async () => {
      chamadas.push("confirmar");
      return { ok: true as const, statusMudou: true, enviadoEmGravado: true, pelaContingencia: false };
    }),
    ...over,
  };
  return { dep, chamadas };
}

describe("Enviar PDF ao cliente: a ordem do clique", () => {
  it("gera o PDF, envia com o id da linha gerada, aciona o despachante e diz que saiu", async () => {
    const { dep, chamadas } = montar();
    const r = await enviarPdfAoCliente(dep);
    expect(chamadas).toEqual(["gerar", "enviar", "acionar", "confirmar"]);
    expect(dep.confirmar).toHaveBeenCalledWith({ tipo: "orcamento", referenciaId: ORC, mensagemId: "m1" });
    expect(dep.enviar).toHaveBeenCalledWith({
      tipo: "orcamento",
      referenciaId: ORC,
      documentoId: DOC,
    });
    expect(r.cancelado).toBe(false);
    if (r.cancelado) return;
    expect(r.desfecho).toMatchObject({ situacao: "saiu", tom: "sucesso" });
    expect(r.desfecho.texto).toBe("O PDF do orçamento nº 123 saiu pelo WhatsApp da gráfica.");
    expect(r.avisos).toEqual([]);
  });

  it("o painel da conversa manda a conversa aberta no pedido", async () => {
    const { dep } = montar({ conversaId: "33333333-3333-4333-8333-333333333333" });
    await enviarPdfAoCliente(dep);
    expect(dep.enviar).toHaveBeenCalledWith(
      expect.objectContaining({ conversaId: "33333333-3333-4333-8333-333333333333" }),
    );
  });
});

describe("PDF que falha não vira envio de link em silêncio", () => {
  it("orçamento: a tela PERGUNTA, e dizendo não nada é enviado nem acionado", async () => {
    const { dep, chamadas } = montar({
      gerarPdf: vi.fn(async () => {
        throw new Error("Falha ao montar a página 2");
      }),
    });
    const r = await enviarPdfAoCliente(dep);
    expect(dep.perguntarSoOLink).toHaveBeenCalledWith("Falha ao montar a página 2");
    expect(chamadas).not.toContain("enviar");
    expect(chamadas).not.toContain("acionar");
    expect(r).toEqual({ cancelado: true, motivo: "Nada foi enviado." });
  });

  it("orçamento: dizendo sim vai só o texto com o link (documentoId nulo)", async () => {
    const { dep } = montar({
      gerarPdf: vi.fn(async () => {
        throw new Error("sem memória");
      }),
      perguntarSoOLink: vi.fn(async () => true),
      enviar: vi.fn(async () => resultado({ comPdf: false, nomeArquivo: null })),
    });
    const r = await enviarPdfAoCliente(dep);
    expect(dep.enviar).toHaveBeenCalledWith(expect.objectContaining({ documentoId: null }));
    if (r.cancelado) throw new Error("não devia cancelar");
    expect(r.desfecho.texto).toBe("O link do orçamento nº 123 saiu pelo WhatsApp da gráfica.");
  });

  it.each(["os", "orcamento_3d"] as const)("%s: não existe só o link, para sem perguntar e sem enviar", async (tipo) => {
    const { dep } = montar({
      tipo,
      gerarPdf: vi.fn(async () => {
        throw new Error("fonte não carregou.");
      }),
    });
    await expect(enviarPdfAoCliente(dep)).rejects.toThrow("Não consegui montar o PDF: fonte não carregou. Nada foi enviado.");
    expect(dep.perguntarSoOLink).not.toHaveBeenCalled();
    expect(dep.enviar).not.toHaveBeenCalled();
    expect(dep.acionar).not.toHaveBeenCalled();
  });
});

describe("o aviso diz o desfecho DAQUELA linha da fila, não o HTTP do despachante", () => {
  const com = (corpo: unknown, status = 200) =>
    montar({ acionar: vi.fn(async () => ({ status, corpo: corpo as never })) });

  it("200 com o lote de outra linha: fica na fila, não diz que saiu", async () => {
    const { dep } = com({ resultados: [{ fila_id: "outra", mensagem_id: "x", situacao: "enviada", erro: null }] });
    const r = await enviarPdfAoCliente(dep);
    if (r.cancelado) throw new Error("não devia cancelar");
    expect(r.desfecho.situacao).toBe("na_fila");
    expect(r.desfecho.tom).toBe("aviso");
    expect(r.desfecho.texto).not.toContain("saiu pelo WhatsApp");
  });

  it("a linha falhou: não saiu, com o motivo", async () => {
    const { dep } = com({ resultados: [{ fila_id: "fila-1", mensagem_id: "m1", situacao: "falha", erro: "número inválido" }] });
    const r = await enviarPdfAoCliente(dep);
    if (r.cancelado) throw new Error("não devia cancelar");
    expect(r.desfecho).toMatchObject({ situacao: "nao_saiu", tom: "erro" });
    expect(r.desfecho.texto).toContain("número inválido");
  });

  it("despachante inalcançável: na fila, e diz como tentar de novo", async () => {
    const { dep } = montar({ acionar: vi.fn(async () => ({ falhaDeRede: "sem rede" })) });
    const r = await enviarPdfAoCliente(dep);
    if (r.cancelado) throw new Error("não devia cancelar");
    expect(r.desfecho.situacao).toBe("na_fila");
    expect(r.desfecho.texto).toContain("Tentar de novo");
  });

  it("nenhum texto da tela tem travessão ou seta", async () => {
    for (const corpo of [
      { resultados: [{ fila_id: "fila-1", mensagem_id: "m1", situacao: "falha", erro: "recusou — tente depois" }] },
      { resultados: [{ fila_id: "fila-1", mensagem_id: "m1", situacao: "pendente", erro: "aguarde → de novo" }] },
      null,
    ]) {
      const { dep } = com(corpo);
      const r = await enviarPdfAoCliente(dep);
      if (r.cancelado) throw new Error("não devia cancelar");
      expect(r.desfecho.texto).not.toMatch(SEM_TRAVESSAO);
    }
  });
});

describe("o registro que falha vira aviso à parte, sem desfazer o envio", () => {
  it("devolve o desfecho de que saiu E um aviso sobre o registro", async () => {
    const { dep } = montar({
      enviar: vi.fn(async () => resultado({ registro: { ok: false, motivo: "tabela sem permissão." } })),
    });
    const r = await enviarPdfAoCliente(dep);
    if (r.cancelado) throw new Error("não devia cancelar");
    expect(r.desfecho.situacao).toBe("saiu");
    expect(r.avisos).toHaveLength(1);
    expect(r.avisos[0]).toContain("tabela sem permissão");
    expect(r.avisos[0]).not.toMatch(SEM_TRAVESSAO);
  });
});

describe("o servidor recusou (desconectado, sem permissão): nada é acionado", () => {
  it("o erro do servidor sobe e o despachante não é chamado", async () => {
    const { dep } = montar({
      enviar: vi.fn(async () => {
        throw new Error("O WhatsApp da gráfica está desconectado. Reconecte o WhatsApp no Monitor. Nada foi enviado.");
      }),
    });
    await expect(enviarPdfAoCliente(dep)).rejects.toThrow("desconectado");
    expect(dep.acionar).not.toHaveBeenCalled();
  });
});

describe("status e enviado_em só depois que a mensagem saiu", () => {
  const com = (corpo: unknown) =>
    montar({ acionar: vi.fn(async () => ({ status: 200, corpo: corpo as never })) });

  it("ainda na fila ou com falha: não confirma, e o orçamento diz que continua como estava", async () => {
    for (const situacao of ["pendente", "falha"]) {
      const { dep, chamadas } = com({ resultados: [{ fila_id: "fila-1", mensagem_id: "m1", situacao, erro: null }] });
      const r = await enviarPdfAoCliente(dep);
      if (r.cancelado) throw new Error("não devia cancelar");
      expect(chamadas).not.toContain("confirmar");
      expect(r.avisos.join(" ")).toContain("continua como estava");
      expect(r.avisos.join(" ")).not.toMatch(SEM_TRAVESSAO);
    }
  });

  it("a confirmação que o servidor recusa vira aviso, sem desfazer o envio", async () => {
    const { dep } = montar({
      confirmar: vi.fn(async () => ({ ok: false as const, motivo: "A mensagem ainda não saiu pelo WhatsApp." })),
    });
    const r = await enviarPdfAoCliente(dep);
    if (r.cancelado) throw new Error("não devia cancelar");
    expect(r.desfecho.situacao).toBe("saiu");
    expect(r.avisos[0]).toContain("não conseguiu marcar o envio");
  });

  it("a confirmação que lança também vira aviso", async () => {
    const { dep } = montar({ confirmar: vi.fn(async () => { throw new Error("sem rede"); }) });
    const r = await enviarPdfAoCliente(dep);
    if (r.cancelado) throw new Error("não devia cancelar");
    expect(r.avisos[0]).toContain("sem rede");
  });
});
