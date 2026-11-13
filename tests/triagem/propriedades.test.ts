import { describe, expect, it } from "vitest";
import {
  contextoPadrao,
  digitar,
  expirarTriagem,
  iniciarSessao,
  SABADO_AS_20H,
  SEGUNDA_AS_10H,
  STATUS_ENCERRADOS,
  verificarTexto,
  type SessaoSimulada,
  type TipoDeEntrada,
} from "../../src/domain/whatsapp/triagem";

/**
 * Propriedades da máquina, sobre conversas sorteadas com uma semente fixa:
 *  1. nunca devolve texto que o verificador do ramo reprove;
 *  2. nunca passa do teto de mensagens, contando as automáticas de fora;
 *  3. terminar sempre é possível: "parar" encerra em qualquer ponto, e quem só
 *     escreve bobagem chega a um fim em poucos passos;
 *  4. chave de idempotência nunca se repete, aviso do grupo sai no máximo uma vez,
 *     e depois do fim não sai mais nada.
 */

function prng(semente: number) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MENSAGENS = [
  // nomes bons e armadilhas de nome
  "Maria Souza",
  "maria",
  "Souza",
  "seu João",
  "dona Maria das Graças",
  "Dr. Carlos Lima",
  "meu nome é Ana Paula",
  "Parceiro Silva",
  "Revendedor",
  "Tabela Preço",
  "Bloqueio de Linha",
  "Bruna Porra",
  "R$ 50",
  "Fulano Desconto",
  // respostas
  "sim",
  "não",
  "ok",
  "👍",
  "👎",
  "primeira vez",
  "já sou cliente",
  "pular",
  "prefiro não informar",
  "quero mudar",
  "outro número",
  "esse mesmo",
  "claro",
  "pode ser",
  "talvez",
  // CEP e telefone
  "68900-000",
  "meu cep é 68900000",
  "6890",
  "Rua Cândido Mendes, 23",
  "96 98140-8722",
  "+55 96 99111-2233",
  "12345",
  "99111-2233",
  "96 99111-2233 e 96 98140-8722",
  // preço, equipe, parceiro, parar, robô
  "quanto custa?",
  "qual o valor do banner",
  "tem tabela de parceiro?",
  "preço de revendedor",
  "desconto para revenda",
  "quero um orçamento",
  "quero falar com uma pessoa",
  "atendente",
  "quero ser parceiro",
  "parceria",
  "sou terceirizado",
  "meu parceiro indicou vocês",
  "sou revendedor",
  "pare de mandar mensagem",
  "sair",
  "você é um robô?",
  "Seu código de verificação é 123456",
  "Digite 1 para falar com o atendimento",
  "Veja https://exemplo.com",
  "*Promoção* hoje",
  // texto livre, cortesia e lixo
  "oi",
  "bom dia",
  "obrigado",
  "preciso de 100 banners para amanhã, urgente, tamanho 2x1 em lona 440",
  "hmm",
  "kkkk",
  "????",
  "😂😂",
  "",
  "a",
  "1",
  "  ",
];

const TIPOS_SEM_TEXTO: TipoDeEntrada[] = [
  "audio",
  "figurinha",
  "imagem",
  "documento",
  "video",
  "localizacao",
  "contato",
];

function conversaSorteada(semente: number) {
  const r = prng(semente);
  const escolhe = <T>(l: readonly T[]) => l[Math.floor(r() * l.length)];
  const maxMensagens = escolhe([4, 5, 6, 8, 8, 8]);
  const fora = escolhe([0, 0, 0, 1, 2, 3]);
  const lid = r() < 0.2;
  const s: SessaoSimulada = iniciarSessao({
    conversaId: `${Math.floor(r() * 0xffffffff)
      .toString(16)
      .padStart(8, "0")}-0000-4000-8000-${Math.floor(r() * 0xffffffffff)
      .toString(16)
      .padStart(12, "0")}`,
    agora: r() < 0.5 ? SEGUNDA_AS_10H : SABADO_AS_20H,
    modo: r() < 0.2 ? "ensaio" : "real",
    ctx: {
      config: { ...contextoPadrao().config, maxMensagens },
      automaticasDeFora: fora,
      leadTipo: r() < 0.15 ? "parceiro" : r() < 0.5 ? "cliente" : null,
      telefoneDoChat: lid
        ? { normalizado: "123456789012345", ehLid: true }
        : { normalizado: "96991112233", ehLid: false },
      enderecoDoCep:
        r() < 0.5
          ? { cep: "68900000", bairro: r() < 0.2 ? "Tabela Parceiro" : "Centro", cidade: "Macapá" }
          : null,
    },
  });
  return { s, r, escolhe, maxMensagens, fora };
}

function passo(
  s: SessaoSimulada,
  r: () => number,
  escolhe: <T>(l: readonly T[]) => T,
): SessaoSimulada {
  const sorte = r();
  const espera = sorte < 0.05 ? 31 * 60 : sorte < 0.08 ? 25 * 3600 : sorte < 0.15 ? 1 : 30;
  if (r() < 0.04) return { ...s, ctx: { ...s.ctx, humanoNaConversa: !s.ctx.humanoNaConversa } };
  if (r() < 0.15)
    return digitar(s, null, { tipo: escolhe(TIPOS_SEM_TEXTO), esperaS: espera }).sessao;
  return digitar(s, escolhe(MENSAGENS), {
    esperaS: espera,
    origem: r() < 0.03 ? "automacao" : undefined,
  }).sessao;
}

describe("propriedades da máquina em 600 conversas sorteadas", () => {
  it("1 a 4: texto sempre limpo, teto respeitado, chaves únicas, um aviso só, silêncio depois do fim", () => {
    let totalDeEnvios = 0;
    for (let semente = 1; semente <= 600; semente++) {
      const { s: inicio, r, escolhe, maxMensagens, fora } = conversaSorteada(semente);
      let s = inicio;
      const chaves = new Set<string>();
      let avisos = 0;
      let versao = s.estado.versao;
      for (let i = 0; i < 40; i++) {
        const antes = s;
        s = passo(s, r, escolhe);
        const res = s.resultados[s.resultados.length - 1];
        if (!res || s.resultados.length === antes.resultados.length) continue;
        const onde = `semente ${semente}, volta ${i}`;

        // 1. nenhum texto que o verificador do ramo reprove
        if (res.envio) {
          totalDeEnvios += 1;
          expect(
            verificarTexto(res.envio.texto, res.estado.ramo).problemas,
            `${onde}: ${res.envio.texto}`,
          ).toEqual([]);
          if (res.estado.ramo === "cliente")
            expect(res.envio.texto, onde).not.toMatch(
              /parceir|revend|tabela|terceiriz|diferenciad|R\$|desconto/i,
            );
          // 4. chave de idempotência única
          expect(chaves.has(res.envio.chaveDeIdempotencia), `${onde}: chave repetida`).toBe(false);
          chaves.add(res.envio.chaveDeIdempotencia);
          // depois do fim não sai mais nada
          expect(
            STATUS_ENCERRADOS.includes(antes.estado.status),
            `${onde}: enviou depois de encerrada (${antes.estado.status})`,
          ).toBe(false);
        }
        // 2. teto de mensagens, contando as automáticas de fora
        expect(res.estado.mensagensEnviadas + fora, onde).toBeLessThanOrEqual(maxMensagens);
        expect(res.estado.mensagensEnviadas, onde).toBeLessThanOrEqual(8);
        // 4. um aviso só
        if (res.avisarGrupo) avisos += 1;
        expect(avisos, onde).toBeLessThanOrEqual(1);
        // versão sempre sobe
        expect(res.estado.versao, onde).toBeGreaterThanOrEqual(versao);
        versao = res.estado.versao;
        // o ramo nunca desce
        if (antes.estado.ramo === "parceiro") expect(res.estado.ramo, onde).toBe("parceiro");
        // o alternativo nunca nasce verificado
        expect(res.estado.dados.telefoneAlternativoVerificado, onde).toBe(false);
        // o ramo parceiro nunca pede CEP nem telefone
        if (res.estado.ramo === "parceiro" && res.envio)
          expect(res.envio.texto, onde).not.toMatch(/\bCEP\b|número/);
        // pedir para parar bloqueia, e quem parou nunca mais recebe
        if (res.bloquearContato) expect(res.estado.status, onde).toBe("parada_pelo_contato");
      }
    }
    expect(totalDeEnvios).toBeGreaterThan(1000);
  }, 120_000);

  it("3a. parar encerra em qualquer ponto de qualquer conversa sorteada", () => {
    for (let semente = 1000; semente < 1300; semente++) {
      const { s: inicio, r, escolhe } = conversaSorteada(semente);
      let s = inicio;
      const voltas = Math.floor(r() * 12);
      for (let i = 0; i < voltas; i++) s = passo(s, r, escolhe);
      const fim = digitar({ ...s, ctx: { ...s.ctx, humanoNaConversa: false } }, "parar", {
        esperaS: 30,
      }).resultado;
      const ja = STATUS_ENCERRADOS.includes(s.estado.status);
      // já encerrada: continua encerrada e calada; senão: parada pelo contato com bloqueio
      if (ja) expect(fim.acao, `semente ${semente}`).toBe("silencio");
      else {
        expect(fim.estado.status, `semente ${semente} (${s.estado.status}/${s.estado.passo})`).toBe(
          "parada_pelo_contato",
        );
        expect(fim.bloquearContato).toBe(true);
      }
    }
  }, 60_000);

  it("3b. quem só escreve bobagem chega a um fim em poucos passos, qualquer que seja o ponto de partida", () => {
    for (let semente = 2000; semente < 2300; semente++) {
      const { s: inicio, r, escolhe } = conversaSorteada(semente);
      let s = inicio;
      const voltas = Math.floor(r() * 10);
      for (let i = 0; i < voltas; i++) s = passo(s, r, escolhe);
      s = { ...s, ctx: { ...s.ctx, humanoNaConversa: false } };
      for (let i = 0; i < 30 && !STATUS_ENCERRADOS.includes(s.estado.status); i++) {
        s = digitar(s, `hmm ${i}`, { esperaS: 30 }).sessao;
        // a conversa pode ter expirado no meio; a varredura só dá o fim formal
        if (s.estado.status === "expirada") break;
      }
      expect(
        ["expirada", ...STATUS_ENCERRADOS],
        `semente ${semente} terminou ${s.estado.status}/${s.estado.passo}`,
      ).toContain(s.estado.status);
    }
  }, 60_000);

  it("3c. toda triagem ativa e parada acaba expirada pela varredura", () => {
    for (let semente = 3000; semente < 3100; semente++) {
      const { s: inicio, r, escolhe } = conversaSorteada(semente);
      let s = inicio;
      for (let i = 0; i < 6; i++) s = passo(s, r, escolhe);
      const v = expirarTriagem(s.estado, s.agora + 60 * 60_000, s.ctx.config);
      const aberta = (st: string) => st === "ativa" || st === "ensaio";
      if (aberta(s.estado.status) && s.estado.passo !== null)
        expect(v.estado.status, `semente ${semente}`).toBe("expirada");
      expect(v.envio).toBeNull();
    }
  });

  it("o caminho feliz sempre termina em 6 mensagens ou menos, mesmo no teto de 8", () => {
    const s = ["oi", "Maria Souza", "primeira vez", "68900-000", "sim"].reduce(
      (a, f) => digitar(a, f).sessao,
      iniciarSessao(),
    );
    expect(s.estado.status).toBe("concluida");
    expect(s.estado.mensagensEnviadas).toBe(5);
  });
});
