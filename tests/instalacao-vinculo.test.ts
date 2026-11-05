import { describe, expect, it } from "vitest";
import { ehItemDeInstalacao, instalacoesSemOrigem, vinculoDaInstalacaoConta } from "@/domain/orcamentos/instalacao";
import { pendenciasParaEnviar, PENDENCIA_INSTALACAO_SEM_ORIGEM } from "@/domain/orcamentos/acordo";
import { passoDaPendencia } from "@/domain/orcamentos/passos-da-equipe";

const produtos = [
  { id: "inst", tipo: "servico", categoria: "instalacao", unidade: "h" },
  { id: "desl", tipo: "servico", categoria: "instalacao", unidade: "km" },
  { id: "arte", tipo: "servico", categoria: "servico", unidade: "h" },
  { id: "adesivo", tipo: "produto", categoria: "adesivos", unidade: "m²" },
];
const adesivo = { id: "a", descricao: "Adesivo perfurado (one way)", unidade: "m²", produto_id: "adesivo" };
const instalacao = (instala_item_id: string | null) => ({
  id: "i", descricao: "Instalação em campo", unidade: "h", produto_id: "inst", instala_item_id,
});

describe("instalação ligada ao item", () => {
  it("instalação sem vínculo gera a pendência", () => {
    expect(instalacoesSemOrigem([adesivo, instalacao(null)], produtos)).toEqual(["Instalação em campo"]);
  });
  it("com vínculo válido a pendência some", () => {
    expect(instalacoesSemOrigem([adesivo, instalacao("a")], produtos)).toEqual([]);
  });
  it("vínculo para item excluído volta a gerar a pendência", () => {
    expect(instalacoesSemOrigem([instalacao("a")], produtos)).toHaveLength(1);
  });
  it("Deslocamento (km) não é instalação e não gera pendência", () => {
    const desl = { id: "d", descricao: "Deslocamento", unidade: "km", produto_id: "desl", instala_item_id: null };
    expect(ehItemDeInstalacao(desl, produtos)).toBe(false);
    expect(instalacoesSemOrigem([adesivo, desl], produtos)).toEqual([]);
  });
  it("Criação/arte final (servico, h) não gera", () => {
    expect(ehItemDeInstalacao({ descricao: "Criação/arte final", unidade: "h", produto_id: "arte" }, produtos)).toBe(false);
  });
  it("item livre 'Instalação …' em hora gera; em un não gera", () => {
    expect(ehItemDeInstalacao({ descricao: "Instalação da fachada", unidade: "h", produto_id: null }, produtos)).toBe(true);
    expect(ehItemDeInstalacao({ descricao: "Instalação da fachada", unidade: "un", produto_id: null }, produtos)).toBe(false);
  });
  it("com produto que não é de instalação, o catálogo manda mesmo com descrição 'Instalação'", () => {
    expect(ehItemDeInstalacao({ descricao: "Instalação do adesivo", unidade: "h", produto_id: "adesivo" }, produtos)).toBe(false);
  });
  it("pendência entra em pendenciasParaEnviar e leva ao passo 2", () => {
    const p = pendenciasParaEnviar({
      temClienteOuContato: true, dataEntrega: "2026-11-10", verPreco: false, temCondicao: true,
      itens: [{ arquivo_id: "x" }], instalacoesSemOrigem: ["Instalação em campo"],
    });
    expect(p).toEqual([PENDENCIA_INSTALACAO_SEM_ORIGEM]);
    expect(passoDaPendencia(PENDENCIA_INSTALACAO_SEM_ORIGEM)).toBe(2);
  });
  it("só conta em orçamento editável", () => {
    expect(vinculoDaInstalacaoConta("rascunho", false)).toBe(true);
    expect(vinculoDaInstalacaoConta("enviado", false)).toBe(true);
    expect(vinculoDaInstalacaoConta("aprovado", false)).toBe(false);
    expect(vinculoDaInstalacaoConta("convertido", true)).toBe(false);
    expect(vinculoDaInstalacaoConta("enviado", true)).toBe(false);
  });
});
