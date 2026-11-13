import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  avisoDeConfirmacao,
  DEGRAUS,
  degrausParaDescer,
  EXPLICACAO_DO_DEGRAU,
  mandaMensagemDeVerdade,
  podeSubir,
  proximoDegrau,
  ROTULO_DO_DEGRAU,
  textoDoBotaoDeSubir,
  type Degrau,
} from "../../src/domain/whatsapp/triagem/escada";
import {
  digitar,
  digitarComoRobo,
  digitarEmRajada,
  textosDoRobo,
  verificarTexto,
  PASSOS_SEMENTE,
  SEMENTES_DO_QUADRO,
  HORARIO_SEMENTE,
} from "../../src/domain/whatsapp/triagem";
import {
  contextoDaSimulacao,
  dataEmIso,
  dataEmTexto,
  digitosDoNumero,
  diaEmBelem,
  explicarProblemaDeTexto,
  fraseJaExisteComOutraIntencao,
  motivoDeDesligar,
  novaSimulacao,
  numeroDeTesteValido,
  numeroEmTexto,
  OPCOES_PADRAO_DO_SIMULADOR,
  problemasExplicados,
  rotuloDoPasso,
  testarFrase,
  visualizarTexto,
  type DadosDoSimulador,
} from "../../src/domain/whatsapp/triagem/tela";
import { validarTextoEditavel } from "../../src/domain/whatsapp/triagem/textos";
import { buttonVariants } from "../../src/components/ui/button";
import { cn } from "../../src/lib/utils";
import {
  LINHAS_POR_PAGINA,
  lerTodasAsLinhas,
} from "../../src/domain/whatsapp/triagem/paginar";

/**
 * A tela de configuração (PR B6), no que é lógica: a escada, as frases em
 * português simples, o campo de teste do quadro e o simulador, que roda o motor
 * puro e NÃO envia nada.
 */

describe("a escada: sobe um degrau por vez, desce sempre", () => {
  it("são cinco degraus, na ordem do plano", () => {
    expect(DEGRAUS).toEqual(["desligada", "ensaio", "teste", "parcial", "ligada"]);
  });

  it("próximo degrau: cada um sobe só para o seguinte, e o último não sobe", () => {
    expect(DEGRAUS.map((d) => proximoDegrau(d))).toEqual([
      "ensaio",
      "teste",
      "parcial",
      "ligada",
      null,
    ]);
  });

  it("descer nunca oferece 'desligada': desligar de vez é o botão vermelho, que também para as conversas abertas", () => {
    expect(degrausParaDescer("ligada")).toEqual(["ensaio", "teste", "parcial"]);
    expect(degrausParaDescer("parcial")).toEqual(["ensaio", "teste"]);
    expect(degrausParaDescer("teste")).toEqual(["ensaio"]);
    expect(degrausParaDescer("ensaio")).toEqual([]);
    expect(degrausParaDescer("desligada")).toEqual([]);
  });

  const situacao = (atual: Degrau, extra: Partial<Parameters<typeof podeSubir>[0]> = {}) => ({
    atual,
    percentual: 10,
    numerosDeTeste: ["96991112233"],
    linkDeParceiro: "https://exemplo.com.br/cadastro",
    ...extra,
  });

  it("de desligada para ensaio sobe sem nada na mão: o ensaio não manda mensagem", () => {
    expect(
      podeSubir(situacao("desligada", { numerosDeTeste: [], percentual: 0, linkDeParceiro: null })),
    ).toEqual({
      pode: true,
      para: "ensaio",
      avisos: [],
    });
  });

  it("para teste exige pelo menos um número de teste", () => {
    const r = podeSubir(situacao("ensaio", { numerosDeTeste: [] }));
    expect(r.pode).toBe(false);
    expect(!r.pode && r.motivo).toMatch(/número de teste/);
    expect(podeSubir(situacao("ensaio")).pode).toBe(true);
  });

  it("para parcial exige porcentagem acima de zero", () => {
    const r = podeSubir(situacao("teste", { percentual: 0 }));
    expect(r.pode).toBe(false);
    expect(podeSubir(situacao("teste", { percentual: 10 })).pode).toBe(true);
  });

  it("sem link de parceiro, avisa nos degraus que mandam mensagem de verdade, mas deixa subir", () => {
    const r = podeSubir(situacao("ensaio", { linkDeParceiro: null }));
    expect(r.pode).toBe(true);
    expect(r.pode && r.avisos.join(" ")).toMatch(/link de cadastro de parceiro/);
  });

  it("no último degrau não há para onde subir", () => {
    expect(podeSubir(situacao("ligada"))).toMatchObject({ pode: false, para: null });
  });

  it("só teste, parcial e ligada mandam mensagem de verdade, e todos pedem confirmação", () => {
    expect(DEGRAUS.filter(mandaMensagemDeVerdade)).toEqual(["teste", "parcial", "ligada"]);
    expect(avisoDeConfirmacao("desligada", 0)).toBeNull();
    expect(avisoDeConfirmacao("ensaio", 0)).toBeNull();
    for (const d of ["teste", "parcial", "ligada"] as const)
      expect(avisoDeConfirmacao(d, 25)).toMatch(/responder de verdade/);
    expect(avisoDeConfirmacao("parcial", 25)).toMatch(/25 de cada 100/);
  });

  it("o botão grande diz para onde vai", () => {
    expect(textoDoBotaoDeSubir("desligada")).toBe("Subir para ensaio");
    expect(textoDoBotaoDeSubir("parcial")).toBe("Subir para ligada");
    expect(textoDoBotaoDeSubir("ligada")).toBe("Já está no último degrau");
  });
});

describe("estilo do dono nos textos da escada e da tela", () => {
  const sem = /[—–―‒−→←⇒⇐➔()]|->|=>/;
  it("nenhum texto do domínio da tela tem travessão, seta ou parênteses", () => {
    const textos: string[] = [
      ...Object.values(ROTULO_DO_DEGRAU),
      ...Object.values(EXPLICACAO_DO_DEGRAU),
      avisoDeConfirmacao("teste", 10) ?? "",
      avisoDeConfirmacao("parcial", 10) ?? "",
      avisoDeConfirmacao("ligada", 10) ?? "",
      ...DEGRAUS.map(textoDoBotaoDeSubir),
      ...[
        "botao_desligar_tudo",
        "freio_falhas_de_envio",
        "freio_erros_de_leitura",
        "freio_textos_barrados",
        "outro",
        null,
      ].map(motivoDeDesligar),
      ...PASSOS_SEMENTE.map((p) => rotuloDoPasso(p.codigo)),
    ];
    const podeSubirTextos = DEGRAUS.flatMap((d) => {
      const r = podeSubir({ atual: d, percentual: 0, numerosDeTeste: [], linkDeParceiro: null });
      return r.pode ? r.avisos : [r.motivo];
    });
    for (const t of [...textos, ...podeSubirTextos]) expect(t, t).not.toMatch(sem);
  });

  it("toda recusa explicada fala com palavras simples e sem os símbolos proibidos", () => {
    const regras = [
      "vazio",
      "acima_de_600_caracteres",
      "variavel_nao_permitida",
      "variavel_sem_preencher",
      "moeda",
      "valor_em_reais",
      "valor_com_centavos",
      "valor_depois_de_valor",
      "porcentagem",
      "desconto",
      "pix",
      "boleto",
      "parcelamento",
      "juros",
      "nota_fiscal",
      "prazo_em_numero",
      "parceiro",
      "terceirizado",
      "revendedor",
      "tabela",
      "preco_diferenciado",
      "travessao",
      "seta",
      "parenteses",
      "regra_que_nao_existe",
    ];
    for (const regra of regras) {
      const t = explicarProblemaDeTexto({ regra, detalhe: "" });
      expect(t.length, regra).toBeGreaterThan(10);
      expect(t, regra).not.toMatch(sem);
      expect(t[0], regra).toBe(t[0].toUpperCase());
    }
  });
});

describe("recusa visível quando o texto tem termo proibido", () => {
  const casos: [string, "cliente" | "parceiro", string][] = [
    ["O banner custa R$ 50", "cliente", "moeda"],
    ["Damos 10% de desconto", "cliente", "desconto"],
    ["Pagamento no pix", "cliente", "pix"],
    ["Entrega em 5 dias", "cliente", "prazo"],
    ["Seja nosso parceiro", "cliente", "parceiro"],
    ["Veja a tabela completa", "cliente", "tabela"],
    ["Olá {{link_parceiro}}", "cliente", "campo"],
    ["Olá — tudo bem?", "cliente", "travessão"],
    ["Olá (tudo bem)", "parceiro", "parênteses"],
    ["Prazo de 3 dias", "parceiro", "prazo"],
  ];
  it.each(casos)("%s no ramo %s é recusado", (texto, ramo) => {
    expect(validarTextoEditavel(texto, ramo).length).toBeGreaterThan(0);
    expect(problemasExplicados(texto, ramo).length).toBeGreaterThan(0);
  });

  it("os textos semente passam, para os dois ramos", () => {
    for (const p of PASSOS_SEMENTE) {
      for (const t of [p.texto, ...(p.variantes ?? []), ...(p.repeticao ? [p.repeticao] : [])]) {
        expect(problemasExplicados(t, p.ramo), `${p.ramo}/${p.codigo}`).toEqual([]);
      }
    }
  });

  it("a visualização preenche com dados de exemplo e passa no verificador do ramo", () => {
    for (const p of PASSOS_SEMENTE) {
      const v = visualizarTexto(p.texto, p.ramo);
      expect(v.texto).not.toMatch(/\{\{/);
      expect(v.problemas).toEqual([]);
      expect(verificarTexto(v.texto, p.ramo).problemas).toEqual([]);
    }
  });
});

describe("o campo de teste do quadro", () => {
  const quadro = SEMENTES_DO_QUADRO;
  it("mostra a intenção que o sistema entende", () => {
    expect(testarFrase("sim", "telefone", quadro).intencao).toBe("sim");
    expect(testarFrase("quero falar com uma pessoa", null, quadro).intencao).toBe(
      "falar_com_equipe",
    );
    expect(testarFrase("quanto custa?", null, quadro).intencao).toBe("pergunta_preco");
    expect(testarFrase("não quero mais mensagens", null, quadro).rotulo).toBe(
      "Quer parar de receber",
    );
  });
  it("frase que o quadro não conhece vira 'não entendi'", () => {
    const r = testarFrase("blablabla xyz", null, quadro);
    expect(r).toMatchObject({ intencao: "nao_sei", rotulo: "Não entendi" });
  });
  it("frase vazia ou só espaço não entende nada", () => {
    expect(testarFrase("   ", null, quadro).intencao).toBe("nao_sei");
  });
});

describe("números de teste, datas e dias", () => {
  it("aceita celular brasileiro com e sem 55 e formata", () => {
    expect(numeroDeTesteValido("96 99111-2233")).toBe(true);
    expect(numeroDeTesteValido("+55 96 99111-2233")).toBe(true);
    expect(numeroDeTesteValido("5596991112233")).toBe(true);
    expect(numeroDeTesteValido("9111-2233")).toBe(false);
    expect(numeroDeTesteValido("123")).toBe(false);
    expect(numeroDeTesteValido("")).toBe(false);
    expect(numeroEmTexto("96991112233")).toBe("96 99111-2233");
    expect(numeroEmTexto("5596991112233")).toBe("96 99111-2233");
    expect(digitosDoNumero("(96) 99111-2233")).toBe("96991112233");
  });
  it("datas: dia/mês/ano para ISO e de volta, sem Date em UTC", () => {
    expect(dataEmIso("25/12/2026")).toBe("2026-12-25");
    expect(dataEmIso("1/1/2027")).toBe("2027-01-01");
    expect(dataEmIso("31/02/2026")).toBeNull();
    expect(dataEmIso("2026-12-25")).toBeNull();
    expect(dataEmTexto("2026-12-25")).toBe("25/12/2026");
    expect(dataEmTexto("2026-12-25T01:00:00+00:00")).toBe("25/12/2026");
  });
  it("o dia de um instante vale no fuso de Belém", () => {
    expect(diaEmBelem("2026-11-14T01:30:00Z")).toBe("13/11/2026");
    expect(diaEmBelem("2026-11-14T04:00:00Z")).toBe("14/11/2026");
    expect(diaEmBelem("lixo")).toBe("");
  });
});

describe("o simulador roda o motor puro e não envia nada", () => {
  afterEach(() => vi.unstubAllGlobals());

  const dados: DadosDoSimulador = {
    passos: PASSOS_SEMENTE.map((p) => ({
      codigo: p.codigo,
      ramo: p.ramo,
      texto: p.texto,
      variantes: p.variantes ?? [],
      repeticao: p.repeticao ?? null,
      ativo: true,
    })),
    respostas: SEMENTES_DO_QUADRO.map((r) => ({
      passo: r.passo,
      intencao: r.intencao,
      frase: r.frase,
      casamento: r.casamento,
      ativo: true,
    })),
    horarios: (HORARIO_SEMENTE.semana ?? []).map((h) => ({
      dia_semana: h.diaSemana,
      abre: h.abre,
      fecha: h.fecha,
      ativo: h.ativo,
    })),
    feriados: [],
    config: {
      max_mensagens: 8,
      max_tentativas_por_passo: 2,
      intervalo_minimo_s: 20,
      atraso_min_s: 3,
      atraso_max_s: 8,
      espera_resposta_min: 30,
      retomar_ate_horas: 24,
      link_parceiro: "https://exemplo.com.br/cadastro",
    },
  };

  it("uma conversa inteira acontece sem rede, sem banco e sem tela falando com servidor", () => {
    const fetchEspiao = vi.fn();
    vi.stubGlobal("fetch", fetchEspiao);
    let s = novaSimulacao(dados, OPCOES_PADRAO_DO_SIMULADOR);
    for (const t of ["Oi", "Maria Souza", "primeira vez", "pular", "sim"]) s = digitar(s, t).sessao;
    expect(s.estado.status).toBe("concluida");
    expect(textosDoRobo(s).length).toBe(5);
    for (const t of textosDoRobo(s)) expect(verificarTexto(t, "cliente").problemas).toEqual([]);
    expect(fetchEspiao).not.toHaveBeenCalled();
  });

  it("usa o texto salvo na tela: mudou o texto, o robô fala o texto novo", () => {
    const novo = {
      ...dados,
      passos: dados.passos.map((p) =>
        p.codigo === "nome" && p.ramo === "cliente"
          ? { ...p, texto: "Bem-vindo! Qual é o seu nome completo?", variantes: [] as string[] }
          : p,
      ),
    };
    const s = digitar(novaSimulacao(novo, OPCOES_PADRAO_DO_SIMULADOR), "Oi").sessao;
    expect(textosDoRobo(s)[0]).toBe("Bem-vindo! Qual é o seu nome completo?");
  });

  it("fora do horário, a despedida diz a hora em que a loja abre", () => {
    let s = novaSimulacao(dados, { ...OPCOES_PADRAO_DO_SIMULADOR, horario: "fora" });
    for (const t of ["Oi", "Maria Souza", "já sou cliente", "sim"]) s = digitar(s, t).sessao;
    expect(textosDoRobo(s).pop()).toMatch(/fora do atendimento presencial/);
    let d = novaSimulacao(dados, OPCOES_PADRAO_DO_SIMULADOR);
    for (const t of ["Oi", "Maria Souza", "já sou cliente", "sim"]) d = digitar(d, t).sessao;
    expect(textosDoRobo(d).pop()).toMatch(/Já avisei a equipe/);
  });

  it("anúncio de parceiro leva ao ramo parceiro, só ali aparece o link", () => {
    let s = novaSimulacao(dados, { ...OPCOES_PADRAO_DO_SIMULADOR, anuncioDeParceiro: true });
    for (const t of ["Oi", "Carlos Lima"]) s = digitar(s, t).sessao;
    expect(s.estado.ramo).toBe("parceiro");
    expect(textosDoRobo(s).join(" ")).toContain("https://exemplo.com.br/cadastro");
    let c = novaSimulacao(dados, OPCOES_PADRAO_DO_SIMULADOR);
    for (const t of ["Oi", "Carlos Lima", "primeira vez"]) c = digitar(c, t).sessao;
    expect(c.estado.ramo).toBe("cliente");
    expect(textosDoRobo(c).join(" ")).not.toMatch(/https?:|parceir/i);
  });

  it("número do chat estranho: o motor puro pede o número direto, sem mostrar o identificador", () => {
    let s = novaSimulacao(dados, { ...OPCOES_PADRAO_DO_SIMULADOR, numeroDoChatEstranho: true });
    for (const t of ["Oi", "Maria Souza", "já sou cliente"]) s = digitar(s, t).sessao;
    expect(textosDoRobo(s).join(" ")).not.toMatch(/253386|terminado em/);
  });

  it("a tela mostra o que o robô de verdade faz com número estranho: não escreve e entrega à equipe", () => {
    let s = novaSimulacao(dados, { ...OPCOES_PADRAO_DO_SIMULADOR, numeroDoChatEstranho: true });
    for (const t of ["Oi", "Maria Souza"]) s = digitarComoRobo(s, t).sessao;
    expect(textosDoRobo(s)).toEqual([]);
    expect(s.estado.status).toBe("entregue_equipe");
    expect(s.resultados[0].avisarGrupo).toEqual({
      motivo: "entregue_equipe",
      marcas: ["sem_numero_valido"],
    });
    expect(s.resultados[1].avisarGrupo).toBeNull();
    // celular comum: a tela segue o motor normalmente
    let c = novaSimulacao(dados, OPCOES_PADRAO_DO_SIMULADOR);
    c = digitarComoRobo(c, "Oi").sessao;
    expect(textosDoRobo(c)).toHaveLength(1);
  });

  it("link de parceiro vazio: o simulador entrega à equipe e não mostra link de exemplo", () => {
    const semLink = { ...dados, config: { ...dados.config, link_parceiro: null } };
    let s = novaSimulacao(semLink, { ...OPCOES_PADRAO_DO_SIMULADOR, anuncioDeParceiro: true });
    for (const t of ["Oi", "Carlos Lima"]) s = digitar(s, t).sessao;
    expect(s.estado.ramo).toBe("parceiro");
    expect(s.estado.status).toBe("entregue_equipe");
    expect(s.estado.motivoFim).toBe("sem_link_de_parceiro");
    expect(textosDoRobo(s).join(" ")).not.toMatch(/https?:|exemplo\.com/);
    expect(contextoDaSimulacao(semLink, OPCOES_PADRAO_DO_SIMULADOR).config.linkParceiro).toBeNull();
    const vazioComEspaco = { ...dados, config: { ...dados.config, link_parceiro: "   " } };
    expect(
      contextoDaSimulacao(vazioComEspaco, OPCOES_PADRAO_DO_SIMULADOR).config.linkParceiro,
    ).toBeNull();
    expect(
      contextoDaSimulacao(dados, OPCOES_PADRAO_DO_SIMULADOR).config.linkParceiro,
    ).toBe("https://exemplo.com.br/cadastro");
  });

  it("áudio, figurinha e rajada passam pelo mesmo motor", () => {
    let s = novaSimulacao(dados, OPCOES_PADRAO_DO_SIMULADOR);
    s = digitar(s, null, { tipo: "audio" }).sessao;
    expect(textosDoRobo(s)[0]).toMatch(/áudio/);
    const r = digitarEmRajada(novaSimulacao(dados, OPCOES_PADRAO_DO_SIMULADOR), [
      "Oi",
      "Maria",
      "Souza",
    ]);
    expect(r.sessao.estado.dados.nomeInformado).toBe("Maria Souza");
  });

  it("o contexto da simulação ignora frase desativada e intenção desconhecida", () => {
    const ctx = contextoDaSimulacao(
      {
        ...dados,
        respostas: [
          { passo: null, intencao: "sim", frase: "claro", casamento: "igual", ativo: false },
          { passo: null, intencao: "nao_sei", frase: "x", casamento: "igual", ativo: true },
          { passo: null, intencao: "nao", frase: "nunca", casamento: "igual", ativo: true },
        ],
      },
      OPCOES_PADRAO_DO_SIMULADOR,
    );
    expect(ctx.quadro).toEqual([
      { passo: null, intencao: "nao", frase: "nunca", casamento: "igual" },
    ]);
  });

  it("os arquivos do simulador não têm caminho para o servidor, o banco ou o WhatsApp", () => {
    const arquivos = [
      "src/components/triagem/simulador.tsx",
      "src/domain/whatsapp/triagem/simular.ts",
      "src/domain/whatsapp/triagem/tela.ts",
    ];
    for (const a of arquivos) {
      // comentários e `import type` (apagado na compilação) ficam de fora: só conta o que roda
      const src = readFileSync(a, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "")
        .replace(/^import type [^;]*;$/gm, "");
      expect(src, a).not.toMatch(
        /createServerFn|useServerFn|supabase|\bfetch\s*\(|\.rpc\s*\(|whatsapp-triagem\.(server|functions)|whatsapp-enviar/,
      );
    }
  });
});

describe("a tela é legível: letra de 16 px, alvo de 44 px, sem símbolo proibido", () => {
  const arquivos = [
    ...readdirSync("src/components/triagem").map((n) => join("src/components/triagem", n)),
    "src/routes/_authenticated/configuracoes-triagem.tsx",
  ];

  it("encontra os arquivos da tela", () => {
    expect(arquivos.length).toBeGreaterThanOrEqual(7);
  });

  it("nenhuma classe de letra menor que 16 px", () => {
    for (const a of arquivos) {
      const src = readFileSync(a, "utf8");
      expect(src, a).not.toMatch(
        /\btext-(xs|sm)\b|text-\[(1[0-5]|[0-9])px\]|text-\[0\.[0-9]+rem\]/,
      );
    }
  });

  it("todo botão e campo da tela usa a altura de 44 px ou a constante que a tem", () => {
    for (const a of arquivos.filter((x) => x.endsWith(".tsx") && !x.endsWith("comum.tsx"))) {
      const src = readFileSync(a, "utf8");
      const botoes = [...src.matchAll(/<Button\b[^>]*>/g)].map((m) => m[0]);
      for (const b of botoes) {
        expect(
          /className=\{?[^>]*(BOTAO|min-h-1[1-9]|min-h-14)/.test(b) ||
            /\bclassName=\{cn\([^)]*(BOTAO|min-h-14)/.test(b),
          `${a}: ${b}`,
        ).toBe(true);
      }
    }
  });

  it("nenhum travessão ou seta em texto de tela", () => {
    for (const a of arquivos) {
      const linhas = readFileSync(a, "utf8")
        .split("\n")
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l) && !/title:|<title>/.test(l));
      for (const l of linhas) expect(l, `${a}: ${l}`).not.toMatch(/[—–―→←⇒]/);
    }
  });

  it("não escreve a palavra do mercado que o dono não usa", () => {
    for (const a of arquivos) {
      const sem = readFileSync(a, "utf8")
        .split("\n")
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join("\n");
      expect(sem, a).not.toMatch(/revend/i);
    }
  });
});

describe("a tela está registrada como as outras de Configurações", () => {
  it("permissão, menu e dica", () => {
    expect(readFileSync("src/lib/permissions.ts", "utf8")).toMatch(
      /path: "\/configuracoes-triagem", permissions: \["configuracoes\.manage", "whatsapp\.manage"\]/,
    );
    expect(readFileSync("src/lib/menu.ts", "utf8")).toMatch(
      /"\/configuracoes-triagem": \{\s*titulo: "Robô de boas-vindas"/,
    );
    expect(readFileSync("src/lib/dicas.ts", "utf8")).toMatch(
      /"\/configuracoes-triagem": \{\s*menu:/,
    );
    const arvore = readFileSync("src/routeTree.gen.ts", "utf8");
    expect(arvore).toMatch(/'\/_authenticated\/configuracoes-triagem': \{/);
    expect(arvore).toMatch(
      /AuthenticatedConfiguracoesTriagemRoute: AuthenticatedConfiguracoesTriagemRoute|AuthenticatedConfiguracoesTriagemRoute:\s+AuthenticatedConfiguracoesTriagemRoute,/,
    );
  });

  it("a permissão da rota vem antes de /configuracoes, que casa por prefixo", () => {
    const src = readFileSync("src/lib/permissions.ts", "utf8");
    expect(src.indexOf('"/configuracoes-triagem"')).toBeGreaterThan(0);
    expect(src.indexOf('"/configuracoes-triagem"')).toBeLessThan(
      src.indexOf('{ path: "/configuracoes", permissions: [] }'),
    );
  });
});

describe("salvar uma frase que já existe com outra intenção", () => {
  const respostas = [
    { passo: null, intencao: "sim", frase: "claro", casamento: "igual", ativo: true },
    { passo: "cep", intencao: "pular", frase: "nao tenho", casamento: "igual", ativo: false },
  ];
  it("acha a frase igual no mesmo lugar e jeito de comparar, ignorando acento e maiúscula", () => {
    const r = fraseJaExisteComOutraIntencao(respostas, {
      passo: null,
      intencao: "nao",
      frase: "Cláro!",
      casamento: "igual",
    });
    expect(r?.intencao).toBe("sim");
    expect(
      fraseJaExisteComOutraIntencao(respostas, {
        passo: "cep",
        intencao: "nao",
        frase: "não tenho",
        casamento: "igual",
      })?.intencao,
    ).toBe("pular");
  });
  it("não avisa quando a intenção é a mesma, o lugar é outro ou o jeito de comparar é outro", () => {
    const base = { passo: null, intencao: "sim", frase: "claro", casamento: "igual" };
    expect(fraseJaExisteComOutraIntencao(respostas, base)).toBeNull();
    expect(fraseJaExisteComOutraIntencao(respostas, { ...base, intencao: "nao", passo: "cep" })).toBeNull();
    expect(
      fraseJaExisteComOutraIntencao(respostas, { ...base, intencao: "nao", casamento: "contem" }),
    ).toBeNull();
    expect(fraseJaExisteComOutraIntencao(respostas, { ...base, intencao: "nao", frase: "  " })).toBeNull();
  });
});

describe("ler todas as linhas, página por página, sem o corte de mil do PostgREST", () => {
  const linhas = Array.from({ length: 2345 }, (_, i) => ({ n: i }));
  const paginaDe = (todas: { n: number }[]) => async (de: number, ate: number) => ({
    data: todas.slice(de, Math.min(ate, de + LINHAS_POR_PAGINA - 1) + 1),
    error: null,
  });

  it("lê as 2.345 linhas em 3 páginas e na ordem", async () => {
    const chamadas: [number, number][] = [];
    const r = await lerTodasAsLinhas(async (de, ate) => {
      chamadas.push([de, ate]);
      return paginaDe(linhas)(de, ate);
    });
    expect(r).toHaveLength(2345);
    expect(r[0].n).toBe(0);
    expect(r[2344].n).toBe(2344);
    expect(chamadas).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("exatamente mil linhas pede uma segunda página vazia e para", async () => {
    const mil = linhas.slice(0, 1000);
    const chamadas: number[] = [];
    const r = await lerTodasAsLinhas(async (de, ate) => {
      chamadas.push(de);
      return paginaDe(mil)(de, ate);
    });
    expect(r).toHaveLength(1000);
    expect(chamadas).toEqual([0, 1000]);
  });

  it("lista vazia, e erro em qualquer página lança em vez de devolver lista curta", async () => {
    expect(await lerTodasAsLinhas(paginaDe([]))).toEqual([]);
    await expect(
      lerTodasAsLinhas(async (de, ate) =>
        de === 0
          ? paginaDe(linhas)(de, ate)
          : { data: null, error: { message: "banco fora" } },
      ),
    ).rejects.toThrow("banco fora");
  });

  it("o painel e as triagens do servidor usam o leitor paginado, sem limit solto", () => {
    const src = readFileSync("src/lib/api/whatsapp-triagem.functions.ts", "utf8");
    expect(src).not.toMatch(/\.limit\(2000\)/);
    expect(src.match(/lerTodasAsLinhas</g)?.length).toBeGreaterThanOrEqual(2);
    expect(src).toMatch(/\.range\(de, ate\)/);
  });
});

describe("mensagens para o dono sem nome de permissão em código", () => {
  it("nenhum texto de tela nem mensagem do servidor traz whatsapp.manage ou configuracoes.manage", () => {
    const arquivos = [
      ...readdirSync("src/components/triagem").map((n) => join("src/components/triagem", n)),
      "src/routes/_authenticated/configuracoes-triagem.tsx",
      "src/lib/api/whatsapp-triagem.functions.ts",
      "src/domain/whatsapp/triagem/tela.ts",
    ];
    for (const a of arquivos) {
      const src = readFileSync(a, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      // as chaves de permissão aparecem só como argumento de função (entre aspas, sem frase em volta)
      for (const linha of src.split("\n")) {
        if (/["'`]\s*(whatsapp|configuracoes)\.manage\s*["'`]/.test(linha)) continue;
        expect(linha, `${a}: ${linha}`).not.toMatch(/(whatsapp|configuracoes)\.manage/);
      }
    }
  });
});

describe("os diálogos de confirmação da tela são legíveis, sem mudar os outros usos", () => {
  it("toda confirmação da tela do robô pede o tamanho grande", () => {
    for (const n of readdirSync("src/components/triagem")) {
      const src = readFileSync(join("src/components/triagem", n), "utf8");
      const usos = src.match(/<ConfirmarAcao\b/g)?.length ?? 0;
      const grandes = src.match(/<ConfirmarAcao\b[^>]*\bgrande\b/gs)?.length ?? 0;
      expect(grandes, n).toBe(usos);
    }
  });

  it("no tamanho grande os botões do diálogo têm 44 px e 16 px de letra; sem ele ficam como sempre", () => {
    const grande = "h-11 min-h-11 text-base";
    const voltar = cn(buttonVariants({ variant: "outline" }), "mt-2 sm:mt-0", grande);
    const confirmar = cn(buttonVariants(), cn(buttonVariants({ variant: "destructive" }), grande));
    for (const c of [voltar, confirmar]) {
      expect(c).toMatch(/\bh-11\b/);
      expect(c).toMatch(/\bmin-h-11\b/);
      expect(c).toMatch(/\btext-base\b/);
      expect(c).not.toMatch(/\bh-9\b|\btext-sm\b/);
    }
    const src = readFileSync("src/components/bex/ConfirmarAcao.tsx", "utf8");
    expect(src).toMatch(/grande = false/);
    expect(src).toContain(grande);
    expect(src).toMatch(/grande && "text-base text-foreground"/);
  });

  it("o cabeçalho legível é opcional e a rota do robô não usa o ícone de dica de 20 px", () => {
    const cab = readFileSync("src/components/bex/SectionHeader.tsx", "utf8");
    expect(cab).toMatch(/legivel = false/);
    expect(cab).toMatch(/legivel \? "text-base" : "text-sm"/);
    const rota = readFileSync("src/routes/_authenticated/configuracoes-triagem.tsx", "utf8");
    expect(rota).toMatch(/<SectionHeader\s+legivel\b/);
    expect(rota).not.toMatch(/ajuda=\{/);
    expect(rota).toMatch(/dicaTela\("\/configuracoes-triagem"\)/);
  });
});
