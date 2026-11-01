import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  FICHA_VAZIA,
  OPCOES_DE_INSCRICAO_ESTADUAL,
  camposDaFichaParaGravar,
  emailValido,
  inscricaoEstadualHabilitada,
  normalizarSite,
  preencherSoOQueFalta,
  problemaDaFicha,
  rotuloDaInscricaoEstadual,
} from "../src/domain/clientes/ficha-do-cliente";
import { ORIGENS, origensParaOferecer, rotuloDaOrigem } from "../src/domain/crm/origens";
import { CamposDeCanais, CamposDeInscricao, SecaoRecolhivel } from "../src/components/cliente/campos-da-ficha";

/**
 * Ficha do cliente no desenho do Holdprint (01/11/2026): inscrições discriminadas, canais de
 * contato, origem do cliente, e o documento validado também na edição (antes era um campo
 * solto, que aceitava qualquer texto).
 */

describe("inscrição estadual", () => {
  it("só quem respondeu 'sim' tem número; as quatro respostas existem", () => {
    expect(OPCOES_DE_INSCRICAO_ESTADUAL.map((o) => o.valor)).toEqual(["nao_informado", "sim", "isento", "nao"]);
    expect(inscricaoEstadualHabilitada("sim")).toBe(true);
    for (const outra of ["nao_informado", "isento", "nao", "", null, undefined, "xyz"]) {
      expect(inscricaoEstadualHabilitada(outra)).toBe(false);
    }
  });

  it("a leitura da ficha diz o que se sabe", () => {
    expect(rotuloDaInscricaoEstadual("sim", " 12.345-6 ")).toBe("Sim: 12.345-6");
    expect(rotuloDaInscricaoEstadual("sim", "")).toBe("Sim, número não informado");
    expect(rotuloDaInscricaoEstadual("isento", "999")).toBe("Isento");
    expect(rotuloDaInscricaoEstadual("nao", null)).toBe("Não possui");
    expect(rotuloDaInscricaoEstadual("nao_informado", null)).toBe("Não informado");
    expect(rotuloDaInscricaoEstadual(undefined, undefined)).toBe("Não informado");
  });
});

describe("o que a ficha grava", () => {
  it("texto vazio vira nulo; site ganha https://; origem vazia vira nula", () => {
    const g = camposDaFichaParaGravar({ ...FICHA_VAZIA, telefone_2: "  ", site: "www.exemplo.com.br", origem: "" });
    expect(g.telefone_2).toBeNull();
    expect(g.site).toBe("https://www.exemplo.com.br");
    expect(g.origem).toBeNull();
    expect(g.possui_inscricao_estadual).toBe("nao_informado");
  });

  it("a inscrição estadual só vai junto com 'sim' (o banco recusa o resto)", () => {
    expect(camposDaFichaParaGravar({ possui_inscricao_estadual: "sim", inscricao_estadual: " 123 " }).inscricao_estadual).toBe("123");
    for (const possui of ["isento", "nao", "nao_informado"]) {
      expect(camposDaFichaParaGravar({ possui_inscricao_estadual: possui, inscricao_estadual: "123" }).inscricao_estadual).toBeNull();
    }
  });

  it("resposta fora das quatro volta a 'não informado', nunca chega crua ao banco", () => {
    expect(camposDaFichaParaGravar({ possui_inscricao_estadual: "talvez" }).possui_inscricao_estadual).toBe("nao_informado");
    expect(camposDaFichaParaGravar({}).possui_inscricao_estadual).toBe("nao_informado");
  });

  it("origem que o sistema gravou sozinho (convite de parceiro) segue valendo", () => {
    expect(camposDaFichaParaGravar({ origem: "convite_parceiro" }).origem).toBe("convite_parceiro");
  });

  it("site já com http ou https não é mexido", () => {
    expect(normalizarSite("http://velho.com")).toBe("http://velho.com");
    expect(normalizarSite("HTTPS://x.com")).toBe("HTTPS://x.com");
    expect(normalizarSite("   ")).toBeNull();
  });
});

describe("e-mail da nota e do boleto", () => {
  it("vazio vale (é opcional); incompleto não", () => {
    expect(emailValido("")).toBe(true);
    expect(emailValido(null)).toBe(true);
    expect(emailValido("financeiro@cliente.com.br")).toBe(true);
    expect(emailValido("financeiro@cliente")).toBe(false);
    expect(emailValido("sem arroba.com")).toBe(false);
  });

  it("o problema da ficha nomeia qual e-mail está errado", () => {
    expect(problemaDaFicha({ email_nota_fiscal: "x@y" })).toContain("nota fiscal");
    expect(problemaDaFicha({ email_boleto: "x@y" })).toContain("boleto");
    expect(problemaDaFicha({ email_nota_fiscal: "a@b.com", email_boleto: "" })).toBeNull();
  });
});

describe("dados da Receita num cadastro que já existe", () => {
  const dados = {
    razao_social: "EMPRESA DA RECEITA LTDA",
    nome_fantasia: "Receita Fantasia",
    endereco: "AVENIDA DA RECEITA, 10",
    bairro: "Centro",
    cidade: "Macapá",
    estado: "AP",
    cep: "68900000",
    telefones: "9633334444",
    email: "receita@exemplo.com",
  };
  const formatar = { cep: (v: string) => `CEP:${v}`, telefone: (v: string) => `TEL:${v}` };

  it("não troca o que alguém já acertou à mão", () => {
    const atual = { nome: "Nome do dono", razao_social: "Razão digitada", endereco: "Rua que o cliente falou", cidade: "Santana", telefone: "(96) 99999-0000", email: "meu@email.com" };
    const r = preencherSoOQueFalta(atual, dados, formatar);
    expect(r.nome).toBe("Nome do dono");
    expect(r.razao_social).toBe("Razão digitada");
    expect(r.endereco).toBe("Rua que o cliente falou");
    expect(r.cidade).toBe("Santana");
    expect(r.telefone).toBe("(96) 99999-0000");
    expect(r.email).toBe("meu@email.com");
  });

  it("preenche o que está vazio, e o nome cai para a fantasia e depois para a razão social", () => {
    const r = preencherSoOQueFalta({ nome: "", razao_social: null, endereco: "", telefone: null }, dados, formatar);
    expect(r.nome).toBe("Receita Fantasia");
    expect(r.razao_social).toBe("EMPRESA DA RECEITA LTDA");
    expect(r.endereco).toBe("AVENIDA DA RECEITA, 10");
    expect(r.cep).toBe("CEP:68900000");
    expect(r.telefone).toBe("TEL:9633334444");
    const semFantasia = preencherSoOQueFalta({ nome: "" }, { ...dados, nome_fantasia: null }, formatar);
    expect(semFantasia.nome).toBe("EMPRESA DA RECEITA LTDA");
  });
});

describe("origem do cliente", () => {
  it("é a lista do Leads, e a que já está gravada fora dela continua à mostra", () => {
    expect(ORIGENS).toContain("Instagram");
    expect(origensParaOferecer("Instagram")).toEqual([...ORIGENS]);
    expect(origensParaOferecer("convite_parceiro")).toEqual([...ORIGENS, "convite_parceiro"]);
    expect(origensParaOferecer(null)).toEqual([...ORIGENS]);
  });

  it("origem vazia vira 'Não informada' na leitura", () => {
    expect(rotuloDaOrigem(null)).toBe("Não informada");
    expect(rotuloDaOrigem("  ")).toBe("Não informada");
    expect(rotuloDaOrigem("Balcão")).toBe("Balcão");
  });
});

describe("as peças na tela", () => {
  const html = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(el);

  it("a inscrição estadual fica travada até a resposta ser 'sim'", () => {
    const travada = html(createElement(CamposDeInscricao, { valor: { possui_inscricao_estadual: "nao_informado" }, onChange: () => {} }));
    expect(travada).toMatch(/id="inscricao-estadual"[^>]*disabled/);
    expect(travada).toContain("Inscrição municipal");
    expect(travada).toContain("Possui inscrição estadual");
    const liberada = html(createElement(CamposDeInscricao, { valor: { possui_inscricao_estadual: "sim", inscricao_estadual: "123" }, onChange: () => {} }));
    expect(liberada).not.toMatch(/id="inscricao-estadual"[^>]*disabled/);
    expect(liberada).toContain('value="123"');
  });

  it("os canais trazem telefones 2 e 3, e-mail da nota, e-mail do boleto e site", () => {
    const h = html(createElement(CamposDeCanais, { valor: {}, onChange: () => {} }));
    for (const rotulo of ["Telefone 2", "Telefone 3", "E-mail para envio de nota fiscal", "E-mail para envio de boleto", "Site"]) {
      expect(h).toContain(rotulo);
    }
  });

  it("e-mail incompleto avisa na hora, sem esperar o botão", () => {
    const h = html(createElement(CamposDeCanais, { valor: { email_boleto: "x@y" }, onChange: () => {} }));
    expect(h).toContain("parece incompleto");
    expect(html(createElement(CamposDeCanais, { valor: { email_boleto: "x@y.com" }, onChange: () => {} }))).not.toContain("parece incompleto");
  });

  it("a seção recolhível abre e fecha, com o título grande", () => {
    const fechada = html(createElement(SecaoRecolhivel, { titulo: "Documentos fiscais", dica: "para a nota" }, "conteúdo"));
    expect(fechada).toContain("<details");
    expect(fechada).not.toMatch(/<details[^>]*\bopen\b/);
    expect(fechada).toContain("text-base font-semibold");
    expect(html(createElement(SecaoRecolhivel, { titulo: "x", abertaDeInicio: true }, "c"))).toMatch(/<details[^>]*\bopen\b/);
  });
});

describe("as telas de clientes usam tudo isso", () => {
  const EDICAO = readFileSync("src/routes/_authenticated/clientes.$id.tsx", "utf8");
  const LISTA = readFileSync("src/routes/_authenticated/clientes.index.tsx", "utf8");
  const LEADS = readFileSync("src/routes/_authenticated/leads.tsx", "utf8");

  it("a edição valida o documento: CampoDocumento no lugar do campo solto, e só barra o que foi alterado", () => {
    expect(EDICAO).toContain("<CampoDocumento");
    expect(EDICAO).not.toContain("<Label>Documento</Label>");
    expect(EDICAO).toContain("docNovo !== docAntigo");
    expect(EDICAO).toContain("preencherSoOQueFalta(atual, dados");
    expect(EDICAO).toContain("Object.assign(payload, camposDaFichaParaGravar(form))");
  });

  it("a edição grava as colunas novas e a ficha mostra o que se sabe", () => {
    for (const col of ["possui_inscricao_estadual", "inscricao_estadual", "inscricao_municipal", "telefone_2", "telefone_3", "email_nota_fiscal", "email_boleto", "site"]) {
      expect(EDICAO, col).toContain(`"${col}"`);
    }
    expect(EDICAO).toContain("rotuloDaInscricaoEstadual(cliente.possui_inscricao_estadual");
    expect(EDICAO).toContain("rotuloDaOrigem(cliente.origem)");
  });

  it("o cadastro novo recusa documento inválido e grava a ficha normalizada", () => {
    expect(LISTA).toContain("validarDocumento(docDigitos");
    expect(LISTA).toContain("...camposDaFichaParaGravar(form)");
    expect(LISTA).toContain("<CampoDeOrigem");
    expect(LISTA).toContain("<CamposDeInscricao");
    expect(LISTA).toContain("<CamposDeCanais");
  });

  it("a lista filtra por origem e mostra a coluna", () => {
    expect(LISTA).toContain('const [filtroOrigem, setFiltroOrigem] = useState<string>("todas")');
    expect(LISTA).toContain('q.is("origem", null)');
    expect(LISTA).toContain("<TableHead>Origem</TableHead>");
    expect(LISTA).toContain("rotuloDaOrigem(c.origem)");
  });

  it("o Leads e o cadastro usam a mesma lista de origens", () => {
    expect(LEADS).toContain('import { ORIGENS } from "@/domain/crm/origens"');
    expect(LEADS).not.toMatch(/const ORIGENS = \[/);
  });
});

describe("o banco e os tipos acompanham", () => {
  const SQL = readFileSync("supabase/migrations/20261101150000_cliente_inscricoes_e_canais.sql", "utf8");
  const TIPOS = readFileSync("src/integrations/supabase/types.ts", "utf8");

  it("a migração cria as oito colunas e as duas regras, sem apagar nada", () => {
    for (const col of ["possui_inscricao_estadual", "inscricao_estadual", "inscricao_municipal", "telefone_2", "telefone_3", "email_nota_fiscal", "email_boleto", "site"]) {
      expect(SQL, col).toContain(`ADD COLUMN IF NOT EXISTS ${col}`);
    }
    expect(SQL).toContain("clientes_possui_ie_check");
    expect(SQL).toContain("clientes_ie_so_quando_contribuinte");
    expect(SQL.replace(/^\s*--.*$/gm, "")).not.toMatch(/\b(DELETE|DROP TABLE|DROP COLUMN|TRUNCATE)\b/i);
  });

  it("as respostas da migração são as mesmas da tela", () => {
    for (const o of OPCOES_DE_INSCRICAO_ESTADUAL) expect(SQL).toContain(`'${o.valor}'`);
  });

  it("os tipos gerados conhecem as colunas novas no Row, no Insert e no Update", () => {
    const ini = TIPOS.indexOf("      clientes: {\n");
    const fim = TIPOS.indexOf("\n      }", TIPOS.indexOf("Update: {", ini));
    const bloco = TIPOS.slice(ini, fim);
    for (const col of ["inscricao_estadual", "inscricao_municipal", "email_boleto", "email_nota_fiscal", "telefone_2", "telefone_3", "site"]) {
      expect(bloco.match(new RegExp(`\\b${col}\\??:`, "g")), col).toHaveLength(3);
    }
    expect(bloco.match(/possui_inscricao_estadual\??:/g)).toHaveLength(3);
  });
});
