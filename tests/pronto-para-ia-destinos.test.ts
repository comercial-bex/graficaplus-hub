import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AVISO_DAS_PERGUNTAS_NA_NOTA,
  checagensDaPasta,
  DESTINO_DA_CHECAGEM,
  DESTINO_DA_REVISAO,
  dicaDaNota,
  notaDaPasta,
  pendenciasDaPasta,
  pendenciasPorAba,
  type EntradaDaNota,
} from "@/domain/catalogo/pronto-para-ia";
import { abasDaPasta } from "@/domain/catalogo/pasta-do-produto";

/** 17/11/2026: cada checagem da nota sabe a aba e o campo onde se preenche. */

const vazia: EntradaDaNota = {
  tipo: "produto",
  unidade: "m2",
  temFoto: false,
  temDescricao: false,
  temFamilia: false,
  temMedidaPadrao: false,
  temMaterialPrincipal: false,
  processos: 0,
  perguntas: 0,
  roteiroEscrito: false,
  roteiroRevisado: false,
};
const completa: EntradaDaNota = {
  ...vazia,
  temFoto: true,
  temDescricao: true,
  temFamilia: true,
  temMedidaPadrao: true,
  temMaterialPrincipal: true,
  processos: 1,
  perguntas: 1,
  roteiroEscrito: true,
  roteiroRevisado: true,
};

const pasta = readFileSync("src/routes/_authenticated/produtos_.$id.tsx", "utf8");
const lista = readFileSync("src/routes/_authenticated/produtos.tsx", "utf8");
const componente = readFileSync("src/components/produtos/nota-pronto-para-ia.tsx", "utf8");

describe("destino de cada checagem", () => {
  const todas = [
    ...checagensDaPasta(vazia),
    ...checagensDaPasta({ ...vazia, roteiroEscrito: true }),
    ...checagensDaPasta({ ...completa, tipo: "servico" }),
  ];

  it("toda checagem tem aba que existe na pasta e campo que existe na tela", () => {
    const abas = abasDaPasta({ canSeePrices: true }).map((a) => a.id);
    for (const c of todas) {
      expect(abas, `aba de ${c.chave}`).toContain(c.destino.aba);
      expect(c.destino.abaTitulo.length).toBeGreaterThan(0);
      expect(c.destino.instrucao.length).toBeGreaterThan(10);
      expect(pasta, `campo ${c.destino.campo} de ${c.chave}`).toContain(`id="${c.destino.campo}"`);
    }
  });

  it("o título da aba do destino é o título da aba na pasta", () => {
    const abas = abasDaPasta({ canSeePrices: true });
    for (const d of [...Object.values(DESTINO_DA_CHECAGEM), DESTINO_DA_REVISAO]) {
      expect(abas.find((a) => a.id === d.aba)?.titulo).toBe(d.abaTitulo);
    }
  });

  it("o mapa cobre exatamente as nove checagens, e roteiro escrito leva à revisão", () => {
    expect(Object.keys(DESTINO_DA_CHECAGEM).sort()).toEqual(checagensDaPasta(vazia).map((c) => c.chave).sort());
    const semTexto = checagensDaPasta(vazia).find((c) => c.chave === "roteiro")!;
    const escrito = checagensDaPasta({ ...vazia, roteiroEscrito: true }).find((c) => c.chave === "roteiro")!;
    expect(semTexto.destino.campo).toBe("pasta-como-medir");
    expect(escrito.destino.campo).toBe("pasta-revisao-roteiro");
  });

  it("frases do dono: sem travessão, seta nem parênteses", () => {
    const frases = [
      ...Object.values(DESTINO_DA_CHECAGEM),
      DESTINO_DA_REVISAO,
    ].flatMap((d) => [d.falta, d.instrucao, d.abaTitulo]);
    frases.push(AVISO_DAS_PERGUNTAS_NA_NOTA, dicaDaNota(notaDaPasta(vazia)), dicaDaNota(null));
    for (const f of frases) expect(f).not.toMatch(/[—–→←()]|->|<-/);
  });
});

describe("pendências por aba e dica da nota", () => {
  it("agrupa o que falta pela aba e some quando preenchido, chegando em 10", () => {
    const n = notaDaPasta(vazia);
    const por = pendenciasPorAba(n);
    expect(por.descricao?.map((p) => p.chave)).toEqual(["foto", "descricao", "familia"]);
    expect(por.parametros?.map((p) => p.chave)).toEqual(["medida", "material"]);
    expect(por.processos).toHaveLength(1);
    expect(por.checklist).toHaveLength(1);
    expect(por.ia).toHaveLength(1);
    const pronta = notaDaPasta(completa);
    expect(pronta.nota).toBe(10);
    expect(pendenciasDaPasta(pronta)).toEqual([]);
    expect(pendenciasPorAba(pronta)).toEqual({});
  });

  it("o que não cabe no produto não vira pendência", () => {
    const servico = notaDaPasta({ ...vazia, tipo: "servico", unidade: "hora" });
    expect(pendenciasDaPasta(servico).map((p) => p.chave)).toEqual(["descricao", "familia", "processos", "roteiro"]);
  });

  it("a dica lista cada falta com a aba e diz quantos itens estão prontos", () => {
    const n = notaDaPasta({ ...completa, temFoto: false, roteiroRevisado: false });
    expect(dicaDaNota(n)).toBe(
      "Pronto para a IA: 8 de 10, com 7 de 9 itens prontos. Falta a foto, na aba Descrição. Falta a revisão do roteiro da IA, na aba Orç.IA.",
    );
    expect(dicaDaNota(notaDaPasta(completa))).toBe("Pronto para a IA: 10 de 10, com 9 de 9 itens prontos. Nada falta.");
  });

  it("sem nota (falha de leitura) a dica diz que não deu para ler, e não fala em zero", () => {
    const t = dicaDaNota(null);
    expect(t).toContain("não deu para ler as fichas");
    expect(t).not.toMatch(/0 de 10/);
  });
});

describe("as telas", () => {
  it("a lista dá traço no lugar da nota quando a leitura das fichas falha, e avisa", () => {
    expect(lista).not.toMatch(/linhasParaNota\.data \?\? \{ fichas: \[\]/);
    expect(lista).toContain("linhasParaNota.isError");
    expect(lista).toContain("AvisoDeFalhaDeConsulta");
  });

  it("a leitura das fichas lança no erro, em vez de virar lista vazia", () => {
    expect(componente).toContain("if (error) throw error;");
    expect(componente).not.toMatch(/fichas\.data \?\? \[\]/);
    expect(componente).toContain("<Dica texto={texto}>");
    expect(componente).toContain("<DicaIcone");
  });

  it("a pasta pinta aba, campo e cartão, leva ao campo no clique e marca a revisão na aba Orç.IA", () => {
    expect(pasta).toContain("pendenciasPorAba(nota)");
    expect(pasta).toContain("pendencias-da-aba-");
    expect(pasta).toContain("scrollIntoView");
    expect(pasta).toContain("marcarRevisado");
    expect(pasta).toContain("Marcar o roteiro como revisado");
    expect(pasta).toContain("<GaleriaDoProduto");
    expect(pasta).toContain("{AVISO_DAS_PERGUNTAS_NA_NOTA}");
    expect(pasta).toContain("não conta na nota");
    expect(pasta).toContain("if (processos.error) throw processos.error;");
  });
});
