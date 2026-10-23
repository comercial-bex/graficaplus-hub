import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  arquivosEmOrdem,
  ehImagemVisivel,
  escolherCapa,
  resumoDosArquivos,
  semCapa,
  type ArquivoDaOs,
} from "../src/domain/os/arquivos-da-os";
import { ETAPAS_QUADRO, etapaDe, ROTULO_ETAPA, statusPadraoDaEtapa } from "../src/domain/os/etapas";

/**
 * O quadro de produção redesenhado (23/10/2026), a pedido do dono: cartão com a
 * CAPA da arte, a trilha entrada → arte → fila → produção → acabamento → saída,
 * e a ficha em janela grande com a arte à esquerda. A fila de produção ganhou
 * coluna própria porque o quadro e a TV da oficina falavam da mesma OS em lugares
 * diferentes: aguardando_producao era Pré-impressão no quadro e Oficina na TV.
 * Visto no painel: 6 colunas, as capas reais (Diocese de Macapá, chaveiro) e a
 * ficha com "falta 2 de 6".
 */

const arq = (p: Partial<ArquivoDaOs> & { id: string; nome: string }): ArquivoDaOs => ({
  caminho: `os/${p.id}`,
  mime_type: null,
  final_producao: false,
  created_at: "2026-10-20T10:00:00Z",
  tipo: "arte",
  ...p,
});

describe("qual arquivo é a capa", () => {
  it("o final de produção ganha da arte mais nova", () => {
    const capa = escolherCapa([
      arq({ id: "nova", nome: "nova.png", created_at: "2026-10-22T10:00:00Z" }),
      arq({ id: "final", nome: "final.png", final_producao: true, created_at: "2026-10-01T10:00:00Z" }),
    ]);
    expect(capa?.id).toBe("final");
  });

  it("sem final, vale a mais recente", () => {
    const capa = escolherCapa([
      arq({ id: "velha", nome: "velha.jpg", created_at: "2026-10-01T10:00:00Z" }),
      arq({ id: "nova", nome: "nova.jpg", created_at: "2026-10-22T10:00:00Z" }),
    ]);
    expect(capa?.id).toBe("nova");
  });

  it("versão substituída e arquivo desativado não entram (a capa não é a arte já trocada)", () => {
    const capa = escolherCapa([
      arq({ id: "trocada", nome: "trocada.png", final_producao: true, substituido_por: "outra" }),
      arq({ id: "desativada", nome: "desativada.png", final_producao: true, ativo: false }),
      arq({ id: "vale", nome: "vale.png" }),
    ]);
    expect(capa?.id).toBe("vale");
  });

  it("CDR, AI, PSD e EPS não são capa (o navegador não os desenha); PDF também não", () => {
    for (const nome of ["logo.cdr", "arte.ai", "foto.psd", "vetor.eps", "folha.pdf"]) {
      expect(ehImagemVisivel(nome, null), nome).toBe(false);
    }
    expect(ehImagemVisivel("a.png", "image/png")).toBe(true);
    expect(ehImagemVisivel("a.psd", "image/vnd.adobe.photoshop")).toBe(false);
    expect(escolherCapa([arq({ id: "x", nome: "arte.cdr" })])).toBeNull();
  });

  it("lista vazia ou ausente: sem capa, sem erro", () => {
    expect(escolherCapa([])).toBeNull();
    expect(escolherCapa(undefined)).toBeNull();
  });
});

describe("o que dizer no lugar da capa", () => {
  it("sem arquivo nenhum: 'Sem arte'", () => {
    expect(semCapa([])).toEqual({ rotulo: "Sem arte", detalhe: null });
  });
  it("só arquivo que não se desenha: o tipo dele, e quantos são", () => {
    expect(semCapa([arq({ id: "a", nome: "logo.cdr" })])).toEqual({ rotulo: "CDR", detalhe: "logo.cdr" });
    expect(semCapa([arq({ id: "a", nome: "x.pdf", mime_type: "application/pdf" }), arq({ id: "b", nome: "y.cdr" })]).detalhe).toBe("2 arquivos");
  });
  it("o resumo conta só os vigentes e os marcados como final", () => {
    const r = resumoDosArquivos([
      arq({ id: "a", nome: "a.png", final_producao: true }),
      arq({ id: "b", nome: "b.png", substituido_por: "a" }),
    ]);
    expect(r).toEqual({ total: 1, finais: 1, temFinal: true });
    expect(arquivosEmOrdem([arq({ id: "a", nome: "a.png" })])).toHaveLength(1);
  });
});

describe("as seis etapas do quadro, que a TV agrupa em quatro blocos", () => {
  it("a fila de produção é coluna própria, entre a arte e a produção", () => {
    expect(ETAPAS_QUADRO).toEqual(["entrada", "pre_impressao", "fila_producao", "producao", "acabamento", "saida"]);
    expect(etapaDe("aguardando_producao")).toBe("fila_producao");
    expect(ROTULO_ETAPA.fila_producao).toBe("Fila de produção");
    expect(statusPadraoDaEtapa("fila_producao")).toBe("aguardando_producao");
  });

  it("a criação e a revisão da arte ficam na Pré-impressão", () => {
    for (const s of ["design", "aguardando_aprovacao_arte", "arte_aprovada", "arte_rejeitada"]) {
      expect(etapaDe(s), s).toBe("pre_impressao");
    }
  });
});

describe("o cartão e a ficha", () => {
  const CARTAO = readFileSync("src/components/kanban/cartao-os.tsx", "utf8");
  const FICHA = readFileSync("src/components/kanban/ficha-da-os.tsx", "utf8");
  const TRILHA = readFileSync("src/components/kanban/trilha-da-os.tsx", "utf8");
  const QUADRO = readFileSync("src/routes/_authenticated/kanban.tsx", "utf8");

  it("o cartão tem capa com proporção fixa e carregamento preguiçoso; imagem quebrada vira ficha com o nome", () => {
    expect(CARTAO).toContain("aspect-[16/9]");
    expect(CARTAO).toContain('loading="lazy"');
    expect(CARTAO).toContain("onError={() => setQuebrou(true)}");
    expect(CARTAO).toContain("<TrilhaDaOs status={os.status} compacta />");
  });

  it("a pendência no cartão é uma linha só: a primeira pelo nome e quantas mais", () => {
    expect(CARTAO).toContain("bloqueios[0].titulo");
    expect(CARTAO).toContain("+{bloqueios.length - 1}");
    expect(CARTAO).not.toContain("bg-[color:var(--bex-amber)]/10");
  });

  it("a ficha é janela (Dialog), com a arte à esquerda e a lista de conferência à direita", () => {
    expect(FICHA).toContain("Dialog");
    expect(FICHA).not.toContain("SheetContent");
    expect(FICHA).toContain("Arte · o que vai ser impresso");
    expect(FICHA).toContain("Para produzir · falta");
    expect(FICHA).toContain("Para produzir · tudo certo");
  });

  it("a lista de conferência mostra o que está certo e o que falta; OS interna não pede pagamento nem arte do cliente", () => {
    expect(FICHA).toContain('{ codigo: "sem_pagamento", rotulo: "Entrada paga", soVenda: true }');
    expect(FICHA).toContain('{ codigo: "arte_nao_aprovada", rotulo: "Arte aprovada pelo cliente", soVenda: true }');
    expect(FICHA).toContain("CONDICOES.filter((c) => !(interna && c.soVenda))");
    // pendência que o banco devolve e a lista não conhece aparece mesmo assim
    expect(FICHA).toContain("!CONDICOES.some((c) => c.codigo === b.codigo)");
  });

  it("a trilha usa as mesmas seis etapas do quadro", () => {
    expect(TRILHA).toContain("ETAPAS_QUADRO");
    expect(TRILHA).toContain("ROTULO_ETAPA");
  });

  it("o quadro traz os arquivos e assina a URL da capa de uma vez; a falha não derruba o quadro", () => {
    expect(QUADRO).toContain("final_producao, created_at, tipo, status, ativo, substituido_por, os_item_id");
    expect(QUADRO).toContain("await urlsAssinadas([...capas.values()].map((c) => c.caminho))");
    expect(readFileSync("src/lib/urls-dos-arquivos.ts", "utf8")).toContain("segue sem imagem");
  });
});

describe("a migração da fila", () => {
  const SQL = readFileSync("supabase/migrations/20261023140000_fila_de_producao_etapa_propria.sql", "utf8");
  it("a fila vira etapa; o bloco de cada status da TV não muda", () => {
    expect(SQL).toContain("WHEN p_status IN ('aguardando_producao') THEN 'fila_producao'");
    expect(SQL).toContain("WHEN 'fila_producao' THEN 'oficina'");
  });
});
