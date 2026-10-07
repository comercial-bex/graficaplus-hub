import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  agruparPorModulo,
  expiraEmDoUltimoDia,
  fazAlgo,
  filtrarChaves,
  hojeNaCasa,
  lerPermissoesDaPessoa,
  lerUsoNoBanco,
  motivoParaNaoTerExcecao,
  nomeDaChave,
  nomeDoModulo,
  origemDaChave,
  primeiroNome,
  resumoDaPessoa,
  rotuloDaOrigem,
  textoDaDataHora,
  textoDoEvento,
  textoDoVencimento,
  type ChaveDaPessoa,
  type PermissoesDaPessoa,
  type UsoNoBanco,
} from "../src/domain/acesso/permissoes-por-pessoa";
import {
  SEM_PERMISSOES,
  fonteDasPermissoes,
  proximoEstado,
  temPermissao,
} from "../src/domain/acesso/permissoes-efetivas";
import { CHAVES_CONFERIDAS_NA_TELA, chavesUsadasNaTela } from "../src/domain/acesso/uso-na-tela";
import { permissions, routePermissions } from "../src/lib/permissions";

/**
 * PERMISSÕES POR PESSOA — a parte da tela.
 *
 * A conta de verdade é do banco (has_permission); aqui se trava o que a tela
 * faz com a resposta: ler sem inventar, dizer de onde vem cada chave, vencer
 * no dia certo em Belém (o aparelho pode estar em UTC, como o servidor), e
 * não deixar o "ainda não faz nada" envelhecer.
 */

function chave(p: Partial<ChaveDaPessoa> & { chave: string }): ChaveDaPessoa {
  return {
    dominio: p.chave.split(".")[0],
    descricao: null,
    efetiva: false,
    so_de_fora: false,
    papeis: [],
    excecao: null,
    ...p,
  };
}

const excecao = (concede: boolean, expira_em: string | null, ativa = true) => ({
  concede,
  expira_em,
  ativa,
  motivo: "cobrir as férias da Cibele",
  criado_em: "2026-10-06T17:30:00.000Z",
  criado_por_nome: "Harison",
});

describe("lendo a resposta do banco", () => {
  const valido: PermissoesDaPessoa = {
    pessoa: { id: "p1", nome: "SERGIO COSTA DA CRUZ", ativo: true, papeis: ["operador"] },
    agora: "2026-10-06T20:00:00.000Z",
    chaves: [
      chave({
        chave: "clientes.read",
        dominio: "crm",
        efetiva: true,
        excecao: excecao(true, null),
      }),
    ],
    historico: [
      {
        quando: "2026-10-06T20:00:00.000Z",
        acao: "dar",
        permissao: "clientes.read",
        concede: true,
        expira_em: null,
        motivo: "cobrir o atendimento",
        autor_nome: "Harison",
        direto_no_banco: false,
      },
    ],
  };

  it("aceita o formato de permissoes_da_pessoa", () => {
    expect(lerPermissoesDaPessoa(valido)).toEqual(valido);
  });

  it("formato inesperado é ERRO, nunca uma pessoa sem permissão nenhuma", () => {
    expect(() => lerPermissoesDaPessoa(null)).toThrow(/formato/);
    expect(() => lerPermissoesDaPessoa({ ...valido, chaves: "nada" })).toThrow(/formato/);
    expect(() =>
      lerPermissoesDaPessoa({ ...valido, chaves: [{ chave: "x", efetiva: "sim" }] }),
    ).toThrow(/formato/);
  });

  it("uso no banco: mapa chave → contagens; outro formato é erro", () => {
    const uso = { "os.read": { politicas: 4, funcoes: 1, visoes: 0 } };
    expect(lerUsoNoBanco(uso)).toEqual(uso);
    expect(() => lerUsoNoBanco([1, 2])).toThrow(/formato/);
    expect(() => lerUsoNoBanco({ "os.read": { politicas: "4" } })).toThrow(/formato/);
  });
});

describe("de onde vem cada chave", () => {
  it("do papel, quando nenhuma exceção ativa existe", () => {
    const o = origemDaChave(
      chave({ chave: "os.read", efetiva: true, papeis: ["vendedor", "operador"] }),
      false,
    );
    expect(o.origem).toEqual({ tipo: "papel", papeis: ["vendedor", "operador"] });
    expect(rotuloDaOrigem(o.origem)).toBe("do papel (vendedor, operador)");
  });

  it("dada só para esta pessoa, com e sem vencimento", () => {
    const sem = origemDaChave(
      chave({ chave: "clientes.read", efetiva: true, excecao: excecao(true, null) }),
      false,
    );
    expect(sem.origem).toEqual({ tipo: "dada", venceEm: null, papelJaDa: false });
    expect(rotuloDaOrigem(sem.origem)).toBe("dada só para esta pessoa");

    const com = origemDaChave(
      chave({
        chave: "clientes.read",
        efetiva: true,
        excecao: excecao(true, "2026-11-01T03:00:00.000Z"),
      }),
      false,
    );
    expect(com.origem).toEqual({ tipo: "dada", venceEm: "31/10", papelJaDa: false });
  });

  it("tirada desta pessoa, mesmo que o papel dê", () => {
    const o = origemDaChave(
      chave({
        chave: "financeiro.read",
        efetiva: false,
        papeis: ["gestor"],
        excecao: excecao(false, null),
      }),
      false,
    );
    expect(o.origem).toEqual({ tipo: "tirada", venceEm: null, papeis: ["gestor"] });
    expect(rotuloDaOrigem(o.origem)).toBe("tirada desta pessoa");
  });

  it("exceção vencida não conta: vale o papel, e o vencimento fica à vista", () => {
    const o = origemDaChave(
      chave({
        chave: "financeiro.read",
        efetiva: true,
        papeis: ["gestor"],
        excecao: excecao(false, "2026-10-06T03:00:00.000Z", false),
      }),
      false,
    );
    expect(o.origem).toEqual({ tipo: "papel", papeis: ["gestor"] });
    expect(o.vencida).toEqual({ concede: false, venceuEm: "05/10" });
  });

  it("exceção não vale para administrador", () => {
    const o = origemDaChave(
      chave({ chave: "os.read", efetiva: true, papeis: ["admin"], excecao: excecao(false, null) }),
      true,
    );
    expect(o.origem.tipo).toBe("papel");
    expect(o.ignoradaPorSerAdmin).toBe(true);
  });

  it("sem papel e sem exceção", () => {
    expect(origemDaChave(chave({ chave: "kanban.read" }), false).origem).toEqual({ tipo: "sem" });
  });
});

describe("vencimento no fuso da casa (Belém, UTC−3), seja qual for o fuso do aparelho", () => {
  it("'vale até 31/10' grava a meia-noite de 01/11 em Belém", () => {
    expect(expiraEmDoUltimoDia("2026-10-31")).toBe("2026-11-01T03:00:00.000Z");
    expect(expiraEmDoUltimoDia("2026-12-31")).toBe("2027-01-01T03:00:00.000Z");
    expect(expiraEmDoUltimoDia("2028-02-29")).toBe("2028-03-01T03:00:00.000Z");
  });

  it("data que não existe é recusada, não rolada para o mês seguinte", () => {
    expect(() => expiraEmDoUltimoDia("2026-02-30")).toThrow(/inválida/);
    expect(() => expiraEmDoUltimoDia("31/10/2026")).toThrow(/inválida/);
  });

  it("a volta: o que foi gravado vira 'vence em 31/10'", () => {
    expect(textoDoVencimento(expiraEmDoUltimoDia("2026-10-31"))).toBe("31/10");
    expect(textoDoVencimento("2026-10-07T20:12:00.000Z")).toBe("07/10 às 17:12");
  });

  it("hoje é hoje em Belém: 02:30 UTC de 07/10 ainda é 06/10 lá", () => {
    expect(hojeNaCasa(new Date("2026-10-07T02:30:00.000Z"))).toBe("2026-10-06");
    expect(hojeNaCasa(new Date("2026-10-07T03:00:00.000Z"))).toBe("2026-10-07");
  });

  it("data e hora do histórico em Belém", () => {
    expect(textoDaDataHora("2026-10-06T17:32:00.000Z")).toBe("06/10/2026 14:32");
  });
});

describe("ainda não faz nada", () => {
  const uso: UsoNoBanco = {
    "os.read": { politicas: 4, funcoes: 1, visoes: 0 },
    "kanban.read": { politicas: 0, funcoes: 0, visoes: 0 },
    "usuarios.read": { politicas: 0, funcoes: 0, visoes: 0 },
  };
  const tela = new Set(["usuarios.read"]);

  it("faz algo se o banco cita OU a tela confere", () => {
    expect(fazAlgo("os.read", uso, tela)).toBe(true);
    expect(fazAlgo("usuarios.read", uso, tela)).toBe(true);
    expect(fazAlgo("kanban.read", uso, tela)).toBe(false);
  });

  it("sem a medição do banco a resposta é 'não sei', nunca 'não faz nada'", () => {
    expect(fazAlgo("kanban.read", null, tela)).toBeNull();
    expect(fazAlgo("chave.nova", uso, tela)).toBeNull();
  });
});

describe("módulos, filtro e resumo", () => {
  const dados: PermissoesDaPessoa = {
    pessoa: { id: "p", nome: "Leonardo Pimentel", ativo: true, papeis: ["vendedor", "operador"] },
    agora: "2026-10-06T20:00:00.000Z",
    chaves: [
      chave({
        chave: "os.read",
        dominio: "os",
        descricao: "Ler",
        efetiva: true,
        papeis: ["vendedor"],
      }),
      chave({
        chave: "clientes.read",
        dominio: "crm",
        descricao: "Ler clientes",
        efetiva: false,
        papeis: ["vendedor"],
        excecao: excecao(false, null),
      }),
      chave({
        chave: "estoque.read",
        dominio: "estoque",
        descricao: "Ler estoque",
        efetiva: true,
        excecao: excecao(true, "2026-11-01T03:00:00.000Z"),
      }),
      chave({ chave: "clientes.delete", dominio: "crm", descricao: "Excluir clientes" }),
    ],
    historico: [],
  };

  it("agrupa por módulo com nome em português, em ordem alfabética", () => {
    const m = agruparPorModulo(dados.chaves);
    expect(m.map((x) => x.nome)).toEqual(["Clientes e leads", "Estoque", "Ordens de serviço"]);
    expect(m[0].chaves.map((c) => c.chave)).toEqual(["clientes.delete", "clientes.read"]);
    expect(m[0].valendo).toBe(0);
    expect(nomeDoModulo("modulo_novo")).toBe("Modulo_novo");
  });

  it("filtra por valendo, exceção, sem efeito e busca sem acento", () => {
    const nada = (k: string) => k === "clientes.delete";
    expect(filtrarChaves(dados.chaves, "valendo", "", nada).map((c) => c.chave)).toEqual([
      "os.read",
      "estoque.read",
    ]);
    expect(filtrarChaves(dados.chaves, "excecoes", "", nada).map((c) => c.chave)).toEqual([
      "clientes.read",
      "estoque.read",
    ]);
    expect(filtrarChaves(dados.chaves, "sem_efeito", "", nada).map((c) => c.chave)).toEqual([
      "clientes.delete",
    ]);
    expect(
      filtrarChaves(dados.chaves, "todas", "ORDENS DE SERVICO", nada).map((c) => c.chave),
    ).toEqual(["os.read"]);
  });

  it("resumo: quantas valem, quantas dadas e tiradas só dela", () => {
    expect(resumoDaPessoa(dados)).toEqual({ valendo: 2, total: 4, dadas: 1, tiradas: 1 });
  });
});

describe("quem pode receber exceção (espelho das recusas do banco)", () => {
  it("administrador não: ele tem tudo, sempre", () => {
    expect(motivoParaNaoTerExcecao(["admin"])).toMatch(/administrador/);
    expect(motivoParaNaoTerExcecao(["admin", "vendedor"])).toMatch(/administrador/);
  });
  it("cliente, parceiro e quem não tem papel: só a equipe", () => {
    expect(motivoParaNaoTerExcecao(["cliente"])).toMatch(/equipe/);
    expect(motivoParaNaoTerExcecao(["parceiro"])).toMatch(/equipe/);
    expect(motivoParaNaoTerExcecao([])).toMatch(/equipe/);
  });
  it("equipe sim", () => {
    expect(motivoParaNaoTerExcecao(["operador"])).toBeNull();
    expect(motivoParaNaoTerExcecao(["vendedor", "cliente"])).toBeNull();
  });
});

describe("histórico em frase", () => {
  const base = {
    quando: "2026-10-06T20:00:00.000Z",
    permissao: "financeiro.read",
    concede: false,
    expira_em: "2026-11-01T03:00:00.000Z",
    motivo: "férias",
    autor_nome: "Harison",
    direto_no_banco: false,
  };
  it("dar, tirar e desfazer, com quem e até quando", () => {
    expect(textoDoEvento({ ...base, acao: "tirar" }, "Ver o financeiro")).toBe(
      "Harison tirou “Ver o financeiro”, até 31/10",
    );
    expect(textoDoEvento({ ...base, acao: "dar", concede: true, expira_em: null }, null)).toBe(
      "Harison deu “financeiro.read”",
    );
    expect(
      textoDoEvento({ ...base, acao: "desfazer", concede: null, expira_em: null }, "Ver"),
    ).toBe("Harison desfez a exceção de “Ver (financeiro.read)”");
  });
  it("descrição de uma ou duas palavras leva a chave junto ('Ler' de quê?)", () => {
    expect(nomeDaChave("financeiro.read", "Ler")).toBe("Ler (financeiro.read)");
    expect(nomeDaChave("whatsapp.manage", "Gerenciar")).toBe("Gerenciar (whatsapp.manage)");
    expect(nomeDaChave("clientes.read", "Ler clientes")).toBe("Ler clientes (clientes.read)");
    expect(nomeDaChave("estoque.cost.read", "Ler custo de estoque")).toBe("Ler custo de estoque");
    expect(nomeDaChave("os.read", null)).toBe("os.read");
  });
  it("mudança feita direto no banco fica dita como tal, não como 'sistema'", () => {
    expect(
      textoDoEvento({ ...base, acao: "dar", autor_nome: null, direto_no_banco: true }, "Ver"),
    ).toMatch(/^Direto no banco \(sem autor\) deu/);
  });
  it("primeiro nome legível", () => {
    expect(primeiroNome("SERGIO COSTA DA CRUZ")).toBe("Sergio");
    expect(primeiroNome("Cibele  Oliveira")).toBe("Cibele");
  });
});

describe("o que vale para quem está logado (auth-context)", () => {
  it("com a resposta do banco, vale ela — inclusive a chave dada só para a pessoa", () => {
    const e = proximoEstado(SEM_PERMISSOES, "sergio", new Set(["os.read", "clientes.read"]), null);
    expect(fonteDasPermissoes(e)).toBe("banco");
    expect(temPermissao(e, ["operador"], "clientes.read")).toBe(true);
    // ... e a tirada some, mesmo que o papel dê.
    const leo = proximoEstado(SEM_PERMISSOES, "leo", new Set(["os.read"]), null);
    expect(temPermissao(leo, ["vendedor"], "clientes.read")).toBe(false);
  });

  it("sem a função no banco (front antes da migração): a matriz dos papéis, como antes", () => {
    const e = proximoEstado(SEM_PERMISSOES, "leo", null, { vendedor: ["clientes.read"] });
    expect(fonteDasPermissoes(e)).toBe("matriz");
    expect(temPermissao(e, ["vendedor"], "clientes.read")).toBe(true);
    expect(temPermissao(e, ["vendedor"], "os.close")).toBe(false);
  });

  it("sem banco nenhum: a reserva escrita no código", () => {
    const e = proximoEstado(SEM_PERMISSOES, "leo", null, {});
    expect(fonteDasPermissoes(e)).toBe("reserva");
    expect(temPermissao(e, ["vendedor"], "orcamentos.create")).toBe(true);
    expect(temPermissao(e, ["vendedor"], "pagamentos.confirm")).toBe(false);
  });

  it("queda de rede numa releitura não troca a resposta certa pela matriz", () => {
    const certo = proximoEstado(SEM_PERMISSOES, "sergio", new Set(["clientes.read"]), null);
    const depois = proximoEstado(certo, "sergio", null, { operador: ["os.read"] });
    expect(depois).toBe(certo);
    // ... mas outra pessoa no mesmo aparelho não herda a resposta da anterior.
    const outra = proximoEstado(certo, "cibele", null, { financeiro: ["financeiro.read"] });
    expect(fonteDasPermissoes(outra)).toBe("matriz");
    expect(temPermissao(outra, ["financeiro"], "clientes.read")).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* A lista da tela não envelhece                                              */
/* -------------------------------------------------------------------------- */

const RAIZ = join(__dirname, "..");

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return arquivos(caminho);
    return /\.(ts|tsx)$/.test(nome) ? [caminho] : [];
  });
}

/** Chaves conferidas na tela por hasPermission("…") / can("…"), fora de comentário. */
function conferidasNoCodigo(): Set<string> {
  const achadas = new Set<string>();
  for (const caminho of arquivos(join(RAIZ, "src"))) {
    if (caminho.includes("integrations/supabase/types")) continue;
    const src = readFileSync(caminho, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    for (const m of src.matchAll(
      /\b(?:hasPermission|can)\(\s*["'`]([a-z0-9_]+(?:\.[a-z0-9_]+)+)["'`]/g,
    )) {
      achadas.add(m[1]);
    }
  }
  return achadas;
}

describe("as chaves que a tela confere", () => {
  it("a lista escrita é exatamente a que o código confere hoje", () => {
    const codigo = [...conferidasNoCodigo()].sort();
    expect(codigo.length, "o detector não achou nada — está cego").toBeGreaterThan(30);
    const escrita = [...CHAVES_CONFERIDAS_NA_TELA].sort();
    const faltam = codigo.filter((k) => !escrita.includes(k));
    const sobram = escrita.filter((k) => !codigo.includes(k));
    expect(
      { faltam, sobram },
      "Atualize CHAVES_CONFERIDAS_NA_TELA em src/domain/acesso/uso-na-tela.ts: senão o painel diz 'ainda não faz nada' de uma chave que a tela usa (ou o contrário).",
    ).toEqual({ faltam: [], sobram: [] });
  });

  it("toda chave da lista existe no catálogo", () => {
    const catalogo = new Set<string>(permissions);
    expect(CHAVES_CONFERIDAS_NA_TELA.filter((k) => !catalogo.has(k))).toEqual([]);
  });

  it("as guardas de rota entram sozinhas, lidas do mapa de rotas", () => {
    const usadas = chavesUsadasNaTela();
    for (const rota of routePermissions)
      for (const k of rota.permissions) expect(usadas.has(k), k).toBe(true);
  });
});

/**
 * RETRATO de 06/10/2026: as 31 chaves que nenhuma policy, função nem view do
 * banco cita (medido com `permissoes_uso_no_banco` no ensaio da migração —
 * 30 de antes + permissoes.manage, que a migração tira das policies da
 * matriz). Das 31, a tela confere 8. Sobram 23 que ainda não fazem nada.
 *
 * Ligar uma delas (na tela ou no banco) é progresso e não quebra este teste.
 * O que quebra é o contrário: uma chave que a tela conferia deixar de ser
 * conferida e voltar a "não fazer nada" sem ninguém notar. O painel mede o
 * banco ao vivo; este retrato só segura o lado da tela.
 */
describe("retrato: o que ainda não faz nada em 06/10/2026", () => {
  const SEM_NADA_NO_BANCO = [
    "agenda.operate",
    "agenda.read",
    "agenda.reschedule",
    "agenda.schedule",
    "clientes.create",
    "clientes.delete",
    "clientes.sensitive.read",
    "desconto.approve",
    "desconto.request",
    "estoque.adjust",
    "financeiro.sensitive.read",
    "kanban.read",
    "leads.assign",
    "leads.delete",
    "manutencao.manage",
    "manutencao.read",
    "margem.read",
    "orcamentos.cancel",
    "os.assign",
    "os.create",
    "os.status.advance",
    "parceiro.painel",
    "permissoes.manage",
    "producao.pause",
    "retrabalho.manage",
    "retrabalho.read",
    "tarefas.assign",
    "usuarios.manage",
    "usuarios.read",
    "whatsapp.assign",
    "whatsapp.transfer",
  ];

  /** Medido em 06/10/2026: as 23 que nem o banco nem a tela usam. */
  const NADA_EM_06_10 = [
    "agenda.reschedule",
    "clientes.create",
    "clientes.delete",
    "clientes.sensitive.read",
    "desconto.approve",
    "desconto.request",
    "financeiro.sensitive.read",
    "kanban.read",
    "leads.assign",
    "leads.delete",
    "manutencao.manage",
    "margem.read",
    "orcamentos.cancel",
    "os.assign",
    "parceiro.painel",
    "permissoes.manage",
    "producao.pause",
    "retrabalho.manage",
    "retrabalho.read",
    "tarefas.assign",
    "usuarios.manage",
    "whatsapp.assign",
    "whatsapp.transfer",
  ];

  it("31 sem nada no banco; das 31, a tela confere 8 e sobram 23", () => {
    expect(SEM_NADA_NO_BANCO).toHaveLength(31);
    expect(NADA_EM_06_10).toHaveLength(23);
    expect(NADA_EM_06_10.every((k) => SEM_NADA_NO_BANCO.includes(k))).toBe(true);
  });

  it("nenhuma chave que a tela conferia voltou a não fazer nada", () => {
    const tela = chavesUsadasNaTela();
    const nadaHoje = SEM_NADA_NO_BANCO.filter((k) => !tela.has(k));
    expect(nadaHoje.filter((k) => !NADA_EM_06_10.includes(k))).toEqual([]);
  });
});
