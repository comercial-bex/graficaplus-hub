import { describe, expect, it } from "vitest";
import {
  agruparRajada,
  CONFIG_PADRAO_DA_TRIAGEM,
  avancarRelogio,
  contextoPadrao,
  digitar,
  digitarEmRajada,
  escolherRamo,
  estadoInicial,
  expirarTriagem,
  iniciarSessao,
  PASSOS_SEMENTE,
  prontoParaResponder,
  proximoPasso,
  SABADO_AS_20H,
  SEGUNDA_AS_10H,
  SEMENTES_DO_QUADRO,
  textosDoRobo,
  verificarTexto,
  type SessaoSimulada,
} from "../../src/domain/whatsapp/triagem";

function conversa(sessao: SessaoSimulada, ...falas: string[]): SessaoSimulada {
  return falas.reduce((s, f) => digitar(s, f).sessao, sessao);
}
const ultimo = (s: SessaoSimulada) => s.resultados[s.resultados.length - 1];
const ultimoTexto = (s: SessaoSimulada) => textosDoRobo(s).at(-1) ?? "";
const avisos = (s: SessaoSimulada) => s.resultados.filter((r) => r.avisarGrupo).length;

describe("primeira mensagem", () => {
  it("responde com as boas-vindas e pede o nome, numa variante estável", () => {
    const a = digitar(iniciarSessao(), "Olá, vi o anúncio de vocês");
    expect(a.resultado.acao).toBe("enviar");
    expect(a.resultado.envio?.texto).toMatch(/nome e sobrenome/);
    expect(a.sessao.estado.passo).toBe("nome");
    expect(a.sessao.estado.tentativasPasso).toBe(1);
    expect(a.sessao.estado.mensagensEnviadas).toBe(1);
    const b = digitar(iniciarSessao(), "Olá, vi o anúncio de vocês");
    expect(b.resultado.envio?.texto).toBe(a.resultado.envio?.texto);
  });

  it("traz atraso de digitação entre 3 e 8 s e chave de idempotência por triagem, texto e ordem", () => {
    const e = digitar(iniciarSessao(), "oi").resultado.envio!;
    expect(e.atrasoS).toBeGreaterThanOrEqual(3);
    expect(e.atrasoS).toBeLessThanOrEqual(8);
    expect(e.chaveDeIdempotencia).toMatch(/^triagem:triagem-[^:]+:nome:1$/);
    expect(e.ordem).toBe(1);
  });

  it("não guarda nome nem telefone nos eventos, só códigos", () => {
    let s = iniciarSessao();
    s = conversa(s, "oi", "Maria Souza", "primeira vez", "68900-000", "sim");
    const texto = JSON.stringify(s.resultados.flatMap((r) => r.eventos));
    expect(texto).not.toMatch(/Maria|Souza|68900|2233|99111/);
  });

  it("pedido de preço na primeira mensagem: passa para a equipe e ainda pede o nome", () => {
    const r = digitar(iniciarSessao(), "Quanto custa um banner?").resultado;
    expect(r.envio?.codigos).toEqual(["ack_preco", "nome"]);
    expect(r.envio?.texto).toMatch(/O valor quem passa é a equipe/);
    expect(r.envio?.texto).toMatch(/nome e sobrenome/);
    expect(r.estado.dados.pediuPreco).toBe(true);
    expect(r.estado.passo).toBe("nome");
  });

  it("áudio na primeira mensagem: boas-vindas e aviso de que só lê texto", () => {
    const r = digitar(iniciarSessao(), null, { tipo: "audio" }).resultado;
    expect(r.envio?.codigos).toEqual(["nome", "aviso_audio"]);
    expect(r.estado.dados.mandouAudio).toBe(true);
  });

  it("figurinha e foto na primeira mensagem: boas-vindas normais", () => {
    expect(digitar(iniciarSessao(), null, { tipo: "figurinha" }).resultado.envio?.codigos).toEqual([
      "nome",
    ]);
    expect(digitar(iniciarSessao(), null, { tipo: "imagem" }).resultado.envio?.codigos).toEqual([
      "nome",
    ]);
  });
});

describe("nome: com e sem prefixo, fora de ordem e texto livre", () => {
  const aposBoasVindas = () => conversa(iniciarSessao(), "oi");

  it.each([
    ["Maria Souza", "Maria Souza", "primeira_vez"],
    ["meu nome é Maria Souza", "Maria Souza", "primeira_vez"],
    ["seu João Batista", "João Batista", "primeira_vez"],
    ["dona Maria das Graças", "Maria das Graças", "primeira_vez"],
    ["Dr. Carlos Lima", "Carlos Lima", "primeira_vez"],
    ["Maria", "Maria", "sobrenome"],
    ["seu João", "João", "sobrenome"],
  ])("%j", (fala, nome, passo) => {
    const r = digitar(aposBoasVindas(), fala);
    expect(r.sessao.estado.dados.nomeInformado).toBe(nome);
    expect(r.sessao.estado.passo).toBe(passo);
    expect(r.resultado.envio?.texto).toContain(`Prazer, ${nome.split(" ")[0]}!`);
  });

  it("só uma palavra pede o sobrenome, e o sobrenome completa o nome", () => {
    let s = conversa(aposBoasVindas(), "Maria");
    expect(ultimoTexto(s)).toBe("Prazer, Maria! Qual é o seu sobrenome?");
    s = conversa(s, "Souza");
    expect(s.estado.dados.nomeInformado).toBe("Maria Souza");
    expect(s.estado.dados.nomeCompleto).toBe(true);
    expect(s.estado.passo).toBe("primeira_vez");
  });

  it("sem sobrenome na segunda tentativa, o nome fica como está e a conversa segue", () => {
    let s = conversa(aposBoasVindas(), "Maria", "sim");
    expect(ultimoTexto(s)).toMatch(/sobrenome/);
    s = conversa(s, "hm");
    expect(s.estado.passo).toBe("primeira_vez");
    expect(s.estado.dados.nomeInformado).toBe("Maria");
    expect(s.estado.dados.nomeCompleto).toBe(false);
  });

  it("CEP no lugar do nome: guarda o CEP, repete o nome e depois não pede o CEP de novo", () => {
    let s = conversa(aposBoasVindas(), "68900-000");
    expect(s.estado.dados.cep).toBe("68900000");
    expect(ultimoTexto(s)).toMatch(/não consegui entender/);
    expect(s.estado.passo).toBe("nome");
    s = conversa(s, "Maria Souza", "primeira vez");
    expect(s.estado.passo).toBe("telefone");
    expect(textosDoRobo(s).some((t) => /Me passe só o seu CEP|me passe só o seu CEP/.test(t))).toBe(
      false,
    );
  });

  it("nome com CEP junto: pega os dois", () => {
    const s = conversa(aposBoasVindas(), "Maria Souza 68900-000");
    expect(s.estado.dados.nomeInformado).toBe("Maria Souza");
    expect(s.estado.dados.cep).toBe("68900000");
  });

  it.each([
    "sim",
    "ok",
    "quero banner",
    "Parceiro Silva",
    "Revendedor",
    "Bruna Porra",
    "😊",
    "preciso urgente",
    "pode ser o tamanho 2x1",
  ])("recusa %j como nome e repete a pergunta", (fala) => {
    const s = conversa(conversa(iniciarSessao(), "oi"), fala);
    expect(s.estado.dados.nomeInformado).toBeNull();
    expect(s.estado.passo).toBe("nome");
    expect(ultimoTexto(s)).toMatch(/não consegui entender/);
  });

  it("o que parece robô ou golpe nem chega à validação do nome: fica sem resposta", () => {
    for (const fala of ["Bloqueio de Linha", "https://golpe.com", "*Promoção* só hoje"]) {
      const r = digitar(conversa(iniciarSessao(), "oi"), fala).resultado;
      expect(r.acao, fala).toBe("silencio");
      expect(r.estado.dados.nomeInformado).toBeNull();
      expect(r.estado.status).toBe("pulada");
    }
  });

  it("pedido longo no lugar do nome: repete uma vez e na segunda entrega à equipe", () => {
    let s = conversa(
      aposBoasVindas(),
      "preciso de 100 banners para amanhã, urgente, pode ser o tamanho 2x1",
    );
    expect(s.estado.status).toBe("ativa");
    s = conversa(s, "preciso de 100 banners para amanhã, urgente, pode ser o tamanho 2x1 sim");
    expect(s.estado.status).toBe("entregue_equipe");
    expect(ultimoTexto(s)).toBe("Claro, já chamo a equipe para continuar com você.");
    expect(ultimo(s).avisarGrupo?.motivo).toBe("entregue_equipe");
    expect(s.estado.dados.nomeInformado).toBeNull();
  });

  it("saudação no lugar do nome conta como resposta que não entendeu", () => {
    const s = conversa(aposBoasVindas(), "oi tudo bem");
    expect(ultimoTexto(s)).toMatch(/não consegui entender/);
  });
});

describe("primeira vez, CEP e telefone", () => {
  const ate = (...f: string[]) => conversa(iniciarSessao(), "oi", "Maria Souza", ...f);

  it("primeira vez leva ao CEP", () => {
    const s = ate("primeira vez");
    expect(s.estado.dados.primeiraVez).toBe("sim");
    expect(s.estado.passo).toBe("cep");
    expect(ultimoTexto(s)).toMatch(/CEP/);
    expect(ultimoTexto(s)).toMatch(/dizer pular/);
  });

  it("já cliente não recebe pedido de CEP e vai direto ao telefone", () => {
    const s = ate("já sou cliente");
    expect(s.estado.dados.primeiraVez).toBe("ja_cliente");
    expect(s.estado.passo).toBe("telefone");
    expect(ultimoTexto(s)).toContain("Que bom ter você de volta!");
    expect(ultimoTexto(s)).not.toMatch(/CEP/);
  });

  it("sim e não na pergunta de primeira vez são ambíguos e caem na repetição; na segunda segue sem saber", () => {
    let s = ate("sim");
    expect(ultimoTexto(s)).toBe(
      "Só para eu registrar certinho, me diga assim: já sou cliente, ou primeira vez.",
    );
    s = conversa(s, "não");
    expect(s.estado.dados.primeiraVez).toBe("nao_sei");
    expect(s.estado.passo).toBe("cep");
  });

  it("o telefone mostra só o final do número do chat", () => {
    const s = ate("primeira vez", "pular");
    expect(ultimoTexto(s)).toContain("terminado em 2233");
    expect(ultimoTexto(s)).not.toContain("99111");
    expect(ultimoTexto(s)).not.toContain("96991112233");
  });

  it("CEP com consulta: confirma com bairro e cidade", () => {
    const s0 = iniciarSessao({
      ctx: {
        enderecoDoCep: {
          cep: "68900000",
          rua: "Rua A",
          bairro: "Centro",
          cidade: "Macapá",
          estado: "AP",
        },
      },
    });
    const s = conversa(s0, "oi", "Maria Souza", "primeira vez", "meu cep é 68900-000");
    expect(ultimoTexto(s)).toContain("Anotei o CEP 68900-000, Centro, Macapá.");
    expect(s.estado.dados.cepEndereco?.cidade).toBe("Macapá");
  });

  it("CEP sem consulta: só anota o CEP", () => {
    const s = ate("primeira vez", "68900000");
    expect(ultimoTexto(s)).toContain("Anotei o seu CEP.");
    expect(s.estado.dados.cep).toBe("68900000");
  });

  it("consulta que traz palavra proibida é barrada, não vai ao cliente", () => {
    const s0 = iniciarSessao({
      ctx: { enderecoDoCep: { cep: "68900000", bairro: "Tabela de Parceiro", cidade: "Macapá" } },
    });
    const s = conversa(s0, "oi", "Maria Souza", "primeira vez", "68900-000");
    const r = ultimo(s);
    expect(r.acao).toBe("silencio");
    expect(r.estado.status).toBe("entregue_equipe");
    expect(r.eventos.some((e) => e.tipo === "texto_barrado")).toBe(true);
    expect(textosDoRobo(s).join(" ")).not.toMatch(/parceiro|tabela/i);
    expect(r.avisarGrupo?.motivo).toBe("texto_barrado");
  });

  it("endereço escrito à mão vale como respondido", () => {
    const s = ate("primeira vez", "Rua Cândido Mendes, 23, Perpétuo Socorro");
    expect(s.estado.passo).toBe("telefone");
    expect(s.estado.dados.enderecoTexto).toMatch(/Cândido Mendes/);
    expect(ultimoTexto(s)).toContain("Anotei o seu endereço.");
  });

  it("localização no CEP vale como endereço recebido; fora do CEP é tratada como arquivo", () => {
    let s = ate("primeira vez");
    s = digitar(s, null, { tipo: "localizacao" }).sessao;
    expect(s.estado.passo).toBe("telefone");
    expect(s.estado.dados.enderecoTexto).toBe("localizacao");
    const t = digitar(conversa(iniciarSessao(), "oi"), null, { tipo: "localizacao" }).resultado;
    expect(t.envio?.codigos).toEqual(["aviso_arquivo", "nome_curto"]);
  });

  it("telefone: sim confirma e fecha", () => {
    const s = ate("primeira vez", "pular", "sim");
    expect(s.estado.dados.telefoneConfirmado).toBe("sim");
    expect(s.estado.status).toBe("concluida");
  });

  it("telefone: número escrito em frase vale, com e sem 55 e 9º dígito", () => {
    for (const fala of [
      "pode ser o 96 98140-8722",
      "+55 (96) 98140-8722",
      "5596981408722",
      "9681408722",
    ]) {
      const s = ate("primeira vez", "pular", fala);
      expect(s.estado.dados.telefoneAlternativo, fala).toBe("96981408722");
      expect(s.estado.dados.telefoneConfirmado).toBe("alternativo");
      expect(s.estado.dados.telefoneAlternativoVerificado).toBe(false);
      expect(s.estado.status).toBe("concluida");
    }
  });

  it("telefone: o mesmo número do chat escrito vale como confirmado, não como alternativo", () => {
    const s = ate("primeira vez", "pular", "96 99111-2233");
    expect(s.estado.dados.telefoneConfirmado).toBe("sim");
    expect(s.estado.dados.telefoneAlternativo).toBeNull();
  });

  it("não e quero mudar levam a telefone_novo; número inválido repete; segunda falha mantém o do chat como pendente", () => {
    let s = ate("primeira vez", "pular", "quero mudar");
    expect(s.estado.passo).toBe("telefone_novo");
    expect(ultimoTexto(s)).toBe("Sem problema! Qual número, com DDD, você quer que eu registre?");
    s = conversa(s, "12345");
    expect(ultimoTexto(s)).toMatch(/Escreva só os números, com DDD/);
    s = conversa(s, "não sei");
    expect(s.estado.dados.telefoneConfirmado).toBe("pendente");
    expect(s.estado.dados.telefoneAlternativo).toBeNull();
    expect(s.estado.status).toBe("concluida");
    expect(ultimo(s).avisarGrupo?.marcas).toContain("telefone_nao_confirmado");
  });

  it("chat só com lid: pula a confirmação, nunca mostra número e pede direto", () => {
    const s0 = iniciarSessao({
      ctx: { telefoneDoChat: { normalizado: "123456789012345", ehLid: true } },
    });
    const s = conversa(s0, "oi", "Maria Souza", "já sou cliente");
    expect(ultimoTexto(s)).toContain("Qual número, com DDD, posso registrar para o seu contato?");
    expect(ultimoTexto(s)).not.toMatch(/123456|terminado/);
    expect(conversa(s, "sim").estado.passo).toBe("telefone");
    const fim = conversa(s, "96 98140-8722");
    expect(fim.estado.dados.telefoneAlternativo).toBe("96981408722");
    expect(fim.estado.status).toBe("concluida");
  });

  it("texto longo na confirmação do telefone entrega à equipe", () => {
    const s = ate(
      "primeira vez",
      "pular",
      "na verdade eu queria saber se vocês fazem banner para evento amanhã",
    );
    expect(s.estado.status).toBe("entregue_equipe");
  });

  it("fechamento fora do horário traz o horário da tabela; dentro, o aviso de equipe em instantes", () => {
    const fora = conversa(
      iniciarSessao({ agora: SABADO_AS_20H }),
      "oi",
      "Maria Souza",
      "primeira vez",
      "pular",
      "sim",
    );
    expect(ultimoTexto(fora)).toContain("Tudo anotado, Maria!");
    expect(ultimoTexto(fora)).toContain("das 8h às 18h, de segunda a sexta");
    const dentro = conversa(
      iniciarSessao({ agora: SEGUNDA_AS_10H }),
      "oi",
      "Maria Souza",
      "primeira vez",
      "pular",
      "sim",
    );
    expect(ultimoTexto(dentro)).toContain("Já avisei a equipe");
    expect(ultimoTexto(dentro)).not.toContain("das 8h");
  });

  it("sem nenhum dia ativo na tabela, o fechamento não inventa horário", () => {
    const horario = {
      semana: contextoPadrao().horario.semana.map((h) => ({ ...h, ativo: false })),
    };
    const s = conversa(
      iniciarSessao({ ctx: { horario } }),
      "oi",
      "Maria Souza",
      "primeira vez",
      "pular",
      "sim",
    );
    expect(ultimoTexto(s)).toContain("assim que possível");
  });
});

describe("três mensagens em rajada", () => {
  it("juntam em uma rodada: nome, sobrenome e primeira vez, uma só resposta", () => {
    const s0 = conversa(iniciarSessao(), "oi");
    const r = digitarEmRajada(s0, ["Maria", "Souza", "primeira vez"]);
    expect(r.resultado.acao).toBe("enviar");
    expect(r.sessao.estado.dados.nomeInformado).toBe("Maria Souza");
    expect(r.sessao.estado.dados.primeiraVez).toBe("sim");
    expect(r.sessao.estado.passo).toBe("cep");
    expect(r.resultado.envio?.codigos).toEqual(["cep"]);
    // só uma mensagem do robô saiu: a das boas-vindas e esta
    expect(r.sessao.estado.mensagensEnviadas).toBe(2);
    expect(r.resultado.gravar).toMatchObject({ nomeInformado: "Maria Souza", primeiraVez: "sim" });
  });

  it("nome, CEP e telefone em três mensagens", () => {
    const s0 = conversa(iniciarSessao(), "oi");
    const r = digitarEmRajada(s0, ["Maria Souza", "primeira vez", "68900-000"]);
    expect(r.sessao.estado.passo).toBe("telefone");
    expect(r.sessao.estado.dados.cep).toBe("68900000");
    expect(r.sessao.estado.mensagensEnviadas).toBe(2);
  });

  it("se uma das três pede para parar, para e responde só o aviso de parar", () => {
    const s0 = conversa(iniciarSessao(), "oi");
    const r = digitarEmRajada(s0, ["Maria", "pare de mandar mensagem", "Souza"]);
    expect(r.resultado.estado.status).toBe("parada_pelo_contato");
    expect(r.resultado.bloquearContato).toBe(true);
    expect(r.resultado.envio?.codigos).toEqual(["aviso_parar"]);
  });

  it("o intervalo mínimo de 20 s e o agrupamento por janela", () => {
    const s = conversa(iniciarSessao(), "oi");
    const config = s.ctx.config;
    expect(prontoParaResponder(s.estado, s.agora + 5_000, config)).toEqual({
      pode: false,
      esperarMs: 15_000,
    });
    expect(prontoParaResponder(s.estado, s.agora + 25_000, config)).toEqual({
      pode: true,
      esperarMs: 0,
    });
    expect(
      prontoParaResponder(estadoInicial({ triagemId: "t", conversaId: "c" }), 0, config).pode,
    ).toBe(true);
    const mk = (t: number, id: string) => ({
      id,
      tipo: "texto" as const,
      texto: id,
      recebidaEm: t,
    });
    const grupos = agruparRajada([mk(30_000, "c"), mk(1_000, "a"), mk(8_000, "b")], 20_000);
    expect(grupos.map((g) => g.map((e) => e.id))).toEqual([["a", "b"], ["c"]]);
  });
});

describe("áudio, figurinha, foto e polegar", () => {
  it("áudio no nome: avisa uma vez e repete a pergunta, sem contar como falha", () => {
    let s = conversa(iniciarSessao(), "oi");
    const r = digitar(s, null, { tipo: "audio" });
    s = r.sessao;
    expect(r.resultado.envio?.codigos).toEqual(["aviso_audio", "nome_curto"]);
    expect(r.resultado.envio?.texto).toMatch(/consigo ler só texto/);
    expect(s.estado.tentativasPasso).toBe(1);
    expect(s.estado.dados.mandouAudio).toBe(true);
  });

  it("segundo áudio: silêncio, entrega à equipe com a marca mandou_audio", () => {
    let s = conversa(iniciarSessao(), "oi");
    s = digitar(s, null, { tipo: "audio" }).sessao;
    const r = digitar(s, null, { tipo: "audio" });
    expect(r.resultado.acao).toBe("silencio");
    expect(r.resultado.estado.status).toBe("entregue_equipe");
    expect(r.resultado.avisarGrupo).toEqual({
      motivo: "audio",
      marcas: expect.arrayContaining(["mandou_audio"]),
    });
  });

  it("áudio em etapa avançada é fim de triagem, sem avisar que o robô só lê texto", () => {
    const s = conversa(iniciarSessao(), "oi", "Maria Souza", "primeira vez", "pular");
    const r = digitar(s, null, { tipo: "audio" });
    expect(r.resultado.estado.status).toBe("entregue_equipe");
    expect(r.resultado.envio?.texto).toBe("Claro, já chamo a equipe para continuar com você.");
    expect(r.resultado.envio?.texto).not.toMatch(/ler só texto/);
  });

  it("figurinha: conta como falha e repete a pergunta; a segunda é ignorada sem resposta", () => {
    let s = conversa(iniciarSessao(), "oi");
    const a = digitar(s, null, { tipo: "figurinha" });
    expect(a.resultado.envio?.texto).toMatch(/não consegui entender/);
    expect(a.sessao.estado.tentativasPasso).toBe(2);
    const b = digitar(a.sessao, null, { tipo: "figurinha" });
    expect(b.resultado.acao).toBe("silencio");
    expect(b.resultado.estado.status).toBe("ativa");
    s = b.sessao;
    expect(s.estado.mensagensEnviadas).toBe(2);
  });

  it("foto, documento e vídeo: avisa uma vez e repete a pergunta; os seguintes ficam em silêncio", () => {
    const s = conversa(iniciarSessao(), "oi", "Maria Souza");
    const a = digitar(s, null, { tipo: "imagem" });
    expect(a.resultado.envio?.codigos).toEqual(["aviso_arquivo", "primeira_vez"]);
    expect(a.resultado.envio?.texto).toMatch(/já deixei guardado para a equipe/);
    expect(a.sessao.estado.passo).toBe("primeira_vez");
    for (const tipo of ["documento", "video", "imagem"] as const) {
      expect(digitar(a.sessao, null, { tipo }).resultado.acao).toBe("silencio");
    }
  });

  it("polegar vale como sim na confirmação do telefone", () => {
    const s = conversa(iniciarSessao(), "oi", "Maria Souza", "primeira vez", "pular");
    const r = digitar(s, "👍");
    expect(r.sessao.estado.dados.telefoneConfirmado).toBe("sim");
    expect(r.sessao.estado.status).toBe("concluida");
  });

  it("polegar para baixo no telefone vale não e leva ao número novo", () => {
    const s = conversa(iniciarSessao(), "oi", "Maria Souza", "primeira vez", "pular");
    expect(digitar(s, "👎").sessao.estado.passo).toBe("telefone_novo");
  });

  it("polegar nas outras etapas é ignorado, sem resposta e sem falha", () => {
    for (const antes of [["oi"], ["oi", "Maria Souza"], ["oi", "Maria Souza", "primeira vez"]]) {
      const s = conversa(iniciarSessao(), ...antes);
      const r = digitar(s, "👍");
      expect(r.resultado.acao).toBe("silencio");
      expect(r.sessao.estado.tentativasPasso).toBe(s.estado.tentativasPasso);
      expect(r.sessao.estado.passo).toBe(s.estado.passo);
    }
  });
});

describe("pedido de preço no meio: nunca responde valor", () => {
  it("devolve a frase de passar para a equipe e volta ao passo, sem contar falha", () => {
    const s = conversa(iniciarSessao(), "oi", "Maria Souza");
    const r = digitar(s, "quanto custa um banner de 2x1?");
    expect(r.resultado.envio?.codigos).toEqual(["ack_preco", "primeira_vez"]);
    expect(r.resultado.envio?.texto).toContain("O valor quem passa é a equipe");
    expect(r.resultado.envio?.texto).not.toMatch(/R\$|\d+\s*reais|%|desconto/i);
    expect(r.sessao.estado.passo).toBe("primeira_vez");
    expect(r.sessao.estado.tentativasPasso).toBe(1);
    expect(r.sessao.estado.dados.pediuPreco).toBe(true);
  });

  it("no passo do nome volta com a pergunta curta, sem repetir as boas-vindas", () => {
    const s = conversa(iniciarSessao(), "oi");
    const r = digitar(s, "qual o valor?");
    expect(r.resultado.envio?.codigos).toEqual(["ack_preco", "nome_curto"]);
    expect(r.resultado.envio?.texto).not.toMatch(/bem-vindo/);
  });

  it("segunda pergunta de valor entrega à equipe com a marca pediu_preco", () => {
    let s = conversa(iniciarSessao(), "oi", "Maria Souza");
    s = conversa(s, "quanto custa?");
    const r = digitar(s, "me passa o preço do cartão");
    expect(r.resultado.estado.status).toBe("entregue_equipe");
    expect(r.resultado.avisarGrupo?.marcas).toContain("pediu_preco");
  });

  it("tabela para parceiro ou revenda recebe a resposta neutra de preço e marca tabela especial", () => {
    const s = conversa(iniciarSessao(), "oi", "Maria Souza");
    const r = digitar(s, "vocês têm tabela para revenda?");
    expect(r.resultado.envio?.codigos).toEqual(["ack_preco", "primeira_vez"]);
    expect(r.resultado.envio?.texto).not.toMatch(/parceir|revend|tabela/i);
    expect(r.sessao.estado.dados.pediuTabelaEspecial).toBe(true);
    expect(r.sessao.estado.ramo).toBe("cliente");
  });
});

describe("parar, equipe, robô e reclamação", () => {
  it("parar encerra, bloqueia e depois escrever de novo gera silêncio", () => {
    const s = conversa(iniciarSessao(), "oi", "Maria Souza");
    const r = digitar(s, "pare de mandar mensagem");
    expect(r.resultado.envio?.texto).toBe(
      "Tudo bem, não vou mais te enviar mensagens automáticas. A equipe continua à disposição por aqui.",
    );
    expect(r.resultado.bloquearContato).toBe(true);
    expect(r.resultado.estado.status).toBe("parada_pelo_contato");
    expect(r.resultado.avisarGrupo).toBeNull();
    const depois = digitar(r.sessao, "oi, tem alguém aí?");
    expect(depois.resultado.acao).toBe("silencio");
    expect(depois.resultado.bloquearContato).toBe(false);
    expect(digitar(depois.sessao, "Maria Souza").resultado.acao).toBe("silencio");
  });

  it("parar vale em qualquer passo", () => {
    const passos = [
      ["oi"],
      ["oi", "Maria Souza"],
      ["oi", "Maria Souza", "primeira vez"],
      ["oi", "Maria Souza", "primeira vez", "pular"],
      ["oi", "Maria Souza", "primeira vez", "pular", "outro"],
    ];
    for (const falas of passos) {
      const r = digitar(conversa(iniciarSessao(), ...falas), "parar");
      expect(r.resultado.estado.status).toBe("parada_pelo_contato");
    }
  });

  it("falar com a equipe entrega, avisa o grupo uma vez e marca pediu_equipe", () => {
    const s = conversa(iniciarSessao(), "oi", "Maria Souza");
    const r = digitar(s, "quero falar com uma pessoa");
    expect(r.resultado.envio?.texto).toBe("Claro, já chamo a equipe para continuar com você.");
    expect(r.resultado.estado.status).toBe("entregue_equipe");
    expect(r.resultado.avisarGrupo).toEqual({
      motivo: "pedido_equipe",
      marcas: expect.arrayContaining(["pediu_equipe"]),
    });
  });

  it("reclamação (é um robô?) entrega à equipe", () => {
    const r = digitar(conversa(iniciarSessao(), "oi"), "isso é um robô?");
    expect(r.resultado.estado.status).toBe("entregue_equipe");
    expect(r.resultado.estado.dados.reclamou).toBe(true);
  });

  it("robô de empresa: origem automação, link, frase de robô e resposta rápida demais ficam sem resposta", () => {
    const s = conversa(iniciarSessao(), "oi");
    for (const [texto, origem] of [
      ["Olá!", "automacao"],
      ["Veja em https://promo.com", undefined],
      ["Digite 1 para falar com o atendimento", undefined],
    ] as const) {
      const r = digitar(s, texto, { origem });
      expect(r.resultado.acao, texto).toBe("silencio");
      expect(r.resultado.estado.status).toBe("pulada");
    }
    const rapido = digitar(s, "Bem-vindo ao nosso atendimento automático da operadora", {
      esperaS: 1,
    });
    expect(rapido.resultado.estado.status).toBe("pulada");
  });

  it("laço com robô: o texto idêntico duas vezes seguidas para a conversa", () => {
    let s = conversa(iniciarSessao(), "oi");
    s = conversa(s, "Menu principal escolha uma opção");
    const r = digitar(s, "Menu principal escolha uma opção");
    // repetição vai para a equipe (terminal, com aviso): nunca silêncio sem aviso, nunca laço
    expect(r.resultado.estado.status).toBe("entregue_equipe");
    expect(r.resultado.estado.motivoFim).toBe("texto_repetido");
    expect(r.resultado.avisarGrupo).not.toBeNull();
    expect(digitar(r.sessao, "Menu principal escolha uma opção").resultado.acao).toBe("silencio");
  });

  it.each([["quanto custa um banner?"], ["quero um banner de lona"], ["Maria Souza"]])(
    "pessoa que repete %j não é pulada em silêncio: vai para a equipe com aviso",
    (frase) => {
      const s = conversa(iniciarSessao(), "oi", frase);
      const r = digitar(s, frase);
      expect(r.resultado.estado.status).not.toBe("pulada");
      expect(r.resultado.estado.status).toBe("entregue_equipe");
      expect(r.resultado.avisarGrupo).not.toBeNull();
    },
  );

  it("PARAR repetido continua bloqueando o contato", () => {
    const s = conversa(iniciarSessao(), "oi", "PARAR agora por favor");
    const r = digitar(s, "PARAR agora por favor");
    expect(["parada_pelo_contato", "entregue_equipe", "pulada"]).toContain(
      r.resultado.estado.status,
    );
  });

  it("primeira mensagem de robô com frase de verificação não abre conversa", () => {
    const r = digitar(iniciarSessao(), "Seu código de verificação é 123456. Não responda.");
    expect(r.resultado.acao).toBe("silencio");
    expect(r.resultado.estado.status).toBe("pulada");
  });
});

describe("humano responde no meio, silêncio e retomada", () => {
  it("humano na conversa: pausa, sem mensagem automática, e nunca retoma sozinha", () => {
    const s = conversa(iniciarSessao(), "oi", "Maria Souza");
    const comHumano = { ...s, ctx: { ...s.ctx, humanoNaConversa: true } };
    const r = digitar(comHumano, "primeira vez");
    expect(r.resultado.acao).toBe("silencio");
    expect(r.resultado.estado.status).toBe("pausada_humano");
    expect(r.resultado.avisarGrupo).toBeNull();
    // mesmo que o humano saia depois, a automação não volta
    const semHumano = { ...r.sessao, ctx: { ...r.sessao.ctx, humanoNaConversa: false } };
    const depois = digitar(semHumano, "primeira vez");
    expect(depois.resultado.acao).toBe("silencio");
    expect(depois.resultado.estado.status).toBe("pausada_humano");
    expect(avisos(depois.sessao)).toBe(0);
  });

  it("silêncio de 30 minutos expira sem lembrete, e a varredura avisa o grupo se havia dados", () => {
    const s = conversa(iniciarSessao(), "oi", "Maria Souza", "primeira vez");
    const cedo = expirarTriagem(s.estado, s.agora + 10 * 60_000, s.ctx.config);
    expect(cedo.estado.status).toBe("ativa");
    const v = expirarTriagem(s.estado, s.agora + 31 * 60_000, s.ctx.config);
    expect(v.estado.status).toBe("expirada");
    expect(v.acao).toBe("silencio");
    expect(v.envio).toBeNull();
    expect(v.avisarGrupo?.motivo).toBe("expirada");
    // sem nenhum dado, não há o que avisar
    const vazio = conversa(iniciarSessao(), "oi");
    const w = expirarTriagem(vazio.estado, vazio.agora + 31 * 60_000, vazio.ctx.config);
    expect(w.estado.status).toBe("expirada");
    expect(w.avisarGrupo).toBeNull();
  });

  it("resposta depois de expirada retoma na mesma etapa com a pergunta de reabertura, sem interpretar a resposta tardia", () => {
    const s = conversa(iniciarSessao(), "oi", "Maria Souza", "primeira vez", "pular");
    const exp = expirarTriagem(s.estado, s.agora + 31 * 60_000, s.ctx.config);
    const tarde = { ...s, estado: exp.estado, agora: s.agora + 3 * 3600_000 };
    const r = digitar(tarde, "sim", { esperaS: 0 });
    expect(r.resultado.envio?.codigos).toEqual(["reabertura", "telefone"]);
    expect(r.resultado.estado.status).toBe("ativa");
    expect(r.resultado.estado.passo).toBe("telefone");
    expect(r.resultado.estado.dados.telefoneConfirmado).toBeNull();
    // só depois da reabertura a resposta curta vale
    const sim = digitar(r.sessao, "sim");
    expect(sim.sessao.estado.dados.telefoneConfirmado).toBe("sim");
  });

  it("a retomada acontece mesmo sem a varredura ter rodado, e só dentro de 24 horas", () => {
    const s = conversa(iniciarSessao(), "oi", "Maria Souza");
    const r = digitar(avancarRelogio(s, 3600), "primeira vez", { esperaS: 0 });
    expect(r.resultado.envio?.codigos).toEqual(["reabertura", "primeira_vez"]);
    const dia = digitar(avancarRelogio(s, 25 * 3600), "primeira vez", { esperaS: 0 });
    expect(dia.resultado.acao).toBe("silencio");
    expect(dia.resultado.estado.status).toBe("expirada");
  });

  it("parar vale mesmo depois de expirada", () => {
    const s = conversa(iniciarSessao(), "oi", "Maria Souza");
    const r = digitar(avancarRelogio(s, 30 * 3600), "parar", { esperaS: 0 });
    expect(r.resultado.estado.status).toBe("parada_pelo_contato");
    expect(r.resultado.bloquearContato).toBe(true);
  });

  it("a mesma mensagem entregue duas vezes pelo webhook gera uma só resposta", () => {
    const s = conversa(iniciarSessao(), "oi");
    const a = digitar(s, "Maria Souza", { id: "wamid.ABC" });
    const b = digitar(a.sessao, "Maria Souza", { id: "wamid.ABC", esperaS: 1 });
    expect(a.resultado.acao).toBe("enviar");
    expect(b.resultado.acao).toBe("silencio");
    expect(b.resultado.motivo).toBe("entrada_duplicada");
    expect(b.sessao.estado.mensagensEnviadas).toBe(a.sessao.estado.mensagensEnviadas);
    expect(b.sessao.estado.passo).toBe("primeira_vez");
  });
});

describe("ramo parceiro", () => {
  it("palavra de parceiro na primeira mensagem abre o ramo parceiro; o link só vem depois do nome", () => {
    const s = iniciarSessao();
    const a = digitar(s, "Quero ser parceiro");
    expect(a.resultado.envio?.texto).toContain("programa de parceiros da Bex Print");
    expect(a.sessao.estado.ramo).toBe("parceiro");
    expect(a.sessao.estado.ramoMotivo).toBe("palavra");
    expect(a.resultado.envio?.texto).not.toMatch(/https?:/);
    const b = digitar(a.sessao, "Carlos Lima");
    expect(b.resultado.envio?.texto).toContain("https://exemplo.com.br/convite");
    expect(b.resultado.envio?.texto).toContain("Prazer, Carlos!");
    expect(b.resultado.estado.status).toBe("concluida");
    expect(b.resultado.avisarGrupo?.motivo).toBe("parceiro");
    // o ramo parceiro não pede CEP nem telefone
    expect(textosDoRobo(b.sessao).join(" ")).not.toMatch(/CEP|número/);
  });

  it.each([
    "parceria",
    "parceiro",
    "parceira",
    "terceirizado",
    "terceirizada",
    "sou terceirizada",
    "quero ser parceira",
  ])("%j abre o ramo parceiro", (fala) => {
    expect(digitar(iniciarSessao(), fala).sessao.estado.ramo).toBe("parceiro");
  });

  it.each([
    "meu parceiro indicou vocês",
    "parceria de marketing",
    "nota fiscal de parceiro",
    "sou revendedor",
    "quero ser revendedor",
    "tem desconto para revenda",
  ])("%j NÃO abre o ramo parceiro", (fala) => {
    const r = digitar(iniciarSessao(), fala).resultado;
    expect(r.estado.ramo).toBe("cliente");
    expect(r.envio?.texto ?? "").not.toMatch(/parceir|revend/i);
  });

  it("fora do horário o link vem com a frase de quando a equipe responde", () => {
    const s = iniciarSessao({ agora: SABADO_AS_20H });
    const r = digitar(digitar(s, "Quero ser parceiro").sessao, "Carlos Lima").resultado;
    expect(r.envio?.texto).toContain("A equipe responde a partir das 8h.");
  });

  it("lead de parceiro da Onda A abre o ramo parceiro; sem Onda A o ramo é cliente final", () => {
    const comOndaA = digitar(iniciarSessao({ ctx: { leadTipo: "parceiro" } }), "Olá, vi o anúncio")
      .sessao.estado;
    expect(comOndaA.ramo).toBe("parceiro");
    expect(comOndaA.ramoMotivo).toBe("anuncio_mapeado");
    for (const leadTipo of [null, undefined, "cliente" as const]) {
      const st = digitar(iniciarSessao({ ctx: { leadTipo } }), "Olá, vi o anúncio").sessao.estado;
      expect(st.ramo).toBe("cliente");
      expect(st.ramoMotivo).toBe("padrao");
    }
  });

  it("o ramo só sobe: depois do nome, palavra de parceiro não troca de ramo nem manda link, só avisa a equipe", () => {
    const s = conversa(iniciarSessao(), "oi", "Maria Souza");
    const r = digitar(s, "quero ser parceiro");
    expect(r.resultado.estado.ramo).toBe("cliente");
    expect(r.resultado.envio?.texto).toBe("Claro, já chamo a equipe para continuar com você.");
    expect(r.resultado.envio?.texto).not.toMatch(/parceir|https?:/);
    expect(r.resultado.estado.dados.pediuParceria).toBe(true);
    expect(r.resultado.avisarGrupo).toEqual({
      motivo: "pediu_parceria",
      marcas: expect.arrayContaining(["pediu_parceria"]),
    });
  });

  it("no passo do nome, a palavra de parceiro troca para o ramo parceiro e recomeça pelo nome", () => {
    const s = conversa(iniciarSessao(), "oi");
    const r = digitar(s, "sou terceirizado");
    expect(r.resultado.estado.ramo).toBe("parceiro");
    expect(r.resultado.envio?.codigos).toEqual(["parceiro_nome"]);
  });

  it("o motivo do ramo é a origem real: palavra escrita grava palavra, anúncio grava anuncio_mapeado", () => {
    const base = {
      ramoAtual: "cliente" as const,
      motivoAtual: "padrao" as const,
      leadTipo: "parceiro" as const,
      texto: "oi",
      passo: null,
      nomeJaInformado: false,
      quadro: SEMENTES_DO_QUADRO,
    };
    expect(escolherRamo({ ...base, leadOrigem: "palavra" })).toEqual({
      ramo: "parceiro",
      motivo: "palavra",
      subiu: true,
    });
    for (const leadOrigem of ["anuncio" as const, null, undefined]) {
      expect(escolherRamo({ ...base, leadOrigem })).toEqual({
        ramo: "parceiro",
        motivo: "anuncio_mapeado",
        subiu: true,
      });
    }
  });

  it("parceiro nunca desce para cliente final", () => {
    expect(
      escolherRamo({
        ramoAtual: "parceiro",
        motivoAtual: "palavra",
        leadTipo: "cliente",
        texto: "oi",
        passo: "parceiro_nome",
        nomeJaInformado: false,
        quadro: SEMENTES_DO_QUADRO,
      }),
    ).toEqual({
      ramo: "parceiro",
      motivo: "palavra",
      subiu: false,
    });
  });

  it("pergunta de valor no ramo parceiro: só a frase das condições depois do cadastro, sem número", () => {
    const s = digitar(iniciarSessao(), "Quero ser parceiro").sessao;
    const r = digitar(s, "quanto custa?").resultado;
    expect(r.envio?.codigos).toEqual(["parceiro_valor", "nome_curto"]);
    expect(r.envio?.texto).toContain(
      "As condições de parceiro ficam disponíveis depois do cadastro.",
    );
    expect(r.envio?.texto).not.toMatch(/\d/);
  });

  it("sem link configurado, o ramo parceiro entrega à equipe em vez de mandar vazio", () => {
    const s0 = iniciarSessao({
      ctx: { config: { ...contextoPadrao().config, linkParceiro: null } },
    });
    const r = digitar(digitar(s0, "Quero ser parceiro").sessao, "Carlos Lima").resultado;
    expect(r.estado.status).toBe("entregue_equipe");
    expect(r.envio?.texto).toBe("Claro, já chamo a equipe para continuar com você.");
  });

  it("texto de cliente final nunca recebe link_parceiro, nem por configuração errada", () => {
    const passos = PASSOS_SEMENTE.map((p) =>
      p.ramo === "cliente" && p.codigo === "primeira_vez"
        ? { ...p, texto: "Prazer, {{primeiro_nome}}! {{link_parceiro}}" }
        : p,
    );
    const s = conversa(iniciarSessao({ ctx: { passos } }), "oi", "Maria Souza");
    const r = ultimo(s);
    expect(r.acao).toBe("silencio");
    expect(r.estado.status).toBe("entregue_equipe");
    expect(r.eventos.find((e) => e.tipo === "texto_barrado")?.detalhe.regras).toEqual([
      "variavel_faltando:link_parceiro",
    ]);
  });
});

describe("textos barrados e textos ausentes", () => {
  it("texto montado com palavra proibida não sai, grava só códigos e avisa o grupo", () => {
    const passos = PASSOS_SEMENTE.map((p) =>
      p.ramo === "cliente" && p.codigo === "ack_preco"
        ? { ...p, texto: "O valor é R$ 50 com desconto de parceiro." }
        : p,
    );
    const s = conversa(iniciarSessao({ ctx: { passos } }), "oi", "quanto custa?");
    const r = ultimo(s);
    expect(r.acao).toBe("silencio");
    expect(r.estado.status).toBe("entregue_equipe");
    const e = r.eventos.find((x) => x.tipo === "texto_barrado");
    expect(e?.detalhe.codigos).toEqual(["ack_preco", "nome_curto"]);
    expect(e?.detalhe.regras).toEqual(expect.arrayContaining(["moeda", "desconto", "parceiro"]));
    expect(JSON.stringify(e)).not.toMatch(/R\$|desconto de parceiro/);
    expect(r.avisarGrupo?.motivo).toBe("texto_barrado");
  });

  it("texto que o dono desativou ou apagou não trava a conversa: entrega à equipe", () => {
    const passos = PASSOS_SEMENTE.filter((p) => !(p.ramo === "cliente" && p.codigo === "nome"));
    const r = digitar(iniciarSessao({ ctx: { passos } }), "oi").resultado;
    expect(r.estado.status).toBe("entregue_equipe");
    expect(r.acao).toBe("silencio");
  });
});

describe("limite de mensagens e das tentativas", () => {
  it("cada pergunta é feita no máximo duas vezes e depois segue com o que tem", () => {
    let s = conversa(iniciarSessao(), "oi", "Maria Souza");
    s = conversa(s, "hmm", "hmm");
    expect(s.estado.dados.primeiraVez).toBe("nao_sei");
    expect(s.estado.passo).toBe("cep");
    expect(textosDoRobo(s).filter((t) => /me diga assim: já sou cliente/.test(t))).toHaveLength(1);
  });

  it("duas etapas esgotadas em seguida encerram como entregue à equipe", () => {
    let s = conversa(iniciarSessao(), "oi", "Maria Souza");
    s = conversa(s, "hmm", "hmm"); // primeira_vez esgotada
    s = conversa(s, "hmm", "hmm"); // cep esgotada
    expect(s.estado.status).toBe("entregue_equipe");
    expect(s.estado.motivoFim).toBe("etapa_esgotada");
  });

  it("no teto de 8 a última mensagem é a de entrega e nada sai depois", () => {
    let s = iniciarSessao({ ctx: { config: { ...contextoPadrao().config, maxMensagens: 4 } } });
    const envios: string[] = [];
    for (let i = 0; i < 30; i++) {
      const r = digitar(s, i === 0 ? "oi" : `hmm ${i}`);
      s = r.sessao;
      if (r.resultado.envio) envios.push(r.resultado.envio.texto);
    }
    expect(envios.length).toBeLessThanOrEqual(4);
    expect(s.estado.mensagensEnviadas).toBeLessThanOrEqual(4);
    expect(s.estado.status).toBe("entregue_equipe");
  });

  it("mensagens automáticas de fora da triagem contam no teto", () => {
    const s = iniciarSessao({ ctx: { automaticasDeFora: 7 } });
    const r = digitar(s, "oi").resultado;
    expect(r.envio?.texto).toBe("Claro, já chamo a equipe para continuar com você.");
    expect(r.estado.status).toBe("entregue_equipe");
    const cheio = digitar(iniciarSessao({ ctx: { automaticasDeFora: 8 } }), "oi").resultado;
    expect(cheio.acao).toBe("silencio");
    expect(cheio.estado.mensagensEnviadas).toBe(0);
    expect(cheio.avisarGrupo?.motivo).toBe("limite_mensagens");
  });
});

describe("estado imutável e versão", () => {
  it("não muda o estado recebido e sobe a versão a cada rodada", () => {
    const s = iniciarSessao();
    const antes = JSON.stringify(s.estado);
    const r = proximoPasso(
      s.estado,
      { id: "m1", tipo: "texto", texto: "oi", recebidaEm: s.agora },
      s.agora,
      s.ctx,
    );
    expect(JSON.stringify(s.estado)).toBe(antes);
    expect(r.estado.versao).toBe(s.estado.versao + 1);
    expect(r.estado).not.toBe(s.estado);
  });

  it("aceita Date como relógio", () => {
    const s = iniciarSessao();
    const r = proximoPasso(
      s.estado,
      { id: "m1", tipo: "texto", texto: "oi", recebidaEm: s.agora },
      new Date(s.agora),
      s.ctx,
    );
    expect(r.estado.ultimoEnvioEm).toBe(s.agora);
  });

  it("modo ensaio decide igual e mantém o status de ensaio", () => {
    const s = iniciarSessao({ modo: "ensaio" });
    const r = digitar(s, "oi");
    expect(r.resultado.estado.status).toBe("ensaio");
    expect(r.resultado.estado.passo).toBe("nome");
  });
});

describe("triagem encerrada", () => {
  it.each([
    "concluida",
    "entregue_equipe",
    "parada_pelo_contato",
    "pausada_humano",
    "pausada_desligada",
    "pulada",
  ] as const)("%s: silêncio para sempre", (status) => {
    const s = iniciarSessao();
    const r = proximoPasso(
      { ...s.estado, status, passo: "cep" },
      { id: "x", tipo: "texto", texto: "oi, sim, 68900-000", recebidaEm: s.agora },
      s.agora,
      s.ctx,
    );
    expect(r.acao).toBe("silencio");
    expect(r.envio).toBeNull();
  });
});

describe("o texto montado passa pelo verificador do ramo", () => {
  it("todo envio do roteiro feliz passa no verificador do cliente", () => {
    const s = conversa(
      iniciarSessao({ agora: SABADO_AS_20H }),
      "oi",
      "dona Maria Souza",
      "primeira vez",
      "68900-000",
      "sim",
    );
    for (const t of textosDoRobo(s)) expect(verificarTexto(t, "cliente").problemas).toEqual([]);
  });
});

describe("B2: parceiro negado, gíria e pedido misto", () => {
  const ramoDe = (...falas: string[]) => conversa(iniciarSessao(), ...falas).estado.ramo;
  const dito = (...falas: string[]) => textosDoRobo(conversa(iniciarSessao(), ...falas)).join(" ");

  it.each([
    ["nao sou parceiro, sou cliente"],
    ["ainda nao sou parceiro"],
    ["não quero ser parceiro"],
    ["sou parceiro de obra do João"],
  ])("%j não abre o ramo parceiro nem diz a palavra ao cliente final", (frase) => {
    expect(ramoDe("oi", frase)).toBe("cliente");
    expect(dito("oi", frase)).not.toMatch(/parceir/i);
  });

  it.each([
    ["bom dia parceiro"],
    ["oi parceiro"],
    ["Opa parceira"],
    ["boa tarde parceria"],
    ["e aí parceiro"],
    ["Boa tarde, parceiro!"],
  ])("vocativo %j fica no ramo cliente", (frase) => {
    expect(ramoDe(frase)).toBe("cliente");
    expect(dito(frase, "Maria Souza")).not.toMatch(/parceir|convite/i);
  });

  it("a palavra do dono como mensagem inteira continua abrindo o ramo parceiro", () => {
    expect(ramoDe("oi", "parceiro")).toBe("parceiro");
    expect(ramoDe("oi", "quero ser parceiro")).toBe("parceiro");
  });

  it("'quero ser parceiro e saber o valor da lona' vai para a equipe com o preço marcado", () => {
    const r = digitar(iniciarSessao(), "oi");
    const x = digitar(r.sessao, "quero ser parceiro e saber o valor da lona");
    expect(x.resultado.estado.status).toBe("entregue_equipe");
    expect(x.resultado.estado.dados.pediuParceria).toBe(true);
    expect(x.resultado.estado.dados.pediuPreco).toBe(true);
  });
});

describe("B2: CEP no passo do telefone com DDD padrão", () => {
  it("CEP digitado no passo do telefone não vira telefone alternativo", () => {
    const base = iniciarSessao({
      ctx: { config: { ...CONFIG_PADRAO_DA_TRIAGEM, dddPadrao: "96" } },
    });
    const s = conversa(base, "oi", "Joao Pedro", "primeira vez", "pular", "68900-000");
    expect(s.estado.dados.telefoneAlternativo).toBeNull();
    expect(s.estado.status).not.toBe("concluida");
    expect(s.estado.passo).toBe("telefone");
  });
});
