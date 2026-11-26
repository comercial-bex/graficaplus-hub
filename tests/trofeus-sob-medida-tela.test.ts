import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/trofeus.functions", () => ({ cotarFichaSobMedida: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import type { CatalogoParaFicha } from "../src/domain/trofeus/ficha-comparar";
import type { FichaLida } from "../src/domain/trofeus/ficha-lida";
import { aoMudarAEspessura, linhasDaFicha, numeroDoCampo, pecaDaLinha, pedidoDaTela, SEM_ALTURA, SEM_QUANTIDADE } from "../src/domain/trofeus/sob-medida-tela";
import { CotarAsPecasDaFicha } from "../src/components/trofeus/cotar-pecas-da-ficha";

/**
 * "Cotar as peças da ficha" na tela (26/11/2026): o que ela pode e não pode fazer. O servidor está em
 * `tests/trofeus-sob-medida-no-servidor.test.ts` e a conta em `tests/trofeus-sob-medida.test.ts`.
 */

const ler = (caminho: string) => readFileSync(caminho, "utf8");
const semComentarios = (fonte: string) => fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const TELA = ler("src/components/trofeus/cotar-pecas-da-ficha.tsx");
const CARTAO_TEXTO = ler("src/components/trofeus/ler-a-ficha.tsx");

const CATALOGO: CatalogoParaFicha = {
  modelos: [],
  alturaMinimaCm: 12,
  alturaMaximaCm: 40,
  espessuraMaximaDeCorteMm: 10,
  materiais: [
    { id: "id-cristal-6", nome: "ACRILICO CRISTAL VIRGEM 6MM", espessuraMm: 6, unidade: "m²" },
    { id: "id-branco-2", nome: "ACRILICO BRANCO VIRGEM 2MM", espessuraMm: 2, unidade: "m²" },
    { id: "id-cristal-10", nome: "ACRILICO CRISTAL VIRGEM 10MM", espessuraMm: 10, unidade: "m²" },
    { id: "id-preto-3", nome: "ACRILICO PRETO VIRGEM 3MM", espessuraMm: 3, unidade: "m²" },
  ],
};

/** A ficha do JariCross 10 Anos: placa de 6 mm (existe), plaqueta de prata 2 mm e base preta de 10 mm (sem cadastro). */
const FICHA: FichaLida = {
  linha: "padrao",
  alturaCm: 18,
  larguraCm: 20,
  base: { larguraCm: 22, alturaCm: 5 },
  quantidade: 1,
  urgente: null,
  arte: null,
  nomesIndividuais: null,
  textos: [],
  observacoes: null,
  pecas: [
    { nome: "Placa principal", material: "Acrílico cristal", espessuraMm: 6, larguraCm: 20, alturaCm: 15, quantidade: 1, decoracao: "vinil_laminado", maquina: null },
    { nome: "Placa frontal da base", material: "Acrílico prata escovado", espessuraMm: 2, larguraCm: 16, alturaCm: 4, quantidade: 1, decoracao: "vinil_laminado", maquina: null },
    { nome: "Base", material: "Acrílico preto brilhante", espessuraMm: 10, larguraCm: 22, alturaCm: 5, quantidade: 1, decoracao: "nenhuma", maquina: null },
  ],
};

describe("as linhas iniciais vêm da ficha e do cadastro", () => {
  const linhas = linhasDaFicha(FICHA, CATALOGO);

  it("uma linha por peça, com os campos como texto e a vírgula do Brasil", () => {
    expect(linhas.map((l) => [l.nome, l.espessura, l.largura, l.altura, l.quantidade, l.decoracao])).toEqual([
      ["Placa principal", "6", "20", "15", "1", "vinil_laminado"],
      ["Placa frontal da base", "2", "16", "4", "1", "vinil_laminado"],
      ["Base", "10", "22", "5", "1", "nenhuma"],
    ]);
    expect(linhas.every((l) => l.fatorDeForma === "1")).toBe(true);
  });

  it("sugere o material do cadastro só quando há um igual (mesma cor e mesma espessura)", () => {
    expect(linhas[0].materialId).toBe("id-cristal-6");
    expect(linhas[1].materialId).toBe("");
    expect(linhas[2].materialId).toBe("");
  });

  it("não inventa material para a prata nem para o preto de 10 mm", () => {
    expect(linhas[1].materialSugeridoId).toBe("");
    expect(linhas[2].materialSugeridoId).toBe("");
  });

  it("peça sem medida na ficha vira campo vazio, nunca zero", () => {
    const sem: FichaLida = { ...FICHA, pecas: [{ ...FICHA.pecas[0], espessuraMm: null, larguraCm: null, alturaCm: null }] };
    const [l] = linhasDaFicha(sem, CATALOGO);
    expect([l.espessura, l.largura, l.altura]).toEqual(["", "", ""]);
  });
});

describe("a linha vira a peça que o servidor recebe", () => {
  const [placa, plaqueta] = linhasDaFicha(FICHA, CATALOGO);

  it("aceita vírgula e ponto", () => {
    expect(numeroDoCampo("6,5")).toBe(6.5);
    expect(numeroDoCampo("6.5")).toBe(6.5);
    expect(Number.isNaN(numeroDoCampo(""))).toBe(true);
    expect(Number.isNaN(numeroDoCampo("abc"))).toBe(true);
  });

  it("material igual ao da ficha: sem aviso de troca", () => {
    expect(pecaDaLinha(placa).materialPedido).toBeNull();
  });

  it("material escolhido diferente do que a ficha pedia: leva o que a ficha escreveu, para o aviso aparecer", () => {
    const escolhida = { ...plaqueta, materialId: "id-branco-2" };
    expect(pecaDaLinha(escolhida).materialPedido).toBe("Acrílico prata escovado");
    expect(pecaDaLinha(escolhida).materialId).toBe("id-branco-2");
  });

  it("peça cuja ficha não dizia o material: nada a avisar", () => {
    const livre = { ...plaqueta, materialDaFicha: null, materialId: "id-branco-2" };
    expect(pecaDaLinha(livre).materialPedido).toBeNull();
  });

  it("trocar a espessura solta o material que deixou de servir, e mantém o que ainda serve", () => {
    const base = { ...linhasDaFicha(FICHA, CATALOGO)[2], materialId: "id-cristal-10" };
    expect(aoMudarAEspessura(base, "3", CATALOGO).materialId).toBe("");
    expect(aoMudarAEspessura(base, "10", CATALOGO).materialId).toBe("id-cristal-10");
    expect(aoMudarAEspessura(base, "10,0", CATALOGO).materialId).toBe("id-cristal-10");
  });
});

describe("o pedido só sai completo", () => {
  const escolhidas = () =>
    linhasDaFicha(FICHA, CATALOGO).map((l, i) => ({ ...l, materialId: ["id-cristal-6", "id-branco-2", "id-cristal-10"][i] }));

  it("com tudo preenchido, devolve o pedido", () => {
    const r = pedidoDaTela(escolhidas(), "18", "3", true);
    expect(r).toMatchObject({ ok: true, pedido: { alturaCm: 18, quantidade: 3, urgente: true } });
    if (r.ok) expect(r.pedido.pecas).toHaveLength(3);
  });

  it("sem altura ou sem quantidade, diz o que falta", () => {
    expect(pedidoDaTela(escolhidas(), "", "1", false)).toEqual({ ok: false, problema: SEM_ALTURA });
    expect(pedidoDaTela(escolhidas(), "18", "0", false)).toEqual({ ok: false, problema: SEM_QUANTIDADE });
    expect(pedidoDaTela(escolhidas(), "18", "1,5", false)).toEqual({ ok: false, problema: SEM_QUANTIDADE });
  });

  it("peça sem material escolhido impede, dizendo qual", () => {
    const r = pedidoDaTela(linhasDaFicha(FICHA, CATALOGO), "18", "1", false);
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.problema).toMatch(/A peça 2 \("Placa frontal da base"\) está sem material/);
  });

  it("medida apagada impede, dizendo qual", () => {
    const ls = escolhidas();
    ls[2] = { ...ls[2], largura: "" };
    const r = pedidoDaTela(ls, "18", "1", false);
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.problema).toMatch(/A peça 3 \("Base"\) está com largura fora/);
  });
});

describe("a tela, desenhada no servidor", () => {
  function desenhar(ficha: FichaLida = FICHA, catalogo: CatalogoParaFicha = CATALOGO): string {
    const cliente = new QueryClient();
    return renderToStaticMarkup(createElement(QueryClientProvider, { client: cliente }, createElement(CotarAsPecasDaFicha, { ficha, catalogo })));
  }

  it("mostra uma linha por peça, com o que a ficha escreveu de material", () => {
    const html = desenhar();
    expect(html).toContain("Cotar as peças da ficha");
    expect(html.match(/data-testid="cotar-peca"/g)).toHaveLength(3);
    for (const nome of ["Placa principal", "Placa frontal da base", "Base"]) expect(html).toContain(nome);
    expect(html).toContain("Ficha: Acrílico prata escovado");
    expect(html).toContain("Ficha: Acrílico preto brilhante");
  });

  it("explica que não precisa de estoque", () => {
    expect(desenhar()).toMatch(/Não precisa ter a chapa em estoque/);
  });

  it("começa com a altura e a quantidade da ficha", () => {
    const html = desenhar();
    expect(html).toMatch(/id="cotar-altura"[^>]*value="18"/);
    expect(html).toMatch(/id="cotar-quantidade"[^>]*value="1"/);
  });

  it("o botão fica desligado enquanto falta escolher material, e a frase diz qual peça", () => {
    const html = desenhar();
    expect(html).toMatch(/data-testid="cotar-pecas-cotar"[^>]*disabled|disabled=""[^>]*data-testid="cotar-pecas-cotar"/);
    expect(html).toContain("A peça 2");
    expect(html).toContain("está sem material");
  });

  it("espessura sem chapa no cadastro diz como resolver, sem pedir estoque", () => {
    const html = desenhar(FICHA, { ...CATALOGO, materiais: CATALOGO.materiais.filter((m) => m.espessuraMm !== 10) });
    expect(html).toContain("Nenhuma chapa dessa espessura no cadastro");
    expect(html).toContain("não precisa de estoque");
  });

  it("ficha sem peças não desenha nada", () => {
    expect(desenhar({ ...FICHA, pecas: [] })).toBe("");
  });

  it("não há resultado nem erro antes de cotar", () => {
    const html = desenhar();
    expect(html).not.toContain("cotar-pecas-resultado");
    expect(html).not.toContain("cotar-pecas-erro");
  });
});

describe("a tela nunca calcula preço, nem grava, nem lê o banco", () => {
  const codigo = semComentarios(TELA);

  it("só chama o servidor de cotar a ficha", () => {
    expect(codigo).toContain("cotarFichaSobMedida");
    expect(codigo).not.toMatch(/cotarTrofeu\b|salvarTrofeuNoOrcamento|escadaDoTrofeu|dadosDoTrofeu|salvar_trofeu|insert\(|\.upload\(/);
  });

  it("não lê o banco do navegador, nem chave", () => {
    expect(codigo).not.toMatch(/integrations\/supabase|supabase\.from\(|\.rpc\(|process\.env|import\.meta\.env|LOVABLE_API_KEY/);
  });

  it("não faz conta de dinheiro: só mostra o que o servidor devolveu", () => {
    // Operador entre um valor de dinheiro e outro número (o hífen só conta com espaços: "cotar-preco-unitario" é um nome).
    expect(codigo).not.toMatch(/\b(preco|custo|margem|multiplicador)\w*\)?\s*[*/+]\s*[\w(]/i);
    expect(codigo).not.toMatch(/\b(preco|custo|margem|multiplicador)\w*\)?\s+-\s+[\w(]/i);
    expect(codigo).not.toMatch(/Math\.(round|ceil|floor)\(\s*(resposta|r|cotar\.data)\./);
  });

  it("quem não vê custo não ganha o bloco de custo: ele só aparece quando o servidor devolveu `custoCheio`", () => {
    expect(codigo).toMatch(/"custoCheio" in c/);
    expect(codigo).toMatch(/comCusto\(resposta\) && \(/);
  });

  it("qualquer edição apaga o preço antigo", () => {
    expect(codigo).toMatch(/cotar\.reset\(\)/);
  });

  it("segue as regras do projeto: sem `as any`, console.log, title= nem text-primary", () => {
    expect(TELA).not.toMatch(/\bas any\b/);
    expect(TELA).not.toMatch(/console\.log/);
    expect(TELA).not.toMatch(/\stitle=/);
    expect(TELA).not.toMatch(/text-primary/);
  });
});

describe("o cartão Ler a ficha só mostra a cotação quando a ficha tem peças", () => {
  it("monta o componente com a ficha e o catálogo lidos, e reinicia a cada leitura nova", () => {
    expect(CARTAO_TEXTO).toMatch(/ok\.ficha\.pecas\.length > 0 && <CotarAsPecasDaFicha key=\{ler\.submittedAt\} ficha=\{ok\.ficha\} catalogo=\{ok\.catalogo\} \/>/);
  });

  it("o cartão continua sem falar de preço nem de custo (a cotação mora no outro componente)", () => {
    expect(CARTAO_TEXTO.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/custo|multiplicador|R\$|cotarTrofeu|cotarFichaSobMedida/i);
  });
});
