import { describe, expect, it } from "vitest";
import {
  BUCKET_PADRAO,
  LIMITE_MINIATURA_BYTES,
  bucketDaArte,
  decisaoRecuaAOs,
  mostraMiniatura,
  orcamentoDoCaminho,
  pedidoDeAjuste,
  situacaoDaArte,
  tamanhoLegivel,
  tipoDaArte,
} from "../src/components/design/tipo-de-arquivo";

describe("que arquivo é a arte", () => {
  it("as três artes reais de 02/10/2026 são PDF: tipo, nome e Abrir — sem miniatura", () => {
    // nome original, caminho com número no lugar do nome, mime e bucket nulos
    const real = {
      nome: "BANNER - TMEPORADA PEST (1).pdf",
      caminho: "orcamento/ab1dee3a-afb0-4895-a6b2-1571214565b3/1790025065880.pdf",
      mime_type: null,
      mime: null,
      tamanho_bytes: null,
    };
    expect(tipoDaArte(real)).toBe("pdf");
    expect(mostraMiniatura(real)).toBe(false);
  });

  it("imagem pequena tem miniatura; grande, só pelo Abrir", () => {
    expect(mostraMiniatura({ nome: "layout.png", tamanho_bytes: 654_223 })).toBe(true);
    expect(mostraMiniatura({ nome: "foto.JPG" })).toBe(true);
    expect(mostraMiniatura({ nome: "foto.jpg", tamanho_bytes: LIMITE_MINIATURA_BYTES + 1 })).toBe(
      false,
    );
  });

  it("Illustrator salvo como PDF continua sendo Illustrator", () => {
    expect(tipoDaArte({ nome: "logo.ai", mime_type: "application/pdf" })).toBe("ai");
    expect(tipoDaArte({ nome: "logo.eps" })).toBe("ai");
    expect(tipoDaArte({ nome: "cartao.cdr" })).toBe("cdr");
    expect(tipoDaArte({ nome: "fachada.psd" })).toBe("psd");
  });

  it("sem extensão no nome: o tipo MIME, depois a extensão do caminho", () => {
    expect(tipoDaArte({ nome: "arte final", mime_type: "image/webp" })).toBe("imagem");
    expect(tipoDaArte({ nome: "arte final", caminho: "orcamento/x/123.pdf" })).toBe("pdf");
    expect(tipoDaArte({ nome: "arte final", caminho: "os/sem-extensao" })).toBe("outro");
  });

  it("TIFF não vira miniatura quebrada", () => {
    expect(tipoDaArte({ nome: "scan", mime_type: "image/tiff" })).toBe("outro");
    expect(mostraMiniatura({ nome: "scan", mime_type: "image/tiff" })).toBe(false);
  });

  it("bucket nulo é o arquivos-clientes", () => {
    expect(BUCKET_PADRAO).toBe("arquivos-clientes");
    expect(bucketDaArte(null)).toBe("arquivos-clientes");
    expect(bucketDaArte("  ")).toBe("arquivos-clientes");
    expect(bucketDaArte("documentos-pdf")).toBe("documentos-pdf");
  });

  it("tamanho legível", () => {
    expect(tamanhoLegivel(185_054)).toBe("181 KB");
    expect(tamanhoLegivel(30_766_547)).toBe("29,3 MB");
    expect(tamanhoLegivel(null)).toBe("");
  });
});

describe("em que pé está a arte", () => {
  it("ajuste pedido vem primeiro, depois aguardando, depois aprovada", () => {
    expect(situacaoDaArte("rejeitado").chave).toBe("ajuste");
    expect(situacaoDaArte("ativo").chave).toBe("aguardando");
    expect(situacaoDaArte("aprovado").chave).toBe("aprovada");
    expect(situacaoDaArte("rejeitado").ordem).toBeLessThan(situacaoDaArte("ativo").ordem);
    expect(situacaoDaArte("ativo").ordem).toBeLessThan(situacaoDaArte("aprovado").ordem);
  });

  it("o pedido de ajuste é o MAIS RECENTE", () => {
    expect(
      pedidoDeAjuste([
        {
          decisao: "ajuste",
          comentario: "telefone errado",
          canal: "link",
          created_at: "2026-10-01T10:00:00Z",
        },
        {
          decisao: "solicitada",
          comentario: null,
          canal: "link",
          created_at: "2026-10-01T11:00:00Z",
        },
        {
          decisao: "ajuste",
          comentario: "logo maior",
          canal: "sistema",
          created_at: "2026-10-02T09:00:00Z",
        },
      ]),
    ).toBe("logo maior");
    expect(pedidoDeAjuste([])).toBeNull();
  });

  it("o orçamento sai do caminho que as telas de orçamento gravam", () => {
    expect(
      orcamentoDoCaminho("orcamento/422fc5b2-35ee-4b10-bf89-783406dd439f/1789994723988.pdf"),
    ).toBe("422fc5b2-35ee-4b10-bf89-783406dd439f");
    expect(orcamentoDoCaminho("orcamento/1059/item1.png")).toBeNull();
    expect(orcamentoDoCaminho("8a7c1f00-0000-0000-0000-000000000000/123_arte.pdf")).toBeNull();
  });

  it("decidir a arte de uma OS que já está na máquina faz a OS recuar — a tela avisa", () => {
    expect(decisaoRecuaAOs("em_impressao")).toBe(true);
    expect(decisaoRecuaAOs("aguardando_retirada")).toBe(true);
    expect(decisaoRecuaAOs("pausado")).toBe(true);
    expect(decisaoRecuaAOs("aguardando_aprovacao_arte")).toBe(false);
    expect(decisaoRecuaAOs("design")).toBe(false);
    // encerrada: a função não mexe no status, então não há recuo
    expect(decisaoRecuaAOs("concluido")).toBe(false);
    expect(decisaoRecuaAOs("cancelado")).toBe(false);
  });
});
