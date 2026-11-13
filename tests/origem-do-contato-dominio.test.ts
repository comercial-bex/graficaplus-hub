import { describe, expect, it } from "vitest";
import {
  frasesDaOrigemDoTipo,
  normalizarTexto,
  produtoDoAnuncio,
  textoTemPalavra,
  tipoDoAnuncio,
  validarPalavra,
} from "../src/domain/whatsapp/origem-do-contato";

const CONJUNTOS = [
  { conjunto_id: "120252255931120481", tipo: "cliente_final" as const, ativo: true },
  { conjunto_id: "120252255945380481", tipo: "parceiro" as const, ativo: true },
  { conjunto_id: "999999999999", tipo: "parceiro" as const, ativo: false },
];

describe("normalizarTexto (espelho do banco)", () => {
  it("tira acento, caixa, pontuação e espaços repetidos", () => {
    expect(normalizarTexto("  Quero SER Parceiro!!  ")).toBe("quero ser parceiro");
    expect(normalizarTexto("Terceirizáda, ção-ñ")).toBe("terceirizada cao n");
    expect(normalizarTexto("a\n\tb")).toBe("a b");
  });
  it("entrada que não é texto vira vazio", () => {
    for (const v of [null, undefined, 3, {}, []]) expect(normalizarTexto(v)).toBe("");
  });
});

describe("validarPalavra", () => {
  it("recusa vazia e curta, mostra como será guardada", () => {
    expect(validarPalavra("   ").ok).toBe(false);
    expect(validarPalavra("abc").ok).toBe(false);
    expect(validarPalavra("a b c")).toMatchObject({ ok: false });
    expect(validarPalavra("Quero ser Parceiro!")).toEqual({ ok: true, palavra: "quero ser parceiro" });
  });
});

describe("textoTemPalavra", () => {
  it("fronteira só à esquerda", () => {
    expect(textoTemPalavra("ser parceiros", ["ser parceiro"])).toBe(true);
    expect(textoTemPalavra("meu parceiro indicou", ["ser parceiro"])).toBe(false);
    expect(textoTemPalavra("superparceria", ["parceria"])).toBe(false);
  });
  it("palavra vazia na lista nunca casa tudo", () => {
    expect(textoTemPalavra("qualquer coisa", [""])).toBe(false);
    expect(textoTemPalavra("qualquer coisa", ["  "])).toBe(false);
  });
});

describe("tipoDoAnuncio", () => {
  it("o tipo vem do conjunto", () => {
    expect(tipoDoAnuncio({ conjunto_id: "120252255931120481" }, CONJUNTOS)).toEqual({ tipo: "cliente_final", motivo: "ok" });
    expect(tipoDoAnuncio({ conjunto_id: "120252255945380481" }, CONJUNTOS)).toEqual({ tipo: "parceiro", motivo: "ok" });
  });
  it("sem conjunto, conjunto inativo ou desconhecido: tipo a confirmar", () => {
    expect(tipoDoAnuncio({ conjunto_id: null }, CONJUNTOS)).toEqual({ tipo: null, motivo: "sem_conjunto" });
    expect(tipoDoAnuncio(null, CONJUNTOS).tipo).toBeNull();
    expect(tipoDoAnuncio({ conjunto_id: "999999999999" }, CONJUNTOS)).toEqual({ tipo: null, motivo: "conjunto_inativo" });
    expect(tipoDoAnuncio({ conjunto_id: "1" }, CONJUNTOS)).toEqual({ tipo: null, motivo: "conjunto_desconhecido" });
  });
});

describe("produtoDoAnuncio", () => {
  it("o do anúncio vence; vazio herda o padrão do conjunto", () => {
    expect(produtoDoAnuncio({ produto: "Lona" }, { produto_padrao: "Geral" })).toBe("Lona");
    expect(produtoDoAnuncio({ produto: "  " }, { produto_padrao: "Geral" })).toBe("Geral");
    expect(produtoDoAnuncio({ produto: null }, null)).toBeNull();
    expect(produtoDoAnuncio(null, { produto_padrao: " " })).toBeNull();
  });
});

describe("frasesDaOrigemDoTipo", () => {
  it("diz de onde veio a etiqueta, só para a equipe", () => {
    expect(frasesDaOrigemDoTipo({ tipo: null, origem: null }).origem).toBe("Ainda sem tipo. Marque quando souber.");
    expect(frasesDaOrigemDoTipo({ tipo: "parceiro", origem: "anuncio", anuncioNome: "Card X" }).origem).toBe("Marcado pelo anúncio Card X");
    expect(frasesDaOrigemDoTipo({ tipo: "parceiro", origem: "palavra" }).origem).toBe("Marcado pela palavra na primeira mensagem");
    expect(frasesDaOrigemDoTipo({ tipo: "parceiro", origem: "telefone" }).origem).toBe("Marcado porque é parceiro cadastrado");
    expect(frasesDaOrigemDoTipo({ tipo: "cliente_final", origem: "manual" }).origem).toBe("Marcado por você");
    expect(frasesDaOrigemDoTipo({ tipo: "cliente_final", origem: "manual", produto: "Lona" }).produto).toBe("Produto do anúncio: Lona");
  });
});
