import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  fraseDoPrecoEspecial,
  pendenciaDoPrecoEspecial,
  precoDoProdutoNoItem,
} from "@/domain/precos/preco-especial-do-cliente";

/** Plano de 02/11/2026, decisão 5: preço especial para clientes, como a aba Preço do Holdprint. */

describe("o preço do produto no item", () => {
  it("fora do modo parceiro, o preço especial do cliente vence a tabela", () => {
    expect(precoDoProdutoNoItem({ emParceiro: false, precoParceiro: 70, precoEspecial: "80", precoBase: 89.9 })).toEqual({ preco: 80, origem: "cliente" });
  });

  it("no modo parceiro, a tabela do parceiro manda; sem ela, a tabela comum", () => {
    expect(precoDoProdutoNoItem({ emParceiro: true, precoParceiro: 70, precoEspecial: 80, precoBase: 89.9 })).toEqual({ preco: 70, origem: "parceiro" });
    expect(precoDoProdutoNoItem({ emParceiro: true, precoParceiro: null, precoEspecial: 80, precoBase: 89.9 })).toEqual({ preco: 89.9, origem: "tabela" });
  });

  it("sem preço especial, vale a tabela; tabela vazia dá zero", () => {
    expect(precoDoProdutoNoItem({ emParceiro: false, precoParceiro: null, precoEspecial: undefined, precoBase: "55" })).toEqual({ preco: 55, origem: "tabela" });
    expect(precoDoProdutoNoItem({ emParceiro: false, precoParceiro: null, precoEspecial: null, precoBase: null })).toEqual({ preco: 0, origem: "tabela" });
  });

  it("o cadastro pede cliente, preço e um só preço por cliente", () => {
    expect(pendenciaDoPrecoEspecial({ cliente_id: "", preco: "10" }, [])).toBe("Escolha o cliente.");
    expect(pendenciaDoPrecoEspecial({ cliente_id: "c1", preco: "0" }, [])).toMatch(/preço/);
    expect(pendenciaDoPrecoEspecial({ cliente_id: "c1", preco: "79,9" }, [{ cliente_id: "c1" }])).toMatch(/já tem/);
    expect(pendenciaDoPrecoEspecial({ cliente_id: "c1", preco: "79,9" }, [{ cliente_id: "c2" }])).toBeNull();
  });

  it("a frase diz o especial e a tabela", () => {
    // O formatador de moeda usa espaço inseparável depois de "R$".
    const limpa = (s: string) => s.replace(/ /g, " ");
    expect(limpa(fraseDoPrecoEspecial(80, 89.9))).toBe("Preço especial do cliente: R$ 80,00 (tabela R$ 89,90)");
    expect(limpa(fraseDoPrecoEspecial(80, null))).toBe("Preço especial do cliente: R$ 80,00");
  });
});

describe("as telas e o banco", () => {
  const pasta = readFileSync("src/routes/_authenticated/produtos_.$id.tsx", "utf8");
  const item = readFileSync("src/routes/_authenticated/orcamentos.$id.tsx", "utf8");
  const migracao = readFileSync("supabase/migrations/20261102233000_preco_especial_por_cliente.sql", "utf8");

  it("a pasta cadastra o preço especial na aba Preço; o item o aplica ao escolher o produto", () => {
    expect(pasta).toContain("<PrecosEspeciaisDoProduto");
    expect(pasta).toContain('from("produto_precos_cliente")');
    expect(item).toContain('from("produto_precos_cliente")');
    expect(item).toContain("precoDoProdutoNoItem({");
    expect(item).toContain('origem === "cliente"');
  });

  it("a migração: um preço por cliente e produto, leitura de quem vê preço, escrita de admin e gestor, nada para anon", () => {
    expect(migracao).toContain("UNIQUE (produto_id, cliente_id)");
    expect(migracao).toContain("USING (public.can_see_prices((select auth.uid())))");
    expect(migracao).toContain("REVOKE ALL ON public.produto_precos_cliente FROM anon");
    expect(migracao).toContain("CHECK (preco >= 0)");
  });
});
