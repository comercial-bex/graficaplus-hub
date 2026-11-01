import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PAISES,
  PAISES_FREQUENTES,
  bandeira,
  ehBrasil,
  montarTelefoneInternacional,
  paisPorCodigo,
  rotuloDoPais,
  separarTelefoneInternacional,
  trocarDePais,
} from "../src/domain/clientes/paises";
import { chaveWhatsApp, numeroEstrangeiro, numeroRecebidoDeFora, recebeWhatsApp } from "../src/domain/documentos";
import { telefoneParaZapi } from "../src/domain/whatsapp/zapi-envio";
import { linkDoWhatsapp } from "../src/domain/portal/link-do-portal";
import {
  RESPOSTAS_VAZIAS_DO_CLIENTE,
  clienteDasRespostas,
  passosDoCliente,
  pendenciaDoPassoDoCliente,
} from "../src/domain/clientes/novo-cliente-em-passos";
import { CampoDeTelefoneComPais, SeletorDePais } from "../src/components/cliente/campo-de-pais";

/**
 * Cliente estrangeiro (01/11/2026): país com bandeira e nome, WhatsApp com o código do país e
 * documento obrigatório para quem é do Brasil. O banco só aceitava celular brasileiro; a regra
 * nova está em `supabase/migrations/20261101180000_cliente_estrangeiro_e_whatsapp_internacional.sql`.
 */

describe("a lista de países", () => {
  it("começa pelo Brasil, depois os vizinhos e o resto que pede orçamento, e só então a ordem alfabética", () => {
    expect(PAISES.slice(0, PAISES_FREQUENTES.length).map((p) => p.codigo)).toEqual([...PAISES_FREQUENTES]);
    expect(PAISES[0].codigo).toBe("BR");
    const resto = PAISES.slice(PAISES_FREQUENTES.length).map((p) => p.nome);
    expect(resto).toEqual([...resto].sort((a, b) => a.localeCompare(b, "pt-BR")));
  });

  it("não repete código de país, e todo código de discagem é só dígitos", () => {
    const codigos = PAISES.map((p) => p.codigo);
    expect(new Set(codigos).size).toBe(codigos.length);
    for (const p of PAISES) {
      expect(p.codigo, p.nome).toMatch(/^[A-Z]{2}$/);
      expect(p.ddi, p.nome).toMatch(/^[1-9][0-9]{0,2}$/);
    }
  });

  it("tem os países de fronteira do Amapá com o código certo", () => {
    expect(paisPorCodigo("GF")).toMatchObject({ nome: "Guiana Francesa", ddi: "594" });
    expect(paisPorCodigo("SR")?.ddi).toBe("597");
    expect(paisPorCodigo("GY")?.ddi).toBe("592");
    expect(paisPorCodigo("br")?.nome).toBe("Brasil");
  });

  it("a bandeira sai do código e o rótulo junta bandeira e nome", () => {
    expect(bandeira("BR")).toBe("\u{1F1E7}\u{1F1F7}");
    expect(bandeira("gf")).toBe("\u{1F1EC}\u{1F1EB}");
    expect(bandeira("")).toBe("");
    expect(bandeira("BRA")).toBe("");
    expect(rotuloDoPais("GF")).toBe(`${bandeira("GF")} Guiana Francesa`);
  });

  it("sem país informado é Brasil, que é o que os clientes de antes são", () => {
    expect(ehBrasil(undefined)).toBe(true);
    expect(ehBrasil(null)).toBe(true);
    expect(ehBrasil("")).toBe(true);
    expect(ehBrasil("BR")).toBe(true);
    expect(ehBrasil("GF")).toBe(false);
  });
});

describe("telefone com código do país", () => {
  it("monta e desmonta sem perder a formatação do número", () => {
    expect(montarTelefoneInternacional("594", " 694 12 34 56 ")).toBe("+594 694 12 34 56");
    expect(montarTelefoneInternacional("594", "  ")).toBe("");
    expect(separarTelefoneInternacional("+594 694 12 34 56")).toEqual({ ddi: "594", nacional: "694 12 34 56" });
    expect(separarTelefoneInternacional("+1 305 555 0100")).toEqual({ ddi: "1", nacional: "305 555 0100" });
    expect(separarTelefoneInternacional("+351912345678")).toEqual({ ddi: "351", nacional: "912345678" });
  });

  it("número sem o '+' não é lido como de fora", () => {
    expect(separarTelefoneInternacional("(96) 99111-2233")).toEqual({ ddi: "", nacional: "(96) 99111-2233" });
  });

  it("trocar de país: documento brasileiro some, telefone de um lado não serve do outro", () => {
    expect(trocarDePais({ pais: "BR", documento: "11222333000181", telefone: "(96) 99111-2233" }, "GF")).toEqual({
      pais: "GF",
      documento: "",
      telefone: "",
    });
    expect(trocarDePais({ pais: "GF", documento: "", telefone: "+594 694 12 34 56" }, "BR")).toEqual({
      pais: "BR",
      documento: "",
      telefone: "",
    });
    expect(trocarDePais({ pais: "BR", documento: "123", telefone: "(96) 99111-2233" }, "BR")).toEqual({
      pais: "BR",
      documento: "123",
      telefone: "(96) 99111-2233",
    });
  });

  it("de um país de fora para outro, só troca o código e o número fica", () => {
    expect(trocarDePais({ pais: "GF", telefone: "+594 694 12 34 56" }, "SR").telefone).toBe("+597 694 12 34 56");
  });
});

describe("quem recebe WhatsApp (espelha o banco)", () => {
  it("celular brasileiro continua valendo, com ou sem +55", () => {
    expect(recebeWhatsApp("(96) 99111-2233")).toBe(true);
    expect(recebeWhatsApp("+55 96 99111-2233")).toBe(true);
    expect(recebeWhatsApp("5596991112233")).toBe(true);
  });

  it("número de fora só vale escrito com '+' e o código do país", () => {
    expect(recebeWhatsApp("+594 694 12 34 56")).toBe(true);
    expect(recebeWhatsApp("+1 305 555 0100")).toBe(true);
    expect(recebeWhatsApp("594694123456")).toBe(false);
  });

  it("fixo e dois números colados continuam recusados", () => {
    expect(recebeWhatsApp("(96) 3222-1234")).toBe(false);
    expect(recebeWhatsApp("+55 96 3222-1234")).toBe(false);
    expect(recebeWhatsApp("96 99131-8834 / 96 98140-8722")).toBe(false);
    expect(recebeWhatsApp("+594 123")).toBe(false);
  });

  it("estrangeiro: devolve só os dígitos, e o +55 não é de fora", () => {
    expect(numeroEstrangeiro("+594 694 12 34 56")).toBe("594694123456");
    expect(numeroEstrangeiro("+55 96 99111-2233")).toBeNull();
    expect(numeroEstrangeiro("594694123456")).toBeNull();
    expect(numeroEstrangeiro("+0 123 456 789")).toBeNull();
  });

  it("o número que chegou pelo webhook vale com 12 a 15 dígitos fora do 55; os EUA, sem o '+', ficam de fora", () => {
    expect(numeroRecebidoDeFora("594694123456")).toBe("594694123456");
    expect(numeroRecebidoDeFora("5596991112233")).toBeNull();
    expect(numeroRecebidoDeFora("13055550100")).toBeNull();
    expect(numeroRecebidoDeFora("96 99131-8834 / 96 98140-8722")).toBeNull();
  });

  it("a chave de reconhecimento do cliente de fora é o número com o código do país", () => {
    expect(chaveWhatsApp("+594 694 12 34 56")).toBe("594694123456");
  });
});

describe("o envio não põe o 55 na frente de quem é de fora", () => {
  it("brasileiro vai com 55; de fora vai como está", () => {
    expect(telefoneParaZapi("(96) 99111-2233")).toBe("5596991112233");
    expect(telefoneParaZapi("+594 694 12 34 56")).toBe("594694123456");
    expect(telefoneParaZapi("594694123456")).toBe("594694123456");
    expect(telefoneParaZapi("+1 305 555 0100")).toBe("13055550100");
  });

  it("fixo continua sem destino", () => {
    expect(telefoneParaZapi("(96) 3222-1234")).toBeNull();
    expect(telefoneParaZapi("")).toBeNull();
    expect(telefoneParaZapi(null)).toBeNull();
  });

  it("o link do portal usa o mesmo número", () => {
    expect(linkDoWhatsapp("+594 694 12 34 56", "oi")).toContain("wa.me/594694123456?");
    expect(linkDoWhatsapp("(96) 99111-2233", "oi")).toContain("wa.me/5596991112233?");
  });
});

describe("cadastro guiado", () => {
  const base = { ...RESPOSTAS_VAZIAS_DO_CLIENTE, tipo: "pj" as const, nome: "Gráfica Guiana", telefone: "+594 694 12 34 56" };

  it("cliente de fora não passa pelo passo do documento", () => {
    expect(passosDoCliente()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(passosDoCliente({ pais: "BR" })).toEqual([1, 2, 3, 4, 5, 6]);
    expect(passosDoCliente({ pais: "GF" })).toEqual([1, 3, 4, 5, 6]);
  });

  it("o documento só é cobrado de quem é do Brasil", () => {
    expect(pendenciaDoPassoDoCliente(2, { ...base, pais: "GF" })).toBeNull();
    expect(pendenciaDoPassoDoCliente(2, { ...base, pais: "BR" })).toMatch(/CPF ou o CNPJ/);
  });

  it("o WhatsApp de fora é conferido com a regra de fora e a mensagem diz como corrigir", () => {
    expect(pendenciaDoPassoDoCliente(3, { ...base, pais: "GF" })).toBeNull();
    expect(pendenciaDoPassoDoCliente(3, { ...base, pais: "GF", telefone: "694 12 34 56" })).toMatch(/código do país/);
  });

  it("grava o país e deixa o documento vazio para quem é de fora", () => {
    const fora = clienteDasRespostas({ ...base, pais: "GF", documento: "11222333000181" });
    expect(fora).toMatchObject({ pais: "GF", documento: "" });
    const brasil = clienteDasRespostas({ ...base, pais: "BR", telefone: "(96) 99111-2233", documento: "11222333000181" });
    expect(brasil).toMatchObject({ pais: "BR", documento: "11222333000181" });
  });
});

describe("as peças na tela", () => {
  const html = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(el);

  it("o seletor de país mostra a bandeira e o nome, e é um campo de escolha com busca", () => {
    const h = html(createElement(SeletorDePais, { valor: "GF", onChange: () => {} }));
    expect(h).toContain("Guiana Francesa");
    expect(h).toContain(bandeira("GF"));
    expect(h).toContain('role="combobox"');
    expect(h).toContain("País");
  });

  it("o telefone do Brasil é o campo de sempre, com +55 à vista", () => {
    const h = html(createElement(CampoDeTelefoneComPais, { id: "t", pais: "BR", valor: "(96) 99111-2233", onChange: () => {} }));
    expect(h).toContain("(96) 99999-9999");
    expect(h).toContain("+55");
    expect(h).not.toContain("Código do país do telefone");
  });

  it("o telefone de fora traz o código para escolher e o número separado dele", () => {
    const h = html(createElement(CampoDeTelefoneComPais, { id: "t", pais: "GF", valor: "+594 694 12 34 56", onChange: () => {} }));
    expect(h).toContain('aria-label="Código do país do telefone"');
    expect(h).toContain("+594");
    expect(h).toContain('value="694 12 34 56"');
  });

  it("aponta o número inválido para o leitor de tela", () => {
    const h = html(createElement(CampoDeTelefoneComPais, { id: "t", pais: "BR", valor: "123", onChange: () => {}, invalido: true }));
    expect(h).toContain('aria-invalid="true"');
  });
});

describe("as telas de clientes usam tudo isso", () => {
  const LISTA = readFileSync("src/routes/_authenticated/clientes.index.tsx", "utf8");
  const FICHA = readFileSync("src/routes/_authenticated/clientes.$id.tsx", "utf8");
  const GUIADO = readFileSync("src/components/cliente/novo-cliente-em-passos.tsx", "utf8");

  it("o cadastro novo escolhe o país, cobra o documento do Brasil e esconde o CPF e o CNPJ de quem é de fora", () => {
    expect(LISTA).toContain("<SeletorDePais");
    expect(LISTA).toContain("ehBrasil(form.pais) && !apenasDigitos(form.documento)");
    expect(LISTA).toContain("{ehBrasil(form.pais) && (");
    expect(LISTA).toContain("<CampoDeTelefoneComPais");
  });

  it("a edição também: país, telefone com código e o documento que não pode ser apagado", () => {
    expect(FICHA).toContain("<SeletorDePais");
    expect(FICHA).toContain("<CampoDeTelefoneComPais");
    expect(FICHA).toContain("O CPF ou CNPJ não pode ficar vazio");
    expect(FICHA).toContain('"pais",');
  });

  it("a lista mostra a bandeira de quem é de fora e separa os cadastros sem documento", () => {
    expect(LISTA).toContain("bandeira(c.pais)");
    expect(LISTA).toContain("Sem CPF/CNPJ");
    expect(LISTA).toContain("soSemDocumento");
  });

  it("o cadastro guiado pergunta o país no primeiro passo e pula o documento para quem é de fora", () => {
    expect(GUIADO).toContain("<SeletorDePais");
    expect(GUIADO).toContain("passosDoCliente(r)");
    expect(GUIADO).toContain("setPasso(ehBrasil(r.pais) ? 2 : 3)");
  });
});

describe("o banco acompanha", () => {
  const SQL = readFileSync("supabase/migrations/20261101180000_cliente_estrangeiro_e_whatsapp_internacional.sql", "utf8");
  const CODIGO = SQL.replace(/^\s*--.*$/gm, "");
  const TIPOS = readFileSync("src/integrations/supabase/types.ts", "utf8");

  it("cria o país e as regras de número de fora sem apagar nada", () => {
    expect(CODIGO).toContain("ADD COLUMN IF NOT EXISTS pais text NOT NULL DEFAULT 'BR'");
    expect(CODIGO).toContain("clientes_pais_check");
    expect(CODIGO).toContain("FUNCTION public.telefone_estrangeiro");
    expect(CODIGO).toContain("FUNCTION public.conversa_recebe_whatsapp");
    expect(CODIGO).not.toMatch(/\b(DROP TABLE|DROP COLUMN|DELETE|TRUNCATE)\b/i);
  });

  it("o número de fora do banco é o mesmo da tela: '+', sem 55, de 8 a 15 dígitos", () => {
    expect(CODIGO).toContain("LIKE '+%'");
    expect(CODIGO).toContain("'^[1-9][0-9]{7,14}$'");
    expect(CODIGO).toContain("!~ '^55'");
  });

  it("a conversa aberta pelo número não bota o 55 em número de fora, e responder usa a regra da conversa", () => {
    expect(CODIGO).toContain("CASE WHEN public.telefone_estrangeiro(p_telefone) THEN v_chave ELSE ''55'' || v_chave END");
    expect(CODIGO).toContain("public.conversa_recebe_whatsapp(v_conversa.telefone)");
    expect(CODIGO).toContain("FUNCTION pg_temp.trocar_na_definicao");
  });

  it("as funções novas não são para o público", () => {
    expect(CODIGO).toContain("REVOKE ALL ON FUNCTION public.telefone_estrangeiro(text) FROM PUBLIC, anon;");
    expect(CODIGO).toContain("REVOKE ALL ON FUNCTION public.conversa_recebe_whatsapp(text) FROM PUBLIC, anon;");
  });

  it("os tipos gerados conhecem o país no Row, no Insert e no Update", () => {
    const ini = TIPOS.indexOf("      clientes: {\n");
    const fim = TIPOS.indexOf("\n      }", TIPOS.indexOf("Update: {", ini));
    expect(TIPOS.slice(ini, fim).match(/\n\s+pais\??: string/g)).toHaveLength(3);
  });
});
