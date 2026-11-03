import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  bytesDaDataUrl,
  extensaoDoMime,
  fotoFoiGerada,
  gerarImagemPeloGateway,
  GATEWAY_DE_IMAGEM,
  mensagemDaFotoGerada,
  modelosParaTentar,
  MODELOS_DE_IMAGEM,
  promptDaFotoDoProduto,
  urlDaImagemNaResposta,
} from "../src/lib/api/produtos-foto-ia.functions";
import { produtosSemFoto, LOTE_DE_FOTOS } from "../src/components/produtos/gerar-fotos-que-faltam";

/**
 * Foto de produto gerada pela IA (01/11/2026): o dono pediu o catálogo com foto
 * como no Holdprint, "e se não tiver, gera no padrão da Bex Print".
 */

const ler = (c: string) => readFileSync(c, "utf8");
const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function resposta(status: number, corpo: unknown, tipo = "application/json"): Response {
  const texto = typeof corpo === "string" ? corpo : JSON.stringify(corpo);
  return new Response(texto, { status, headers: { "content-type": tipo } });
}

describe("o pedido que vai para a IA", () => {
  it("fala do produto, da família e da marca, e nunca de preço", () => {
    const p = promptDaFotoDoProduto({ nome: "Lona 440 g", familia: "Lonas frontlight", descricao: "Lona brilho com bainha e ilhós" });
    expect(p).toContain("Produto: Lona 440 g.");
    expect(p).toContain("Família: Lonas frontlight.");
    expect(p).toContain("Como é: Lona brilho com bainha e ilhós.");
    expect(p).toContain('"BEX PRINT"');
    expect(p).toContain("fundo branco");
    expect(p.toLowerCase()).not.toMatch(/preço|custo|r\$/);
  });

  it("sem família e sem descrição o pedido continua inteiro", () => {
    const p = promptDaFotoDoProduto({ nome: "  Placa   em ACM  " });
    expect(p).toContain("Produto: Placa em ACM.");
    expect(p).not.toContain("Família:");
    expect(p).not.toContain("Como é:");
  });
});

describe("ler a imagem da resposta do gateway", () => {
  it("acha a imagem em `images` e, se não houver, numa parte do conteúdo", () => {
    expect(urlDaImagemNaResposta({ choices: [{ message: { images: [{ image_url: { url: "data:image/png;base64,AAAA" } }] } }] })).toBe(
      "data:image/png;base64,AAAA",
    );
    expect(
      urlDaImagemNaResposta({ choices: [{ message: { content: [{ type: "text", text: "aqui" }, { type: "image_url", image_url: { url: "https://x/y.png" } }] } }] }),
    ).toBe("https://x/y.png");
    expect(urlDaImagemNaResposta({ choices: [{ message: { content: "só texto" } }] })).toBeNull();
    expect(urlDaImagemNaResposta(null)).toBeNull();
  });

  it("decodifica data URL de imagem e recusa o resto", () => {
    const png = bytesDaDataUrl(`data:image/png;base64,${PNG_1PX}`);
    expect(png?.mime).toBe("image/png");
    expect(png?.bytes.length).toBeGreaterThan(60);
    expect(bytesDaDataUrl("data:text/plain;base64,aGVsbG8=")).toBeNull();
    expect(bytesDaDataUrl("https://x/y.png")).toBeNull();
    expect(extensaoDoMime("image/jpeg")).toBe("jpg");
    expect(extensaoDoMime("image/webp")).toBe("webp");
    expect(extensaoDoMime("octet/stream")).toBe("png");
  });
});

describe("gerarImagemPeloGateway", () => {
  it("sem chave é sem_ia, 402 é sem_saldo, 429 é limite", async () => {
    expect(await gerarImagemPeloGateway("x", undefined)).toEqual({ estado: "sem_ia" });
    expect((await gerarImagemPeloGateway("x", "k", async () => resposta(402, { error: "credits" }))).estado).toBe("sem_saldo");
    expect((await gerarImagemPeloGateway("x", "k", async () => resposta(429, { error: "rate" }))).estado).toBe("limite");
  });

  it("manda modalities de imagem e tenta o próximo modelo quando o gateway não aceita o primeiro", async () => {
    const chamadas: { url: string; corpo: Record<string, unknown> }[] = [];
    const buscar = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const corpo = JSON.parse(String(init?.body)) as Record<string, unknown>;
      chamadas.push({ url: String(url), corpo });
      if (corpo.model === MODELOS_DE_IMAGEM[0]) return resposta(400, { error: { message: "model not found" } });
      return resposta(200, { choices: [{ message: { images: [{ image_url: { url: `data:image/png;base64,${PNG_1PX}` } }] } }] });
    }) as unknown as typeof fetch;

    const r = await gerarImagemPeloGateway("desenhe", "chave", buscar);
    expect(r.estado).toBe("ok");
    if (r.estado === "ok") {
      expect(r.modelo).toBe(MODELOS_DE_IMAGEM[1]);
      expect(r.mime).toBe("image/png");
    }
    expect(chamadas).toHaveLength(2);
    expect(chamadas[0].url).toBe(GATEWAY_DE_IMAGEM);
    expect(chamadas[0].corpo.modalities).toEqual(["image", "text"]);
    expect(chamadas[0].corpo.messages).toEqual([{ role: "user", content: "desenhe" }]);
  });

  it("HTTP 500 não vira 'próximo modelo': é falha e diz o número", async () => {
    const r = await gerarImagemPeloGateway("x", "k", async () => resposta(500, "deu ruim", "text/plain"));
    expect(r).toEqual({ estado: "falhou", detalhe: "o serviço de IA respondeu HTTP 500" });
  });

  it("resposta sem imagem em todos os modelos é falha, não foto vazia", async () => {
    const r = await gerarImagemPeloGateway("x", "k", async () => resposta(200, { choices: [{ message: { content: "não consigo" } }] }));
    expect(r).toEqual({ estado: "falhou", detalhe: "a IA respondeu sem imagem" });
  });

  it("modelo que responde só com texto cede a vez ao próximo (03/11/2026)", async () => {
    const buscar = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const corpo = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (corpo.model === MODELOS_DE_IMAGEM[0]) return resposta(200, { choices: [{ message: { content: "não posso desenhar isto" } }] });
      return resposta(200, { choices: [{ message: { images: [{ image_url: { url: `data:image/png;base64,${PNG_1PX}` } }] } }] });
    }) as unknown as typeof fetch;
    const r = await gerarImagemPeloGateway("x", "k", buscar);
    expect(r.estado).toBe("ok");
    if (r.estado === "ok") expect(r.modelo).toBe(MODELOS_DE_IMAGEM[1]);
  });

  it("os modelos são os que o gateway lista hoje: nenhum '-preview', todos Gemini de chat com imagem", () => {
    // Conferido em 03/11/2026 com o agente do Lovable, pela lista de modelos do gateway com a chave do projeto.
    expect([...MODELOS_DE_IMAGEM]).toEqual([
      "google/gemini-3.1-flash-image",
      "google/gemini-2.5-flash-image",
      "google/gemini-3-pro-image",
    ]);
    for (const m of MODELOS_DE_IMAGEM) expect(m).not.toMatch(/preview/);
  });

  it("baixa a imagem quando o gateway devolve um endereço em vez do conteúdo", async () => {
    const buscar = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === GATEWAY_DE_IMAGEM) {
        return resposta(200, { choices: [{ message: { images: [{ image_url: { url: "https://cdn.exemplo/foto.webp" } }] } }] });
      }
      return new Response(Buffer.from(PNG_1PX, "base64"), { status: 200, headers: { "content-type": "image/webp" } });
    }) as unknown as typeof fetch;
    const r = await gerarImagemPeloGateway("x", "k", buscar);
    expect(r.estado).toBe("ok");
    if (r.estado === "ok") expect(r.mime).toBe("image/webp");
  });

  it("o modelo do projeto vai primeiro; a foto gerada se reconhece pela pasta", () => {
    expect(modelosParaTentar("google/novo-modelo")[0]).toBe("google/novo-modelo");
    expect(modelosParaTentar("google/novo-modelo")).toHaveLength(MODELOS_DE_IMAGEM.length + 1);
    expect(modelosParaTentar(undefined)).toEqual([...MODELOS_DE_IMAGEM]);
    expect(fotoFoiGerada("https://x.supabase.co/storage/v1/object/public/produtos-fotos/ia/abc/1.png")).toBe(true);
    expect(fotoFoiGerada("https://x.supabase.co/storage/v1/object/public/produtos-fotos/abc.jpg")).toBe(false);
    expect(fotoFoiGerada(null)).toBe(false);
  });

  it("cada estado tem uma frase que diz o que fazer", () => {
    expect(mensagemDaFotoGerada({ estado: "sem_ia" })).toContain("Copie o pedido");
    expect(mensagemDaFotoGerada({ estado: "sem_saldo" })).toContain("saldo de IA");
    expect(mensagemDaFotoGerada({ estado: "limite" })).toContain("Espere um minuto");
    expect(mensagemDaFotoGerada({ estado: "falhou", detalhe: "x" })).toBe("Não deu para gerar a foto: x.");
  });
});

describe("o lote de fotos que faltam", () => {
  it("pega só ativo sem foto; o teto do lote é de segurança, não de 8 em 8", () => {
    const lista = [
      { id: "1", nome: "a", imagem_url: null, ativo: true },
      { id: "2", nome: "b", imagem_url: "https://x/y.png", ativo: true },
      { id: "3", nome: "c", imagem_url: "  ", ativo: true },
      { id: "4", nome: "d", imagem_url: null, ativo: false },
    ];
    expect(produtosSemFoto(lista).map((p) => p.id)).toEqual(["1", "3"]);
    // 03/11/2026: o dono quis "clicar e ir gerando" até o fim; 43 produtos sem foto cabem num clique.
    expect(LOTE_DE_FOTOS).toBe(60);
    expect(LOTE_DE_FOTOS).toBeGreaterThan(43);
  });

  it("a cada foto pronta a lista de produtos é atualizada, para as miniaturas irem aparecendo", () => {
    const lote = ler("src/components/produtos/gerar-fotos-que-faltam.tsx");
    expect(lote).toContain('void fila.invalidateQueries({ queryKey: ["produtos"] });');
    expect(lote).toContain("deixe esta aba aberta");
    expect(lote).toContain("Parar depois desta");
  });
});

describe("as telas", () => {
  it("o cadastro e a ficha oferecem a IA, e a função só lê a view sem preço e exige admin ou gestor", () => {
    const foto = ler("src/components/produtos/foto-do-produto.tsx");
    expect(foto.includes("Gerar foto com IA")).toBe(true);
    expect(foto.includes("Copiar pedido")).toBe(true);
    expect(foto.includes("Gerada pela IA")).toBe(true);
    // O pedido que a IA recebe fica à vista, para o dono ver o que será desenhado antes de gerar (03/11/2026).
    expect(foto.includes('data-testid="pedido-da-foto"')).toBe(true);
    expect(foto.includes("Ver o pedido que a IA recebe")).toBe(true);
    expect(/\stitle=/.test(foto)).toBe(false);
    const produtos = ler("src/routes/_authenticated/produtos.tsx");
    expect(produtos.includes("{isAdmin && <GerarFotosQueFaltam produtos={produtos} />}")).toBe(true);
    expect(produtos.includes("produto={{ id: form.id || null")).toBe(true);
    // A miniatura da foto na tabela e na grade: as fotos geradas vão aparecendo na lista.
    expect(produtos.match(/<MiniaturaDoProduto url=\{p\.imagem_url\}/g)?.length).toBe(2);
    const miniatura = ler("src/components/produtos/miniatura-do-produto.tsx");
    expect(miniatura).toContain('alt=""');
    expect(miniatura).toContain('loading="lazy"');
    expect(/\stitle=/.test(miniatura)).toBe(false);
    const ficha = ler("src/components/precos/ficha-do-produto.tsx");
    expect(ficha.includes("produto={{ id: p.id, nome: p.nome, familia: linha?.familia ?? null, categoria: p.categoria }}")).toBe(true);
    const fn = ler("src/lib/api/produtos-foto-ia.functions.ts");
    expect(fn.includes('.from("produtos_operacional")')).toBe(true);
    expect(fn.includes('.select("id, nome, descricao, familia, categoria")')).toBe(true);
    expect(fn.includes('const PAPEIS_QUE_GERAM = ["admin", "gestor"]')).toBe(true);
    expect(fn.includes("process.env.LOVABLE_API_KEY")).toBe(true);
  });
});
