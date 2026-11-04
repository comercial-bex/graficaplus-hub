import { describe, expect, it } from "vitest";
import { CADASTRO_VAZIO, payloadDoCadastro, type Cadastro } from "../src/domain/catalogo/pasta-do-produto";
import {
  cadastroDepoisDeRecarregar,
  cadastroTemEdicaoPendente,
  comFotoGerada,
  fotoMudouNaTela,
  mesmaFoto,
} from "../src/domain/catalogo/foto-do-produto";

/**
 * Revisão do PR 428 (04/11/2026): o Salvar e a pasta acompanham a foto que a IA grava no servidor.
 * Os cenários abaixo são os que a revisão reproduziu com a tela de verdade.
 */

const VISAO = { canSeePrices: true, canSeeFinancials: true };
const GERADA = "https://x.supabase.co/storage/v1/object/public/produtos-fotos/ia/abc/1-aa.png";
const REAL = "https://x.supabase.co/storage/v1/object/public/produtos-fotos/3f2a.jpg";

const cadastro = (extra: Partial<Cadastro> = {}): Cadastro => ({ ...CADASTRO_VAZIO, nome: "Lona", descricao: "Lona brilho", ...extra });

describe("a foto que o Salvar grava", () => {
  it("compara aparando espaços, e nulo vale vazio", () => {
    expect(mesmaFoto("  ", "")).toBe(true);
    expect(mesmaFoto(null, "")).toBe(true);
    expect(mesmaFoto(GERADA, ` ${GERADA} `)).toBe(true);
    expect(fotoMudouNaTela(GERADA, "")).toBe(true);
    expect(fotoMudouNaTela("", GERADA)).toBe(true);
    expect(fotoMudouNaTela(GERADA, GERADA)).toBe(false);
  });

  it("gerar na própria janela avança a base: a janela mostra e o banco tem a mesma foto", () => {
    const aberta = { imagem_url: "", imagem_url_aberta: "", nome: "Lona" };
    expect(comFotoGerada(aberta, GERADA)).toEqual({ imagem_url: GERADA, imagem_url_aberta: GERADA, nome: "Lona" });
  });

  it("Gerar, Remover, Salvar: a foto sai do produto (antes a base nunca avançava e o Salvar não mandava nada)", () => {
    // A janela abriu sem foto, gerou, e a pessoa clicou em Remover.
    let janela = { imagem_url: "", imagem_url_aberta: "" };
    janela = comFotoGerada(janela, GERADA);
    janela = { ...janela, imagem_url: "" }; // Remover
    expect(fotoMudouNaTela(janela.imagem_url, janela.imagem_url_aberta)).toBe(true);
    // Na pasta, o mesmo, com o payload do cadastro:
    const p = payloadDoCadastro(cadastro({ imagem_url: "" }), VISAO, { imagemNoBanco: GERADA });
    expect(p.imagem_url).toBeNull();
  });

  it("outra pessoa enviou a foto real depois que a janela gerou: salvar outro campo não regrava a gerada por cima", () => {
    // A janela A gerou G (base = G). B enviou R. A salva o nome: a foto da tela segue G, igual à base, e fica fora do payload.
    const base = GERADA;
    const p = payloadDoCadastro(cadastro({ nome: "Lona nova", imagem_url: GERADA }), VISAO, { imagemNoBanco: base });
    expect("imagem_url" in p).toBe(false);
  });

  it("sem gerar nada, a foto do lote no meio tempo também não é apagada (comportamento que já valia)", () => {
    const p = payloadDoCadastro(cadastro({ imagem_url: "" }), VISAO, { imagemNoBanco: "" });
    expect("imagem_url" in p).toBe(false);
  });
});

describe("a pasta recarrega o cadastro do banco", () => {
  const doBancoAntes = cadastro({ descricao: "texto salvo", imagem_url: "" });

  it("sem edição pendente, troca tudo pelo banco", () => {
    const agora = cadastro({ descricao: "texto salvo", imagem_url: GERADA, preco_base: "10" });
    expect(cadastroTemEdicaoPendente(doBancoAntes, doBancoAntes)).toBe(false);
    expect(cadastroDepoisDeRecarregar(doBancoAntes, doBancoAntes, agora)).toEqual(agora);
  });

  it("primeira carga: troca tudo", () => {
    const agora = cadastro({ nome: "do banco" });
    expect(cadastroDepoisDeRecarregar(CADASTRO_VAZIO, null, agora)).toEqual(agora);
  });

  it("com texto digitado e não salvo, o texto fica e só a foto acompanha o banco (a IA gravou enquanto a pessoa digitava)", () => {
    const digitado = cadastro({ descricao: "texto NOVO digitado, que o pedido da IA usou", imagem_url: "" });
    const agora = cadastro({ descricao: "texto salvo", imagem_url: GERADA });
    expect(cadastroTemEdicaoPendente(digitado, doBancoAntes)).toBe(true);
    const r = cadastroDepoisDeRecarregar(digitado, doBancoAntes, agora);
    expect(r.descricao).toBe("texto NOVO digitado, que o pedido da IA usou");
    expect(r.imagem_url).toBe(GERADA);
  });

  it("foto escolhida pela pessoa e ainda não salva continua valendo mesmo com o banco mudando", () => {
    const comFotoNova = cadastro({ descricao: "texto salvo", imagem_url: REAL });
    const agora = cadastro({ descricao: "texto salvo", imagem_url: GERADA });
    const r = cadastroDepoisDeRecarregar(comFotoNova, doBancoAntes, agora);
    expect(r.imagem_url).toBe(REAL);
  });

  it("depois de salvar, a recarga não desfaz o que acabou de ser salvo", () => {
    // A pessoa editou o preço e salvou: o formulário já tem o preço, o banco devolve o mesmo.
    const editado = cadastro({ preco_base: "99", imagem_url: "" });
    const salvoNoBanco = cadastro({ preco_base: "99", imagem_url: "" });
    const r = cadastroDepoisDeRecarregar(editado, doBancoAntes, salvoNoBanco);
    expect(r.preco_base).toBe("99");
  });
});
