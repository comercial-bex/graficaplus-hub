import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import secoesDaLuga from "./fixtures/catalogo-secoes.json";
import {
  CATEGORIAS,
  CHAVES_DE_CATEGORIA,
  COMBINA_COM,
  categoriaDaSecao,
  categoriaPeloTitulo,
  ehCategoria,
  type Categoria,
} from "../src/domain/catalogo/categorias-da-loja";
import {
  alternativas,
  aPartirDe,
  azulejosDeCategorias,
  buscarNaLoja,
  combinaCom,
  itemDaLojaDaVitrine,
  itemDaLojaDoCatalogo,
  sugestoesDoCarrinho,
  type ItemDaLoja,
} from "../src/domain/catalogo/loja";
import {
  adicionarAoCarrinho,
  alterarQuantidade,
  conferirCarrinho,
  itensParaOrcar,
  lerCarrinho,
  linhaDoCarrinho,
  removerDoCarrinho,
  resumoDoCarrinho,
  serializarCarrinho,
  somarPasso,
  totalDaLinha,
  chaveDeArmazenamento,
} from "../src/domain/catalogo/carrinho";
import {
  CHAVES_DA_COTACAO,
  mensagemDaCotacao,
  pedidoDeCotacaoFechado,
  pedidoDoCarrinho,
  telefoneBemFormado,
} from "../src/domain/catalogo/cotacao";
import { itemDaLinha, type SecaoDoCatalogo } from "../src/domain/catalogo/itens";
import { precoEmReais } from "../src/domain/catalogo/preco-de-venda";
import { vitrineFechada } from "../src/domain/catalogo/vitrine";

/**
 * A LOJA: o catálogo como mini e-commerce para orçar (06/10/2026).
 *
 * As 50 seções em `fixtures/catalogo-secoes.json` foram lidas do banco em
 * 06/10/2026 (`fornecedor_secoes`, 933 itens). O que estes testes seguram:
 *   - toda seção da LUGA tem categoria na migração, e a dedução pelo título
 *     (a rede de segurança para seção nova) chega à MESMA categoria;
 *   - a conta do carrinho é a da tela de orçamento (cento vira peça);
 *   - o passo do "+"/"−" respeita mínimo e múltiplo;
 *   - o pedido de cotação só sai com as chaves combinadas.
 */

const MIGRACAO = readFileSync(
  resolve(__dirname, "../supabase/migrations/20261007120000_catalogo_vitrine_e_carrinho.sql"),
  "utf8",
);

/** O CASE da migração: título → categoria. */
function mapaDaMigracao(): Map<string, string> {
  const inicio = MIGRACAO.indexOf("SET categoria = CASE upper(btrim(s.titulo))");
  const fim = MIGRACAO.indexOf("END\n WHERE s.categoria IS NULL", inicio);
  const corpo = MIGRACAO.slice(inicio, fim);
  const mapa = new Map<string, string>();
  for (const m of corpo.matchAll(/WHEN '((?:[^']|'')+)' THEN '([a-z]+)'/g))
    mapa.set(m[1].replace(/''/g, "'"), m[2]);
  return mapa;
}

describe("as categorias cobrem as 50 seções da LUGA", () => {
  const mapa = mapaDaMigracao();

  it("o retrato tem 50 seções e 933 itens", () => {
    expect(secoesDaLuga).toHaveLength(50);
    expect(secoesDaLuga.reduce((s, x) => s + x.itens, 0)).toBe(933);
  });

  it("toda seção tem categoria gravada na migração, e é uma categoria da lista", () => {
    const semMapa = secoesDaLuga.filter((s) => !mapa.has(s.titulo.toUpperCase()));
    expect(semMapa.map((s) => s.titulo)).toEqual([]);
    for (const s of secoesDaLuga)
      expect(ehCategoria(mapa.get(s.titulo.toUpperCase())), s.titulo).toBe(true);
  });

  it("o CHECK da coluna é a mesma lista de CATEGORIAS, na mesma ordem", () => {
    const check = MIGRACAO.match(/categoria IS NULL OR categoria IN \(([^)]*)\)/)![1];
    expect([...check.matchAll(/'([a-z]+)'/g)].map((m) => m[1])).toEqual([...CHAVES_DE_CATEGORIA]);
  });

  it("a dedução pelo título chega à mesma categoria da migração, nas 50", () => {
    const divergem = secoesDaLuga
      .map((s) => ({
        titulo: s.titulo,
        banco: mapa.get(s.titulo.toUpperCase()),
        titulo_deduz: categoriaPeloTitulo(s.titulo),
      }))
      .filter((x) => x.banco !== x.titulo_deduz);
    expect(divergem).toEqual([]);
  });

  it("a contagem por categoria fecha em 933 (o relatório do dono)", () => {
    const porCategoria: Record<string, number> = {};
    for (const s of secoesDaLuga) {
      const c = mapa.get(s.titulo.toUpperCase())!;
      porCategoria[c] = (porCategoria[c] ?? 0) + s.itens;
    }
    expect(porCategoria).toEqual({
      agendas: 165,
      cadernos: 180,
      canetas: 120,
      chaveiros: 142,
      copos: 80,
      calendarios: 113,
      sacolas: 24,
      utilidades: 14,
      sublimacao: 57,
      encadernacao: 29,
      outros: 9,
    });
    expect(Object.values(porCategoria).reduce((a, b) => a + b, 0)).toBe(933);
  });

  it("seção nova sem apontar cai pelo título, e no pior caso em Outros", () => {
    expect(categoriaDaSecao({ categoria: null, titulo: "CANETAS DE BAMBU" })).toBe("canetas");
    expect(categoriaDaSecao({ categoria: "copos", titulo: "QUALQUER COISA" })).toBe("copos");
    expect(categoriaDaSecao({ categoria: "nao_existe", titulo: "GARRAFA TÉRMICA" })).toBe("copos");
    expect(categoriaDaSecao({ categoria: null, titulo: "ZZZ" })).toBe("outros");
    expect(categoriaDaSecao(null)).toBe("outros");
  });

  it("todo 'combina com' aponta para categorias da lista, sem apontar para si mesma", () => {
    for (const c of CATEGORIAS) {
      const alvo = COMBINA_COM[c.chave];
      expect(alvo.length, c.chave).toBeGreaterThan(0);
      for (const d of alvo) {
        expect(ehCategoria(d), `${c.chave} → ${d}`).toBe(true);
        expect(d, c.chave).not.toBe(c.chave);
      }
    }
  });
});

/** Um item da loja de mentira, com uma opção com preço (ou sem). */
function item(
  codigo: string,
  categoria: Categoria,
  preco: number | null,
  extras: Partial<ItemDaLoja> = {},
): ItemDaLoja {
  return {
    codigo,
    nome: `Item ${codigo}`,
    especificacao: null,
    dimensoes: null,
    secao: `Seção ${categoria}`,
    categoria,
    unidade_preco: "unidade",
    foto: { origem: "repositorio", caminho: "/catalogo/0123456789abcdef.webp" },
    opcoes: [
      {
        modalidade: "sem_gravacao",
        rotulo: "Sem gravação",
        preco,
        quantidade_minima: 10,
        multiplo: 10,
        faixa: null,
        faixa_max: null,
      },
    ],
    ref: { origem: "catalogo", item_id: `id-${codigo}`, catalogo_id: "cat" },
    ordem: Number(codigo.replace(/\D/g, "")),
    ...extras,
  };
}

const LOJA: ItemDaLoja[] = [
  item("BX-0001", "canetas", 2.0),
  item("BX-0002", "canetas", 2.5),
  item("BX-0003", "canetas", 2.2),
  item("BX-0004", "canetas", 9.0),
  item("BX-0005", "canetas", null),
  item("BX-0006", "cadernos", 20),
  item("BX-0007", "cadernos", null),
  item("BX-0008", "agendas", 30),
  item("BX-0009", "chaveiros", 4),
  item("BX-0010", "copos", 15),
];

describe("alternativas e sugestões, por regra", () => {
  it("alternativas: mesma categoria e preço até 30% para cima ou para baixo, os mais próximos primeiro", () => {
    expect(alternativas(LOJA[0], LOJA).map((i) => i.codigo)).toEqual(["BX-0003", "BX-0002"]);
    // R$ 9,00 está fora dos 30% de R$ 2,00; o item sem preço nunca entra por preço.
  });

  it("item sem preço cai para a mesma seção", () => {
    expect(alternativas(LOJA[4], LOJA).map((i) => i.codigo)).toEqual([
      "BX-0001",
      "BX-0002",
      "BX-0003",
      "BX-0004",
    ]);
  });

  it("combina com: as categorias complementares, uma rodada por categoria, com preço primeiro", () => {
    // canetas → cadernos, agendas, chaveiros
    expect(combinaCom(LOJA[0], LOJA).map((i) => i.codigo)).toEqual([
      "BX-0006",
      "BX-0008",
      "BX-0009",
      "BX-0007",
    ]);
  });

  it("sugestões do carrinho: sem repetir o que já está nele nem a própria categoria", () => {
    const sugeridos = sugestoesDoCarrinho(
      [
        { categoria: "canetas", codigo: "BX-0001" },
        { categoria: "cadernos", codigo: "BX-0006" },
      ],
      LOJA,
    ).map((i) => i.codigo);
    expect(sugeridos).not.toContain("BX-0001");
    expect(sugeridos).not.toContain("BX-0006");
    expect(sugeridos).not.toContain("BX-0002");
    expect(sugeridos).toContain("BX-0008");
    expect(sugeridos).toContain("BX-0009");
    expect(sugestoesDoCarrinho([], LOJA)).toEqual([]);
  });

  it("nunca mais de 6, e nunca o próprio item", () => {
    const muitos = Array.from({ length: 20 }, (_, n) =>
      item(`BX-01${String(n).padStart(2, "0")}`, "copos", 10 + n * 0.1),
    );
    const a = alternativas(muitos[0], muitos);
    expect(a).toHaveLength(6);
    expect(a.map((i) => i.codigo)).not.toContain(muitos[0].codigo);
  });

  it("os azulejos seguem a ordem da lista e mostram a foto de um item com preço", () => {
    const az = azulejosDeCategorias(LOJA);
    expect(az.map((a) => a.categoria)).toEqual([
      "canetas",
      "copos",
      "chaveiros",
      "cadernos",
      "agendas",
    ]);
    expect(az[0].quantidade).toBe(5);
    expect(az[0].foto).not.toBeNull();
  });

  it("a busca acha por código compacto e filtra por categoria", () => {
    expect(buscarNaLoja(LOJA, { busca: "bx7", categoria: null }).map((i) => i.codigo)).toEqual([
      "BX-0007",
    ]);
    expect(buscarNaLoja(LOJA, { busca: "", categoria: "cadernos" })).toHaveLength(2);
    expect(buscarNaLoja(LOJA, { busca: "item", categoria: "copos" }).map((i) => i.codigo)).toEqual([
      "BX-0010",
    ]);
  });
});

describe("o carrinho faz a conta da tela de orçamento", () => {
  const cento = item("BX-0100", "calendarios", 279, { unidade_preco: "cento" });
  const peca = item("BX-0001", "canetas", 2.5);

  it("preço do cento vira preço da peça: 279 o cento × 250 peças = R$ 697,50", () => {
    const l = linhaDoCarrinho(cento, cento.opcoes[0], 250);
    expect(totalDaLinha(l)).toBe(697.5);
  });

  it("linha sob consulta fica fora do subtotal — e o resumo diz quantas ficaram", () => {
    const c = [
      linhaDoCarrinho(peca, peca.opcoes[0], 100),
      linhaDoCarrinho(LOJA[4], LOJA[4].opcoes[0], 50),
    ];
    const r = resumoDoCarrinho(c);
    expect(r).toEqual({ linhas: 2, pecas: 150, comPreco: 1, semPreco: 1, subtotal: 250 });
    expect(resumoDoCarrinho([linhaDoCarrinho(LOJA[4], LOJA[4].opcoes[0], 50)]).subtotal).toBeNull();
    expect(resumoDoCarrinho([]).subtotal).toBeNull();
  });

  it("o mesmo item e a mesma opção somam; outra opção é outra linha", () => {
    let c = adicionarAoCarrinho([], linhaDoCarrinho(peca, peca.opcoes[0], 10));
    c = adicionarAoCarrinho(c, linhaDoCarrinho(peca, peca.opcoes[0], 20));
    expect(c).toHaveLength(1);
    expect(c[0].quantidade).toBe(30);
    const outra = {
      ...peca.opcoes[0],
      modalidade: "gravada_1_cor" as const,
      rotulo: "Gravada em silk 1 cor",
    };
    c = adicionarAoCarrinho(c, linhaDoCarrinho(peca, outra, 100));
    expect(c).toHaveLength(2);
    c = alterarQuantidade(c, c[0].chave, 0);
    expect(c).toHaveLength(1);
    c = removerDoCarrinho(c, c[0].chave);
    expect(c).toEqual([]);
  });

  it("o '+' e o '−' andam no múltiplo e não descem do mínimo", () => {
    const regra = { quantidadeMinima: 100, multiplo: 10 };
    expect(somarPasso(100, regra, 1)).toBe(110);
    expect(somarPasso(105, regra, 1)).toBe(110);
    expect(somarPasso(110, regra, -1)).toBe(100);
    expect(somarPasso(100, regra, -1)).toBe(100);
    expect(somarPasso(1, { quantidadeMinima: null, multiplo: null }, -1)).toBe(1);
    expect(somarPasso(1_000_000, regra, 1)).toBe(1_000_000);
  });

  it("quantidade fora da regra é acusada com a frase do banco", () => {
    const c = [linhaDoCarrinho(peca, peca.opcoes[0], 15)];
    expect(conferirCarrinho(c)).toEqual([
      {
        chave: "BX-0001|sem_gravacao",
        mensagem: '"Sem gravação" é vendido de 10 em 10: use 20.',
        sugestao: 20,
      },
    ]);
    expect(conferirCarrinho([linhaDoCarrinho(peca, peca.opcoes[0], 20)])).toEqual([]);
  });

  it("só linha com preço e com ref de catálogo vai para o orçamento; as outras ficam no carrinho", () => {
    const semRef = item("BX-0200", "copos", 5, { ref: null });
    const produto = item("BX-0300", "copos", 5, { ref: { origem: "produto", produto_id: "p1" } });
    const c = [
      linhaDoCarrinho(peca, peca.opcoes[0], 100),
      linhaDoCarrinho(LOJA[4], LOJA[4].opcoes[0], 50),
      linhaDoCarrinho(semRef, semRef.opcoes[0], 10),
      linhaDoCarrinho(produto, produto.opcoes[0], 10),
    ];
    const s = itensParaOrcar(c);
    expect(s.prontos).toEqual([
      { item_id: "id-BX-0001", modalidade: "sem_gravacao", quantidade: 100 },
    ]);
    expect(s.semPreco.map((l) => l.codigo)).toEqual(["BX-0005"]);
    expect(s.semRef.map((l) => l.codigo)).toEqual(["BX-0200", "BX-0300"]);
  });

  it("o que vai ao aparelho volta igual; lixo no aparelho vira carrinho vazio", () => {
    const c = [
      linhaDoCarrinho(cento, cento.opcoes[0], 250),
      linhaDoCarrinho(LOJA[4], LOJA[4].opcoes[0], 50),
    ];
    expect(lerCarrinho(serializarCarrinho(c))).toEqual(c);
    expect(lerCarrinho("{nao é json")).toEqual([]);
    expect(lerCarrinho(null)).toEqual([]);
    expect(
      lerCarrinho(
        JSON.stringify({
          v: 1,
          linhas: [{ codigo: "LG3561", modalidade: "sem_gravacao", quantidade: 10 }],
        }),
      ),
    ).toEqual([]);
    expect(
      lerCarrinho(
        JSON.stringify({
          v: 1,
          linhas: [{ codigo: "BX-0001", modalidade: "sem_gravacao", quantidade: 1.5 }],
        }),
      ),
    ).toEqual([]);
    // Preço zero guardado não vira oferta: volta como sob consulta.
    const zero = lerCarrinho(JSON.stringify({ v: 1, linhas: [{ ...c[0], preco: 0 }] }));
    expect(zero[0].preco).toBeNull();
  });

  it("a chave de armazenamento é uma por escopo e não aceita lixo", () => {
    expect(chaveDeArmazenamento("equipe")).toBe("bexprint:carrinho:equipe");
    expect(chaveDeArmazenamento("vitrine-abc/../x")).toBe("bexprint:carrinho:vitrine-abcx");
    expect(chaveDeArmazenamento("")).toBe("bexprint:carrinho:loja");
  });
});

describe("o item da loja nasce só com o que o cliente pode ver", () => {
  const linha: Record<string, unknown> = {
    id: "i1",
    catalogo_id: "c1",
    secao_id: "s1",
    codigo_bex: "BX-0042",
    codigo_fornecedor: "LG3561",
    descricao: "LG3561 CANETA METAL AZUL",
    nome: "Caneta de metal azul",
    unidade_preco: "unidade",
    tem_foto: true,
    foto_id: "f1",
    situacao: "ativo",
    ordem: 7,
    fornecedor_item_modalidades: [
      {
        modalidade: "gravada_1_cor",
        posicao: 2,
        quantidade_minima: 100,
        multiplo: null,
        faixa: "100 a 199 peças",
        faixa_max: 199,
      },
      { modalidade: "sem_gravacao", posicao: 1, quantidade_minima: 10, multiplo: 10 },
    ],
  };
  const secao: SecaoDoCatalogo = {
    id: "s1",
    ordem: 1,
    titulo: "CANETAS PLÁSTICAS - SEMI METAL E METAL",
    especificacao: "Caneta esferográfica",
    categoria: null,
  };
  const foto = { origem: "repositorio" as const, caminho: "/catalogo/0123456789abcdef.webp" };

  it("do catálogo da equipe: código BX, nome, categoria pelo título, preço por opção — nada do código do fabricante", () => {
    const i = itemDaLojaDoCatalogo(itemDaLinha(linha), foto, secao, [
      { modalidade: "sem_gravacao", preco: 3.5, motivo: null, regra: "catalogo", custo: 2.1 },
      { modalidade: "gravada_1_cor", preco: null, motivo: "sem_custo", regra: null },
    ])!;
    expect(i.codigo).toBe("BX-0042");
    expect(i.categoria).toBe("canetas");
    expect(i.opcoes.map((o) => [o.modalidade, o.preco])).toEqual([
      ["sem_gravacao", 3.5],
      ["gravada_1_cor", null],
    ]);
    expect(i.ref).toEqual({ origem: "catalogo", item_id: "i1", catalogo_id: "c1" });
    expect(JSON.stringify(i)).not.toMatch(/LG3561|custo|2\.1/);
    expect(aPartirDe(i)).toBe(3.5);
  });

  it("sem foto, fora da tabela ou sem a lista de preços: fora da loja ou sob consulta", () => {
    expect(
      itemDaLojaDoCatalogo(
        itemDaLinha({ ...linha, tem_foto: false, foto_id: null }),
        null,
        secao,
        [],
      ),
    ).toBeNull();
    expect(
      itemDaLojaDoCatalogo(itemDaLinha({ ...linha, situacao: "fora_da_tabela" }), foto, secao, []),
    ).toBeNull();
    const semPrecos = itemDaLojaDoCatalogo(itemDaLinha(linha), foto, secao, null)!;
    expect(semPrecos.opcoes.every((o) => o.preco === null)).toBe(true);
  });

  it("da vitrine do cliente: a categoria vem do banco ou do título, e não há ref", () => {
    const v = vitrineFechada({
      titulo: "Brindes",
      vence_em: "2026-11-01T00:00:00Z",
      empresa: {},
      itens: [
        {
          codigo: "BX-0001",
          nome: "Caneca branca",
          secao: "CANECA LIVE AAA",
          categoria: "copos",
          unidade_preco: "unidade",
          foto,
          opcoes: [
            {
              modalidade: "valor_unico",
              rotulo: "Preço",
              preco: 12,
              quantidade_minima: 12,
              multiplo: 12,
            },
          ],
        },
        {
          codigo: "BX-0002",
          nome: "Trena",
          secao: "TRENAS",
          categoria: "inventada",
          unidade_preco: "unidade",
          foto,
          opcoes: [],
        },
      ],
    })!;
    const itens = v.itens.map(itemDaLojaDaVitrine);
    expect(itens.map((i) => i.categoria)).toEqual(["copos", "utilidades"]);
    expect(itens[0].ref).toBeNull();
    expect(v.itens[1].categoria).toBeNull();
  });
});

describe("o pedido de cotação sai com as chaves combinadas", () => {
  it("telefone: só dígitos, com DDD", () => {
    expect(telefoneBemFormado("(96) 98424-1205")).toBe("96984241205");
    expect(telefoneBemFormado("+55 96 98424-1205")).toBe("5596984241205");
    expect(telefoneBemFormado("1234")).toBeNull();
    expect(telefoneBemFormado(96984241205)).toBeNull();
  });

  it("o corpo que chega vira pedido fechado, ou nada", () => {
    const ok = pedidoDeCotacaoFechado({
      nome: "  Maria  Silva ",
      telefone: "(96) 98424-1205",
      itens: [
        { codigo: "bx-0001", modalidade: "sem_gravacao", quantidade: 100, extra: "ignorada" },
      ],
      extra: "ignorada",
    })!;
    expect(ok).toEqual({
      nome: "Maria Silva",
      telefone: "96984241205",
      itens: [{ codigo: "BX-0001", modalidade: "sem_gravacao", quantidade: 100 }],
    });
    expect(Object.keys(ok)).toEqual([...CHAVES_DA_COTACAO.pedido]);
    expect(Object.keys(ok.itens[0])).toEqual([...CHAVES_DA_COTACAO.item]);
    expect(
      pedidoDeCotacaoFechado({
        nome: "M",
        telefone: "96984241205",
        itens: [{ codigo: "BX-0001", quantidade: 1 }],
      }),
    ).toBeNull();
    expect(
      pedidoDeCotacaoFechado({ nome: "Maria", telefone: "96984241205", itens: [] }),
    ).toBeNull();
    expect(
      pedidoDeCotacaoFechado({
        nome: "Maria",
        telefone: "96984241205",
        itens: [{ codigo: "LG3561", quantidade: 1 }],
      }),
    ).toBeNull();
    expect(
      pedidoDeCotacaoFechado({
        nome: "Maria",
        telefone: "96984241205",
        itens: [{ codigo: "BX-0001", quantidade: 1.5 }],
      }),
    ).toBeNull();
    expect(
      pedidoDeCotacaoFechado({
        nome: "Maria",
        telefone: "96984241205",
        itens: [{ codigo: "BX-0001", modalidade: "laser", quantidade: 1 }],
      }),
    ).toBeNull();
    expect(pedidoDeCotacaoFechado(null)).toBeNull();
    expect(pedidoDeCotacaoFechado([])).toBeNull();
  });

  it("o pedido do carrinho e a mensagem do WhatsApp levam código, opção, quantidade e preço", () => {
    const peca = item("BX-0001", "canetas", 2.5);
    const c = [
      linhaDoCarrinho(peca, peca.opcoes[0], 100),
      linhaDoCarrinho(LOJA[4], LOJA[4].opcoes[0], 50),
    ];
    expect(pedidoDoCarrinho("Maria", "(96) 98424-1205", c)).toEqual({
      nome: "Maria",
      telefone: "96984241205",
      itens: [
        { codigo: "BX-0001", modalidade: "sem_gravacao", quantidade: 100 },
        { codigo: "BX-0005", modalidade: "sem_gravacao", quantidade: 50 },
      ],
    });
    const m = mensagemDaCotacao("Brindes de fim de ano", "Maria", c);
    expect(m).toContain('Sou Maria. Vi o catálogo "Brindes de fim de ano"');
    // precoEmReais põe espaço inflexível depois do "R$": o esperado vem da mesma função.
    expect(m).toContain(
      `• BX-0001 — Item BX-0001 (Sem gravação): 100 peças — ${precoEmReais(2.5)} a peça`,
    );
    expect(m).toContain("• BX-0005 — Item BX-0005 (Sem gravação): 50 peças — sob consulta");
  });
});

describe("o banco da loja (retrato em 20261006230000)", () => {
  const sql = MIGRACAO.split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");

  it("a tabela de pedidos nasce com RLS, sem GRANT e sem policy: só função chega nela", () => {
    expect(sql).toContain("ALTER TABLE public.catalogo_cotacoes ENABLE ROW LEVEL SECURITY;");
    expect(sql).toContain(
      "REVOKE ALL ON TABLE public.catalogo_cotacoes FROM PUBLIC, anon, authenticated;",
    );
    expect(/CREATE POLICY [^;]* ON public\.catalogo_cotacoes\b/.test(sql)).toBe(false);
    expect(/GRANT (?!EXECUTE)[^;]*\bpublic\.catalogo_cotacoes\b(?!\()/.test(sql)).toBe(false);
    expect(/GRANT[^;]*\bTO\b[^;]*\b(anon|PUBLIC)\b/i.test(sql)).toBe(false);
  });

  it("toda função nasce fechada; a do cliente só para o servidor; as da equipe para authenticated", () => {
    const funcoes = [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z_]+)\(/g)].map(
      (m) => m[1],
    );
    expect(funcoes).toEqual([
      "catalogo_link_abrir",
      "catalogo_link_pedir_cotacao",
      "catalogo_cotacoes",
      "catalogo_cotacao_atender",
      "catalogo_gerar_orcamento",
    ]);
    for (const f of funcoes) {
      expect(
        new RegExp(
          `REVOKE ALL ON FUNCTION public\\.${f}\\([^)]*\\) FROM PUBLIC, anon, authenticated, service_role;`,
        ).test(sql),
        f,
      ).toBe(true);
    }
    const grants = Object.fromEntries(
      [...sql.matchAll(/GRANT EXECUTE ON FUNCTION public\.([a-z_]+)\([^)]*\) TO (\w+);/g)].map(
        (m) => [m[1], m[2]],
      ),
    );
    expect(grants).toEqual({
      catalogo_link_abrir: "service_role",
      catalogo_link_pedir_cotacao: "service_role",
      catalogo_cotacoes: "authenticated",
      catalogo_cotacao_atender: "authenticated",
      catalogo_gerar_orcamento: "authenticated",
    });
  });

  it("o pedido de cotação tem freio por origem e por link, e reconstrói os itens campo a campo", () => {
    const inicio = sql.indexOf("CREATE OR REPLACE FUNCTION public.catalogo_link_pedir_cotacao");
    const corpo = sql.slice(inicio, sql.indexOf("$f$;", inicio));
    expect(corpo).toMatch(/pg_advisory_xact_lock/);
    expect(corpo).toMatch(/IF v_da_origem >= 5 THEN/);
    expect(corpo).toMatch(/IF v_do_link >= 60 THEN/);
    // Só item deste link, pelo código BX.
    expect(corpo).toMatch(/WHERE li\.link_id = l\.id AND i\.codigo_bex = v_codigo/);
    // O jsonb gravado é montado aqui, não copiado do navegador.
    expect(corpo).toMatch(/v_itens := v_itens \|\| jsonb_build_object\(\s*'codigo'/);
    expect(corpo).not.toMatch(/VALUES \([^)]*p_itens/);
    // E nada do pedido volta ao cliente além do estado.
    expect(corpo).toMatch(/RETURN jsonb_build_object\('estado', 'registrado'\);/);
  });

  it("gerar orçamento passa pelo mesmo caminho de 'Adicionar ao orçamento' e aceita sem cliente", () => {
    const inicio = sql.indexOf("CREATE OR REPLACE FUNCTION public.catalogo_gerar_orcamento");
    const corpo = sql.slice(inicio, sql.indexOf("$f$;", inicio));
    expect(corpo).toMatch(/public\.catalogo_adicionar_ao_orcamento\(/);
    expect(corpo).not.toMatch(/INSERT INTO public\.orcamento_itens/);
    expect(corpo).toMatch(/p_cliente_id uuid DEFAULT NULL/);
    expect(corpo).toMatch(/require_permission\('catalogo\.read'\)/);
    expect(corpo).toMatch(/has_permission\(v_uid, 'orcamentos\.create'\)/);
    expect(corpo).toMatch(/can_see_prices\(v_uid\)/);
  });

  it("a vitrine ganha a chave 'categoria' e nada mais", () => {
    const inicio = sql.indexOf("CREATE OR REPLACE FUNCTION public.catalogo_link_abrir");
    const corpo = sql.slice(inicio, sql.indexOf("$f$;", inicio));
    expect(corpo).toMatch(/'categoria', s\.categoria/);
    expect(corpo).not.toMatch(
      /'custo'|'margem_pct'|'codigo_fornecedor'|'descricao'|'regra'|'motivo'/,
    );
  });
});
