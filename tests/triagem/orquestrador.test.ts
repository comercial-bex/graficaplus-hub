import { describe, expect, it } from "vitest";
import { verificarTexto } from "../../src/domain/whatsapp/triagem";
import {
  assistentePodeResponder,
  comHashDaUltimaEntrada,
  entradaDaLinha,
  ESPERA_MAXIMA_MS,
  estadoDoBanco,
  contextoDoBanco,
  entregaSemNumero,
  limparDetalhe,
  linhaDeTriagemPodeSair,
  MOTIVO_SEM_NUMERO,
  ramoDoLead,
  resultadoParaAplicar,
  STATUS_TERMINAIS_QUE_FALAM,
  rodarTriagem,
  cepParaConsultar,
} from "../../src/domain/whatsapp/triagem/orquestrador";
import { estadoInicial } from "../../src/domain/whatsapp/triagem/maquina";
import {
  telefoneComCaraDeLid,
  telefoneDoChatUtilizavel,
  triagemPodeFalarCom,
} from "../../src/domain/whatsapp/triagem/extrair";
import { normalizarTexto } from "../../src/domain/whatsapp/triagem/normalizar";
import { md5 } from "../../src/domain/whatsapp/triagem/md5";
import { criarBanco, CONVERSA, TRIAGEM, type BancoFalso } from "./porta-falsa";

/**
 * O orquestrador da triagem (PR B5) com o banco simulado por chamadas fingidas.
 * O que se segura:
 *   desligada          lê a configuração e sai: nenhuma outra chamada
 *   falha do banco     nunca lança, deixa o rastro do erro e devolve { acao: "erro" }
 *   falha do CEP       silenciosa: a triagem segue só com o CEP
 *   texto montado      passa no verificador do ramo e a chave é a da triagem
 *   evento             nunca leva texto, nome, telefone nem CEP
 *   conversa inteira   ida e volta pelo banco simulado, sem mensagem proibida
 */

async function fala(
  b: BancoFalso,
  texto: string | null,
  o: Parameters<BancoFalso["chega"]>[1] = {},
) {
  const id = b.chega(texto, o);
  const r = await rodarTriagem(b.porta, { conversaId: CONVERSA, mensagemId: id });
  return { id, r };
}

describe("estado de nascença: desligada", () => {
  it("lê só a configuração e sai: nenhuma outra chamada, nenhuma gravação", async () => {
    const b = criarBanco({ estado: "desligada" });
    const { r } = await fala(b, "Oi");
    expect(r).toEqual({ acao: "nada", motivo: "desligada" });
    expect(b.chamadas).toEqual(["estadoDaConfiguracao"]);
    expect(b.triagem).toBeNull();
    expect(b.aplicacoes).toEqual([]);
    expect(b.despachos).toBe(0);
  });

  it("sem linha de configuração: também sai sem tocar em nada", async () => {
    const b = criarBanco({ estado: null });
    const { r } = await fala(b, "Oi");
    expect(r).toEqual({ acao: "nada", motivo: "sem_configuracao" });
    expect(b.chamadas).toEqual(["estadoDaConfiguracao"]);
  });
});

describe("nunca derruba o webhook", () => {
  it("erro ao ler a configuração: devolve erro, deixa o rastro e não lança", async () => {
    const b = criarBanco();
    b.forcar.estadoDaConfiguracao = () => {
      throw Object.assign(new Error("connection refused 96991112233"), { code: "ECONNREFUSED" });
    };
    const { r } = await fala(b, "Oi");
    expect(r).toEqual({ acao: "erro", etapa: "configuracao" });
    expect(b.errosRegistrados).toEqual([{ etapa: "configuracao", codigo: "econnrefused" }]);
    expect(JSON.stringify(b.errosRegistrados)).not.toMatch(/9699/);
  });

  it("erro de permissão ao abrir (GRANT esquecido): vira erro registrado, a conversa fica com a equipe", async () => {
    const b = criarBanco();
    b.forcar.lerOuAbrir = () => {
      throw Object.assign(new Error("permission denied for function triagem_ler_ou_abrir"), {
        code: "42501",
      });
    };
    const { r } = await fala(b, "Oi");
    expect(r).toEqual({ acao: "erro", etapa: "ler_ou_abrir" });
    expect(b.errosRegistrados).toEqual([{ etapa: "ler_ou_abrir", codigo: "42501" }]);
    expect(b.aplicacoes).toEqual([]);
    expect(b.despachos).toBe(0);
  });

  it("erro ao aplicar: devolve erro, não despacha", async () => {
    const b = criarBanco();
    b.forcar.aplicar = () => {
      throw new Error("check_violation");
    };
    const { r } = await fala(b, "Oi");
    expect(r).toEqual({ acao: "erro", etapa: "aplicar" });
    expect(b.despachos).toBe(0);
  });

  it("resposta vazia do banco: erro, nunca exceção", async () => {
    const b = criarBanco();
    b.forcar.lerOuAbrir = () => null;
    expect((await fala(b, "Oi")).r).toEqual({ acao: "erro", etapa: "ler_ou_abrir" });
    const c = criarBanco();
    c.forcar.aplicar = () => undefined;
    expect((await fala(c, "Oi")).r).toEqual({ acao: "erro", etapa: "aplicar" });
  });

  it("até o registro do erro falhar não derruba", async () => {
    const b = criarBanco();
    b.forcar.lerOuAbrir = () => {
      throw new Error("banco fora");
    };
    b.forcar.registrarErro = async () => {
      throw new Error("o insert também falhou");
    };
    await expect(fala(b, "Oi")).resolves.toMatchObject({ r: { acao: "erro" } });
  });

  it("falha ao despachar não desfaz o que já está na fila", async () => {
    const b = criarBanco();
    b.forcar.despachar = async () => {
      throw new Error("Z-API fora");
    };
    const { r } = await fala(b, "Oi");
    expect(r).toMatchObject({ acao: "processada", enviou: true });
    expect(b.enviados).toHaveLength(1);
    expect(b.errosRegistrados).toEqual([]);
  });

  it("erro dentro do motor puro também não lança", async () => {
    const b = criarBanco();
    b.forcar.lerOuAbrir = () => ({
      dono: "triagem",
      triagem: { id: TRIAGEM, conversa_id: CONVERSA, passo: "nome", status: "ativa", versao: 1 },
      config: null,
      passos: "lixo",
      quadro: 7,
      horario: "x",
      conversa: null,
      pendentes: "x",
    });
    const id = b.chega("Oi");
    const r = await rodarTriagem(b.porta, { conversaId: CONVERSA, mensagemId: id });
    expect(["processada", "erro", "nada"]).toContain(r.acao);
  });
});

describe("a consulta de CEP é silenciosa", () => {
  async function ateOCep(b: BancoFalso) {
    await fala(b, "Oi");
    await fala(b, "Maria Souza");
    await fala(b, "primeira vez");
    expect((b.triagem as Record<string, unknown>).passo).toBe("cep");
  }

  it("CEP escrito no passo do CEP: consulta com os 8 números", async () => {
    const b = criarBanco();
    await ateOCep(b);
    const { r } = await fala(b, "meu cep é 68900-000");
    expect(b.cepsConsultados).toEqual(["68900000"]);
    expect(r).toMatchObject({ acao: "processada" });
    expect((b.triagem as Record<string, unknown>).cep).toBe("68900000");
  });

  it("serviço de CEP lançando erro: a triagem segue, sem erro registrado", async () => {
    const b = criarBanco();
    await ateOCep(b);
    b.forcar.cep = async () => {
      throw new Error("tempo esgotado");
    };
    const { r } = await fala(b, "68900-000");
    expect(r).toMatchObject({ acao: "processada" });
    expect(b.errosRegistrados).toEqual([]);
    expect((b.triagem as Record<string, unknown>).cep).toBe("68900000");
    expect((b.triagem as Record<string, unknown>).cep_endereco).toBeNull();
  });

  it("serviço de CEP sem resposta (nulo): também segue só com o CEP", async () => {
    const b = criarBanco();
    await ateOCep(b);
    b.forcar.cep = async () => null;
    const { r } = await fala(b, "68900-000");
    expect(r).toMatchObject({ acao: "processada" });
    expect((b.triagem as Record<string, unknown>).cep).toBe("68900000");
  });

  it("não consulta CEP fora do passo do CEP", () => {
    const e = estadoInicial({ triagemId: TRIAGEM, conversaId: CONVERSA });
    const entrada = { id: "m", tipo: "texto" as const, texto: "68900-000", recebidaEm: 0 };
    expect(cepParaConsultar({ ...e, passo: "nome" }, [entrada])).toBeNull();
    expect(cepParaConsultar({ ...e, passo: "telefone" }, [entrada])).toBeNull();
    expect(cepParaConsultar({ ...e, passo: "cep" }, [entrada])).toBe("68900000");
    expect(cepParaConsultar({ ...e, passo: "cep", ramo: "parceiro" }, [entrada])).toBeNull();
  });
});

describe("o caminho de uma mensagem", () => {
  it("primeira mensagem: pergunta o nome, enfileira com a chave da triagem e pede a rodada", async () => {
    const b = criarBanco();
    const { r } = await fala(b, "Oi, bom dia");
    expect(r).toMatchObject({ acao: "processada", enviou: true, ensaio: false, passo: "nome" });
    expect(b.chamadas).toEqual([
      "estadoDaConfiguracao",
      "lerOuAbrir",
      "lerEntradas",
      "aplicar",
      "despachar",
    ]);
    const e = b.enviados[0];
    expect(e.chave).toMatch(new RegExp(`^triagem:${TRIAGEM}:`));
    expect(e.atraso_s).toBeGreaterThanOrEqual(3);
    expect(e.atraso_s).toBeLessThanOrEqual(8);
    expect(verificarTexto(e.texto, "cliente").problemas).toEqual([]);
    const enviado = b.aplicacoes[0].resultado;
    expect(enviado.mensagem_id).toMatch(/^00000000-0000-4000-8000-/);
    expect(enviado.estado.passo).toBe("nome");
    expect(enviado.estado.mensagens_enviadas).toBe(1);
  });

  it("ensaio: aplica, não despacha e não enfileira nada", async () => {
    const b = criarBanco({ estado: "ensaio" });
    const { r } = await fala(b, "Oi");
    expect(r).toMatchObject({ acao: "processada", enviou: false, ensaio: true });
    expect(b.enviados).toEqual([]);
    expect(b.despachos).toBe(0);
    expect(b.eventos.some((e) => e.tipo === "envio_ensaio")).toBe(true);
  });

  it("dono assistente sem triagem (por exemplo cliente cadastrado): não interpreta e não aplica", async () => {
    const b = criarBanco();
    b.forcar.lerOuAbrir = () => ({ dono: "assistente", motivo: "cliente_vinculado" });
    const { r } = await fala(b, "Oi");
    expect(r).toEqual({ acao: "nada", motivo: "cliente_vinculado", dono: "assistente" });
    expect(b.chamadas).toEqual(["estadoDaConfiguracao", "lerOuAbrir"]);
  });

  it("dono ninguem (robô de empresa, grupo, pausada): não interpreta e não aplica", async () => {
    const b = criarBanco();
    b.forcar.lerOuAbrir = () => ({ dono: "ninguem", motivo: "robo" });
    const { r } = await fala(b, "Seu código de verificação é 123456");
    expect(r).toEqual({ acao: "nada", motivo: "robo", dono: "ninguem" });
    expect(b.aplicacoes).toEqual([]);
  });

  it("o mesmo webhook entregue duas vezes: a segunda não responde", async () => {
    const b = criarBanco();
    const { id } = await fala(b, "Oi");
    const segunda = await rodarTriagem(b.porta, { conversaId: CONVERSA, mensagemId: id });
    expect(segunda).toMatchObject({ acao: "nada", motivo: "entrada_repetida" });
    expect(b.enviados).toHaveLength(1);
  });

  it("mensagem que não existe mais ou é do sistema: nada", async () => {
    const b = criarBanco();
    const r = await rodarTriagem(b.porta, {
      conversaId: CONVERSA,
      mensagemId: "00000000-0000-4000-8000-0000000000ff",
    });
    expect(r).toMatchObject({ acao: "nada", motivo: "mensagem_nao_e_texto_ou_midia" });
    const id = b.chega("aviso", { tipo: "sistema" });
    expect(await rodarTriagem(b.porta, { conversaId: CONVERSA, mensagemId: id })).toMatchObject({
      acao: "nada",
    });
  });

  it("conflito de versão: relê e tenta de novo uma vez", async () => {
    const b = criarBanco();
    b.forcar.conflitos = 1;
    const { r } = await fala(b, "Oi");
    expect(r).toMatchObject({ acao: "processada", enviou: true });
    expect(b.chamadas.filter((c) => c === "lerOuAbrir")).toHaveLength(2);
    expect(b.chamadas.filter((c) => c === "aplicar")).toHaveLength(2);
    expect(b.enviados).toHaveLength(1);
  });

  it("dois conflitos seguidos: desiste sem erro e sem envio", async () => {
    const b = criarBanco();
    b.forcar.conflitos = 5;
    const { r } = await fala(b, "Oi");
    expect(r).toEqual({ acao: "nada", motivo: "conflito_de_versao" });
    expect(b.enviados).toEqual([]);
    expect(b.errosRegistrados).toEqual([]);
  });

  it("respondeu logo depois do envio: espera o intervalo mínimo, no máximo 20 segundos", async () => {
    const b = criarBanco();
    await fala(b, "Oi");
    const id = b.chega("Maria Souza", { depoisDeMs: 6_000 });
    await rodarTriagem(b.porta, { conversaId: CONVERSA, mensagemId: id });
    expect(b.esperas).toHaveLength(1);
    expect(b.esperas[0]).toBeGreaterThan(10_000);
    expect(b.esperas[0]).toBeLessThanOrEqual(ESPERA_MAXIMA_MS);
  });

  it("intervalo configurado acima do teto: a espera nunca passa de 20 segundos", async () => {
    const b = criarBanco({ linhaDeConfig: { intervalo_minimo_s: 300 } });
    await fala(b, "Oi");
    const id = b.chega("Maria Souza", { depoisDeMs: 2_000 });
    await rodarTriagem(b.porta, { conversaId: CONVERSA, mensagemId: id });
    expect(b.esperas).toEqual([ESPERA_MAXIMA_MS]);
  });

  it("rajada: junta as mensagens pendentes em uma rodada e avisa o banco de todas", async () => {
    const b = criarBanco();
    await fala(b, "Oi");
    const m1 = b.chega("Maria", { depoisDeMs: 31_000 });
    const m2 = b.chega("Souza", { depoisDeMs: 1_000 });
    b.extras.pendentes = [m1];
    const r = await rodarTriagem(b.porta, { conversaId: CONVERSA, mensagemId: m2 });
    expect(r).toMatchObject({ acao: "processada" });
    const aplicado = b.aplicacoes[b.aplicacoes.length - 1].resultado;
    expect(aplicado.mensagem_id).toBe(m2);
    expect(aplicado.mensagens_ids).toEqual([m1]);
    expect((b.triagem as Record<string, unknown>).nome_informado).toBe("Maria Souza");
  });

  it("áudio na primeira mensagem: avisa uma vez e repete a pergunta", async () => {
    const b = criarBanco();
    const { r } = await fala(b, null, { tipo: "audio" });
    expect(r).toMatchObject({ acao: "processada", enviou: true });
    expect(b.enviados[0].texto).toMatch(/áudio/);
    expect(verificarTexto(b.enviados[0].texto, "cliente").ok).toBe(true);
  });

  it("figurinha vira 'figurinha' e não derruba nada", async () => {
    const b = criarBanco();
    await fala(b, "Oi");
    const { r } = await fala(b, null, { tipo: "sticker" });
    expect(r.acao).toBe("processada");
  });

  it("texto repetido: o hash do banco volta como texto normalizado e o motor reconhece", async () => {
    const b = criarBanco();
    await fala(b, "Oi");
    const frase = "quero saber sobre um banner grande";
    await fala(b, frase);
    expect((b.triagem as Record<string, unknown>).ultima_entrada_hash).toBe(
      md5(normalizarTexto(frase)),
    );
    const { r } = await fala(b, frase);
    expect(r).toMatchObject({ acao: "processada", motivo: "texto_repetido" });
    expect((b.triagem as Record<string, unknown>).status).toBe("entregue_equipe");
  });
});

describe("o texto montado e os eventos", () => {
  it("conversa inteira do cliente final: todo texto passa no verificador, sem dado pessoal nos eventos", async () => {
    const b = criarBanco();
    const passos = ["Oi", "Maria Souza", "primeira vez", "68900-000", "sim"];
    for (const p of passos) await fala(b, p);
    expect(b.enviados.length).toBeGreaterThanOrEqual(5);
    for (const e of b.enviados) {
      expect(verificarTexto(e.texto, "cliente").problemas, e.texto).toEqual([]);
      expect(e.atraso_s).toBeGreaterThanOrEqual(3);
      expect(e.atraso_s).toBeLessThanOrEqual(8);
    }
    const chaves = b.enviados.map((e) => e.chave);
    expect(new Set(chaves).size).toBe(chaves.length);
    expect(b.enviados.length).toBeLessThanOrEqual(8);
    const eventos = JSON.stringify(b.eventos);
    expect(eventos).not.toMatch(/Maria|Souza|68900|2233|99111/);
    expect((b.triagem as Record<string, unknown>).status).toBe("concluida");
    expect(b.errosRegistrados).toEqual([]);
  });

  it("ramo parceiro (anúncio mapeado): o link sai só nesse ramo e o texto passa no verificador do parceiro", async () => {
    const b = criarBanco();
    b.extras.leadTipo = "parceiro";
    await fala(b, "Oi");
    await fala(b, "Carlos Lima");
    const textos = b.enviados.map((e) => e.texto);
    expect(textos.some((t) => t.includes("https://exemplo.com.br/cadastro"))).toBe(true);
    for (const t of textos) expect(verificarTexto(t, "parceiro").problemas, t).toEqual([]);
    expect((b.triagem as Record<string, unknown>).ramo).toBe("parceiro");
  });

  it("cliente final nunca lê parceiro, tabela ou link, mesmo quando pergunta de tabela", async () => {
    const b = criarBanco();
    await fala(b, "Oi");
    await fala(b, "vocês têm tabela para parceiro?");
    await fala(b, "Maria Souza");
    for (const e of b.enviados) {
      expect(e.texto.toLowerCase()).not.toMatch(/parceir|tabela|revend|https?:/);
    }
  });

  it("limparDetalhe tira chave proibida e filtra códigos e variáveis fora do formato do banco", () => {
    const l = limparDetalhe({
      motivo: "x",
      nome: "Maria",
      telefone: "9699",
      cep: "68900",
      texto: "oi",
      codigos: ["nome~repeticao", "ack_ja_cliente", "Inválido!", "a+b"],
      variaveis: ["primeiro_nome", "Nome Com Espaço"],
      enviadas: 3,
      lista: ["a", 1 as unknown as string],
    });
    expect(l).toEqual({
      motivo: "x",
      codigos: ["nome_repeticao", "ack_ja_cliente", "a_b"],
      variaveis: ["primeiro_nome"],
      enviadas: 3,
      lista: ["a"],
    });
  });

  it("o hash guardado só vira texto normalizado quando bate com a primeira mensagem", () => {
    const e = estadoInicial({ triagemId: TRIAGEM, conversaId: CONVERSA });
    const primeira = { id: "m", tipo: "texto" as const, texto: "Quero um Banner!!", recebidaEm: 0 };
    const norm = normalizarTexto(primeira.texto);
    expect(comHashDaUltimaEntrada(e, md5(norm), primeira).ultimaEntradaNormalizada).toBe(norm);
    expect(
      comHashDaUltimaEntrada(e, md5("outra coisa"), primeira).ultimaEntradaNormalizada,
    ).toBeNull();
    expect(comHashDaUltimaEntrada(e, null, primeira).ultimaEntradaNormalizada).toBeNull();
    expect(
      comHashDaUltimaEntrada(e, md5(norm), { ...primeira, tipo: "audio" }).ultimaEntradaNormalizada,
    ).toBeNull();
  });
});

describe("leitura do que o banco devolve", () => {
  it("estadoDoBanco rejeita linha sem id e aceita valores fora de lista com padrão seguro", () => {
    expect(estadoDoBanco(null)).toBeNull();
    expect(estadoDoBanco({ id: "x" })).toBeNull();
    const e = estadoDoBanco({
      id: TRIAGEM,
      conversa_id: CONVERSA,
      passo: "inventado",
      status: "inventado",
      ramo: "x",
      modo: "real",
    });
    expect(e).toMatchObject({ passo: null, status: "ativa", ramo: "cliente", modo: "real" });
  });

  it("entradaDaLinha: figurinha, sistema e data ruim", () => {
    const base = {
      id: "m",
      texto: "oi",
      legenda: null,
      origem: null,
      recebidaEm: "2026-11-16T13:00:00Z",
    };
    expect(entradaDaLinha({ ...base, tipo: "sticker" })?.tipo).toBe("figurinha");
    expect(entradaDaLinha({ ...base, tipo: "sistema" })).toBeNull();
    expect(entradaDaLinha({ ...base, tipo: "texto", recebidaEm: "ontem" })).toBeNull();
    expect(
      entradaDaLinha({ ...base, tipo: "imagem", texto: null, legenda: "foto da arte" })?.texto,
    ).toBe("foto da arte");
  });

  it("o resultado nunca leva a chave 'texto' em evento e o envio leva o passo e a ordem", () => {
    const e = estadoInicial({ triagemId: TRIAGEM, conversaId: CONVERSA });
    const p = resultadoParaAplicar(
      {
        estado: {
          ...e,
          passo: "nome",
          mensagensEnviadas: 1,
          ultimaEntradaNormalizada: "quero um banner",
        },
        acao: "enviar",
        envio: {
          texto: "Olá",
          codigos: ["nome"],
          variaveis: [],
          atrasoS: 4,
          chaveDeIdempotencia: `triagem:${TRIAGEM}:nome:1`,
          ordem: 1,
        },
        gravar: { nomeInformado: "Maria", pediuPreco: true },
        eventos: [
          {
            tipo: "interpretada",
            passo: "nome",
            intencao: "saudacao",
            detalhe: { tentativa: 0, ambigua: false },
          },
          { tipo: "aviso_grupo", passo: null, intencao: null, detalhe: {} },
        ],
        avisarGrupo: { motivo: "concluida", marcas: ["pediu_preco", "Com Espaço"] },
        bloquearContato: false,
        motivo: null,
      },
      { mensagemId: "m1", outrasMensagens: [] },
    );
    expect(p.envio).toMatchObject({
      texto: "Olá",
      chave: `triagem:${TRIAGEM}:nome:1`,
      atraso_s: 4,
      passo: "nome",
      ordem: 1,
    });
    expect(p.gravar).toEqual({ nome_informado: "Maria", pediu_preco: true });
    expect((p.eventos as unknown[]).length).toBe(1);
    expect(p.aviso_grupo).toEqual({ motivo: "concluida", marcas: ["pediu_preco"] });
    expect((p.estado as Record<string, unknown>).ultima_entrada_hash).toBe(md5("quero um banner"));
    expect(p.bloquear_contato).toBeUndefined();
  });
});

describe("quem manda e quando a fila pode despachar", () => {
  it("a assistente só responde quando o dono é ela", () => {
    expect(assistentePodeResponder("assistente").pode).toBe(true);
    expect(assistentePodeResponder("triagem")).toEqual({ pode: false, motivo: "dono_triagem" });
    expect(assistentePodeResponder("ninguem")).toEqual({ pode: false, motivo: "dono_ninguem" });
    expect(assistentePodeResponder(null).pode).toBe(false);
    expect(assistentePodeResponder(undefined).pode).toBe(false);
    expect(assistentePodeResponder({ ok: true }).pode).toBe(false);
    expect(assistentePodeResponder("").pode).toBe(false);
  });

  const ok = {
    statusDaTriagem: "ativa",
    modoDaTriagem: "real",
    degrauPermite: true,
    humanoNaConversa: false,
    telefoneAlcancavel: true,
  };

  it("pergunta de triagem sai com triagem ativa em modo real, sem gente e com o degrau permitindo", () => {
    expect(linhaDeTriagemPodeSair(ok)).toEqual({ sai: true, motivo: "ok" });
    expect(linhaDeTriagemPodeSair({ ...ok, humanoNaConversa: true })).toEqual({
      sai: false,
      motivo: "humano_na_conversa",
    });
    expect(linhaDeTriagemPodeSair({ ...ok, degrauPermite: false })).toEqual({
      sai: false,
      motivo: "fora_do_degrau",
    });
    expect(linhaDeTriagemPodeSair({ ...ok, statusDaTriagem: null })).toEqual({
      sai: false,
      motivo: "triagem_nao_existe",
    });
    expect(linhaDeTriagemPodeSair({ ...ok, modoDaTriagem: "ensaio" }).sai).toBe(false);
  });

  it("a mensagem FINAL sai: concluida, entregue_equipe e parada_pelo_contato são terminais que falam", () => {
    expect([...STATUS_TERMINAIS_QUE_FALAM].sort()).toEqual([
      "concluida",
      "entregue_equipe",
      "parada_pelo_contato",
    ]);
    for (const statusDaTriagem of STATUS_TERMINAIS_QUE_FALAM) {
      expect(linhaDeTriagemPodeSair({ ...ok, statusDaTriagem }), statusDaTriagem).toEqual({
        sai: true,
        motivo: "ok_despedida",
      });
    }
  });

  it("a despedida também cancela com gente na conversa, com o degrau desligado e fora do modo real", () => {
    for (const statusDaTriagem of STATUS_TERMINAIS_QUE_FALAM) {
      const s = { ...ok, statusDaTriagem };
      expect(linhaDeTriagemPodeSair({ ...s, humanoNaConversa: true }), statusDaTriagem).toEqual({
        sai: false,
        motivo: "humano_na_conversa",
      });
      expect(linhaDeTriagemPodeSair({ ...s, degrauPermite: false }), statusDaTriagem).toEqual({
        sai: false,
        motivo: "fora_do_degrau",
      });
      expect(linhaDeTriagemPodeSair({ ...s, modoDaTriagem: "ensaio" }).sai).toBe(false);
    }
  });

  it("pausada_humano, pausada_desligada, pulada, expirada e ensaio seguem cancelando", () => {
    for (const statusDaTriagem of [
      "pausada_humano",
      "pausada_desligada",
      "pulada",
      "expirada",
      "ensaio",
      "inventado",
    ]) {
      expect(linhaDeTriagemPodeSair({ ...ok, statusDaTriagem }), statusDaTriagem).toEqual({
        sai: false,
        motivo: `triagem_${statusDaTriagem}`,
      });
    }
  });

  it("telefone sem cara de celular brasileiro: nada sai, nem a despedida", () => {
    for (const statusDaTriagem of ["ativa", ...STATUS_TERMINAIS_QUE_FALAM]) {
      expect(
        linhaDeTriagemPodeSair({ ...ok, statusDaTriagem, telefoneAlcancavel: false }),
        statusDaTriagem,
      ).toEqual({ sai: false, motivo: MOTIVO_SEM_NUMERO });
    }
  });
});

describe("o telefone da conversa decide pelo formato, nunca por ter um chat_lid guardado", () => {
  it("conversa com telefone brasileiro normal e chat_lid preenchido recebe a confirmação do final", async () => {
    const b = criarBanco();
    b.extras.temLid = true;
    b.extras.telefone = "96991112233";
    await fala(b, "Oi");
    await fala(b, "Maria Souza");
    await fala(b, "primeira vez");
    await fala(b, "68900-000");
    expect(b.enviados.map((e) => e.texto).join("\n")).toMatch(/terminado em 2233/);
    expect(b.enviados.map((e) => e.texto).join("\n")).not.toMatch(/Qual número, com DDD/);
  });

  it("o contexto do banco marca lid só pelo formato", () => {
    const ctx = (tel: string | null, temLid: boolean) =>
      contextoDoBanco({ conversa: { telefone_normalizado: tel, tem_chat_lid: temLid } });
    expect(ctx("96991112233", true).telefoneDoChat.ehLid).toBe(false);
    expect(ctx("96991112233", false).telefoneDoChat.ehLid).toBe(false);
    expect(ctx("253386293268636", false).telefoneDoChat.ehLid).toBe(true);
    expect(ctx("5596991112233", true).telefoneDoChat.ehLid).toBe(false);
    expect(telefoneDoChatUtilizavel(ctx("96991112233", true).telefoneDoChat)).toBe(true);
    expect(telefoneDoChatUtilizavel(ctx("253386293268636", true).telefoneDoChat)).toBe(false);
  });

  it("telefoneComCaraDeLid: 12 a 15 dígitos fora do padrão brasileiro ou com @", () => {
    for (const v of [
      "253386293268636",
      "123456789012345",
      "253386293268636@lid",
      "5511999@lid",
      "447700900123",
      "6289123456789",
    ])
      expect(telefoneComCaraDeLid(v), v).toBe(true);
    for (const v of [
      "96991112233",
      "5596991112233",
      "+55 96 99111-2233",
      "(96) 99111-2233",
      "9691112233",
      "",
      null,
      undefined,
    ])
      expect(telefoneComCaraDeLid(v), String(v)).toBe(false);
  });

  it("triagemPodeFalarCom: só celular brasileiro", () => {
    for (const v of ["96991112233", "5596991112233", "(96) 99111-2233"])
      expect(triagemPodeFalarCom(v), v).toBe(true);
    for (const v of ["253386293268636", "253386293268636@lid", "447700900123", "9632221234", "", null])
      expect(triagemPodeFalarCom(v), String(v)).toBe(false);
  });

  it("conversa com telefone de cara de lid: a equipe assume, com evento e sem nenhuma mensagem", async () => {
    const b = criarBanco();
    b.extras.telefone = "253386293268636";
    b.extras.temLid = true;
    const { r } = await fala(b, "Oi, bom dia");
    expect(r).toMatchObject({
      acao: "processada",
      enviou: false,
      status: "entregue_equipe",
      motivo: MOTIVO_SEM_NUMERO,
    });
    expect(b.enviados).toEqual([]);
    expect(b.despachos).toBe(0);
    expect(b.esperas).toEqual([]);
    expect(b.cepsConsultados).toEqual([]);
    expect(b.eventos).toEqual([
      { tipo: "pulou", passo: null, intencao: null, detalhe: { motivo: MOTIVO_SEM_NUMERO } },
    ]);
    const aplicado = b.aplicacoes[0].resultado;
    expect(aplicado.envio).toBeUndefined();
    expect(aplicado.aviso_grupo).toEqual({ motivo: "entregue_equipe", marcas: ["sem_numero_valido"] });
    expect((b.triagem as Record<string, unknown>).status).toBe("entregue_equipe");
    expect((b.triagem as Record<string, unknown>).motivo_fim).toBe(MOTIVO_SEM_NUMERO);
  });

  it("telefone vazio ou fixo também não recebe mensagem do robô", async () => {
    for (const tel of [null, "9632221234"]) {
      const b = criarBanco();
      b.extras.telefone = tel;
      const { r } = await fala(b, "Oi");
      expect(r, String(tel)).toMatchObject({ acao: "processada", enviou: false });
      expect(b.enviados).toEqual([]);
    }
  });

  it("entregaSemNumero não leva texto, nome nem telefone", () => {
    const e = estadoInicial({ triagemId: TRIAGEM, conversaId: CONVERSA });
    const r = entregaSemNumero(e);
    expect(r.envio).toBeNull();
    expect(r.acao).toBe("silencio");
    const p = resultadoParaAplicar(r, { mensagemId: "m1", outrasMensagens: [] });
    expect(p.envio).toBeUndefined();
    expect(JSON.stringify(p)).not.toMatch(/2233|253386/);
  });
});

describe("o ramo parceiro só abre por anúncio mapeado ou palavra escrita", () => {
  it("lead parceiro por anúncio ou palavra abre o ramo e o motivo é a origem real", () => {
    expect(ramoDoLead({ tipo: "parceiro", tipo_origem: "anuncio" })).toEqual({
      leadTipo: "parceiro",
      leadOrigem: "anuncio",
    });
    expect(ramoDoLead({ tipo: "parceiro", tipo_origem: "palavra" })).toEqual({
      leadTipo: "parceiro",
      leadOrigem: "palavra",
    });
  });

  it("lead parceiro por telefone, manual ou sem origem cai no ramo cliente", () => {
    for (const tipo_origem of ["telefone", "manual", null, undefined, "outra"]) {
      expect(ramoDoLead({ tipo: "parceiro", tipo_origem }), String(tipo_origem)).toEqual({
        leadTipo: "cliente",
        leadOrigem: null,
      });
    }
    expect(ramoDoLead(null)).toEqual({ leadTipo: null, leadOrigem: null });
    expect(ramoDoLead({ tipo: "cliente_final", tipo_origem: "anuncio" })).toEqual({
      leadTipo: "cliente",
      leadOrigem: null,
    });
  });

  it("anúncio mapeado: ramo parceiro com motivo anuncio_mapeado", async () => {
    const b = criarBanco();
    b.extras.leadTipo = "parceiro";
    b.extras.leadOrigem = "anuncio";
    await fala(b, "Oi");
    expect((b.triagem as Record<string, unknown>).ramo).toBe("parceiro");
    expect(b.aplicacoes[0].resultado.estado.ramo_motivo).toBe("anuncio_mapeado");
  });

  it("palavra escrita antes: ramo parceiro com motivo palavra, não anuncio_mapeado", async () => {
    const b = criarBanco();
    b.extras.leadTipo = "parceiro";
    b.extras.leadOrigem = "palavra";
    await fala(b, "Oi");
    expect((b.triagem as Record<string, unknown>).ramo).toBe("parceiro");
    expect(b.aplicacoes[0].resultado.estado.ramo_motivo).toBe("palavra");
  });

  it("lead parceiro por telefone ou marcado à mão: ramo cliente, sem link nem a palavra parceiro", async () => {
    for (const origem of ["telefone", "manual"]) {
      const b = criarBanco();
      b.extras.leadTipo = "parceiro";
      b.extras.leadOrigem = origem;
      await fala(b, "Oi");
      await fala(b, "Carlos Lima");
      expect((b.triagem as Record<string, unknown>).ramo, origem).toBe("cliente");
      for (const e of b.enviados) expect(e.texto, origem).not.toMatch(/parceir|tabela|https?:/i);
    }
  });
});

describe("o ensaio não espera", () => {
  it("resposta logo depois do envio no ensaio: nenhuma espera, para não atrasar a assistente", async () => {
    const b = criarBanco({ estado: "ensaio" });
    await fala(b, "Oi");
    const id = b.chega("Maria Souza", { depoisDeMs: 3_000 });
    await rodarTriagem(b.porta, { conversaId: CONVERSA, mensagemId: id });
    expect(b.esperas).toEqual([]);
    expect(b.eventos.filter((e) => e.tipo === "envio_ensaio").length).toBeGreaterThanOrEqual(2);
  });

  it("no envio real a espera continua valendo", async () => {
    const b = criarBanco();
    await fala(b, "Oi");
    const id = b.chega("Maria Souza", { depoisDeMs: 3_000 });
    await rodarTriagem(b.porta, { conversaId: CONVERSA, mensagemId: id });
    expect(b.esperas).toHaveLength(1);
  });
});
