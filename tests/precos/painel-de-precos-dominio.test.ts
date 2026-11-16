import { describe, expect, it } from "vitest";
import {
  avaliarLinha,
  contar,
  familiasDe,
  filtrar,
  lerReais,
  margemDe,
  mensagemDoPedido,
  ordenar,
  pisoDe,
  previaDoPreco,
  type LinhaDePreco,
} from "../../src/domain/precos/painel-de-precos";

const linha = (p: Partial<LinhaDePreco> & { id: string }): LinhaDePreco => ({
  nome: "Produto " + p.id,
  familia: "Lonas",
  unidade: "un",
  custo: 30,
  custo_cheio: null,
  preco: 60,
  margem_minima: 40,
  preco_parceiro: null,
  ...p,
});

describe("piso e margem", () => {
  it("o piso é round(custo / (1 - margem mínima / 100), 2), como no banco", () => {
    expect(pisoDe(30, 40)).toBe(50);
    expect(pisoDe(42.3, 40)).toBe(70.5);
    expect(pisoDe(10, 30)).toBe(14.29);
  });
  it("sem custo, custo zero ou margem de 100 por cento não há piso", () => {
    expect(pisoDe(null, 40)).toBeNull();
    expect(pisoDe(0, 40)).toBeNull();
    expect(pisoDe(10, 100)).toBeNull();
  });
  it("margem é sobre a venda e fica nula sem preço", () => {
    expect(margemDe(50, 30)).toBe(40);
    expect(margemDe(0, 30)).toBeNull();
    expect(margemDe(null, 30)).toBeNull();
  });
});

describe("ler o que a pessoa digita", () => {
  it("aceita vírgula, ponto e milhar", () => {
    expect(lerReais("70,40")).toBe(70.4);
    expect(lerReais("70.40")).toBe(70.4);
    expect(lerReais("R$ 1.234,56")).toBe(1234.56);
    expect(lerReais("1.234")).toBe(1234);
    expect(lerReais("70")).toBe(70);
  });
  it("recusa vazio, zero, negativo e lixo", () => {
    for (const t of ["", "  ", "0", "-5", "abc", "1,234", "1,2,3"])
      expect(lerReais(t), t).toBeNull();
  });
});

describe("a situação de cada produto, em palavras", () => {
  it("abaixo do piso, margem justa, margem boa", () => {
    expect(avaliarLinha(linha({ id: "a", preco: 45 })).situacao).toBe("abaixo");
    expect(avaliarLinha(linha({ id: "b", preco: 52 })).situacao).toBe("justa");
    expect(avaliarLinha(linha({ id: "c", preco: 80 })).situacao).toBe("boa");
  });
  it("sem custo e sem preço", () => {
    expect(avaliarLinha(linha({ id: "d", custo: null })).situacao).toBe("sem_custo");
    expect(avaliarLinha(linha({ id: "e", custo: 0 })).situacao).toBe("sem_custo");
    expect(avaliarLinha(linha({ id: "f", preco: null })).situacao).toBe("sem_preco");
    expect(avaliarLinha(linha({ id: "g", preco: 0 })).situacao).toBe("sem_preco");
  });
  it("parceiro acima do balcão só quando o parceiro é maior", () => {
    expect(avaliarLinha(linha({ id: "h", preco_parceiro: 61 })).parceiroAcima).toBe(true);
    expect(avaliarLinha(linha({ id: "i", preco_parceiro: 60 })).parceiroAcima).toBe(false);
    expect(avaliarLinha(linha({ id: "j", preco_parceiro: null })).parceiroAcima).toBe(false);
  });
});

describe("contagem, filtro, busca e ordem", () => {
  const todas = [
    linha({ id: "1", nome: "Banner", familia: "Banners", preco: 45 }),
    linha({ id: "2", nome: "Impressão 3D", familia: "Criação", custo: null, preco: null }),
    linha({ id: "3", nome: "Certificado A4", familia: "Papel", custo: null }),
    linha({ id: "4", nome: "Adesivo", familia: "Adesivos", preco: 90, preco_parceiro: 95 }),
    linha({ id: "5", nome: "Lona", familia: "Lonas", preco: 90 }),
    linha({ id: "6", nome: "Acrílico", familia: "Lonas", preco: 52 }),
  ];
  it("conta cada problema", () => {
    expect(contar(todas)).toEqual({
      abaixo: 1,
      abaixo_do_minimo: 0,
      sem_custo: 2,
      sem_preco: 1,
      parceiro_acima: 1,
    });
  });
  it("sem custo e sem preço juntos contam nos dois, mas a situação em palavras é a primeira falta, sem custo", () => {
    expect(avaliarLinha(todas[1]).situacao).toBe("sem_custo");
    expect(
      filtrar(todas, { familia: null, problema: "sem_preco", busca: "" }).map((l) => l.id),
    ).toEqual(["2"]);
  });
  it("filtra por família, por problema e por busca sem acento", () => {
    expect(
      filtrar(todas, { familia: "Lonas", problema: "todos", busca: "" }).map((l) => l.id),
    ).toEqual(["5", "6"]);
    expect(
      filtrar(todas, { familia: null, problema: "abaixo", busca: "" }).map((l) => l.id),
    ).toEqual(["1"]);
    expect(
      filtrar(todas, { familia: null, problema: "parceiro_acima", busca: "" }).map((l) => l.id),
    ).toEqual(["4"]);
    expect(
      filtrar(todas, { familia: null, problema: "todos", busca: "acrilico" }).map((l) => l.id),
    ).toEqual(["6"]);
    expect(
      filtrar(todas, { familia: null, problema: "todos", busca: "impressao" }).map((l) => l.id),
    ).toEqual(["2"]);
  });
  it("lista as famílias sem repetir", () => {
    expect(familiasDe(todas)).toEqual(["Adesivos", "Banners", "Criação", "Lonas", "Papel"]);
  });
  it("a ordem de abertura é abaixo do piso, sem custo, sem preço, parceiro acima, o resto", () => {
    const ids = ordenar(todas, "problema").map((l) => l.id);
    expect(ids.slice(0, 4)).toEqual(["1", "3", "2", "4"]);
    expect(ids.slice(4)).toEqual(["6", "5"]);
  });
  it("ordena por nome, preço e margem", () => {
    expect(ordenar(todas, "nome").map((l) => l.nome)[0]).toBe("Acrílico");
    expect(ordenar(todas, "preco").map((l) => l.id)[0]).toBe("1");
    expect(ordenar(todas, "margem").map((l) => l.id)[0]).toBe("3");
  });
  it("não muda a lista original", () => {
    const antes = todas.map((l) => l.id);
    ordenar(todas, "nome");
    expect(todas.map((l) => l.id)).toEqual(antes);
  });
});

describe("a prévia na hora da digitação", () => {
  const l = linha({ id: "p", custo: 42.3, margem_minima: 40, preco: 80, preco_parceiro: 70 });
  it("mostra piso, margem nova e nenhum aviso quando o preço está certo", () => {
    const p = previaDoPreco(l, "75");
    expect(p.piso).toBe(70.5);
    expect(p.margem).toBe(43.6);
    expect(p.aviso).toBeNull();
    expect(p.mudou).toBe(true);
    expect(p.podePedir).toBe(true);
    expect(p.exigeMotivo).toBe(false);
  });
  it("abaixo do piso avisa, exige motivo e ainda deixa pedir", () => {
    const p = previaDoPreco(l, "71");
    expect(p.avaliacao.situacao).toBe("justa");
    const q = previaDoPreco(
      linha({ id: "q", custo: 42.3, margem_minima: 40, preco: 80, preco_parceiro: null }),
      "60",
    );
    expect(q.avaliacao.situacao).toBe("abaixo");
    expect(q.aviso).toContain("Abaixo do piso");
    expect(q.exigeMotivo).toBe(true);
    expect(q.podePedir).toBe(true);
  });
  it("não deixa pedir preço igual ao atual, vazio ou inválido", () => {
    expect(previaDoPreco(l, "80,00").podePedir).toBe(false);
    expect(previaDoPreco(l, "").podePedir).toBe(false);
    const ruim = previaDoPreco(l, "abc");
    expect(ruim.podePedir).toBe(false);
    expect(ruim.aviso).toContain("Digite um valor em reais");
  });
  it("não deixa o balcão ficar abaixo do preço do parceiro", () => {
    const p = previaDoPreco(l, "69");
    expect(p.avaliacao.parceiroAcima).toBe(true);
    expect(p.aviso).toContain("parceiro");
    expect(p.podePedir).toBe(false);
  });
  it("sem custo avisa que não dá para conferir o piso", () => {
    expect(previaDoPreco(linha({ id: "s", custo: null }), "50").aviso).toContain("Sem custo");
  });
  it("nenhum aviso usa parênteses, travessão ou seta", () => {
    const frases = [
      previaDoPreco(l, "60").aviso,
      previaDoPreco(l, "69").aviso,
      previaDoPreco(l, "x").aviso,
      previaDoPreco(linha({ id: "z", custo: null }), "5").aviso,
    ];
    for (const f of frases) expect(f ?? "").not.toMatch(/[()—–→]/);
  });
});

describe("a função de pedir aprovação ausente", () => {
  it("vira frase humana", () => {
    for (const m of [
      "function public.preco_proposta_criar(p_produto_id, p_preco, p_motivo) does not exist",
      "Could not find the function public.preco_proposta_criar(p_motivo, p_preco, p_produto_id) in the schema cache",
    ]) {
      const t = mensagemDoPedido(m);
      expect(t).toContain("Avise o suporte");
      expect(t).not.toContain("preco_proposta_criar");
    }
  });
  it("outros erros passam como vieram", () => {
    expect(mensagemDoPedido("Já existe uma proposta pendente.")).toBe(
      "Já existe uma proposta pendente.",
    );
  });
});
