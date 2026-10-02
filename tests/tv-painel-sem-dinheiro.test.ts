import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { legendaDeMaquinas } from "../src/domain/producao/identidade-da-maquina";

/**
 * A PAREDE NÃO MOSTRA A CONTA DE NINGUÉM.
 *
 * A TV da Oficina fica virada para o balcão, onde o cliente enxerga. Tudo o
 * que ela mostra vem de UMA função do banco, `tv_painel_maquinas()`, e a regra
 * é dura: nenhum custo, preço, margem, valor ou pagamento; nenhum nome ou logo
 * de cliente; nenhum texto digitado (título da OS, descrição do item,
 * observações, briefing, endereço). O único texto que vem de tabela é o nome do
 * produto do catálogo.
 *
 * O risco não é alguém escrever `valor_total` de propósito. É o atalho: um
 * `select *`, um `to_jsonb(linha)` ou "só mais uma coluna" numa manutenção
 * futura — e as views por onde a função lê (`ordens_servico_operacional`,
 * `itens_os_operacional`) TÊM `cliente_nome`, `briefing`, `observacoes`,
 * `titulo` e `descricao`. Ler pela view protege de dinheiro, não de
 * privacidade.
 *
 * Este teste lê a MIGRAÇÃO (o retrato do que está vivo no banco; o md5 do
 * corpo foi conferido contra `pg_proc` em 01/10/2026) e falha quando o corpo
 * de uma função da parede:
 *   - cita uma coluna ou chave com palavra de dinheiro, de cliente ou de texto
 *     digitado;
 *   - usa `select *`, `alias.*`, `to_jsonb(`, `to_json(` ou `row_to_json(`;
 *   - lê uma tabela fora da lista fechada (em especial `ordens_servico` e
 *     `itens_os` cruas, `clientes`, e as RPCs que devolvem custo);
 *   - tira texto de outra coluna que não `produtos.nome`;
 *   - deixa de ter a guarda de `service_role` ou ganha EXECUTE para mais alguém.
 *
 * Não substitui o ensaio no banco, que plantou "R$ 150,00" e um nome de
 * cliente em todos os textos livres e varreu os VALORES devolvidos. Aquele
 * prova o que a função viva devolve hoje; este segura o que o repositório
 * pode vir a mudar.
 */

const MIGRACOES = "supabase/migrations";
const FUNCOES_DA_PAREDE = ["tv_painel_maquinas", "tv_hora_local"];

/**
 * O que não pode aparecer no corpo — nem como coluna lida, nem como chave do
 * jsonb, nem em comentário (comentário com `valor_total` é o primeiro passo
 * para a coluna voltar).
 *
 * É a lista do desenho da TV (dinheiro_na_parede, camada 5), com as grafias
 * acentuadas ao lado das sem acento: `preco` sozinho deixaria passar `preço`.
 */
const PROIBIDO =
  /valor|custo|pre[cç]o|margem|lucro|desconto|comiss|aquisi|residual|pagamento|cliente|logo|telefone|briefing|observa|descri[cç][aã]o|t[ií]tulo|endere[cç]o/gi;

/**
 * A ÚNICA exceção, nomeada: a chave `com_cliente` do bloco entrada_arte.
 *
 * É uma CONTAGEM — quantas OS estão em `aguardando_aprovacao_arte`, isto é,
 * com a arte na mão do cliente para aprovar. Não é nome, não é id, não
 * identifica ninguém. O nome está no contrato v2 da TV, e trocar a chave para
 * fugir do teste seria pior do que explicar a exceção.
 *
 * A exceção vale para o literal exato, entre aspas simples, e uma vez só: se
 * `cliente` aparecer em qualquer outra forma (`cliente_nome`, `o.cliente_id`,
 * um segundo `'com_cliente'` montado de outro jeito), o teste falha.
 */
const EXCECAO = "'com_cliente'";

/** As relações que a parede pode ler. Lista fechada — regra (d) do contrato. */
const TABELAS_PERMITIDAS = [
  "maquinas",
  "ordens_servico_operacional",
  "itens_os_operacional",
  "produtos",
  "maquinas_agenda",
  "apontamentos_producao",
  "entregas_instalacoes",
  "os_status_historico",
  "producao_3d_apontamentos",
  "producao_3d_jobs",
];

/** As funções da base única (F0/F1) que ela reaproveita, e o enum. */
const APOIO_PERMITIDO = [
  "hoje_local",
  "os_esta_encerrada",
  "etapa_da_os",
  "bloco_da_tv",
  "os_saiu_fisicamente",
  "tipos_de_maquina",
  "maquina_do_status",
  "maquina_padrao_da_os",
  "tv_hora_local",
  "teto_do_apontamento",
  "status_os",
];

type Funcao = { nome: string; arquivo: string; cabecalho: string; corpo: string };

/**
 * A função como está na ÚLTIMA migração que a define — a mesma regra de
 * tests/tv-bloco-espelha-etapas.test.ts: quando alguém redefinir a função, é a
 * migração nova que vale no banco, e conferir a antiga seria passar com o
 * retrato de ontem.
 */
function funcaoDaMigracao(nome: string): Funcao & { texto: string } {
  const inicio = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${nome}\\s*\\(`, "i");
  const arquivos = readdirSync(MIGRACOES)
    .filter((a) => a.endsWith(".sql"))
    .sort();
  for (const arquivo of arquivos.reverse()) {
    const texto = readFileSync(join(MIGRACOES, arquivo), "utf8");
    const m = inicio.exec(texto);
    if (!m) continue;
    const resto = texto.slice(m.index);
    const partes = /^([\s\S]*?)AS\s+\$function\$([\s\S]*?)\$function\$/.exec(resto);
    if (!partes) {
      throw new Error(`${arquivo}: achei public.${nome} mas não o corpo entre $function$ … $function$`);
    }
    return { nome, arquivo, cabecalho: partes[1], corpo: partes[2], texto };
  }
  throw new Error(`Nenhuma migração define public.${nome}`);
}

/** Linha e trecho de cada ocorrência, para a mensagem dizer ONDE. */
function ocorrencias(corpo: string, padrao: RegExp): string[] {
  const achados: string[] = [];
  const linhas = corpo.split("\n");
  linhas.forEach((linha, i) => {
    padrao.lastIndex = 0;
    if (padrao.test(linha)) achados.push(`linha ${i + 1}: ${linha.trim().slice(0, 110)}`);
  });
  return achados;
}

/** O corpo sem a exceção nomeada — e quantas vezes ela aparecia. */
function semAExcecao(corpo: string): { limpo: string; vezes: number } {
  const vezes = corpo.split(EXCECAO).length - 1;
  return { limpo: corpo.split(EXCECAO).join("'com_…'"), vezes };
}

function palavrasProibidas(corpo: string): string[] {
  return ocorrencias(semAExcecao(corpo).limpo, PROIBIDO);
}

function atalhos(corpo: string): string[] {
  return [
    ...ocorrencias(corpo, /select\s+(?:distinct\s+)?\*/gi),
    // `alias.*` — `count(*)` não casa: ali o asterisco vem depois de parêntese.
    ...ocorrencias(corpo, /\b[a-z_][a-z0-9_]*\.\*/gi),
    ...ocorrencias(corpo, /\b(?:to_jsonb|to_json|row_to_json)\s*\(/gi),
  ];
}

const painel = funcaoDaMigracao("tv_painel_maquinas");
const funcoes = FUNCOES_DA_PAREDE.map(funcaoDaMigracao);

describe("o teste lê alguma coisa — não pode passar por não achar nada", () => {
  it("acha as duas funções da parede, com corpo de verdade", () => {
    // Uma trava que não inspeciona nada passa sempre. Se o formato do SQL
    // mudar e o extrator ficar cego, é aqui que aparece.
    expect(funcoes.map((f) => f.nome)).toEqual(FUNCOES_DA_PAREDE);
    expect(painel.corpo.length).toBeGreaterThan(20_000);
    expect(painel.corpo).toContain("jsonb_build_object(");
    expect(painel.corpo).toContain("public.ordens_servico_operacional");
    expect(painel.corpo.split("\n").length).toBeGreaterThan(400);
  });

  it("o detector pega o que tem de pegar", () => {
    // Prova contra o falso verde: os mesmos detectores, em corpos plantados.
    expect(palavrasProibidas("select o.valor_total from x o")).toHaveLength(1);
    expect(palavrasProibidas("'cliente', o.cliente_nome")).toHaveLength(1);
    expect(palavrasProibidas("'preço', i.preco_m2,\n'título', o.titulo")).toHaveLength(2);
    expect(palavrasProibidas("select i.descricao, g.observacoes, e.endereco")).toHaveLength(1);
    expect(palavrasProibidas("-- o item do catálogo")).toHaveLength(1); // "catálogo" contém "logo"
    expect(palavrasProibidas("'com_cliente', t.ea_esp")).toHaveLength(0); // a exceção, e só ela
    expect(palavrasProibidas("'com_cliente_nome', o.x")).toHaveLength(1);
    expect(atalhos("select * from public.ordens_servico")).toHaveLength(1);
    expect(atalhos("select o.* from public.ordens_servico o")).toHaveLength(1);
    expect(atalhos("select to_jsonb(o) from o")).toHaveLength(1);
    expect(atalhos("select row_to_json(o) from o")).toHaveLength(1);
    expect(atalhos("select count(*) filter (where x.a) from w x")).toHaveLength(0);
  });
});

describe("nenhuma coluna ou chave de dinheiro, de cliente ou de texto digitado", () => {
  for (const f of funcoes) {
    it(`${f.nome}: o corpo não cita nenhuma palavra proibida`, () => {
      const achados = palavrasProibidas(f.corpo);
      expect(
        achados,
        `${f.arquivo} → public.${f.nome} cita palavra de dinheiro, de cliente ou de texto digitado.\n` +
          `A parede fica virada para o balcão: isso não pode sair no retorno, nem em comentário.\n  ${achados.join("\n  ")}`,
      ).toEqual([]);
    });
  }

  it("a exceção `com_cliente` aparece exatamente uma vez, como chave de contagem", () => {
    const { vezes } = semAExcecao(painel.corpo);
    expect(vezes, "a exceção é para UMA chave; apareceu outra quantidade").toBe(1);
    // …e o que ela carrega é um count(*) — não uma coluna de cliente.
    const linha = painel.corpo.split("\n").find((l) => l.includes(EXCECAO)) ?? "";
    const alias = /'com_cliente',\s*t\.([a-z_]+)/.exec(linha)?.[1];
    expect(alias, `não achei de onde vem o valor de 'com_cliente' em: ${linha.trim()}`).toBeTruthy();
    const origem = new RegExp(`count\\(\\*\\)\\s+filter\\s*\\([^\\n]*\\)::integer\\s+as\\s+${alias}\\b`, "i");
    expect(origem.test(painel.corpo), `'com_cliente' deixou de ser um count(*) (alias ${alias})`).toBe(true);
    expect(FUNCOES_DA_PAREDE.filter((n) => n !== "tv_painel_maquinas").map((n) => semAExcecao(funcaoDaMigracao(n).corpo).vezes)).toEqual([0]);
  });
});

describe("nenhum atalho que traga a linha inteira", () => {
  for (const f of funcoes) {
    it(`${f.nome}: sem select *, sem alias.*, sem to_jsonb(linha)`, () => {
      const achados = atalhos(f.corpo);
      expect(
        achados,
        `${f.arquivo} → public.${f.nome} usa um atalho que devolve colunas que ninguém escolheu.\n` +
          `Liste as colunas e monte o jsonb chave por chave.\n  ${achados.join("\n  ")}`,
      ).toEqual([]);
    });
  }
});

describe("lista fechada do que a parede lê", () => {
  it("só as tabelas e views do contrato — nunca ordens_servico ou itens_os cruas", () => {
    const citadas = [...new Set([...painel.corpo.matchAll(/\bpublic\.([a-z0-9_]+)/gi)].map((m) => m[1]))];
    const fora = citadas.filter((r) => !TABELAS_PERMITIDAS.includes(r) && !APOIO_PERMITIDO.includes(r));
    expect(
      fora,
      `tv_painel_maquinas passou a ler algo fora da lista fechada: ${fora.join(", ")}.\n` +
        `OS e itens só pelas views *_operacional; nada de clientes, de RPC de capacidade ou de pendências.`,
    ).toEqual([]);
    // As dez relações do contrato continuam todas lá: se uma sumir, a lista
    // deste teste está velha e deixou de proteger.
    for (const t of TABELAS_PERMITIDAS) expect(citadas, `a função não lê mais public.${t}`).toContain(t);
  });

  it("toda relação é lida com o schema escrito (senão a lista acima não a enxerga)", () => {
    const semSchema = ocorrencias(
      painel.corpo,
      /\b(?:from|join)\s+(?:maquinas|ordens_servico|itens_os|produtos|clientes|maquinas_agenda|apontamentos_producao|entregas_instalacoes|os_status_historico|producao_3d_)/gi,
    );
    expect(semSchema).toEqual([]);
  });

  it("o único texto que sai de tabela é produtos.nome", () => {
    // `nome` aparece em três lugares e só neles: o nome do produto do item da
    // reserva (pr), o do item único da OS (p2) e o nome da máquina — este só
    // para ORDENAR as colunas, nunca devolvido.
    const usos = [...painel.corpo.matchAll(/\b([a-z0-9_]+)\.nome\b/gi)].map((m) => m[1]).sort();
    expect(usos).toEqual(["m", "p2", "pr"]);
    expect(/left join public\.produtos pr\b/i.test(painel.corpo)).toBe(true);
    expect(/left join public\.produtos p2\b/i.test(painel.corpo)).toBe(true);
    const linhaDoNomeDaMaquina = painel.corpo.split("\n").find((l) => /\bm\.nome\b/.test(l)) ?? "";
    expect(linhaDoNomeDaMaquina, "o nome da máquina só pode servir para ordenar").toMatch(/over\s*\(\s*order by/i);
    // O tipo da máquina é coluna de texto livre: o que sai é o do mapa fechado.
    expect(painel.corpo).not.toMatch(/\bm\.tipo\s+as\b/i);
    expect(painel.corpo).toMatch(/select m\.id, t\.tipo,/i);
  });
});

describe("listas fechadas no retorno", () => {
  const literais = (re: RegExp) => [...new Set([...painel.corpo.matchAll(re)].map((m) => m[1]))].sort();

  it("os sete estados da fase 1 — sem manutenção, que ainda não tem fonte", () => {
    const bloco = /case when e\.a_tid is not null and e\.a_no_teto([\s\S]*?)end as estado/i.exec(painel.corpo)?.[1] ?? "";
    const estados = [...bloco.matchAll(/(?:then|else)\s+'([a-z_]+)'/gi)].map((m) => m[1]);
    // A ORDEM é a precedência do desenho.
    expect(estados).toEqual([
      "rodando", "nao_fechou", "bloqueada", "reservada", "pelo_status", "livre", "sem_registro",
    ]);
    expect(painel.corpo).not.toMatch(/'manutencao'/i);
  });

  it("os cinco tipos de evento — concluir, faturar, cancelar e pausar nunca viram evento", () => {
    // Concluir e faturar só acontecem com a OS quitada: evento disso seria
    // dizer na parede quem pagou.
    const doApontamento = literais(/'(apontamento_[a-z]+)'(?:::text as tipo)?, a\.maquina_id/g);
    const doHistorico = [
      ...new Set(
        [...painel.corpo.matchAll(/case h\.status_novo([\s\S]*?)\bend,/gi)].flatMap((m) =>
          [...m[1].matchAll(/(?:then|else)\s+'([a-z_]+)'/gi)].map((x) => x[1]),
        ),
      ),
    ];
    expect([...doApontamento, ...doHistorico].sort()).toEqual([
      "apontamento_finalizado", "apontamento_iniciado", "os_entrou_na_fila", "os_ficou_pronta", "os_foi_para_acabamento",
    ]);
    // Cada tipo é escrito duas vezes — na lista de hoje e no "último" —, e as
    // duas listas têm de ser a mesma: nenhum literal de evento fora delas.
    const todos = literais(/'((?:apontamento_(?:iniciado|finalizado))|os_(?:entrou|foi|ficou)[a-z_]*)'/g);
    expect(todos).toEqual([...doApontamento, ...doHistorico].sort());
    const filtros = [...painel.corpo.matchAll(/h\.status_novo in \(([^)]*)\)/gi)].map((m) =>
      [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort(),
    );
    expect(filtros.length).toBe(2); // os eventos de hoje e o último evento
    for (const f of filtros) {
      expect(f).toEqual(["aguardando_entrega", "aguardando_producao", "aguardando_retirada", "em_acabamento"]);
    }
  });

  it("o id do evento é estável: apt-ini, apt-fim, hist", () => {
    expect(literais(/'((?:apt-ini|apt-fim|hist):)'/g)).toEqual(["apt-fim:", "apt-ini:", "hist:"]);
  });
});

describe("quem pode chamar", () => {
  it("roda com a permissão de quem chama, e a guarda é o papel real", () => {
    for (const f of funcoes) {
      expect(f.cabecalho, `${f.nome} virou SECURITY DEFINER`).not.toMatch(/SECURITY\s+DEFINER/i);
      expect(f.cabecalho, `${f.nome} sem search_path fixo`).toMatch(/SET\s+search_path/i);
    }
    // Em função invoker, current_user é quem chamou. A guarda vem antes de
    // qualquer leitura.
    const guarda = painel.corpo.indexOf("if current_user <> 'service_role' then");
    const primeiraLeitura = painel.corpo.search(/\bfrom\s+public\./i);
    expect(guarda, "a guarda de service_role sumiu do corpo").toBeGreaterThan(-1);
    expect(guarda).toBeLessThan(primeiraLeitura);
    expect(painel.corpo).toMatch(/errcode = '42501'/);
  });

  it("EXECUTE só para service_role — revogado de PUBLIC, anon e authenticated", () => {
    for (const f of funcoes) {
      const assinatura = `public\\.${f.nome}\\([^)]*\\)`;
      const revoke = new RegExp(`REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+${assinatura}\\s+FROM\\s+PUBLIC,\\s*anon,\\s*authenticated`, "i");
      expect(revoke.test(f.texto), `${f.arquivo}: falta o REVOKE de PUBLIC, anon, authenticated em ${f.nome}`).toBe(true);
      const grants = [...f.texto.matchAll(new RegExp(`GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+${assinatura}\\s+TO\\s+([^;]+);`, "gi"))].map((m) =>
        m[1].split(",").map((r) => r.trim()).sort().join(","),
      );
      expect(grants, `${f.arquivo}: ${f.nome} tem EXECUTE para mais alguém`).toEqual(["service_role"]);
    }
  });
});

describe("a tela foi desenhada para cinco colunas", () => {
  it("o limite da conferência R6 é o número de máquinas que a tela conhece", () => {
    const limite = Number(/c_colunas\s+constant integer := (\d+);/.exec(painel.corpo)?.[1]);
    expect(limite).toBe(5);
    // Entrou um sexto tipo de máquina na identidade? A grade da TV, o limite
    // do SQL e `tipos_de_maquina()` mudam juntos — e a sexta máquina não some
    // em silêncio: R6 acusa na parede.
    expect(legendaDeMaquinas().length).toBe(limite);
  });

  it("intervalo e expediente são os que o dono decidiu", () => {
    expect(painel.corpo).toMatch(/c_intervalo_s constant integer := 60;/);
    expect(painel.corpo).toMatch(/c_abre\s+constant time := time '08:00';/);
    expect(painel.corpo).toMatch(/c_fecha\s+constant time := time '18:00';/);
    expect(painel.corpo).toMatch(/c_fuso\s+constant text := 'America\/Belem';/);
  });

  it("o teto do apontamento está escrito UMA vez, e a parede lê de lá", () => {
    // A parede (RODANDO x NÃO FECHOU) e o fechamento (até onde o tempo vira
    // custo de máquina) leem o mesmo número: `teto_do_apontamento`. Medido em
    // 01/10/2026: um apontamento esquecido por 20 h lançava 20 h, enquanto a
    // TV já o escrevia como NÃO FECHOU há 10. Duas constantes no SQL da TV
    // seriam o caminho de volta para isso.
    const teto = funcaoDaMigracao("teto_do_apontamento");
    expect(teto.corpo).toMatch(/interval '10 hours'/);
    expect(teto.corpo).toMatch(/interval '24 hours'/);
    expect(teto.corpo).toMatch(/= 'em_3d'/);
    expect(teto.corpo).toMatch(/America\/Belem/);
    expect(painel.corpo).toMatch(/public\.teto_do_apontamento\(a\.iniciado_em, m\.tipo\)/);
    expect(painel.corpo).not.toMatch(/c_teto/);
    expect(painel.corpo).not.toMatch(/interval '\d+ hours'/);
  });
});

describe("o que a parede esconde de propósito", () => {
  it("entrada/arte e saída são só contagem: a lista dos cartões só numera oficina e acabamento", () => {
    // O desenho fecha a subtração dizendo que ENTRADA E ARTE e NA SAÍDA não
    // mostram número de OS. O payload tem de obedecer, não a tela: as três
    // listas (atrasadas, prazo hoje, prazo amanhã) filtram o bloco no SQL e o
    // total continua contando os quatro blocos.
    const filtros = painel.corpo.match(/from (?:atr|ph|pa) z where z\.bloco in \('oficina', 'acabamento'\)/g) ?? [];
    expect(filtros.sort()).toEqual([
      "from atr z where z.bloco in ('oficina', 'acabamento')",
      "from pa z where z.bloco in ('oficina', 'acabamento')",
      "from ph z where z.bloco in ('oficina', 'acabamento')",
    ]);
    // …e os totais continuam vindo das listas inteiras.
    expect(painel.corpo).toMatch(/'total', \(select count\(\*\)::integer from atr\)/);
    expect(painel.corpo).toMatch(/'total', \(select count\(\*\)::integer from ph\)/);
    expect(painel.corpo).toMatch(/'total', \(select count\(\*\)::integer from pa\)/);
  });

  it("a OS que já saiu só some da parede quando o status ainda é de saída", () => {
    // A entregue que VOLTOU (retrabalho) está na parede. Medido em 01/10/2026:
    // o filtro antigo escondia a OS em retrabalho com uma entrega concluída.
    expect(painel.corpo).toMatch(/where not \(p\.saiu and b\.bloco is not distinct from 'saida'\)/);
    expect(painel.corpo).not.toMatch(/and not public\.os_saiu_fisicamente\(o\.id\)/);
  });

  it("bloqueio é só a reserva sem OS feita à mão; reserva órfã não bloqueia máquina", () => {
    expect(painel.corpo).toMatch(/when g\.origem = 'manual' then 'bloqueio' end as classe/);
  });

  it("apontamento aberto de OS fora da oficina é aviso, não falha de número", () => {
    // Apontar pela ficha numa OS do acabamento é fato da operação. A coluna
    // mostra, os totais fecham sem ela, e a faixa "número inconsistente" não
    // acende por isso.
    expect(painel.corpo).toMatch(/'aviso', 'apontamento_aberto_fora_da_oficina'/);
    expect(painel.corpo).toMatch(/'falhas', v_falhas, 'avisos', v_avisos\)/);
    expect(painel.corpo).toMatch(/where y1\.dias_atraso is not null and y1\.bloco = 'oficina'/);
    expect(painel.corpo).toMatch(/from trab2 y where y\.bloco = 'oficina'\)/);
    expect(painel.corpo).not.toMatch(/os_na_coluna_fora_da_oficina/);
  });

  it("a prova do LIVRE vem nomeada: apontamento ou job 3D", () => {
    const bloco = /case when e\.estado = 'livre' then([\s\S]*?)end end as livre_por/i.exec(painel.corpo)?.[1] ?? "";
    const provas = [...bloco.matchAll(/'([a-z_0-9]+)'/g)].map((m) => m[1]).sort();
    expect(provas).toEqual(["apontamento", "job_3d"]);
    expect(painel.corpo).toMatch(/'livre_por', e\.livre_por/);
    expect(painel.corpo).toMatch(/'ultimo_registro_local', public\.tv_hora_local\(v_vida\)/);
  });
});
