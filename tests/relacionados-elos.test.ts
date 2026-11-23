import { describe, expect, it } from "vitest";
import {
  aplicarAcesso,
  caminhoDeAcesso,
  contasDaOs,
  contasDoCliente,
  eloDeRecebimento,
  elosDaOs,
  elosDoCliente,
  elosDoOrcamento,
  resumirContas,
  type ContaLida,
  type Destino,
  type Elo,
  type Leitura,
} from "@/domain/relacionados/elos";

/**
 * A faixa "Relacionados" (23/11/2026). O que se prova aqui é o que a faixa NÃO pode fazer:
 *   - dizer "não deve nada" a quem não lê o financeiro (o banco devolveria vazio ou recusaria);
 *   - transformar uma leitura que falhou em "não tem";
 *   - fazer uma segunda conta de dinheiro diferente da tela "A receber".
 */

const OK = <T,>(dados: T): Leitura<T> => ({ estado: "ok", dados });
const CARREGANDO: Leitura<never> = { estado: "carregando" };
const ERRO: Leitura<never> = { estado: "erro" };
const SEM_ACESSO: Leitura<never> = { estado: "sem_acesso" };

function conta(p: Partial<ContaLida> & { parcelas?: ContaLida["parcelas"] }): ContaLida {
  return {
    conta_id: "c1",
    cliente_id: "cli1",
    os_id: "os1",
    recebido: 0,
    a_receber: 0,
    vencido: 0,
    parcelas: [],
    ...p,
  };
}

const porChave = (elos: Elo[], chave: string) => elos.find((e) => e.chave === chave);

describe("caminhoDeAcesso e aplicarAcesso", () => {
  it("cada destino aponta para a rota cuja permissão decide o acesso", () => {
    const casos: [Destino, string][] = [
      [{ rota: "cliente", id: "x" }, "/clientes"],
      [{ rota: "orcamento", id: "x" }, "/orcamentos"],
      [{ rota: "os", id: "x" }, "/os"],
      [{ rota: "produto", id: "x" }, "/produtos"],
      [{ rota: "conversa", id: "x" }, "/whatsapp"],
      [{ rota: "a-receber" }, "/a-receber"],
      [{ rota: "entregas" }, "/entregas"],
      [{ rota: "parceiros" }, "/parceiros"],
    ];
    for (const [destino, caminho] of casos) expect(caminhoDeAcesso(destino)).toBe(caminho);
  });

  it("tira o link do que a pessoa não abre e mantém o texto", () => {
    const elos: Elo[] = [
      { chave: "a", rotulo: "A", texto: "Cliente X", tom: "normal", destino: { rota: "cliente", id: "1" } },
      { chave: "b", rotulo: "B", texto: "Produto Y", tom: "normal", destino: { rota: "produto", id: "2" } },
      { chave: "c", rotulo: "C", texto: "Sem link", tom: "vazio" },
    ];
    const r = aplicarAcesso(elos, (caminho) => caminho === "/clientes");
    expect(r[0].destino).toEqual({ rota: "cliente", id: "1" });
    expect(r[1].destino).toBeUndefined();
    expect(r[1].texto).toBe("Produto Y");
    expect(r[2].destino).toBeUndefined();
    // não muta o original
    expect(elos[1].destino).toEqual({ rota: "produto", id: "2" });
  });
});

describe("resumirContas: usa os números do banco, sem refazer a conta", () => {
  it("soma em centavos e conta parcelas", () => {
    const r = resumirContas([
      conta({
        recebido: 0.1,
        a_receber: 0.2,
        vencido: 0,
        parcelas: [
          { numero: 1, valor: 0.1, vencimento: "2026-11-01", status: "paga", atrasada: false },
          { numero: 2, valor: 0.2, vencimento: "2026-12-10", status: "prevista", atrasada: false },
        ],
      }),
      conta({ conta_id: "c2", recebido: 0.2, a_receber: 0.1 }),
    ]);
    expect(r.recebido).toBe(0.3); // 0,1 + 0,2 sem 0,30000000000000004
    expect(r.aReceber).toBe(0.3);
    expect(r.parcelasPagas).toBe(1);
    expect(r.parcelasAbertas).toBe(1);
    expect(r.proximaAVencer).toBe("2026-12-10");
  });

  it("o valor vencido é o do banco, mesmo que as parcelas contem outra coisa", () => {
    const r = resumirContas([
      conta({
        a_receber: 500,
        vencido: 123.45,
        parcelas: [{ numero: 1, valor: 500, vencimento: "2026-11-10", status: "prevista", atrasada: true }],
      }),
    ]);
    expect(r.vencido).toBe(123.45);
    expect(r.parcelasVencidas).toBe(1);
    expect(r.maisAntigaVencida).toBe("2026-11-10");
  });

  it("achar a vencida mais antiga e a próxima a vencer entre várias", () => {
    const r = resumirContas([
      conta({
        a_receber: 300,
        vencido: 200,
        parcelas: [
          { numero: 1, valor: 100, vencimento: "2026-11-12", status: "prevista", atrasada: true },
          { numero: 2, valor: 100, vencimento: "2026-10-30", status: "prevista", atrasada: true },
          { numero: 3, valor: 100, vencimento: "2026-12-20", status: "prevista", atrasada: false },
          { numero: 4, valor: 100, vencimento: "2026-12-05", status: "prevista", atrasada: false },
        ],
      }),
    ]);
    expect(r.maisAntigaVencida).toBe("2026-10-30");
    expect(r.proximaAVencer).toBe("2026-12-05");
  });

  it("parcelas nulas não quebram", () => {
    expect(resumirContas([conta({ parcelas: null })]).parcelasAbertas).toBe(0);
    expect(resumirContas([]).contas).toBe(0);
  });

  it("filtra as contas de um cliente e de uma OS", () => {
    const todas = [
      conta({ conta_id: "a", cliente_id: "x", os_id: "o1" }),
      conta({ conta_id: "b", cliente_id: "y", os_id: "o2" }),
      conta({ conta_id: "c", cliente_id: "x", os_id: "o3" }),
    ];
    expect(contasDoCliente(todas, "x").map((c) => c.conta_id)).toEqual(["a", "c"]);
    expect(contasDaOs(todas, "o2").map((c) => c.conta_id)).toEqual(["b"]);
    expect(contasDaOs(todas, "nenhuma")).toEqual([]);
  });
});

describe("eloDeRecebimento", () => {
  it("quem não lê o financeiro não recebe elo nenhum, nem 'tudo recebido'", () => {
    expect(eloDeRecebimento(SEM_ACESSO, "cliente")).toBeNull();
    expect(eloDeRecebimento(SEM_ACESSO, "os")).toBeNull();
  });

  it("carregando não traz link nem número", () => {
    const e = eloDeRecebimento(CARREGANDO, "os");
    expect(e?.tom).toBe("carregando");
    expect(e?.destino).toBeUndefined();
  });

  it("leitura que falhou diz que falhou, não 'nada a receber'", () => {
    const e = eloDeRecebimento(ERRO, "cliente");
    expect(e?.tom).toBe("erro");
    expect(e?.texto).toMatch(/Não foi possível ler/);
    expect(e?.texto).not.toMatch(/Tudo recebido|Nenhuma conta/);
  });

  it("sem conta nenhuma: diz o que falta, sem prometer link", () => {
    const os = eloDeRecebimento(OK<ContaLida[]>([]), "os");
    expect(os?.texto).toBe("Sem conta a receber ligada");
    expect(os?.tom).toBe("vazio");
    expect(os?.destino).toBeUndefined();
    expect(eloDeRecebimento(OK<ContaLida[]>([]), "cliente")?.texto).toBe("Nenhuma conta a receber registrada");
  });

  it("tudo pago", () => {
    const e = eloDeRecebimento(
      OK([
        conta({
          recebido: 450,
          parcelas: [
            { numero: 1, valor: 200, vencimento: "2026-10-01", status: "paga", atrasada: false },
            { numero: 2, valor: 250, vencimento: "2026-11-01", status: "paga", atrasada: false },
          ],
        }),
      ]),
      "cliente",
    );
    expect(e?.texto).toBe("Tudo recebido");
    expect(e?.tom).toBe("normal");
    expect(e?.detalhe).toMatch(/2 parcelas pagas/);
    expect(e?.detalhe).toMatch(/450,00/);
    expect(e?.destino).toEqual({ rota: "a-receber" });
  });

  it("com vencida: atenção, valor do banco e a data da mais antiga", () => {
    const e = eloDeRecebimento(
      OK([
        conta({
          a_receber: 1234.5,
          vencido: 400,
          parcelas: [
            { numero: 1, valor: 400, vencimento: "2026-11-10", status: "prevista", atrasada: true },
            { numero: 2, valor: 834.5, vencimento: "2026-12-10", status: "prevista", atrasada: false },
          ],
        }),
      ]),
      "cliente",
    );
    expect(e?.tom).toBe("atencao");
    expect(e?.texto).toMatch(/2 parcelas em aberto/);
    expect(e?.texto).toMatch(/1\.234,50/);
    expect(e?.detalhe).toMatch(/1 vencida/);
    expect(e?.detalhe).toMatch(/400,00/);
    expect(e?.detalhe).toMatch(/10\/11\/2026/);
  });

  it("em aberto e nada vencido: normal, com a próxima data", () => {
    const e = eloDeRecebimento(
      OK([
        conta({
          a_receber: 100,
          parcelas: [{ numero: 1, valor: 100, vencimento: "2026-12-10", status: "prevista", atrasada: false }],
        }),
      ]),
      "os",
    );
    expect(e?.tom).toBe("normal");
    expect(e?.texto).toMatch(/1 parcela em aberto/);
    expect(e?.detalhe).toMatch(/Nada vencido/);
    expect(e?.detalhe).toMatch(/10\/12\/2026/);
  });
});

describe("elosDaOs", () => {
  const base = {
    osId: "os1",
    os: { status: "em_producao", orcamento_id: "orc1", cliente_id: "cli1", cliente_nome: "Gráfica Alfa" },
    orcamento: OK({ numero: 123, status: "convertido" }) as Leitura<{ numero: number; status: string } | null>,
    produtos: OK({ itens: 2, semProduto: 0, produtos: [{ id: "p1", nome: "Banner lona" }] }),
    entregas: OK([]) as Leitura<never[]>,
    contas: SEM_ACESSO as Leitura<ContaLida[]>,
  };

  it("liga o orçamento de origem, o cliente e o produto", () => {
    const elos = elosDaOs(base);
    expect(porChave(elos, "orcamento")?.texto).toBe("Orçamento #123");
    expect(porChave(elos, "orcamento")?.detalhe).toBe("Virou OS");
    expect(porChave(elos, "orcamento")?.destino).toEqual({ rota: "orcamento", id: "orc1" });
    expect(porChave(elos, "cliente")?.texto).toBe("Gráfica Alfa");
    expect(porChave(elos, "cliente")?.destino).toEqual({ rota: "cliente", id: "cli1" });
    expect(porChave(elos, "produtos")?.texto).toBe("Banner lona");
    expect(porChave(elos, "produtos")?.destino).toEqual({ rota: "produto", id: "p1" });
  });

  it("OS sem orçamento diz isso e não tem link", () => {
    const elos = elosDaOs({ ...base, os: { ...base.os, orcamento_id: null } });
    const o = porChave(elos, "orcamento");
    expect(o?.texto).toBe("Sem orçamento ligado");
    expect(o?.tom).toBe("vazio");
    expect(o?.destino).toBeUndefined();
  });

  it("se a leitura do número do orçamento falha, o link continua certo (o id vem da própria OS)", () => {
    const elos = elosDaOs({ ...base, orcamento: ERRO });
    expect(porChave(elos, "orcamento")?.destino).toEqual({ rota: "orcamento", id: "orc1" });
    expect(porChave(elos, "orcamento")?.texto).toBe("Orçamento de origem ligado");
  });

  it("sem cliente ligado é atenção", () => {
    const elos = elosDaOs({ ...base, os: { ...base.os, cliente_id: null, cliente_nome: null } });
    expect(porChave(elos, "cliente")?.tom).toBe("atencao");
    expect(porChave(elos, "cliente")?.destino).toBeUndefined();
  });

  it("produtos: o produto vem dos itens, e item de texto livre é avisado", () => {
    const umeSemProduto = elosDaOs({
      ...base,
      produtos: OK({ itens: 3, semProduto: 2, produtos: [{ id: "p1", nome: "Banner lona" }] }),
    });
    expect(porChave(umeSemProduto, "produtos")?.detalhe).toBe("2 itens sem produto do catálogo");

    const varios = elosDaOs({
      ...base,
      produtos: OK({
        itens: 5,
        semProduto: 1,
        produtos: [
          { id: "p1", nome: "Banner" },
          { id: "p2", nome: "Adesivo" },
          { id: "p3", nome: "Placa" },
          { id: "p4", nome: "Lona" },
        ],
      }),
    });
    const v = porChave(varios, "produtos");
    expect(v?.texto).toBe("4 produtos do catálogo");
    expect(v?.detalhe).toBe("Banner, Adesivo, Placa… · 1 item sem produto do catálogo");
    expect(v?.destino).toBeUndefined(); // vários: não dá para linkar um só

    const nenhum = elosDaOs({ ...base, produtos: OK({ itens: 2, semProduto: 2, produtos: [] }) });
    expect(porChave(nenhum, "produtos")?.texto).toBe("Nenhum item é de produto do catálogo");
    expect(porChave(nenhum, "produtos")?.tom).toBe("vazio");

    const semItens = elosDaOs({ ...base, produtos: OK({ itens: 0, semProduto: 0, produtos: [] }) });
    expect(porChave(semItens, "produtos")?.texto).toBe("Sem itens na OS");
  });

  it("entrega: sem registro numa OS que já saiu da produção é atenção; antes disso, só neutro", () => {
    const concluida = elosDaOs({ ...base, os: { ...base.os, status: "concluido" } });
    const e = porChave(concluida, "entrega");
    expect(e?.texto).toBe("Sem registro de entrega ou retirada");
    expect(e?.tom).toBe("atencao");

    const emProducao = elosDaOs(base);
    expect(porChave(emProducao, "entrega")?.tom).toBe("vazio");
  });

  it("entrega registrada: mostra a mais recente", () => {
    const elos = elosDaOs({
      ...base,
      entregas: OK([
        { tipo: "entrega", status: "agendada", data_agendada: "2026-11-10T12:00:00Z", data_realizada: null },
        { tipo: "retirada", status: "concluida", data_agendada: null, data_realizada: "2026-11-21T15:00:00Z" },
      ]),
    });
    const e = porChave(elos, "entrega");
    expect(e?.texto).toBe("Retirada concluída");
    expect(e?.detalhe).toMatch(/21\/11\/2026/);
    expect(e?.detalhe).toMatch(/2 registros/);
    expect(e?.destino).toEqual({ rota: "entregas" });
  });

  it("para quem não lê o financeiro não existe o elo 'A receber'; para quem lê, existe", () => {
    expect(porChave(elosDaOs(base), "a-receber")).toBeUndefined();
    const com = elosDaOs({ ...base, contas: OK([conta({ recebido: 100, parcelas: [{ numero: 1, valor: 100, vencimento: "2026-11-01", status: "paga", atrasada: false }] })]) });
    expect(porChave(com, "a-receber")?.texto).toBe("Tudo recebido");
  });

  it("o status da OS não vaza no detalhe do orçamento (só o do orçamento)", () => {
    const elos = elosDaOs({ ...base, orcamento: OK({ numero: 9, status: "aprovado" }) });
    expect(porChave(elos, "orcamento")?.detalhe).toBe("Aprovado");
  });
});

describe("elosDoOrcamento", () => {
  const base = {
    orc: { status: "enviado", cliente_id: "cli1", cliente_nome: "Gráfica Alfa", os_id: null as string | null, enviado_em: "2026-11-20T15:00:00Z" },
    os: OK(null) as Leitura<{ numero: number; status: string } | null>,
    envios: OK([]) as Leitura<{ canal: string | null; enviado_em: string | null }[]>,
    conversa: OK(null) as Leitura<{ id: string } | null>,
  };

  it("liga o cliente", () => {
    const elos = elosDoOrcamento(base);
    expect(porChave(elos, "cliente")?.destino).toEqual({ rota: "cliente", id: "cli1" });
  });

  it("sem cliente: neutro no rascunho, atenção depois que sai dele", () => {
    const rascunho = elosDoOrcamento({ ...base, orc: { ...base.orc, status: "rascunho", cliente_id: null, cliente_nome: null } });
    expect(porChave(rascunho, "cliente")?.tom).toBe("vazio");
    const enviado = elosDoOrcamento({ ...base, orc: { ...base.orc, cliente_id: null, cliente_nome: null } });
    expect(porChave(enviado, "cliente")?.tom).toBe("atencao");
    expect(porChave(enviado, "cliente")?.detalhe).toMatch(/OS só nasce com o cliente/);
  });

  it("aprovado sem OS é atenção; com OS liga ao número", () => {
    const sem = elosDoOrcamento({ ...base, orc: { ...base.orc, status: "aprovado" } });
    expect(porChave(sem, "os")?.texto).toBe("Aprovado e ainda sem OS");
    expect(porChave(sem, "os")?.tom).toBe("atencao");

    const com = elosDoOrcamento({
      ...base,
      orc: { ...base.orc, status: "convertido", os_id: "os9" },
      os: OK({ numero: 261, status: "em_producao" }),
    });
    const o = porChave(com, "os");
    expect(o?.texto).toBe("OS #261");
    expect(o?.detalhe).toBe("Em produção");
    expect(o?.destino).toEqual({ rota: "os", id: "os9" });
  });

  it("rascunho ou enviado sem OS: neutro", () => {
    expect(porChave(elosDoOrcamento(base), "os")?.texto).toBe("Ainda sem OS");
    expect(porChave(elosDoOrcamento(base), "os")?.tom).toBe("vazio");
  });

  it("envios: conta, último e canal", () => {
    const elos = elosDoOrcamento({
      ...base,
      envios: OK([
        { canal: "wa_me", enviado_em: "2026-11-18T12:00:00Z" },
        { canal: "whatsapp_sistema", enviado_em: "2026-11-21T15:02:00Z" },
        { canal: "wa_me", enviado_em: "2026-11-19T12:00:00Z" },
      ]),
    });
    const e = porChave(elos, "envios");
    expect(e?.texto).toBe("Enviado 3 vezes");
    expect(e?.detalhe).toMatch(/último em 21\/11\/2026/);
    expect(e?.detalhe).toMatch(/pelo WhatsApp do sistema/);
    expect(porChave(elosDoOrcamento({ ...base, envios: OK([{ canal: "wa_me", enviado_em: "2026-11-18T12:00:00Z" }]) }), "envios")?.texto).toBe("Enviado 1 vez");
  });

  it("sem registro de envio mas marcado como enviado: não inventa nem nega; diz as duas coisas", () => {
    const e = porChave(elosDoOrcamento(base), "envios");
    expect(e?.texto).toBe("Sem registro de envio pelo sistema");
    expect(e?.detalhe).toMatch(/Marcado como enviado em 20\/11\/2026/);
    expect(e?.tom).toBe("vazio");
    const rascunho = porChave(elosDoOrcamento({ ...base, orc: { ...base.orc, status: "rascunho", enviado_em: null } }), "envios");
    expect(rascunho?.texto).toBe("Ainda não enviado");
  });

  it("falha na leitura dos envios é dita", () => {
    expect(porChave(elosDoOrcamento({ ...base, envios: ERRO }), "envios")?.tom).toBe("erro");
  });

  it("conversa só aparece quando existe (não achar não prova que nunca conversaram)", () => {
    expect(porChave(elosDoOrcamento(base), "conversa")).toBeUndefined();
    expect(porChave(elosDoOrcamento({ ...base, conversa: SEM_ACESSO }), "conversa")).toBeUndefined();
    expect(porChave(elosDoOrcamento({ ...base, conversa: ERRO }), "conversa")).toBeUndefined();
    const com = porChave(elosDoOrcamento({ ...base, conversa: OK({ id: "cv1" }) }), "conversa");
    expect(com?.destino).toEqual({ rota: "conversa", id: "cv1" });
  });
});

describe("elosDoCliente", () => {
  it("sem acesso ao financeiro e não sendo parceiro: nenhum elo (a faixa some, nada é afirmado)", () => {
    expect(elosDoCliente({ contas: SEM_ACESSO, parceiro: OK(null) })).toEqual([]);
    expect(elosDoCliente({ contas: SEM_ACESSO, parceiro: SEM_ACESSO })).toEqual([]);
  });

  it("mostra o que o cliente deve e que ele é parceiro", () => {
    const elos = elosDoCliente({
      contas: OK([
        conta({
          a_receber: 100,
          vencido: 100,
          parcelas: [{ numero: 1, valor: 100, vencimento: "2026-11-01", status: "prevista", atrasada: true }],
        }),
      ]),
      parceiro: OK({ id: "pa1", marca_nome: "Gráfica Alfa", status: "ativo" }),
    });
    expect(porChave(elos, "a-receber")?.tom).toBe("atencao");
    const pa = porChave(elos, "parceiro");
    expect(pa?.texto).toBe("Parceiro: Gráfica Alfa");
    expect(pa?.detalhe).toBe("Cadastro ativo");
    expect(pa?.destino).toEqual({ rota: "parceiros" });
  });

  it("erro na leitura das contas aparece como erro, não como 'nada a receber'", () => {
    const elos = elosDoCliente({ contas: ERRO, parceiro: OK(null) });
    expect(elos).toHaveLength(1);
    expect(elos[0].tom).toBe("erro");
  });
});
