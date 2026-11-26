import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DDDS_BRASIL, ehCelularBrasileiro, ehDddDoBrasil } from "../src/domain/contato/ddds-do-brasil";
import { DDDS_BRASIL as DDDS_REEXPORTADOS } from "../src/domain/contato/celular-e-email";
import {
  PAISES,
  PAISES_FREQUENTES,
  exemploDoNumero,
  montarTelefoneInternacional,
  paisDoTelefone,
  paisEfetivo,
  paisPorDdi,
  semZeroDeDiscagem,
  textoParaCampoDeTelefone,
  telefoneInternacionalLegivel,
  trocarDePais,
} from "../src/domain/clientes/paises";
import { recebeWhatsApp } from "../src/domain/documentos";
import { telefoneParaZapi } from "../src/domain/whatsapp/zapi-envio";
import { lerNumeroColado } from "../src/domain/whatsapp/numero-colado";

/**
 * Telefone internacional (26/11/2026, pedido do dono: cliente da França, da Guiana Francesa e da Colômbia).
 * O que se prova aqui é o que estava ERRADO antes, medido com o código real:
 *   - "+33 9 12 34 56 78" saía para 5533912345678 (um número brasileiro de verdade, DDD 33);
 *   - "+597 712 3456" (Suriname) saía para 5559977123456;
 *   - "+33 06 12 34 56 78" (o francês digita com o 0) saía para 330612345678, que não existe;
 *   - a "Nova conversa" recusava França, Guiana Francesa e Colômbia.
 */

describe("os DDDs do Brasil e o celular brasileiro de verdade", () => {
  it("a lista é uma só: o módulo de celular reexporta a mesma", () => {
    expect(DDDS_REEXPORTADOS).toBe(DDDS_BRASIL);
    expect(DDDS_BRASIL).toHaveLength(67);
  });

  it("DDD que existe e DDD que não existe", () => {
    expect(ehDddDoBrasil("96")).toBe(true);
    expect(ehDddDoBrasil("11")).toBe(true);
    expect(ehDddDoBrasil("59")).toBe(false); // Suriname 597 começa por 59
    expect(ehDddDoBrasil("10")).toBe(false);
    expect(ehDddDoBrasil("00")).toBe(false);
  });

  it("celular brasileiro: 11 dígitos, DDD de verdade e o 9 na frente", () => {
    expect(ehCelularBrasileiro("96991112233")).toBe(true);
    expect(ehCelularBrasileiro("59977123456")).toBe(false); // o "celular" que o Suriname virava
    expect(ehCelularBrasileiro("96881112233")).toBe(false); // sem o 9
    expect(ehCelularBrasileiro("9699111223")).toBe(false); // 10 dígitos
    expect(ehCelularBrasileiro(null)).toBe(false);
  });
});

describe("para onde o envio manda cada número (telefoneParaZapi)", () => {
  it.each([
    // brasileiro: como sempre
    ["(96) 99111-2233", "5596991112233"],
    ["+55 96 99111-2233", "5596991112233"],
    ["96991112233", "5596991112233"],
    // de fora, escrito com "+": o código do país, sem o 55
    ["+33 6 12 34 56 78", "33612345678"],
    ["+594 694 12 34 56", "594694123456"],
    ["+57 300 123 4567", "573001234567"],
    // o "+" vale antes do formato brasileiro: eram os dois erros graves
    ["+33 9 12 34 56 78", "33912345678"],
    ["+597 712 3456", "5977123456"],
    // de fora, só dígitos (como chega do webhook)
    ["573001234567", "573001234567"],
    ["594694123456", "594694123456"],
    ["33612345678", "33612345678"], // 11 dígitos: antes não valia
    ["34612345678", "34612345678"],
    ["12125551234", "12125551234"],
    ["5977123456", "5977123456"], // Suriname, 10 dígitos
  ])("%s → %s", (entrada, esperado) => {
    expect(telefoneParaZapi(entrada)).toBe(esperado);
  });

  it("o que não é número recebe nulo, em vez de ir para um número errado", () => {
    expect(telefoneParaZapi("9632221234")).toBeNull(); // fixo de Macapá
    expect(telefoneParaZapi("96 99131-8834 / 96 98140-8722")).toBeNull(); // dois colados
    expect(telefoneParaZapi("")).toBeNull();
    expect(telefoneParaZapi(null)).toBeNull();
  });

  it("nenhum número de fora escrito com '+' vira número brasileiro", () => {
    for (const n of ["+33 9 12 34 56 78", "+597 712 3456", "+592 612 3456", "+34 912 345 678", "+58 412 123 4567", "+351 912 345 678"]) {
      const destino = telefoneParaZapi(n);
      expect(destino, n).not.toBeNull();
      expect(destino!.startsWith("55"), n).toBe(false);
      expect(destino, n).toBe(n.replace(/\D/g, ""));
    }
  });
});

describe("recebeWhatsApp: DDD de verdade, e o '+' continua valendo", () => {
  it("brasileiro com DDD que não existe deixa de passar por celular", () => {
    expect(recebeWhatsApp("(59) 97712-3456")).toBe(false);
    expect(recebeWhatsApp("(96) 99111-2233")).toBe(true);
  });
  it("de fora com + vale; sem + não vale (regra de digitação continua estrita)", () => {
    expect(recebeWhatsApp("+597 712 3456")).toBe(true);
    expect(recebeWhatsApp("+33 6 12 34 56 78")).toBe(true);
    expect(recebeWhatsApp("33612345678")).toBe(false);
  });
});

describe("o zero de discagem do país", () => {
  it("o francês digita com o 0 e o número gravado sai sem ele", () => {
    expect(montarTelefoneInternacional("33", "06 12 34 56 78")).toBe("+33 6 12 34 56 78");
    expect(montarTelefoneInternacional("33", "6 12 34 56 78")).toBe("+33 6 12 34 56 78");
    expect(montarTelefoneInternacional("594", "0694 12 34 56")).toBe("+594 694 12 34 56");
    expect(montarTelefoneInternacional("58", "0412 123 4567")).toBe("+58 412 123 4567");
    expect(montarTelefoneInternacional("33", "(0)6 12 34 56 78")).toBe("+33 6 12 34 56 78");
  });

  it("o que o país não usa fica como foi digitado", () => {
    expect(montarTelefoneInternacional("57", "300 123 4567")).toBe("+57 300 123 4567");
    expect(montarTelefoneInternacional("351", "912 345 678")).toBe("+351 912 345 678");
    expect(montarTelefoneInternacional("39", "06 1234 5678")).toBe("+39 06 1234 5678"); // fixo italiano mantém o 0
    expect(montarTelefoneInternacional("1", "212 555 1234")).toBe("+1 212 555 1234");
  });

  it("um zero sozinho não apaga o número, e sem dígitos não grava nada", () => {
    expect(semZeroDeDiscagem("33", "0")).toBe("0");
    expect(montarTelefoneInternacional("33", "")).toBe("");
    expect(montarTelefoneInternacional("33", "  ")).toBe("");
  });

  it("ao trocar de país de fora para outro, o número fica e o código muda (sem o zero)", () => {
    const r = trocarDePais({ pais: "FR", telefone: "+33 6 12 34 56 78" }, "GF");
    expect(r.telefone).toBe("+594 6 12 34 56 78");
  });
});

describe("o país que o telefone diz ser", () => {
  it("pelo código depois do +", () => {
    expect(paisDoTelefone("+33 6 12 34 56 78")).toBe("FR");
    expect(paisDoTelefone("+594 694 12 34 56")).toBe("GF");
    expect(paisDoTelefone("+57 300 123 4567")).toBe("CO");
    expect(paisDoTelefone("+1 212 555 1234")).toBe("US"); // código dividido: vale o mais usado
    expect(paisDoTelefone("(96) 99111-2233")).toBe("BR");
    expect(paisDoTelefone("+55 96 99111-2233")).toBe("BR");
    expect(paisDoTelefone("")).toBe("BR");
  });

  it("cadastro com país Brasil e telefone de fora vale o telefone; país já escolhido vale como está", () => {
    expect(paisEfetivo("BR", "+33 6 12 34 56 78")).toBe("FR");
    expect(paisEfetivo(null, "+57 300 123 4567")).toBe("CO");
    expect(paisEfetivo("BR", "(96) 99111-2233")).toBe("BR");
    expect(paisEfetivo("GF", "+33 6 12 34 56 78")).toBe("GF");
  });

  it("o país de um código de discagem", () => {
    expect(paisPorDdi("594")?.codigo).toBe("GF");
    expect(paisPorDdi("+33")?.codigo).toBe("FR");
    expect(paisPorDdi("1")?.codigo).toBe("US");
    expect(paisPorDdi("999")).toBeUndefined();
  });
});

describe("a lista dos mais usados", () => {
  it("traz França e Colômbia (o dono tem cliente dos dois), logo depois do Brasil e da Guiana Francesa", () => {
    expect(PAISES_FREQUENTES).toEqual(["BR", "GF", "FR", "CO", "SR", "GY", "VE", "PT", "US"]);
    expect(PAISES.slice(0, 9).map((p) => p.codigo)).toEqual(["BR", "GF", "FR", "CO", "SR", "GY", "VE", "PT", "US"]);
  });
  it("cada país mais usado tem um exemplo de número no campo", () => {
    for (const c of PAISES_FREQUENTES) {
      const ddi = PAISES.find((p) => p.codigo === c)!.ddi;
      expect(exemploDoNumero(ddi), c).not.toBe("número sem o código do país");
    }
    expect(exemploDoNumero("999")).toBe("número sem o código do país");
  });
});

describe("o número de fora para mostrar", () => {
  it.each([
    ["+33 06 12 34 56 78", "+33 6 12 34 56 78"],
    ["+594 694 12 34 56", "+594 694 12 34 56"],
    ["33612345678", "+33 612345678"], // França, pelo webhook
    ["573001234567", "+57 3001234567"], // Colômbia, pelo webhook
    ["5977123456", "+597 7123456"], // Suriname, 10 dígitos
  ])("%s → %s", (entrada, esperado) => {
    expect(telefoneInternacionalLegivel(entrada)).toBe(esperado);
  });
  it("brasileiro, com ou sem o 55, nunca é mostrado como de fora", () => {
    expect(telefoneInternacionalLegivel("5596991112233")).toBeNull();
    expect(telefoneInternacionalLegivel("96991112233")).toBeNull();
    expect(telefoneInternacionalLegivel("(96) 99111-2233")).toBeNull();
    expect(telefoneInternacionalLegivel("+55 96 99111-2233")).toBeNull();
    expect(telefoneInternacionalLegivel("9632221234")).toBeNull(); // fixo
    expect(telefoneInternacionalLegivel("")).toBeNull();
  });
});

describe("a Nova conversa lê número de fora", () => {
  it.each([
    ["+33 6 12 34 56 78", "+33612345678", "FR", "+33 6 12 34 56 78"],
    ["+33 06 12 34 56 78", "+33612345678", "FR", "+33 6 12 34 56 78"],
    ["0033 6 12 34 56 78", "+33612345678", "FR", "+33 6 12 34 56 78"],
    ["+594 694 12 34 56", "+594694123456", "GF", "+594 694 12 34 56"],
    ["+594 0694 12 34 56", "+594694123456", "GF", "+594 694 12 34 56"],
    ["+57 300 123 4567", "+573001234567", "CO", "+57 300 123 4567"],
    ["+597 712 3456", "+5977123456", "SR", "+597 712 3456"],
    ["https://wa.me/33612345678", "+33612345678", "FR", "+33 612345678"],
    ["https://api.whatsapp.com/send?phone=573001234567", "+573001234567", "CO", "+57 3001234567"],
  ])("%s", (colado, telefone, pais, legivel) => {
    const r = lerNumeroColado(colado);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.internacional).toBe(true);
    expect(r.telefone).toBe(telefone);
    expect(r.pais).toBe(pais);
    expect(r.legivel).toBe(legivel);
    expect(r.dddPresumido).toBe(false);
  });

  it("a chave de reconhecimento é a mesma que o banco grava (normalize_whatsapp_phone)", () => {
    expect(lerNumeroColado("+33 6 12 34 56 78")).toMatchObject({ ok: true, chave: "33612345678" });
    expect(lerNumeroColado("+57 300 123 4567")).toMatchObject({ ok: true, chave: "573001234567" });
    // 10 dígitos: o banco insere um 9 (regra brasileira) dos dois lados, e a chave espelha isso
    expect(lerNumeroColado("+597 712 3456")).toMatchObject({ ok: true, chave: "59977123456" });
  });

  it("o brasileiro continua igual, inclusive com +55 e com link", () => {
    for (const colado of ["+55 (96) 99156-2194", "96 99156-2194", "wa.me/5596991562194", "(96) 99156-2194"]) {
      const r = lerNumeroColado(colado);
      expect(r, colado).toMatchObject({ ok: true, chave: "96991562194", telefone: "96991562194", internacional: false, pais: "BR" });
    }
  });

  it("de fora com dígito demais ou de menos é recusado com o motivo", () => {
    const longo = lerNumeroColado("+33 6 12 34 56 78 90 12 34 56");
    expect(longo.ok).toBe(false);
    expect(!longo.ok && longo.motivo).toContain("mais de 15");
    const curto = lerNumeroColado("+33 6 12");
    expect(curto.ok).toBe(false);
    expect(!curto.ok && curto.motivo).toContain("Faltam números");
  });

  it("o mesmo número sem o +, o 00 nem link continua sendo tratado como brasileiro (e a mensagem manda escolher o país)", () => {
    const r = lerNumeroColado("33612345678");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.motivo).toContain("escolha o país na bandeira");
  });
});

describe("o que se cola no campo com bandeira", () => {
  it.each([
    ["0033 6 12 34 56 78", "+33 6 12 34 56 78"],
    ["  00594 694 12 34 56", "+594 694 12 34 56"],
    ["https://wa.me/33612345678", "+33612345678"],
    ["https://api.whatsapp.com/send?phone=573001234567", "+573001234567"],
    ["https://wa.me/5596991562194", "96991562194"],
    ["+57 300 123 4567", "+57 300 123 4567"],
    ["(96) 99111-2233", "(96) 99111-2233"],
    ["", ""],
  ])("%s → %s", (colado, esperado) => {
    expect(textoParaCampoDeTelefone(colado)).toBe(esperado);
  });
  it("um zero de DDD brasileiro não é o 00 europeu", () => {
    expect(textoParaCampoDeTelefone("096 99111-2233")).toBe("096 99111-2233");
  });
});

describe("as telas usam o campo com bandeira e mandam o número de fora do jeito certo", () => {
  const ler = (c: string) => readFileSync(c, "utf8");
  const SEM_COMENTARIOS = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const NOVA = ler("src/components/whatsapp/nova-conversa.tsx");
  const ORCAMENTOS = ler("src/routes/_authenticated/orcamentos.index.tsx");
  const LEADS = ler("src/routes/_authenticated/leads.tsx");
  const FICHA = ler("src/components/cliente/campos-da-ficha.tsx");
  const CAMPO = ler("src/components/bex/CampoDeTelefoneInternacional.tsx");

  it("Nova conversa: o servidor recebe o telefone com o '+' (o que diz de fora) e a procura usa a chave do banco", () => {
    expect(NOVA).toContain("<CampoDeTelefoneInternacional");
    expect(NOVA).toMatch(/abrir\(\{ data: \{ telefone: lido\.telefone,/);
    expect(SEM_COMENTARIOS(NOVA)).not.toMatch(/telefone: lido\.chave/);
    expect(NOVA.match(/\.eq\("telefone_normalizado", chave as string\)/g)).toHaveLength(2);
  });

  it("Orçamento avulso: o campo com bandeira e o cliente nasce com o país do telefone", () => {
    expect(ORCAMENTOS).toContain('<CampoDeTelefoneInternacional');
    expect(ORCAMENTOS).toMatch(/pais: paisDoTelefone\(form\.contato_telefone\)/);
  });

  it("Lead de fora: o cliente que acabou de nascer recebe o país; o que já existia não muda, e a falha avisa", () => {
    expect(LEADS).toContain("<CampoDeTelefoneInternacional");
    const trecho = LEADS.slice(LEADS.indexOf("const pais = paisDoTelefone(converter.telefone)"));
    expect(trecho).toMatch(/pais !== "BR" && !r\.cliente_existente && !r\.idempotent/);
    expect(trecho).toMatch(/\.update\(\{ pais \}\)\s*\.eq\("id", r\.cliente_id\)\s*\.eq\("pais", "BR"\)/);
    expect(trecho).toMatch(/if \(erroPais\) \{\s*toast\.warning/);
  });

  it("Telefones 2 e 3 da ficha: a máscara de saída não reformata número de fora (virava '(33) 61234-5678')", () => {
    expect(FICHA).toContain("<CampoDeTelefoneInternacional");
    expect(FICHA).toMatch(/if \(atual\.trim\(\)\.startsWith\("\+"\)\) return;/);
  });

  it("o campo mantém uma só caixa de texto entre o Brasil e o de fora (trocar de país não tira o cursor)", () => {
    expect(CAMPO.match(/<Input\b/g)).toHaveLength(1);
  });
});

describe("a migração do banco repete as regras do TypeScript", () => {
  const MIGRACAO = readFileSync("supabase/migrations/20261126100000_telefone_internacional_ddd_e_conversa_de_fora.sql", "utf8");

  it("a lista de DDDs do banco é a mesma do TypeScript, no mesmo conteúdo", () => {
    const corpo = MIGRACAO.slice(MIGRACAO.indexOf("CREATE OR REPLACE FUNCTION public.ddd_do_brasil"), MIGRACAO.indexOf("CREATE OR REPLACE FUNCTION public.celular_br_valido"));
    const doBanco = [...corpo.matchAll(/'(\d\d)'/g)].map((m) => m[1]);
    expect(doBanco).toEqual([...DDDS_BRASIL]);
  });

  it("as duas funções novas nascem fechadas: nada para PUBLIC, anon e authenticated por padrão, e só authenticated e service_role voltam", () => {
    for (const f of ["ddd_do_brasil", "celular_br_valido"]) {
      expect(MIGRACAO).toContain(`REVOKE ALL ON FUNCTION public.${f}(text) FROM PUBLIC, anon, authenticated;`);
      expect(MIGRACAO).toContain(`GRANT EXECUTE ON FUNCTION public.${f}(text) TO authenticated, service_role;`);
    }
    expect(MIGRACAO).not.toMatch(/GRANT EXECUTE[^;]*\banon\b/i);
  });

  it("a conversa de fora é gravada com o número real e o '+', nunca com a chave (que acrescenta um 9 ao Suriname)", () => {
    expect(MIGRACAO).toMatch(/CASE WHEN public\.telefone_estrangeiro\(p_telefone\) THEN '\+' \|\| v_digitos ELSE '55' \|\| v_chave END/);
    expect(MIGRACAO).toMatch(/v_digitos := regexp_replace\(p_telefone, '\[\^0-9\]', '', 'g'\)/);
  });

  it("a migração confere no próprio banco o que promete e protege as funções que já existem com o md5 da versão conhecida", () => {
    expect(MIGRACAO).toMatch(/DO \$conferencia\$/);
    expect(MIGRACAO).toContain("a78f014f40348cd9f4ba38c19303f80f");
    expect(MIGRACAO).toContain("a928ee39fd9e52b204e48ad6ee85576f");
    expect(MIGRACAO).toContain("de8ca40450deb28d9c46812508f2f20b");
    expect(MIGRACAO).toMatch(/DESFAZER/);
  });

  it("não mexe em normalize_whatsapp_phone (a chave dos dois lados tem de continuar a mesma)", () => {
    expect(MIGRACAO).not.toMatch(/CREATE OR REPLACE FUNCTION public\.normalize_whatsapp_phone/);
  });

  it("a regra de 'recebido de fora' do banco e a do TypeScript concordam nos mesmos casos", () => {
    // Os mesmos números que a conferência final da migração exige verdadeiros ou falsos.
    const verdadeiros = ["33612345678", "34612345678", "12125551234", "573001234567", "594694123456", "5977123456", "5596991112233", "96991112233"];
    const falsos = ["9632221234", "5532221234", ""];
    for (const n of verdadeiros) expect(telefoneParaZapi(n), n).not.toBeNull();
    for (const n of falsos) expect(telefoneParaZapi(n), n).toBeNull();
  });
});
