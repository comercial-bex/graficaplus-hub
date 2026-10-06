import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  MODALIDADES,
  ROTULO_DA_MODALIDADE,
  fatorDaUnidade,
  UNIDADES_DE_PRECO,
} from "../src/domain/catalogo/modalidades";
import {
  REGRAS_VAZIAS,
  arredondar,
  calcularPreco,
  emReais,
  precoDaPeca,
  precoDeVenda,
  type LinhaParaPrecificar,
  type RegrasDeVenda,
} from "../src/domain/catalogo/preco-de-venda";
import { conferirQuantidade, quantidadeInicial, quantidadeParaCliente } from "../src/domain/catalogo/quantidade";
import {
  mensagemDoPedido,
  situacaoDaVitrine,
  tokenDoCatalogoBemFormado,
  urlDaVitrine,
  validadeDoLink,
  whatsappDaEmpresa,
} from "../src/domain/catalogo/link-do-catalogo";
import {
  caminhoDaFotoNoStorage,
  codigoDoArquivo,
  conferirFotos,
  urlDaFoto,
} from "../src/domain/catalogo/fotos";
import { filtrarItens, fotosParaApontar, itemDaLinha, type ItemDoCatalogo } from "../src/domain/catalogo/itens";
import { CHAVES_DA_VITRINE, menorPreco, vitrineFechada } from "../src/domain/catalogo/vitrine";

/**
 * O catálogo de fornecedores tem a conta do preço no BANCO e o espelho dela na
 * tela (prévia ao vivo). Os números abaixo são os mesmos do ensaio do banco de
 * 05/10/2026 — se o espelho divergir, a tela mostra um preço e o orçamento
 * grava outro.
 */

const MIGRACAO = readFileSync(
  resolve(__dirname, "../supabase/migrations/20261005200000_catalogo_de_fornecedores.sql"),
  "utf8",
);

describe("o espelho confere com o banco", () => {
  it("os rótulos das opções são os mesmos de fornecedor_rotulo_modalidade()", () => {
    const corpo = MIGRACAO.slice(MIGRACAO.indexOf("FUNCTION public.fornecedor_rotulo_modalidade"));
    const doBanco = Object.fromEntries(
      [...corpo.slice(0, corpo.indexOf("$f$;")).matchAll(/WHEN '([a-z0-9_]+)' THEN '([^']+)'/g)].map((m) => [m[1], m[2]]),
    );
    expect(doBanco).toEqual(ROTULO_DA_MODALIDADE);
  });

  it("as opções e as unidades são as dos CHECK das tabelas", () => {
    const opcoes = MIGRACAO.match(/modalidade text NOT NULL CHECK \(modalidade IN \(([^)]*)\)\)/)![1];
    expect([...opcoes.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1])).toEqual([...MODALIDADES]);
    const unidades = MIGRACAO.match(/CHECK \(unidade_preco IN \(([^)]*)\)\)/)![1];
    expect([...unidades.matchAll(/'([a-z]+)'/g)].map((m) => m[1])).toEqual([...UNIDADES_DE_PRECO]);
  });

  it("o fator da unidade é o de fornecedor_fator_unidade()", () => {
    expect(MIGRACAO).toMatch(/WHEN 'cento' THEN 100 WHEN 'milheiro' THEN 1000 ELSE 1/);
    expect(fatorDaUnidade("cento")).toBe(100);
    expect(fatorDaUnidade("milheiro")).toBe(1000);
    expect(fatorDaUnidade("pacote")).toBe(1);
  });

  it("as frases de quantidade são as que o banco devolve", () => {
    for (const frase of [
      "Informe a quantidade em peças inteiras (maior que zero).",
      "A quantidade mínima de",
      "é vendido de % em %: use %.",
      "A tabela do fornecedor só traz preço para %s; acima disso, confirme o custo antes de enviar.",
    ]) {
      expect(MIGRACAO).toContain(frase);
    }
  });
});

describe("preço de venda", () => {
  // Ensaio do banco: margem 60%, frete R$ 0,10 por peça, arredondamento R$ 0,50.
  const base = { margemPct: 60, fretePorPeca: 0.1, fator: 1, arredondamento: 0.5, precoFixo: null };

  it("custo + frete, vezes a margem, arredondado para cima no passo", () => {
    expect(precoDeVenda({ ...base, custo: 20.73 })).toBe(33.5); // (20,73 + 0,10) × 1,6 = 33,328
    expect(precoDeVenda({ ...base, custo: 22.38 })).toBe(36); // 35,968
    // Cento: o frete é por peça, então conta 100 vezes.
    expect(precoDeVenda({ ...base, custo: 279, fator: 100 })).toBe(462.5); // (279 + 10) × 1,6 = 462,4
    expect(precoDeVenda({ ...base, custo: 20.73, margemPct: 80 })).toBe(37.5); // margem da seção
  });

  it("preço fixo ignora custo e margem; sem custo ou sem margem é sob consulta, nunca zero", () => {
    expect(precoDeVenda({ ...base, custo: 20.73, precoFixo: 49.9 })).toBe(49.9);
    expect(precoDeVenda({ ...base, custo: null })).toBeNull();
    expect(precoDeVenda({ ...base, custo: 20.73, margemPct: null })).toBeNull();
    expect(precoDeVenda({ ...base, custo: 0, precoFixo: null })).toBe(0.5); // só o frete, arredondado
  });

  it("o resto de conta do ponto flutuante não sobe um passo", () => {
    // 31,20 ÷ 0,10 dá 311,99999… no float: sem o arredondamento em 6 casas viraria 31,30.
    expect(precoDeVenda({ custo: 19.5, margemPct: 60, fretePorPeca: 0, fator: 1, arredondamento: 0.1, precoFixo: null })).toBe(31.2);
    expect(arredondar(1.005, 2)).toBe(1.01);
    expect(arredondar(0.125, 2)).toBe(0.13);
    expect(precoDaPeca(462.5, "cento")).toBe(4.625);
  });

  it("precedência: preço fixo > margem do item > da seção > do catálogo; frete idem; arredondamento do catálogo", () => {
    const regras: RegrasDeVenda = {
      catalogo: { margem_pct: 60, frete_por_peca: 0.1, arredondamento: 0.5 },
      secoes: { s1: { margem_pct: 80 } },
      itens: { i2: { margem_pct: 100, frete_por_peca: 0 }, i3: { precos_fixos: { sem_gravacao: 49.9 } } },
    };
    const linha = (p: Partial<LinhaParaPrecificar>): LinhaParaPrecificar => ({
      itemId: "i1",
      secaoId: null,
      situacao: "ativo",
      emDuvida: false,
      unidade: "unidade",
      modalidade: "sem_gravacao",
      custo: 20.73,
      ...p,
    });
    expect(calcularPreco(linha({}), regras)).toEqual({ preco: 33.5, motivo: null, origem: "catalogo" });
    expect(calcularPreco(linha({ secaoId: "s1" }), regras)).toEqual({ preco: 37.5, motivo: null, origem: "secao" });
    expect(calcularPreco(linha({ itemId: "i2", secaoId: "s1" }), regras)).toEqual({
      preco: 41.5, // 20,73 × 2 = 41,46 → 41,50
      motivo: null,
      origem: "item",
    });
    expect(calcularPreco(linha({ itemId: "i3", secaoId: "s1" }), regras)).toEqual({
      preco: 49.9,
      motivo: null,
      origem: "preco_fixo",
    });
  });

  it("os motivos do sob consulta, na ordem do banco", () => {
    const regras: RegrasDeVenda = { catalogo: { margem_pct: 60 }, secoes: {}, itens: {} };
    const l: LinhaParaPrecificar = {
      itemId: "i",
      secaoId: null,
      situacao: "ativo",
      emDuvida: false,
      unidade: "unidade",
      modalidade: "sem_gravacao",
      custo: 10,
    };
    expect(calcularPreco({ ...l, situacao: "fora_da_tabela" }, regras).motivo).toBe("fora_da_tabela");
    expect(calcularPreco({ ...l, emDuvida: true }, regras).motivo).toBe("em_duvida");
    expect(calcularPreco({ ...l, custo: null }, regras).motivo).toBe("sem_custo");
    expect(calcularPreco(l, REGRAS_VAZIAS).motivo).toBe("sem_regra");
    expect(calcularPreco(l, REGRAS_VAZIAS).preco).toBeNull();
  });

  it("custo de 3 casas aparece inteiro", () => {
    expect(emReais(0.072).replace(/\s/g, " ")).toBe("R$ 0,072");
    expect(emReais(20.73).replace(/\s/g, " ")).toBe("R$ 20,73");
    expect(emReais(null)).toBe("—");
  });
});

describe("quantidade", () => {
  const regra = { quantidadeMinima: 10, multiplo: 10, faixa: null, faixaMax: null };

  it("recusa com as frases do banco e sugere a quantidade certa", () => {
    expect(conferirQuantidade(15, regra, "Sem gravação")).toEqual({
      ok: false,
      mensagem: '"Sem gravação" é vendido de 10 em 10: use 20.',
      sugestao: 20,
    });
    expect(conferirQuantidade(5, regra, "Sem gravação")).toEqual({
      ok: false,
      mensagem: 'A quantidade mínima de "Sem gravação" é 10 peças.',
      sugestao: 10,
    });
    expect(conferirQuantidade(2.5, regra, "x").ok).toBe(false);
    expect(conferirQuantidade(0, regra, "x").ok).toBe(false);
    expect(conferirQuantidade(20, regra, "x")).toEqual({ ok: true, aviso: null });
  });

  it("acima da faixa da tabela passa, com aviso", () => {
    const faixa = { quantidadeMinima: 100, multiplo: null, faixa: "100 a 199 peças", faixaMax: 199 };
    const r = conferirQuantidade(250, faixa, "Com gravação");
    expect(r.ok).toBe(true);
    expect(r.ok && r.aviso).toContain("100 a 199 peças");
  });

  it("a quantidade inicial já respeita mínimo e múltiplo", () => {
    expect(quantidadeInicial({ quantidadeMinima: 15, multiplo: 10 })).toBe(20);
    expect(quantidadeInicial({ quantidadeMinima: null, multiplo: null })).toBe(1);
  });

  it("em linguagem de cliente", () => {
    expect(quantidadeParaCliente({ quantidadeMinima: 100, multiplo: 10, faixa: null })).toBe(
      "Pedido mínimo de 100 peças, de 10 em 10",
    );
    expect(quantidadeParaCliente({ quantidadeMinima: 1000, multiplo: 1000, faixa: null })).toBe(
      "Vendido de 1.000 em 1.000 peças",
    );
    expect(quantidadeParaCliente({ quantidadeMinima: 100, multiplo: null, faixa: "100 a 199 peças" })).toBe(
      "Pedido mínimo de 100 peças · preço para 100 a 199 peças",
    );
    expect(quantidadeParaCliente({ quantidadeMinima: null, multiplo: null, faixa: null })).toBeNull();
  });
});

describe("link da vitrine", () => {
  it("token de 43 caracteres base64url, sem ponto (nunca casa com o nome de uma foto)", () => {
    expect(tokenDoCatalogoBemFormado("a".repeat(43))).toBe(true);
    expect(tokenDoCatalogoBemFormado("a".repeat(42))).toBe(false);
    expect(tokenDoCatalogoBemFormado("0123456789abcdef.webp")).toBe(false);
    expect(tokenDoCatalogoBemFormado(null)).toBe(false);
  });

  it("validade entre 1 e 90 dias", () => {
    expect(validadeDoLink("30")).toBe(30);
    expect(validadeDoLink(500)).toBe(90);
    expect(validadeDoLink(0)).toBe(1);
    expect(validadeDoLink("abc")).toBe(30);
  });

  it("o WhatsApp da gráfica é o primeiro celular do texto livre da empresa", () => {
    expect(whatsappDaEmpresa("(96) 99113-6169 · (96) 99111-6169 · (96) 99111-8090")).toBe("5596991136169");
    expect(whatsappDaEmpresa("(96) 3222-1234 / (96) 98111-0000")).toBe("5596981110000");
    expect(whatsappDaEmpresa("(96) 3222-1234")).toBe("559632221234");
    expect(whatsappDaEmpresa("ligue na loja")).toBeNull();
    expect(whatsappDaEmpresa(null)).toBeNull();
  });

  it("o pedido leva os códigos BX — nunca o código do fornecedor", () => {
    const m = mensagemDoPedido("Brindes de fim de ano", [
      { codigo: "BX-0001", nome: "Agenda Lisa Preta", opcao: "Sem gravação" },
      { codigo: "BX-0042", nome: "Caneta", opcao: null },
    ]);
    expect(m).toContain("• BX-0001 — Agenda Lisa Preta (Sem gravação)");
    expect(m).toContain("• BX-0042 — Caneta");
    expect(urlDaVitrine("https://app.exemplo/", "t".repeat(43))).toBe(`https://app.exemplo/catalogo/${"t".repeat(43)}`);
  });

  it("situação: cancelado > vencido > ativo; data ilegível é vencido", () => {
    const agora = new Date("2026-10-05T12:00:00Z");
    expect(situacaoDaVitrine({ expira_em: "2026-11-01T00:00:00Z", revogado_em: null }, agora)).toBe("ativo");
    expect(situacaoDaVitrine({ expira_em: "2026-10-01T00:00:00Z", revogado_em: null }, agora)).toBe("vencido");
    expect(situacaoDaVitrine({ expira_em: "2026-11-01T00:00:00Z", revogado_em: "2026-10-02T00:00:00Z" }, agora)).toBe(
      "cancelado",
    );
    expect(situacaoDaVitrine({ expira_em: "ontem", revogado_em: null }, agora)).toBe("vencido");
  });
});

describe("fotos", () => {
  const publica = (c: string) => `https://storage/catalogo-fotos/${c}`;
  const uuid = "2d1b6c1e-1111-4222-8333-444455556666";

  it("o caminho opaco vira URL; caminho fora do formato não vira URL nenhuma", () => {
    expect(urlDaFoto({ origem: "repositorio", caminho: "/catalogo/0123456789abcdef.webp" }, publica)).toBe(
      "/catalogo/0123456789abcdef.webp",
    );
    expect(urlDaFoto({ origem: "repositorio", caminho: "/catalogo/LG3561.webp" }, publica)).toBeNull();
    expect(urlDaFoto({ origem: "storage", caminho: `${uuid}/${uuid}.jpg` }, publica)).toBe(publica(`${uuid}/${uuid}.jpg`));
    expect(urlDaFoto({ origem: "storage", caminho: `${uuid}/LG3561.jpg` }, publica)).toBeNull();
    expect(urlDaFoto(null, publica)).toBeNull();
  });

  it("o nome do arquivo é o código; o caminho no armazenamento é sorteado", () => {
    expect(codigoDoArquivo("LG3561.webp")).toBe("LG3561");
    expect(codigoDoArquivo("6035-8ZN.JPG")).toBe("6035-8ZN");
    expect(caminhoDaFotoNoStorage(uuid, uuid, "image/jpeg")).toBe(`${uuid}/${uuid}.jpg`);
    expect(caminhoDaFotoNoStorage(uuid, uuid, "image/gif")).toBeNull();
    const r = conferirFotos([
      { name: "LG1.webp", type: "image/webp", size: 1000 },
      { name: "grande.png", type: "image/png", size: 3 * 1024 * 1024 },
      { name: "doc.pdf", type: "application/pdf", size: 10 },
    ]);
    expect(r.validas).toEqual([{ indice: 0, codigo: "LG1" }]);
    expect(r.problemas.map((p) => p.arquivo)).toEqual(["grande.png", "doc.pdf"]);
  });
});

describe("grade de itens", () => {
  const item = (p: Partial<ItemDoCatalogo>): ItemDoCatalogo =>
    itemDaLinha({
      id: p.id ?? "i",
      catalogo_id: "c",
      codigo_bex: "BX-0012",
      codigo_fornecedor: "LG3561",
      descricao: "CANETA DE METAL AZUL",
      nome: "Caneta de Metal Azul",
      unidade_preco: "unidade",
      situacao: "ativo",
      tem_foto: true,
      ordem: 1,
      fornecedor_item_modalidades: [],
      ...p,
    });

  it("busca sem acento e sem caixa, por nome, código BX ou código do fornecedor", () => {
    const itens = [
      item({ id: "a" }),
      item({ id: "b", codigo_bex: "BX-0200", codigo_fornecedor: "100L", nome: "Agenda Lisa", descricao: "AGENDA" }),
    ];
    const achar = (busca: string) => filtrarItens(itens, { busca, secaoId: null, filtro: "todos" }).map((i) => i.id);
    expect(achar("bx12")).toEqual(["a"]);
    expect(achar("BX-0200")).toEqual(["b"]);
    expect(achar("lg3561")).toEqual(["a"]);
    expect(achar("canéta azul")).toEqual(["a"]);
    expect(achar("")).toEqual(["a", "b"]);
  });

  it("os filtros de trabalho", () => {
    const itens = [
      item({ id: "com" }),
      item({ id: "sem", tem_foto: false, foto_conferir: true }),
      item({ id: "fora", situacao: "fora_da_tabela" }),
      item({ id: "duvida", em_duvida: true }),
    ];
    const f = (filtro: Parameters<typeof filtrarItens>[1]["filtro"]) =>
      filtrarItens(itens, { busca: "", secaoId: null, filtro }).map((i) => i.id);
    expect(f("sem_foto")).toEqual(["sem"]);
    expect(f("foto_a_conferir")).toEqual(["sem"]);
    expect(f("fora_da_tabela")).toEqual(["fora"]);
    expect(f("em_duvida")).toEqual(["duvida"]);
    // Sem preços carregados, "sem preço" não chuta: não lista nada.
    expect(f("sem_preco")).toEqual([]);
  });

  it("fotos para apontar: as do mesmo código (normalizado) primeiro", () => {
    const fotos = [
      { id: "1", codigo_fornecedor: "LG 3561", legenda: "Caneta azul", origem: "repositorio" as const, caminho: "/catalogo/0123456789abcdef.webp" },
      { id: "2", codigo_fornecedor: "LG9999", legenda: "Caneta verde metal", origem: "repositorio" as const, caminho: "/catalogo/0123456789abcdee.webp" },
    ];
    const r = fotosParaApontar(fotos, { codigo_fornecedor: "LG3561" }, "verde");
    expect(r.doCodigo.map((f) => f.id)).toEqual(["1"]);
    expect(r.outras.map((f) => f.id)).toEqual(["2"]);
  });
});

describe("a vitrine leva só as chaves combinadas", () => {
  const bruto = {
    situacao: "aberto",
    vence_em: "2026-11-04T00:00:00Z",
    titulo: "Brindes",
    // Chaves que NÃO podem chegar ao cliente, como se o banco as mandasse por engano:
    fornecedor: "LUGA",
    empresa: { nome: "BEX PRINT", slogan: null, cidade: "Macapá", estado: "AP", telefones: "(96) 99113-6169", cnpj: "x" },
    itens: [
      {
        codigo: "BX-0001",
        nome: "Agenda",
        especificacao: null,
        dimensoes: null,
        secao: "AGENDAS",
        unidade_preco: "unidade",
        codigo_fornecedor: "100L",
        descricao: "AGENDA LISA PRETA",
        custo: 20.73,
        foto: { origem: "repositorio", caminho: "/catalogo/0123456789abcdef.webp", legenda: "x" },
        opcoes: [
          { modalidade: "sem_gravacao", rotulo: "Sem gravação", preco: 33.5, custo: 20.73, margem_pct: 60, quantidade_minima: 10, multiplo: 10, faixa: null },
          { modalidade: "gravada_1_cor", rotulo: "Gravada em silk 1 cor", preco: 0, quantidade_minima: 100, multiplo: null, faixa: null },
        ],
      },
      { codigo: "LG3561", nome: "sem código BX", foto: { origem: "repositorio", caminho: "/catalogo/x.webp" }, opcoes: [] },
      { codigo: "BX-0002", nome: "sem foto", opcoes: [] },
    ],
  };

  it("chave fora da lista some; item sem BX ou sem foto não vai; preço zero vira sob consulta", () => {
    const v = vitrineFechada(bruto)!;
    expect(Object.keys(v).sort()).toEqual([...CHAVES_DA_VITRINE.raiz].sort());
    expect(Object.keys(v.empresa).sort()).toEqual([...CHAVES_DA_VITRINE.empresa].sort());
    expect(v.itens).toHaveLength(1);
    expect(Object.keys(v.itens[0]).sort()).toEqual([...CHAVES_DA_VITRINE.item].sort());
    expect(Object.keys(v.itens[0].foto).sort()).toEqual([...CHAVES_DA_VITRINE.foto].sort());
    for (const o of v.itens[0].opcoes) expect(Object.keys(o).sort()).toEqual([...CHAVES_DA_VITRINE.opcao].sort());
    expect(v.itens[0].opcoes.map((o) => o.preco)).toEqual([33.5, null]);
    expect(menorPreco(v.itens[0])).toBe(33.5);
    const texto = JSON.stringify(v);
    for (const proibido of ["custo", "margem", "codigo_fornecedor", "descricao", "LUGA", "100L", "cnpj", "legenda"]) {
      expect(texto, proibido).not.toContain(proibido);
    }
  });

  it("a lista de chaves não tem nada de dinheiro de dentro nem de fornecedor", () => {
    const todas = Object.values(CHAVES_DA_VITRINE).flat().join(" ");
    expect(todas).not.toMatch(/custo|margem|fornecedor|regra|motivo|descricao/);
  });

  it("forma desconhecida não vira vitrine", () => {
    expect(vitrineFechada(null)).toBeNull();
    expect(vitrineFechada({ titulo: "x" })).toBeNull();
    expect(vitrineFechada([])).toBeNull();
  });
});
