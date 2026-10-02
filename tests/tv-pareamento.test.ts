import { describe, expect, it } from "vitest";
import { defaultParseSearch, defaultStringifySearch } from "@tanstack/react-router";
import {
  ALFABETO_DO_CODIGO,
  TAMANHO_DO_CODIGO,
  TETO_DE_PAREAMENTOS,
  TETO_POR_ORIGEM,
  TOLERANCIA_NO_AR_MS,
  codigoDaBusca,
  codigoNaUrl,
  codigoValido,
  duracaoPorExtenso,
  formatarCodigo,
  gerarCodigo,
  idBemFormado,
  mensagemDaRecusa,
  nomeValido,
  normalizarCodigo,
  normalizarNome,
  retiradaPedeNovoCodigo,
  segredoBemFormado,
  segundosRestantes,
  situacaoDaTv,
  textoDaSituacao,
  urlDeAprovacao,
} from "../src/domain/tv/pareamento";
import { gerarSegredo } from "../src/domain/whatsapp/segredo-webhook";

/**
 * O pareamento da TV da Oficina, na parte que não depende de banco.
 *
 * O que está em jogo aqui é pequeno e fácil de errar: um código que se lê de
 * longe sem confundir letra com número, uma limpeza do que foi digitado que
 * NÃO adivinha intenção, e um "sem acesso há X" que não chama de "no ar" uma
 * TV apagada.
 */

describe("código de pareamento", () => {
  it("o alfabeto não tem os quatro caracteres que se confundem na parede", () => {
    expect(ALFABETO_DO_CODIGO).toHaveLength(32);
    expect(new Set(ALFABETO_DO_CODIGO).size).toBe(32);
    for (const ambiguo of ["0", "O", "1", "I"]) expect(ALFABETO_DO_CODIGO).not.toContain(ambiguo);
  });

  it("sorteia sempre no formato que o banco aceita", () => {
    // O CHECK de tv_pareamentos.codigo é esta mesma expressão.
    for (let i = 0; i < 500; i++) {
      const codigo = gerarCodigo();
      expect(codigo).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
      expect(codigoValido(codigo)).toBe(true);
    }
  });

  it("cada byte vira um caractere, sem favorecer nenhum", () => {
    // 256 valores de byte ÷ 32 caracteres = 8 bytes para cada um. Se o
    // alfabeto tivesse 31 ou 33, alguma letra sairia mais que as outras.
    const contagem = new Map<string, number>();
    for (let b = 0; b < 256; b++) {
      const c = gerarCodigo(new Uint8Array(TAMANHO_DO_CODIGO).fill(b))[0];
      contagem.set(c, (contagem.get(c) ?? 0) + 1);
    }
    expect(contagem.size).toBe(32);
    expect([...contagem.values()].every((n) => n === 8)).toBe(true);
  });

  it("é determinístico com bytes dados e recusa bytes de menos", () => {
    expect(gerarCodigo(new Uint8Array([0, 1, 2, 31, 32, 255]))).toBe("ABC9A9");
    expect(() => gerarCodigo(new Uint8Array(3))).toThrow();
  });

  it("dois sorteios seguidos não repetem", () => {
    const sorteados = new Set(Array.from({ length: 200 }, () => gerarCodigo()));
    // 200 sorteios em ~1 bilhão: repetição aqui é gerador quebrado, não azar.
    expect(sorteados.size).toBe(200);
  });

  it("limpa o que foi digitado sem adivinhar intenção", () => {
    expect(normalizarCodigo(" k7m-q2x ")).toBe("K7MQ2X");
    expect(normalizarCodigo("K7M Q2X")).toBe("K7MQ2X");
    // "0" não vira "O": código com caractere fora do alfabeto é código errado.
    expect(normalizarCodigo("K0M-Q2X")).toBe("K0MQ2X");
    expect(codigoValido(normalizarCodigo("K0M-Q2X"))).toBe(false);
    expect(codigoValido("K7MQ2")).toBe(false);
    expect(codigoValido("K7MQ2XA")).toBe(false);
    expect(codigoValido("k7mq2x")).toBe(false);
  });

  it("mostra em dois grupos de três", () => {
    expect(formatarCodigo("k7mq2x")).toBe("K7M-Q2X");
    expect(formatarCodigo("K7M")).toBe("K7M");
    expect(formatarCodigo("K7M-")).toBe("K7M");
    expect(formatarCodigo("K7MQ")).toBe("K7M-Q");
    expect(formatarCodigo("K7MQ2XZZZ")).toBe("K7M-Q2X");
    expect(formatarCodigo("")).toBe("");
  });

  it("o QR leva só o código, até a tela logada", () => {
    const url = urlDeAprovacao("https://print.exemplo.com/", "k7m-q2x");
    expect(url).toBe("https://print.exemplo.com/telas?codigo=K7M_Q2X");
    // Nada de segredo de retirada nem de token no endereço.
    expect([...new URL(url).searchParams.keys()]).toEqual(["codigo"]);
  });
});

describe("o código atravessa o roteador sem virar outro", () => {
  /** O caminho de verdade: QR → URL → parser do roteador → validateSearch de /telas. */
  const peloRoteador = (codigo: string) => {
    const url = new URL(urlDeAprovacao("https://print.exemplo.com", codigo));
    const cru = defaultParseSearch(url.search).codigo;
    return { cru, validado: codigoDaBusca(cru), busca: url.search };
  };

  it("o defeito que o sublinhado evita: código de dígitos e E é lido como número", () => {
    // O roteador passa cada valor por JSON.parse. Sem separador, "234E56" é
    // notação científica e chegava à tela como OUTRO código.
    const semSeparador = defaultParseSearch("?codigo=234E56").codigo;
    expect(typeof semSeparador).toBe("number");
    expect(normalizarCodigo(String(semSeparador))).not.toBe("234E56");
    // O hífen de exibição não resolve: "22E-222" é expoente negativo.
    const comHifen = defaultParseSearch("?codigo=22E-222").codigo;
    expect(typeof comHifen).toBe("number");
    expect(normalizarCodigo(String(comHifen))).not.toBe("22E222");
    // Sublinhado não existe em nenhum valor JSON: chega como texto.
    expect(defaultParseSearch("?codigo=234_E56").codigo).toBe("234_E56");
    expect(defaultParseSearch("?codigo=22E_222").codigo).toBe("22E_222");
  });

  it("os códigos que JSON.parse entenderia chegam inteiros", () => {
    for (const codigo of ["234E56", "2E5678", "2345E6", "22E222", "9E9999", "234567", "K7MQ2X"]) {
      const { cru, validado } = peloRoteador(codigo);
      expect(typeof cru, codigo).toBe("string");
      expect(normalizarCodigo(validado ?? ""), codigo).toBe(codigo);
      expect(formatarCodigo(validado ?? ""), codigo).toBe(formatarCodigo(codigo));
    }
  });

  it("vale para o alfabeto inteiro: sorteios e a família de dígitos com E por extenso", () => {
    const confere = (codigo: string) => {
      const { validado, busca } = peloRoteador(codigo);
      expect(normalizarCodigo(validado ?? ""), codigo).toBe(codigo);
      // O validador devolve a mesma grafia do QR, e o roteador a escreve igual:
      // o servidor não tem para onde redirecionar o endereço lido.
      expect(defaultStringifySearch({ codigo: validado }), codigo).toBe(busca);
    };
    for (let i = 0; i < 3000; i++) confere(gerarCodigo());
    // Só dígitos (8^6 é muito: um a cada 53) e um E em cada posição (um a cada 7).
    const digitos = "23456789";
    const emDigitos = (n: number, tamanho: number) => {
      let texto = "";
      let x = n;
      for (let k = 0; k < tamanho; k++) {
        texto += digitos[x % 8];
        x = Math.floor(x / 8);
      }
      return texto;
    };
    for (let n = 0; n < 8 ** 6; n += 53) confere(emDigitos(n, 6));
    for (let posicao = 0; posicao <= 5; posicao++) {
      for (let n = 0; n < 8 ** 5; n += 7) {
        const resto = emDigitos(n, 5);
        confere(`${resto.slice(0, posicao)}E${resto.slice(posicao)}`);
      }
    }
  });

  it("a busca devolve sempre a grafia da URL; o campo mostra com hífen", () => {
    expect(codigoNaUrl("k7mq2x")).toBe("K7M_Q2X");
    expect(codigoNaUrl("K7M")).toBe("K7M");
    expect(codigoDaBusca("k7mq2x")).toBe("K7M_Q2X");
    expect(codigoDaBusca("K7M-Q2X")).toBe("K7M_Q2X");
    expect(codigoDaBusca("K7M_Q2X")).toBe("K7M_Q2X");
    expect(codigoDaBusca(234567)).toBe("234_567");
    expect(codigoDaBusca("K7MQ2XZZZ")).toBe("K7M_Q2X");
    expect(formatarCodigo(codigoDaBusca("K7M_Q2X") ?? "")).toBe("K7M-Q2X");
  });

  it("valor que não é texto nem número não chega à tela", () => {
    // `?codigo=true` o roteador entrega como booleano; a tela quebraria ao
    // tentar formatar. O validador devolve undefined e a rota grava a chave.
    for (const lixo of [true, false, null, undefined, [], ["K7MQ2X"], { a: 1 }, "", "---"]) {
      expect(codigoDaBusca(lixo), JSON.stringify(lixo)).toBeUndefined();
    }
    expect(codigoDaBusca(defaultParseSearch("?codigo=true").codigo)).toBeUndefined();
    expect(codigoDaBusca(defaultParseSearch("?codigo=[1]").codigo)).toBeUndefined();
  });
});

describe("segredos e ids que chegam de fora", () => {
  it("aceita o que gerarSegredo produz", () => {
    for (let i = 0; i < 50; i++) expect(segredoBemFormado(gerarSegredo())).toBe(true);
  });

  it("recusa o que não tem cara de segredo antes de ir ao banco", () => {
    expect(segredoBemFormado(null)).toBe(false);
    expect(segredoBemFormado(undefined)).toBe(false);
    expect(segredoBemFormado("")).toBe(false);
    expect(segredoBemFormado("1234")).toBe(false);
    expect(segredoBemFormado("a".repeat(42))).toBe(false);
    expect(segredoBemFormado("a".repeat(44))).toBe(false);
    expect(segredoBemFormado(`${"a".repeat(42)}=`)).toBe(false);
    expect(segredoBemFormado(12345)).toBe(false);
  });

  it("id de pareamento é uuid", () => {
    expect(idBemFormado("6e6693f1-ea58-42b8-acf6-46fae959566a")).toBe(true);
    expect(idBemFormado("6e6693f1ea5842b8acf646fae959566a")).toBe(false);
    expect(idBemFormado("' or 1=1 --")).toBe(false);
    expect(idBemFormado(42)).toBe(false);
  });
});

describe("nome da TV", () => {
  it("junta espaços repetidos e apara as pontas, como a função do banco", () => {
    expect(normalizarNome("  TV   da  Oficina ")).toBe("TV da Oficina");
  });

  it("exige de 1 a 40 caracteres depois de limpo", () => {
    expect(nomeValido("TV da Oficina")).toBe(true);
    expect(nomeValido("   ")).toBe(false);
    expect(nomeValido("")).toBe(false);
    expect(nomeValido("x".repeat(40))).toBe(true);
    expect(nomeValido("x".repeat(41))).toBe(false);
  });
});

describe("o pedido visto pela TV", () => {
  it("vencido e consumido pedem código novo; aguardando e pareado não", () => {
    expect(retiradaPedeNovoCodigo("expirado")).toBe(true);
    expect(retiradaPedeNovoCodigo("consumido")).toBe(true);
    expect(retiradaPedeNovoCodigo("aguardando")).toBe(false);
    expect(retiradaPedeNovoCodigo("pareado")).toBe(false);
  });

  it("a contagem do código é de cronômetro, não de relógio", () => {
    // validade_s vem do banco; o decorrido é o que o aparelho mediu desde a
    // resposta. A hora do aparelho não entra — TV com o relógio adiantado 11
    // minutos via todo código novo como vencido e pedia outro em laço.
    expect(segundosRestantes(600, 0)).toBe(600);
    expect(segundosRestantes(600, 1_500)).toBe(598);
    expect(segundosRestantes(600, 599_000)).toBe(1);
    expect(segundosRestantes(600, 600_000)).toBe(0);
    expect(segundosRestantes(600, 3_600_000)).toBe(0);
    // Cronômetro que anda para trás e resposta sem validade não viram tempo a mais.
    expect(segundosRestantes(600, -5_000)).toBe(600);
    expect(segundosRestantes(Number.NaN, 0)).toBe(0);
    expect(segundosRestantes(600, Number.NaN)).toBe(0);
  });

  it("os dois tetos de pedidos vivos: o da origem cabe várias vezes no da fila", () => {
    // Um endereço só não consegue encher a fila inteira (5 de 20).
    expect(TETO_POR_ORIGEM).toBe(5);
    expect(TETO_DE_PAREAMENTOS).toBe(20);
  });
});

describe("recusas da aprovação viram frase que diz o que fazer", () => {
  it("código não encontrado conta as tentativas que restam", () => {
    expect(
      mensagemDaRecusa({ ok: false, motivo: "codigo_nao_encontrado", tentativas_restantes: 4 }),
    ).toContain("restam 4 tentativas");
    expect(
      mensagemDaRecusa({ ok: false, motivo: "codigo_nao_encontrado", tentativas_restantes: 1 }),
    ).toContain("resta 1 tentativa");
    expect(
      mensagemDaRecusa({ ok: false, motivo: "codigo_nao_encontrado", tentativas_restantes: 0 }),
    ).toContain("última tentativa");
  });

  it("bloqueio por tentativas diz a hora em que libera, no fuso da oficina", () => {
    // 18:30 UTC = 15:30 em Macapá (America/Belem, UTC−3).
    const frase = mensagemDaRecusa({
      ok: false,
      motivo: "muitas_tentativas",
      liberado_em: "2026-10-01T18:30:00Z",
    });
    expect(frase).toContain("15:30");
    expect(mensagemDaRecusa({ ok: false, motivo: "muitas_tentativas" })).toContain("espere");
  });

  it("todo motivo tem frase própria", () => {
    const motivos = [
      "nome_invalido",
      "muitas_tentativas",
      "codigo_mal_formado",
      "codigo_nao_encontrado",
      "codigo_ja_usado",
      "codigo_expirado",
    ] as const;
    const frases = motivos.map((motivo) => mensagemDaRecusa({ ok: false, motivo }));
    expect(frases.every((f) => typeof f === "string" && f.length > 20)).toBe(true);
    expect(new Set(frases).size).toBe(motivos.length);
  });
});

describe("sem acesso há X", () => {
  const agora = new Date("2026-10-01T15:00:00Z");
  const ha = (ms: number) => new Date(agora.getTime() - ms).toISOString();
  const MIN = 60_000;

  it("revogada ganha de tudo, mesmo com acesso recente", () => {
    const tv = { ultimo_acesso_em: ha(10_000), revogado_em: ha(5_000) };
    expect(situacaoDaTv(tv, agora)).toBe("revogada");
    expect(textoDaSituacao(tv, agora)).toBe("Acesso revogado");
  });

  it("TV aprovada que nunca leu o painel não é 'no ar'", () => {
    const tv = { ultimo_acesso_em: null, revogado_em: null };
    expect(situacaoDaTv(tv, agora)).toBe("nunca_acessou");
    expect(textoDaSituacao(tv, agora)).toBe("Nunca acessou");
  });

  it("dentro da tolerância está no ar; um segundo depois, não", () => {
    expect(situacaoDaTv({ ultimo_acesso_em: ha(90_000), revogado_em: null }, agora)).toBe("no_ar");
    expect(
      situacaoDaTv({ ultimo_acesso_em: ha(TOLERANCIA_NO_AR_MS), revogado_em: null }, agora),
    ).toBe("no_ar");
    expect(
      situacaoDaTv({ ultimo_acesso_em: ha(TOLERANCIA_NO_AR_MS + 1000), revogado_em: null }, agora),
    ).toBe("sem_acesso");
  });

  it("escreve o tempo parado em minutos, horas e dias", () => {
    const frase = (ms: number) =>
      textoDaSituacao({ ultimo_acesso_em: ha(ms), revogado_em: null }, agora);
    expect(frase(40 * MIN)).toBe("Sem acesso há 40 min");
    expect(frase(59 * MIN + 59_000)).toBe("Sem acesso há 59 min");
    expect(frase(60 * MIN)).toBe("Sem acesso há 1 h");
    expect(frase(16 * 60 * MIN)).toBe("Sem acesso há 16 h");
    expect(frase(47 * 60 * MIN)).toBe("Sem acesso há 47 h");
    expect(frase(48 * 60 * MIN)).toBe("Sem acesso há 2 dias");
    expect(frase(9 * 24 * 60 * MIN)).toBe("Sem acesso há 9 dias");
  });

  it("data ilegível acusa em vez de dizer 'no ar'", () => {
    const tv = { ultimo_acesso_em: "não é data", revogado_em: null };
    expect(situacaoDaTv(tv, agora)).toBe("sem_acesso");
    expect(textoDaSituacao(tv, agora)).toBe("Sem acesso");
  });

  it("relógio adiantado da TV (acesso 'no futuro') não vira tempo negativo", () => {
    expect(situacaoDaTv({ ultimo_acesso_em: ha(-30_000), revogado_em: null }, agora)).toBe("no_ar");
    expect(duracaoPorExtenso(-5000)).toBe("menos de 1 min");
    expect(duracaoPorExtenso(30_000)).toBe("menos de 1 min");
  });
});
