import { describe, expect, it } from "vitest";
import {
  avancarRelogio,
  digitar,
  digitarEmRajada,
  expirarTriagem,
  iniciarSessao,
  portaoDaTriagem,
  SABADO_AS_20H,
  SEMENTES_DO_QUADRO,
  textosDoRobo,
  verificarTexto,
  type SessaoSimulada,
} from "../../src/domain/whatsapp/triagem";

/**
 * O roteiro de 14 cenários do degrau 2 do plano de ligar (seção 8 do projeto),
 * executado contra a máquina pura. No dia, o dono repete cada cenário no
 * WhatsApp e confere as consultas de prova; aqui a prova é sobre o estado e os
 * envios que a máquina decide.
 */

const falas = (s: SessaoSimulada, ...f: string[]) => f.reduce((a, t) => digitar(a, t).sessao, s);
const ultimo = (s: SessaoSimulada) => s.resultados[s.resultados.length - 1];
const robo = (s: SessaoSimulada) => textosDoRobo(s);
const avisosDoGrupo = (s: SessaoSimulada) => s.resultados.filter((r) => r.avisarGrupo).length;

/** As consultas de prova do plano: chaves únicas, contagem de mensagens e nada proibido ao cliente final. */
function provas(s: SessaoSimulada) {
  const envios = s.resultados.flatMap((r) => (r.envio ? [r.envio] : []));
  const chaves = envios.map((e) => e.chaveDeIdempotencia);
  expect(new Set(chaves).size, "chaves de idempotência únicas").toBe(chaves.length);
  expect(s.estado.mensagensEnviadas, "contagem de mensagens").toBe(envios.length);
  expect(s.estado.mensagensEnviadas).toBeLessThanOrEqual(8);
  if (s.estado.ramo === "cliente") {
    for (const e of envios)
      expect(verificarTexto(e.texto, "cliente").problemas, e.texto).toEqual([]);
  }
  for (const r of s.resultados) {
    const eventos = JSON.stringify(r.eventos);
    expect(eventos, "evento sem dado pessoal").not.toMatch(/Maria|Souza|68900|2233|99111|8722/);
  }
}

const todasAsConversasDoCliente: SessaoSimulada[] = [];
const guardar = (s: SessaoSimulada) => {
  provas(s);
  todasAsConversasDoCliente.push(s);
  return s;
};

describe("degrau 2: o roteiro de 14 cenários", () => {
  it("1. nome e sobrenome completos, primeira vez, CEP certo, telefone sim, fora do horário", () => {
    const s = guardar(
      falas(
        iniciarSessao({ agora: SABADO_AS_20H }),
        "Olá, vi o anúncio",
        "Maria Souza",
        "primeira vez",
        "68900-000",
        "sim",
      ),
    );
    expect(s.estado).toMatchObject({ status: "concluida", passo: "fechamento", ramo: "cliente" });
    expect(s.estado.dados).toMatchObject({
      nomeInformado: "Maria Souza",
      nomeCompleto: true,
      primeiraVez: "sim",
      cep: "68900000",
      telefoneConfirmado: "sim",
    });
    expect(robo(s)).toHaveLength(5);
    expect(robo(s).at(-1)).toMatch(
      /fora do atendimento presencial, que funciona das 8h às 18h, de segunda a sexta/,
    );
  });

  it("2. só um nome, depois sobrenome", () => {
    const s = guardar(falas(iniciarSessao(), "oi", "Maria", "Souza"));
    expect(robo(s)[1]).toBe("Prazer, Maria! Qual é o seu sobrenome?");
    expect(s.estado.dados).toMatchObject({ nomeInformado: "Maria Souza", nomeCompleto: true });
    expect(s.estado.passo).toBe("primeira_vez");
  });

  it("3. já sou cliente, sem pedido de CEP", () => {
    const s = guardar(falas(iniciarSessao(), "oi", "Maria Souza", "já sou cliente", "sim"));
    expect(s.estado.dados.primeiraVez).toBe("ja_cliente");
    expect(robo(s).join(" ")).not.toMatch(/CEP/);
    expect(s.estado.status).toBe("concluida");
  });

  it("4. CEP errado, depois certo", () => {
    let s = falas(iniciarSessao(), "oi", "Maria Souza", "primeira vez", "6890-000");
    expect(robo(s).at(-1)).toMatch(/Não consegui ler o CEP/);
    expect(s.estado.dados.cep).toBeNull();
    s = guardar(falas(s, "68900-000"));
    expect(s.estado.dados.cep).toBe("68900000");
    expect(s.estado.passo).toBe("telefone");
  });

  it("5. pular o CEP, e depois recusar o CEP", () => {
    const pulou = guardar(falas(iniciarSessao(), "oi", "Maria Souza", "primeira vez", "pular"));
    expect(pulou.estado.dados).toMatchObject({ enderecoRecusado: true, cep: null });
    expect(pulou.estado.passo).toBe("telefone");
    const recusou = guardar(
      falas(iniciarSessao(), "oi", "Maria Souza", "primeira vez", "prefiro não informar"),
    );
    expect(recusou.estado.dados).toMatchObject({ enderecoRecusado: true, cep: null });
    expect(recusou.estado.passo).toBe("telefone");
    // nunca se pergunta de novo
    expect(robo(recusou).filter((t) => /me passe só o seu CEP/.test(t))).toHaveLength(1);
  });

  it("6. telefone: outro número, número inválido, quero mudar", () => {
    const outro = guardar(
      falas(
        iniciarSessao(),
        "oi",
        "Maria Souza",
        "primeira vez",
        "pular",
        "pode usar o 96 98140-8722",
      ),
    );
    expect(outro.estado.dados).toMatchObject({
      telefoneConfirmado: "alternativo",
      telefoneAlternativo: "96981408722",
      telefoneAlternativoVerificado: false,
    });

    const invalido = guardar(
      falas(iniciarSessao(), "oi", "Maria Souza", "primeira vez", "pular", "12345", "123"),
    );
    expect(invalido.estado.dados).toMatchObject({
      telefoneConfirmado: "pendente",
      telefoneAlternativo: null,
    });
    expect(invalido.estado.status).toBe("concluida");

    const mudar = guardar(
      falas(
        iniciarSessao(),
        "oi",
        "Maria Souza",
        "primeira vez",
        "pular",
        "quero mudar",
        "96 98140-8722",
      ),
    );
    expect(mudar.estado.dados).toMatchObject({
      telefoneConfirmado: "alternativo",
      telefoneAlternativo: "96981408722",
    });
    expect(robo(mudar)).toContain("Sem problema! Qual número, com DDD, você quer que eu registre?");
  });

  it("7. áudio, figurinha, foto, polegar", () => {
    let s = iniciarSessao();
    s = falas(s, "oi");
    s = digitar(s, null, { tipo: "audio" }).sessao;
    expect(robo(s).at(-1)).toMatch(/consigo ler só texto/);
    s = falas(s, "Maria Souza");
    s = digitar(s, null, { tipo: "figurinha" }).sessao;
    expect(robo(s).at(-1)).toMatch(/me diga assim: já sou cliente/);
    s = digitar(s, null, { tipo: "imagem" }).sessao;
    expect(robo(s).at(-1)).toMatch(/Recebi seu arquivo/);
    s = falas(s, "primeira vez", "pular");
    s = digitar(s, "👍").sessao;
    guardar(s);
    expect(s.estado.dados.telefoneConfirmado).toBe("sim");
    expect(s.estado.status).toBe("concluida");
  });

  it("8. pergunta de valor no meio", () => {
    const s = guardar(
      falas(iniciarSessao(), "oi", "Maria Souza", "quanto custa um banner de 2x1?", "primeira vez"),
    );
    expect(robo(s).filter((t) => t.includes("O valor quem passa é a equipe"))).toHaveLength(1);
    expect(robo(s).join(" ")).not.toMatch(/R\$|\d+ reais|desconto|%/);
    expect(s.estado.passo).toBe("cep");
    expect(s.estado.dados.pediuPreco).toBe(true);
  });

  it("9. parar, e depois escrever de novo: silêncio esperado", () => {
    let s = falas(iniciarSessao(), "oi", "Maria Souza", "primeira vez");
    const r = digitar(s, "parar");
    expect(r.resultado.bloquearContato).toBe(true);
    s = r.sessao;
    const antes = s.estado.mensagensEnviadas;
    for (const t of ["oi", "Maria Souza", "tem alguém aí?", "quanto custa?"])
      s = digitar(s, t).sessao;
    guardar(s);
    expect(s.estado.mensagensEnviadas).toBe(antes);
    expect(s.estado.status).toBe("parada_pelo_contato");
    expect(s.resultados.slice(-4).every((x) => x.acao === "silencio")).toBe(true);
  });

  it("10. colega da equipe responde no meio: pausa, e nenhuma mensagem automática depois", () => {
    const s0 = falas(iniciarSessao(), "oi", "Maria Souza");
    const comColega = { ...s0, ctx: { ...s0.ctx, humanoNaConversa: true } };
    let s = digitar(comColega, "primeira vez").sessao;
    expect(s.estado.status).toBe("pausada_humano");
    const antes = s.estado.mensagensEnviadas;
    s = { ...s, ctx: { ...s.ctx, humanoNaConversa: false } };
    s = falas(s, "pular", "sim", "oi");
    guardar(s);
    expect(s.estado.mensagensEnviadas).toBe(antes);
    expect(avisosDoGrupo(s)).toBe(0);
  });

  it("10b. o celular da equipe e o dono escrevendo do próprio número não abrem triagem fora do degrau de teste", () => {
    const base = {
      percentual: 100,
      valeAPartirDe: 0,
      conversaId: "c1",
      entrada: { ehDePessoa: true, ehDeGrupo: false, texto: "oi", origem: null },
      conversa: {
        criadaEm: 1,
        clienteVinculado: false,
        temResponsavel: false,
        arquivada: false,
        modoHumano: false,
        saidasAnteriores: 0,
      },
      telefone: { bloqueado: false, ehDaEquipe: true, jaEConhecido: false, ehDeTeste: true },
      volume: { novasNaHora: 0, novasNoDia: 0, maxPorHora: 12, maxPorDia: 60 },
      quadro: SEMENTES_DO_QUADRO,
    };
    expect(portaoDaTriagem({ ...base, estado: "ligada" }).motivo).toBe("equipe");
    expect(portaoDaTriagem({ ...base, estado: "teste" }).abre).toBe(true);
  });

  it("11. silêncio de 30 minutos, expiração, e resposta depois: retomada", () => {
    const s0 = falas(iniciarSessao(), "oi", "Maria Souza", "primeira vez");
    const exp = expirarTriagem(s0.estado, s0.agora + 31 * 60_000, s0.ctx.config);
    expect(exp.estado.status).toBe("expirada");
    expect(exp.envio).toBeNull();
    const s1: SessaoSimulada = { ...s0, estado: exp.estado, agora: s0.agora + 2 * 3600_000 };
    const r = digitar(s1, "68900-000", { esperaS: 0 });
    expect(r.resultado.envio?.codigos).toEqual(["reabertura", "cep"]);
    // a resposta tardia não foi lida como CEP: volta a perguntar
    expect(r.sessao.estado.dados.cep).toBeNull();
    const s2 = guardar(falas(r.sessao, "68900-000"));
    expect(s2.estado.dados.cep).toBe("68900000");
    expect(s2.estado.passo).toBe("telefone");
  });

  it("12. mesma mensagem entregue duas vezes pelo webhook: uma só resposta", () => {
    let s = falas(iniciarSessao(), "oi");
    const a = digitar(s, "Maria Souza", { id: "wamid.REPETIDA" });
    const b = digitar(a.sessao, "Maria Souza", { id: "wamid.REPETIDA", esperaS: 2 });
    s = guardar(b.sessao);
    expect(a.resultado.acao).toBe("enviar");
    expect(b.resultado.acao).toBe("silencio");
    expect(robo(s)).toHaveLength(2);
  });

  it("13. palavra de parceiro: ramo parceiro, e nada de parceiro aparece nos outros", () => {
    const s = falas(iniciarSessao(), "Quero ser parceiro", "Carlos Lima");
    expect(s.estado.ramo).toBe("parceiro");
    expect(robo(s)[0]).toContain("programa de parceiros");
    expect(robo(s)[1]).toContain("https://exemplo.com.br/convite");
    expect(s.estado.status).toBe("concluida");
    for (const x of s.resultados)
      for (const e of x.eventos) expect(JSON.stringify(e)).not.toMatch(/Carlos|Lima/);
    // todas as conversas de cliente final do roteiro, juntas: nenhuma palavra de parceiro
    expect(todasAsConversasDoCliente.length).toBeGreaterThanOrEqual(10);
    for (const c of todasAsConversasDoCliente) {
      expect(c.estado.ramo).toBe("cliente");
      expect(robo(c).join(" ")).not.toMatch(/parceir|revend|tabela|diferenciad/i);
    }
  });

  it("14. resumo no grupo: exatamente um por triagem, e nenhum quando pausou por humano", () => {
    const completa = falas(
      iniciarSessao(),
      "oi",
      "Maria Souza",
      "primeira vez",
      "68900-000",
      "sim",
    );
    expect(avisosDoGrupo(completa)).toBe(1);
    expect(completa.resultados.at(-1)?.avisarGrupo?.motivo).toBe("concluida");
    // depois de concluída, mais mensagens não geram outro resumo
    expect(avisosDoGrupo(falas(completa, "obrigada", "oi"))).toBe(1);

    const pausada = falas(
      { ...iniciarSessao(), ctx: { ...iniciarSessao().ctx, humanoNaConversa: true } },
      "oi",
      "Maria Souza",
    );
    expect(avisosDoGrupo(pausada)).toBe(0);

    const pedidoEquipe = falas(
      iniciarSessao(),
      "oi",
      "Maria Souza",
      "quero falar com atendente",
      "me liga",
    );
    expect(avisosDoGrupo(pedidoEquipe)).toBe(1);

    const rajada = digitarEmRajada(falas(iniciarSessao(), "oi"), [
      "Maria Souza",
      "primeira vez",
      "pular",
      "sim",
    ]);
    expect(rajada.resultado.avisarGrupo?.motivo).toBe("concluida");
    expect(avancarRelogio(rajada.sessao, 1).estado.avisoGrupoDecidido).toBe(true);
  });
});
