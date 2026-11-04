import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  bytesDaDataUrl,
  caminhoDaFotoGerada,
  decidirGeracao,
  extensaoDoMime,
  fotoFoiGerada,
  gerarImagemPeloGateway,
  GATEWAY_DE_IMAGEM,
  guardarFotoGerada,
  mensagemDaFotoGerada,
  modelosParaTentar,
  MODELOS_DE_IMAGEM,
  produtoDoPedido,
  promptDaFotoDoProduto,
  urlDaImagemNaResposta,
  type GravadorDeFotos,
} from "../src/lib/api/produtos-foto-ia.functions";
import { produtosSemFoto, LOTE_DE_FOTOS } from "../src/components/produtos/gerar-fotos-que-faltam";
import { CADASTRO_VAZIO, payloadDoCadastro } from "../src/domain/catalogo/pasta-do-produto";

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
    expect(mensagemDaFotoGerada({ estado: "ja_tem_foto" })).toContain("não troca a que já existe");
    expect(mensagemDaFotoGerada({ estado: "servico" })).toContain("Serviço não leva foto gerada");
  });
});

describe("antes de gastar saldo de IA (revisão de 03/11/2026)", () => {
  const gerada = "https://x.supabase.co/storage/v1/object/public/produtos-fotos/ia/abc/1.png";
  const real = "https://x.supabase.co/storage/v1/object/public/produtos-fotos/3f2a.jpg";

  it("serviço não leva foto gerada, nem pedindo outra", () => {
    expect(decidirGeracao({ tipo: "servico", imagem_url: null }, false)).toBe("servico");
    expect(decidirGeracao({ tipo: "servico", imagem_url: gerada }, true)).toBe("servico");
  });

  it("sem foto, gera; com foto, só gera de novo quando é uma gerada E a pessoa pediu outra", () => {
    expect(decidirGeracao({ tipo: "produto", imagem_url: null }, false)).toBe("gerar");
    expect(decidirGeracao({ tipo: "produto", imagem_url: "   " }, false)).toBe("gerar");
    expect(decidirGeracao({ tipo: "produto", imagem_url: gerada }, false)).toBe("ja_tem_foto");
    expect(decidirGeracao({ tipo: "produto", imagem_url: gerada }, true)).toBe("gerar");
  });

  it("foto enviada à mão nunca é trocada pela IA, nem com 'substituir'", () => {
    expect(decidirGeracao({ tipo: "produto", imagem_url: real }, false)).toBe("ja_tem_foto");
    expect(decidirGeracao({ tipo: "produto", imagem_url: real }, true)).toBe("ja_tem_foto");
  });

  it("o pedido usa o texto da tela quando ela mandou, e o salvo quando não mandou", () => {
    const salvo = { nome: "Lona", descricao: "texto salvo", familia: "Lonas", categoria: "lona" };
    expect(produtoDoPedido(salvo)).toMatchObject({ nome: "Lona", descricao: "texto salvo", familia: "Lonas" });
    expect(produtoDoPedido(salvo, { descricao: "texto novo na tela" })).toMatchObject({ nome: "Lona", descricao: "texto novo na tela", familia: "Lonas" });
    // A tela mandou a descrição vazia (a pessoa apagou): vale o vazio, não o salvo.
    expect(produtoDoPedido(salvo, { descricao: "" }).descricao).toBe("");
    // Nome vazio na tela não vale: produto sem nome não existe.
    expect(produtoDoPedido(salvo, { nome: "  " }).nome).toBe("Lona");
    // O que a tela mostra é exatamente o que vai: mesmo texto, mesmo pedido.
    const naTela = { nome: "Lona nova", descricao: "d", familia: "f" };
    expect(promptDaFotoDoProduto(produtoDoPedido(salvo, naTela))).toBe(promptDaFotoDoProduto(naTela));
  });

  it("só sai do armazenamento a foto gerada DESTE produto", () => {
    const base = "https://x.supabase.co/storage/v1/object/public/produtos-fotos";
    expect(caminhoDaFotoGerada(`${base}/ia/abc/171-ab12.png`, "abc")).toBe("ia/abc/171-ab12.png");
    expect(caminhoDaFotoGerada(`${base}/ia/abc/171-ab12.png?v=2`, "abc")).toBe("ia/abc/171-ab12.png");
    // de outro produto, enviada à mão, vazia ou com caminho esquisito: nunca
    expect(caminhoDaFotoGerada(`${base}/ia/outro/171.png`, "abc")).toBeNull();
    expect(caminhoDaFotoGerada(`${base}/3f2a.jpg`, "abc")).toBeNull();
    expect(caminhoDaFotoGerada(`${base}/ia/abc/../x.png`, "abc")).toBeNull();
    expect(caminhoDaFotoGerada(`${base}/ia/abc/pasta/x.png`, "abc")).toBeNull();
    expect(caminhoDaFotoGerada("", "abc")).toBeNull();
    expect(caminhoDaFotoGerada(null, "abc")).toBeNull();
  });
});

/** Um armazenamento e uma tabela `produtos` em memória, com só os filtros que a gravação usa. */
function ambiente(inicial: { id: string; imagem_url: string | null }[], opcoes: { falhaEnvio?: boolean; falhaGravacao?: boolean; falhaConsulta?: boolean } = {}) {
  const arquivos = new Map<string, number>();
  const produtos = inicial.map((p) => ({ ...p }));
  const remocoes: string[][] = [];
  const base = "https://x.supabase.co/storage/v1/object/public/produtos-fotos";
  for (const p of produtos) {
    const i = p.imagem_url?.indexOf("/produtos-fotos/") ?? -1;
    if (p.imagem_url && i >= 0) arquivos.set(p.imagem_url.slice(i + "/produtos-fotos/".length), 1);
  }

  function construtor(modo: "update" | "select", valores?: { imagem_url: string }) {
    const filtros: ((p: { id: string; imagem_url: string | null }) => boolean)[] = [];
    let maximo = Infinity;
    const q = {
      eq: (col: string, v: string) => (filtros.push((p) => String((p as Record<string, unknown>)[col] ?? "") === v && (p as Record<string, unknown>)[col] !== null), q),
      neq: (col: string, v: string) => (filtros.push((p) => String((p as Record<string, unknown>)[col]) !== v), q),
      or: (expr: string) => {
        if (expr !== "imagem_url.is.null,imagem_url.eq.") throw new Error(`filtro não modelado: ${expr}`);
        filtros.push((p) => p.imagem_url === null || p.imagem_url === "");
        return q;
      },
      limit: (n: number) => ((maximo = n), q),
      select: (_c: string) => q,
      then: (ok: (r: { data: { id: string }[] | null; error: unknown }) => unknown) => {
        if (opcoes.falhaConsulta && modo === "select") return Promise.resolve({ data: null, error: new Error("consulta") }).then(ok);
        const achados = produtos.filter((p) => filtros.every((f) => f(p))).slice(0, maximo);
        if (modo === "update") {
          if (opcoes.falhaGravacao) return Promise.resolve({ data: null, error: new Error("gravação") }).then(ok);
          for (const p of achados) p.imagem_url = valores!.imagem_url;
        }
        return Promise.resolve({ data: achados.map((p) => ({ id: p.id })), error: null }).then(ok);
      },
    };
    return q;
  }

  const admin: GravadorDeFotos = {
    storage: {
      from: () => ({
        upload: async (caminho) => {
          if (opcoes.falhaEnvio || arquivos.has(caminho)) return { error: new Error("envio") };
          arquivos.set(caminho, 1);
          return { error: null };
        },
        getPublicUrl: (caminho) => ({ data: { publicUrl: `${base}/${caminho}` } }),
        remove: async (caminhos) => {
          remocoes.push(caminhos);
          for (const c of caminhos) arquivos.delete(c);
          return {};
        },
      }),
    },
    from: () => ({
      update: (valores: { imagem_url: string }) => construtor("update", valores),
      select: () => construtor("select"),
    }),
  };
  return { admin, arquivos, produtos, remocoes, base };
}

const IMAGEM = { bytes: new Uint8Array([1, 2, 3]), mime: "image/png", modelo: "m" };
const ID = "11111111-1111-4111-8111-111111111111";
const OUTRO = "22222222-2222-4222-8222-222222222222";

describe("guardar a foto gerada (revisão de 03/11/2026)", () => {
  it("sem foto antes: sobe o arquivo, aponta o produto e não remove nada", async () => {
    const a = ambiente([{ id: ID, imagem_url: null }]);
    const r = await guardarFotoGerada({ admin: a.admin, produtoId: ID, fotoLida: null, imagem: IMAGEM, agora: () => 1, sufixoUnico: () => "aa" });
    expect(r.estado).toBe("ok");
    expect(a.produtos[0].imagem_url).toBe(`${a.base}/ia/${ID}/1-aa.png`);
    expect([...a.arquivos.keys()]).toEqual([`ia/${ID}/1-aa.png`]);
    expect(a.remocoes).toEqual([]);
  });

  it("foto vazia ('') conta como sem foto", async () => {
    const a = ambiente([{ id: ID, imagem_url: "" }]);
    const r = await guardarFotoGerada({ admin: a.admin, produtoId: ID, fotoLida: "", imagem: IMAGEM, sufixoUnico: () => "aa" });
    expect(r.estado).toBe("ok");
    expect(a.produtos[0].imagem_url).toContain(`/ia/${ID}/`);
  });

  it("outra pessoa enviou a foto real enquanto a IA desenhava: a real fica e o arquivo novo é removido", async () => {
    const real = "https://x.supabase.co/storage/v1/object/public/produtos-fotos/3f2a.jpg";
    const a = ambiente([{ id: ID, imagem_url: real }]);
    // O produto foi lido SEM foto, mas na hora de gravar já tinha a real.
    const r = await guardarFotoGerada({ admin: a.admin, produtoId: ID, fotoLida: "", imagem: IMAGEM, agora: () => 1, sufixoUnico: () => "aa" });
    expect(r).toEqual({ estado: "ja_tem_foto" });
    expect(a.produtos[0].imagem_url).toBe(real);
    // Só o arquivo da foto real continua no armazenamento; o que a IA acabou de subir foi embora.
    expect([...a.arquivos.keys()]).toEqual(["3f2a.jpg"]);
    expect(a.remocoes).toEqual([[`ia/${ID}/1-aa.png`]]);
  });

  it("duas gerações ao mesmo tempo: a segunda não sobrescreve a primeira e não deixa arquivo órfão", async () => {
    const a = ambiente([{ id: ID, imagem_url: null }]);
    const primeira = await guardarFotoGerada({ admin: a.admin, produtoId: ID, fotoLida: null, imagem: IMAGEM, agora: () => 1, sufixoUnico: () => "aa" });
    const segunda = await guardarFotoGerada({ admin: a.admin, produtoId: ID, fotoLida: null, imagem: IMAGEM, agora: () => 1, sufixoUnico: () => "bb" });
    expect(primeira.estado).toBe("ok");
    expect(segunda).toEqual({ estado: "ja_tem_foto" });
    expect(a.produtos[0].imagem_url).toBe(`${a.base}/ia/${ID}/1-aa.png`);
    expect([...a.arquivos.keys()]).toEqual([`ia/${ID}/1-aa.png`]);
  });

  it("'Gerar outra': troca a gerada e tira a anterior do armazenamento", async () => {
    const antiga = `https://x.supabase.co/storage/v1/object/public/produtos-fotos/ia/${ID}/0-zz.png`;
    const a = ambiente([{ id: ID, imagem_url: antiga }]);
    const r = await guardarFotoGerada({ admin: a.admin, produtoId: ID, fotoLida: antiga, imagem: IMAGEM, agora: () => 2, sufixoUnico: () => "cc" });
    expect(r.estado).toBe("ok");
    expect(a.produtos[0].imagem_url).toBe(`${a.base}/ia/${ID}/2-cc.png`);
    expect([...a.arquivos.keys()]).toEqual([`ia/${ID}/2-cc.png`]);
    expect(a.remocoes).toEqual([[`ia/${ID}/0-zz.png`]]);
  });

  it("'Gerar outra' com a foto antiga compartilhada por um produto duplicado: o arquivo antigo fica", async () => {
    const antiga = `https://x.supabase.co/storage/v1/object/public/produtos-fotos/ia/${ID}/0-zz.png`;
    const a = ambiente([
      { id: ID, imagem_url: antiga },
      { id: OUTRO, imagem_url: antiga }, // "Duplicar produto" copia o endereço da foto
    ]);
    const r = await guardarFotoGerada({ admin: a.admin, produtoId: ID, fotoLida: antiga, imagem: IMAGEM, agora: () => 2, sufixoUnico: () => "cc" });
    expect(r.estado).toBe("ok");
    expect(a.produtos[1].imagem_url).toBe(antiga);
    expect(a.arquivos.has(`ia/${ID}/0-zz.png`)).toBe(true);
    expect(a.remocoes).toEqual([]);
  });

  it("se a consulta de quem mais usa a foto antiga falha, o arquivo antigo fica (na dúvida não se apaga)", async () => {
    const antiga = `https://x.supabase.co/storage/v1/object/public/produtos-fotos/ia/${ID}/0-zz.png`;
    const a = ambiente([{ id: ID, imagem_url: antiga }], { falhaConsulta: true });
    const r = await guardarFotoGerada({ admin: a.admin, produtoId: ID, fotoLida: antiga, imagem: IMAGEM, agora: () => 2, sufixoUnico: () => "cc" });
    expect(r.estado).toBe("ok");
    expect(a.arquivos.has(`ia/${ID}/0-zz.png`)).toBe(true);
  });

  it("a foto anterior que NÃO é gerada (enviada à mão) nunca é removida", async () => {
    // Não acontece pelo handler (ele recusa), mas a função não pode apagar o que não é dela.
    const real = "https://x.supabase.co/storage/v1/object/public/produtos-fotos/3f2a.jpg";
    const a = ambiente([{ id: ID, imagem_url: real }]);
    const r = await guardarFotoGerada({ admin: a.admin, produtoId: ID, fotoLida: real, imagem: IMAGEM, agora: () => 2, sufixoUnico: () => "cc" });
    expect(r.estado).toBe("ok");
    expect(a.arquivos.has("3f2a.jpg")).toBe(true);
    expect(a.remocoes).toEqual([]);
  });

  it("erro ao gravar o produto: o arquivo que subiu é removido e a resposta diz o que houve", async () => {
    const a = ambiente([{ id: ID, imagem_url: null }], { falhaGravacao: true });
    const r = await guardarFotoGerada({ admin: a.admin, produtoId: ID, fotoLida: null, imagem: IMAGEM, agora: () => 1, sufixoUnico: () => "aa" });
    expect(r).toEqual({ estado: "falhou", detalhe: "a imagem subiu mas o produto não aceitou a foto" });
    expect(a.arquivos.size).toBe(0);
    expect(a.produtos[0].imagem_url).toBeNull();
  });

  it("erro ao subir o arquivo: nada é gravado no produto", async () => {
    const a = ambiente([{ id: ID, imagem_url: null }], { falhaEnvio: true });
    const r = await guardarFotoGerada({ admin: a.admin, produtoId: ID, fotoLida: null, imagem: IMAGEM });
    expect(r.estado).toBe("falhou");
    expect(a.produtos[0].imagem_url).toBeNull();
  });

  it("duas gerações no mesmo milissegundo não colidem no nome do arquivo", async () => {
    const a = ambiente([{ id: ID, imagem_url: null }, { id: OUTRO, imagem_url: null }]);
    const um = await guardarFotoGerada({ admin: a.admin, produtoId: ID, fotoLida: null, imagem: IMAGEM, agora: () => 7 });
    const dois = await guardarFotoGerada({ admin: a.admin, produtoId: ID, fotoLida: um.estado === "ok" ? um.url : null, imagem: IMAGEM, agora: () => 7 });
    expect(um.estado).toBe("ok");
    expect(dois.estado).toBe("ok"); // sufixo aleatório: o nome é outro, mesmo no mesmo ms
  });
});

describe("o Salvar não apaga a foto que o lote gravou no meio tempo", () => {
  const visao = { canSeePrices: true, canSeeFinancials: true };
  const cadastro = { ...CADASTRO_VAZIO, nome: "Lona", imagem_url: "" };

  it("foto igual à do banco não vai no Salvar; foto mudada vai; sem a informação do banco, vai como antes", () => {
    expect("imagem_url" in payloadDoCadastro(cadastro, visao, { imagemNoBanco: "" })).toBe(false);
    expect("imagem_url" in payloadDoCadastro({ ...cadastro, imagem_url: "https://x/a.jpg" }, visao, { imagemNoBanco: "https://x/a.jpg" })).toBe(false);
    expect(payloadDoCadastro({ ...cadastro, imagem_url: "https://x/nova.jpg" }, visao, { imagemNoBanco: "" }).imagem_url).toBe("https://x/nova.jpg");
    // Remover a foto de propósito (o banco tinha uma) grava nulo.
    expect(payloadDoCadastro(cadastro, visao, { imagemNoBanco: "https://x/a.jpg" }).imagem_url).toBeNull();
    expect(payloadDoCadastro(cadastro, visao).imagem_url).toBeNull();
  });
});

describe("o lote de fotos que faltam", () => {
  it("pega só ativo sem foto e que não é serviço; o teto do lote é de segurança, não de 8 em 8", () => {
    const lista = [
      { id: "1", nome: "a", imagem_url: null, ativo: true },
      { id: "2", nome: "b", imagem_url: "https://x/y.png", ativo: true },
      { id: "3", nome: "c", imagem_url: "  ", ativo: true },
      { id: "4", nome: "d", imagem_url: null, ativo: false },
      { id: "5", nome: "Deslocamento", imagem_url: null, ativo: true, tipo: "servico" },
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

  it("sair da tela para o lote, um segundo lote não começa por cima, e o Parar responde na hora", () => {
    const lote = ler("src/components/produtos/gerar-fotos-que-faltam.tsx");
    // O botão Parar mora na tela: ao desmontar, o laço para depois da foto em curso.
    expect(lote).toMatch(/useEffect\(\s*\(\) => \(\) => \{\s*parar\.current = true;/);
    expect(lote).toContain("let loteEmCurso = false;");
    expect(lote).toContain("if (loteEmCurso) {");
    expect(lote).toContain("setParando(true)");
    expect(lote).toContain('"Parando..."');
    // A regra de parada mora no domínio, testada sem React (tests/lote-de-fotos.test.ts).
    expect(lote).toContain("rodarLote({");
    expect(lote).toContain("resumoDoLote(saida, semFoto.length)");
    // Nunca aviso verde para um lote que não gerou nada.
    expect(lote).not.toContain('"Nenhuma foto gerada desta vez."');
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
    expect(produtos.includes("categoria: form.categoria, tipo: form.tipo }}")).toBe(true);
    // Salvar a Edição rápida não regrava a foto velha por cima da que o lote gravou.
    expect(produtos.includes("imagem_url_aberta")).toBe(true);
    expect(produtos.includes("f.imagem_url.trim() === f.imagem_url_aberta.trim()")).toBe(true);
    // Na grade a miniatura é quadrada, como a foto pedida à IA.
    expect(produtos.includes('className="aspect-square h-auto w-full"')).toBe(true);
    expect(produtos.includes('className="h-28 w-full"')).toBe(false);
    // A miniatura da foto na tabela e na grade: as fotos geradas vão aparecendo na lista.
    expect(produtos.match(/<MiniaturaDoProduto url=\{p\.imagem_url\}/g)?.length).toBe(2);
    const miniatura = ler("src/components/produtos/miniatura-do-produto.tsx");
    expect(miniatura).toContain('alt=""');
    expect(miniatura).toContain('loading="lazy"');
    expect(/\stitle=/.test(miniatura)).toBe(false);
    const ficha = ler("src/components/precos/ficha-do-produto.tsx");
    // A ficha carrega a descrição: o pedido mostrado tem o "Como é:" que o servidor também manda.
    expect(ficha.includes("produto={{ id: p.id, nome: p.nome, descricao: p.descricao ?? null, familia: linha?.familia ?? null, categoria: p.categoria, tipo: p.tipo }}")).toBe(true);
    expect(ler("src/routes/_authenticated/tabela-de-precos.tsx")).toContain('observacoes_internas, descricao")');
    // A pasta passa o tipo e só grava a foto se ela mudou.
    const pasta = ler("src/routes/_authenticated/produtos_.$id.tsx");
    expect(pasta).toContain("tipo: cadastro.tipo,");
    expect(pasta).toContain("{ imagemNoBanco: produto.data?.imagem_url ?? \"\" }");
    // Gerar não troca foto enviada à mão, não gera serviço e manda o texto que a tela mostra.
    expect(foto.includes("substituir: !valor.trim() || gerada")).toBe(true);
    expect(foto.includes("textos: { nome: produto.nome, descricao: produto.descricao ?? null, familia: produto.familia ?? null }")).toBe(true);
    expect(foto.includes('produto?.tipo === "servico"')).toBe(true);
    expect(foto.includes('queryKey: ["produtos"]')).toBe(true);
    const fn = ler("src/lib/api/produtos-foto-ia.functions.ts");
    expect(fn.includes('.from("produtos_operacional")')).toBe(true);
    expect(fn.includes('.select("id, nome, descricao, familia, categoria, tipo, imagem_url")')).toBe(true);
    // Lê a foto atual ANTES de pagar a geração, troca só se ela ainda é a lida, e limpa o que sobra.
    // (lastIndexOf: as chamadas dentro do handler, não as definições das funções, que vêm antes no arquivo.)
    expect(fn.lastIndexOf("decidirGeracao(")).toBeLessThan(fn.lastIndexOf("gerarImagemPeloGateway(\n"));
    expect(fn.lastIndexOf("decidirGeracao(")).toBeGreaterThan(fn.indexOf("export const gerarFotoDoProduto"));
    expect(fn.includes('troca.eq("imagem_url", fotoLida)')).toBe(true);
    expect(fn.includes('troca.or("imagem_url.is.null,imagem_url.eq.")')).toBe(true);
    expect(fn.includes("tirarDoArmazenamento([caminho])")).toBe(true);
    expect(fn.includes("tirarDoArmazenamento([anterior])")).toBe(true);
    expect(fn.includes("crypto.randomUUID()")).toBe(true);
    // O handler guarda pela função testada abaixo, com o cliente de serviço.
    expect(fn.includes("return guardarFotoGerada({")).toBe(true);
    expect(fn.includes('const PAPEIS_QUE_GERAM = ["admin", "gestor"]')).toBe(true);
    expect(fn.includes("process.env.LOVABLE_API_KEY")).toBe(true);
  });
});
