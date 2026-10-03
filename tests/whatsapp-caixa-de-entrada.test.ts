import { describe, expect, it } from "vitest";
import {
  adicionarEtiqueta,
  contarPorAba,
  conteudoDaMensagem,
  desfechoDoEnvio,
  envioLiberado,
  filtrarConversas,
  horaCurta,
  instanciaPrincipal,
  nomeDaConversa,
  pedidoDaConversa,
  podeResponder,
  removerEtiqueta,
  seloDoStatus,
  telefoneLegivel,
  vazioDaCaixa,
  type ConversaDaCaixa,
  type MensagemDaCaixa,
} from "../src/domain/whatsapp/caixa-de-entrada";
import { situacaoDaConexao } from "../src/domain/whatsapp/situacao-conexao";

/**
 * O estado real do banco de 28/09 até 02/10/2026 às 16:30 (Macapá): instância
 * BEX PRINTS cadastrada e nunca pareada. Nessa hora chegou o primeiro "Ao
 * conectar" — e a caixa passou ao caso CONECTADA abaixo, ainda sem conversa.
 */
const NUNCA_PAREADA = {
  conectado: false,
  status: "desconectada",
  ultimo_evento_at: null,
  ativa: true,
};
const CAIU = { ...NUNCA_PAREADA, ultimo_evento_at: "2026-10-01T12:00:00Z" };
const CONECTADA = {
  conectado: true,
  status: "conectada",
  ultimo_evento_at: "2026-10-02T12:00:00Z",
  ativa: true,
};

function conversa(parcial: Partial<ConversaDaCaixa> = {}): ConversaDaCaixa {
  return {
    id: "c1",
    instancia_id: "i1",
    telefone: "5596981216527",
    nome_contato: null,
    cliente_id: null,
    lead_id: null,
    os_id: null,
    status: "aberta",
    etiquetas: [],
    ultima_mensagem: null,
    ultima_mensagem_at: null,
    nao_lidas: 0,
    responsavel_id: null,
    created_at: "2026-10-02T10:00:00Z",
    cliente: null,
    lead: null,
    ...parcial,
  };
}

function mensagem(parcial: Partial<MensagemDaCaixa> = {}): MensagemDaCaixa {
  return {
    id: Math.random().toString(36).slice(2),
    direcao: "entrada",
    tipo: "texto",
    status: "recebida",
    texto: null,
    legenda: null,
    media_url: null,
    storage_bucket: null,
    storage_path: null,
    erro: null,
    recebido_em: null,
    enviado_em: null,
    created_at: "2026-10-02T13:00:00Z",
    ...parcial,
  };
}

describe("o botão de responder diz por que não envia", () => {
  it("nunca pareada (o estado até 02/10): a frase que o dono pediu, e desabilitado", () => {
    const r = envioLiberado(NUNCA_PAREADA);
    expect(r.liberado).toBe(false);
    if (r.liberado) return;
    expect(r.rotulo).toBe("WhatsApp desconectado — falta escanear o QR Code");
    expect(r.motivo).toContain("QR Code");
    // A frase do cartão do Monitor diz "Verificar aqui"; aqui é outra tela.
    expect(r.motivo).not.toMatch(/Verificar aqui/);
  });

  it("caiu depois de ter funcionado: pede o QR de novo", () => {
    const r = envioLiberado(CAIU);
    expect(r.liberado).toBe(false);
    if (!r.liberado) expect(r.rotulo).toBe("WhatsApp desconectado — leia o QR Code de novo");
  });

  it("sem instância e instância desativada também recusam", () => {
    expect(envioLiberado(null)).toMatchObject({
      liberado: false,
      rotulo: "WhatsApp não configurado",
    });
    expect(envioLiberado({ ...CONECTADA, ativa: false }).liberado).toBe(false);
  });

  it("conectada libera — mesmo sem evento ainda, porque enviar não depende do webhook", () => {
    expect(envioLiberado(CONECTADA)).toEqual({ liberado: true });
    expect(envioLiberado({ ...CONECTADA, ultimo_evento_at: null })).toEqual({ liberado: true });
  });

  it("espelha a função do banco: conectado=true com status diferente de 'conectada' não libera", () => {
    // whatsapp_responder exige conectado = true E status = 'conectada'.
    expect(envioLiberado({ ...CONECTADA, status: "conectando" }).liberado).toBe(false);
  });

  it("sem whatsapp.reply: a resposta é a da permissão, não a do QR Code", () => {
    const r = podeResponder(CONECTADA, false);
    expect(r.liberado).toBe(false);
    if (!r.liberado) {
      expect(r.rotulo).toBe("Seu perfil só lê as conversas");
      expect(r.motivo).toContain("whatsapp › reply");
    }
    expect(podeResponder(CONECTADA, true)).toEqual({ liberado: true });
  });
});

describe("a caixa vazia diz o motivo", () => {
  it("nunca pareada: falta escanear o QR Code", () => {
    const v = vazioDaCaixa(NUNCA_PAREADA);
    expect(v.titulo).toBe("Nenhuma conversa ainda — falta escanear o QR Code");
    expect(v.detalhe).toContain("QR Code");
  });

  it("cada estado da conexão tem a sua frase — nenhum cai no genérico por engano", () => {
    // A classificação vem de situacaoDaConexao; se alguém mudar um rótulo lá,
    // este teste aponta a frase que ficou para trás aqui.
    const casos: [Parameters<typeof vazioDaCaixa>[0], string][] = [
      [null, "Nenhuma conversa ainda — o WhatsApp não está configurado"],
      [
        { ...CONECTADA, ativa: false },
        "Nenhuma conversa ainda — a instância do WhatsApp está desativada",
      ],
      [NUNCA_PAREADA, "Nenhuma conversa ainda — falta escanear o QR Code"],
      [CAIU, "Nenhuma conversa — o WhatsApp está desconectado"],
      [{ ...CONECTADA, ultimo_evento_at: null }, "Nenhuma mensagem recebida ainda"],
      [CONECTADA, "Nenhuma mensagem recebida ainda"],
    ];
    for (const [instancia, titulo] of casos) {
      expect(vazioDaCaixa(instancia).titulo, situacaoDaConexao(instancia).rotulo).toBe(titulo);
    }
    // Conectada sem evento e recebendo têm o mesmo título, motivos diferentes.
    expect(vazioDaCaixa({ ...CONECTADA, ultimo_evento_at: null }).detalhe).toContain("webhooks");
    expect(vazioDaCaixa(CONECTADA).detalhe).toContain("aparece aqui");
  });
});

describe("a lista de conversas", () => {
  it("nome: cliente vinculado > nome do WhatsApp > lead > telefone", () => {
    expect(
      nomeDaConversa(conversa({ cliente: { id: "x", nome: "Padaria Real" }, nome_contato: "Zé" })),
    ).toBe("Padaria Real");
    expect(nomeDaConversa(conversa({ nome_contato: "Zé" }))).toBe("Zé");
    expect(
      nomeDaConversa(conversa({ lead: { id: "l", nome: "Lead WhatsApp", status: "novo" } })),
    ).toBe("Lead WhatsApp");
    expect(nomeDaConversa(conversa())).toBe("(96) 98121-6527");
  });

  it("telefone legível tira o 55 e formata; o que não é celular brasileiro passa como veio", () => {
    expect(telefoneLegivel("5596981216527")).toBe("(96) 98121-6527");
    expect(telefoneLegivel("12025550123456")).toBe("12025550123456");
  });

  it("abas separam abertas de concluídas e contam certo", () => {
    const lista = [
      conversa({ id: "a", status: "aberta" }),
      conversa({ id: "b", status: "pendente" }),
      conversa({ id: "c", status: "resolvida" }),
      conversa({ id: "d", status: "arquivada" }),
    ];
    expect(filtrarConversas(lista, { busca: "", aba: "abertas" }).map((c) => c.id)).toEqual([
      "a",
      "b",
    ]);
    expect(filtrarConversas(lista, { busca: "", aba: "concluidas" }).map((c) => c.id)).toEqual([
      "c",
      "d",
    ]);
    expect(contarPorAba(lista)).toEqual({ abertas: 2, concluidas: 2, todas: 4 });
  });

  it("busca sem acento, por telefone com ou sem máscara e por etiqueta", () => {
    const lista = [
      conversa({ id: "a", nome_contato: "Ação Gráfica", telefone: "5596981216527" }),
      conversa({
        id: "b",
        nome_contato: "Outro",
        telefone: "5596991112233",
        etiquetas: ["Pagamento"],
      }),
    ];
    const achar = (busca: string) =>
      filtrarConversas(lista, { busca, aba: "todas" }).map((c) => c.id);
    expect(achar("acao grafica")).toEqual(["a"]);
    expect(achar("98121-65")).toEqual(["a"]);
    expect(achar("pagamento")).toEqual(["b"]);
  });

  it("hora curta no fuso de Macapá: hoje mostra a hora, outro dia mostra a data", () => {
    const agora = new Date("2026-10-02T20:00:00Z"); // 17:00 em Macapá
    expect(horaCurta("2026-10-02T17:32:00Z", agora)).toBe("14:32");
    expect(horaCurta("2026-09-30T17:32:00Z", agora)).toBe("30/09");
    // 01:30 UTC de 03/10 ainda é 22:30 de 02/10 em Macapá: é "hoje".
    expect(horaCurta("2026-10-03T01:30:00Z", new Date("2026-10-03T02:00:00Z"))).toBe("22:30");
  });

  it("a instância do topo é a ativa mais antiga — só para exibir", () => {
    expect(
      instanciaPrincipal([
        { ...CONECTADA, ativa: false, created_at: "2026-01-01" },
        { ...NUNCA_PAREADA, created_at: "2026-09-28" },
      ])?.status,
    ).toBe("desconectada");
    expect(instanciaPrincipal([])).toBeNull();
  });
});

describe("as mensagens", () => {
  it("mídia sem legenda mostra o tipo, não uma bolha vazia", () => {
    expect(conteudoDaMensagem({ texto: null, legenda: null, tipo: "imagem" })).toBe("[Imagem]");
    expect(conteudoDaMensagem({ texto: null, legenda: "a arte", tipo: "imagem" })).toBe("a arte");
  });

  it("o selo nunca diz 'enviada' do que está na fila", () => {
    expect(seloDoStatus({ direcao: "saida", status: "pendente" })?.texto).toBe(
      "na fila — ainda não saiu",
    );
    expect(seloDoStatus({ direcao: "saida", status: "falha" })?.texto).toBe("não saiu");
    expect(seloDoStatus({ direcao: "saida", status: "lida" })?.texto).toBe("lida");
    expect(seloDoStatus({ direcao: "entrada", status: "recebida" })).toBeNull();
  });
});

describe("da conversa para o orçamento", () => {
  it("o pedido leva só as mensagens do cliente, em ordem, com dia e hora de Macapá", () => {
    const msgs = [
      mensagem({ texto: "Para sexta-feira se possível.", recebido_em: "2026-10-02T13:20:00Z" }),
      mensagem({
        texto: "Bom dia, gostaria de um orçamento de banner.",
        recebido_em: "2026-10-02T13:12:00Z",
      }),
      mensagem({
        direcao: "saida",
        status: "enviada",
        texto: "Qual a medida?",
        enviado_em: "2026-10-02T13:15:00Z",
      }),
      mensagem({ tipo: "imagem", recebido_em: "2026-10-02T13:18:00Z" }),
    ];
    expect(pedidoDaConversa(msgs)).toBe(
      [
        "[02/10 10:12] Bom dia, gostaria de um orçamento de banner.",
        "[02/10 10:18] [Imagem]",
        "[02/10 10:20] Para sexta-feira se possível.",
      ].join("\n"),
    );
  });

  it("respeita o limite, ficando com as mais recentes", () => {
    const msgs = Array.from({ length: 15 }, (_, i) =>
      mensagem({
        texto: `m${i}`,
        recebido_em: `2026-10-02T13:${String(10 + i).padStart(2, "0")}:00Z`,
      }),
    );
    const linhas = pedidoDaConversa(msgs, 3).split("\n");
    expect(linhas).toHaveLength(3);
    expect(linhas[2]).toContain("m14");
  });

  it("conversa sem mensagem do cliente dá pedido vazio, não texto inventado", () => {
    expect(pedidoDaConversa([mensagem({ direcao: "saida", status: "enviada", texto: "oi" })])).toBe(
      "",
    );
  });
});

describe("etiquetas", () => {
  it("acrescenta sem duplicar, ignorando maiúscula e acento", () => {
    expect(adicionarEtiqueta(["Orçamento"], "orcamento")).toEqual(["Orçamento"]);
    expect(adicionarEtiqueta(["Orçamento"], "  Arte   final ")).toEqual([
      "Orçamento",
      "Arte final",
    ]);
    expect(adicionarEtiqueta(null, "   ")).toEqual([]);
  });

  it("remove pelo mesmo critério", () => {
    expect(removerEtiqueta(["Orçamento", "Arte"], "ORCAMENTO")).toEqual(["Arte"]);
  });
});

describe("o que dizer depois de acionar o envio", () => {
  const FILA = "f1";
  const MSG = "m1";

  it("'enviada' só quando o consumidor diz que ESTA linha saiu", () => {
    expect(
      desfechoDoEnvio(
        {
          status: 200,
          corpo: {
            ok: true,
            resultados: [{ fila_id: FILA, mensagem_id: MSG, situacao: "enviada", erro: null }],
          },
        },
        FILA,
        MSG,
      ),
    ).toEqual({ tom: "sucesso", texto: "Mensagem enviada." });
  });

  it("200 sem a linha (havia mais antigas na frente) é 'ficou na fila', não sucesso", () => {
    const d = desfechoDoEnvio({ status: 200, corpo: { ok: true, resultados: [] } }, FILA, MSG);
    expect(d.tom).toBe("aviso");
    expect(d.texto).toContain("fila");
  });

  it("falha da linha traz o motivo do Z-API", () => {
    const d = desfechoDoEnvio(
      {
        status: 200,
        corpo: {
          resultados: [
            { fila_id: FILA, mensagem_id: MSG, situacao: "falha", erro: "número inválido" },
          ],
        },
      },
      FILA,
      MSG,
    );
    expect(d).toEqual({ tom: "erro", texto: "A mensagem não saiu: número inválido." });
  });

  it("servidor sem token: diz que ficou na fila e o que resolver", () => {
    const d = desfechoDoEnvio(
      {
        status: 503,
        corpo: {
          ok: false,
          erro: "ZAPI_TOKEN não está configurado no servidor",
          comoResolver: "Cadastre ZAPI_TOKEN.",
        },
      },
      FILA,
      MSG,
    );
    expect(d.tom).toBe("aviso");
    expect(d.texto).toContain("ZAPI_TOKEN não está configurado");
    expect(d.texto).toContain("Cadastre ZAPI_TOKEN.");
  });

  it("saiu mas a gravação foi recusada: erro, nunca sucesso", () => {
    const d = desfechoDoEnvio(
      {
        status: 500,
        corpo: {
          resultados: [{ fila_id: FILA, mensagem_id: MSG, situacao: "enviada", erro: null }],
          erros_de_gravacao: [{ tabela: "whatsapp_mensagens", id: MSG, erro: "duplicate key" }],
        },
      },
      FILA,
      MSG,
    );
    expect(d.tom).toBe("erro");
    expect(d.texto).toContain("saiu pelo WhatsApp");
  });

  it("rede fora: a mensagem ficou na fila e a tela diz isso", () => {
    const d = desfechoDoEnvio({ falhaDeRede: "Failed to fetch" }, FILA, MSG);
    expect(d.tom).toBe("aviso");
    expect(d.texto).toContain("ficou na fila");
  });
});
