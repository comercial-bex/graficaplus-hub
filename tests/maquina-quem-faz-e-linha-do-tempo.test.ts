import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ETAPAS, QUEM_FAZ_A_ETAPA } from "../src/domain/os/etapas";
import { comQuem, ehComigo, quemFazAgora } from "../src/domain/os/quem-faz-agora";
import { duracaoEmPalavras, linhaDoTempo } from "../src/domain/os/linha-do-tempo";

/**
 * Pedido do dono (15/11/2026):
 *  - "Não vi a opção de selecionar a máquina… Eu seleciono o operador e o operador
 *    seleciona a máquina — dentro do modal da tarefa do Kanban."
 *  - "Colocar em cenários de processos e quem executa cada processo, facilitando
 *    cada vez mais. E responsabilizando também por cada etapa."
 *
 * E o atalho achado no mesmo dia: a OS 221 (venda, sem validação) foi de "Entrada"
 * para "Arte aprovada" pelo registro do aceite da arte, que mudava o status direto.
 * Ensaio no Postgres em 15/11/2026, com rollback:
 *  - o aceite na OS 163 (Atendimento, sem validação) ficou gravado e a OS ficou em
 *    "entrada", e a função devolveu esse status (espera_validacao = true);
 *  - o gestor, mudando o status direto, foi recusado ("ainda não foi validada");
 *  - validada, a OS andou para "briefing_ok";
 *  - o Fernando pôs a OS 231 na fila da Plotter de Impressão; a Epson A4 (tipo sem
 *    etapa de produção) e uma OS fora da fila foram recusadas; a Maiara (atendimento)
 *    não pôde (42501).
 */

const SQL = readFileSync("supabase/migrations/20261115140000_maquina_na_fila_e_validacao_sem_atalho.sql", "utf8");
const FICHA = readFileSync("src/components/kanban/ficha-da-os.tsx", "utf8");
const MAQUINA = readFileSync("src/components/kanban/maquina-da-os.tsx", "utf8");
const KANBAN = readFileSync("src/routes/_authenticated/kanban.tsx", "utf8");
const CARTAO = readFileSync("src/components/kanban/cartao-os.tsx", "utf8");
const ACEITE = readFileSync("src/components/kanban/aceite-da-arte-rapido.tsx", "utf8");

function corpo(nome: string): string {
  const inicio = SQL.indexOf(`CREATE OR REPLACE FUNCTION public.${nome}(`);
  expect(inicio, `a migração define ${nome}`).toBeGreaterThan(-1);
  const m = /AS (\$\w*\$)([\s\S]*?)\1/.exec(SQL.slice(inicio));
  return m ? m[2] : "";
}

describe("a validação do gestor sem atalho", () => {
  it("a guarda é da tabela: nenhum caminho tira a OS de venda do Atendimento sem a validação", () => {
    const c = corpo("tg_os_atendimento_sem_atalho");
    expect(SQL).toContain("BEFORE UPDATE OF status ON public.ordens_servico");
    expect(c).toContain("AND public.os_espera_validacao_do_gestor(OLD.id) THEN");
    expect(c).toContain("RAISE EXCEPTION 'A OS nº % ainda não foi validada pelo gestor");
  });

  it("o fluxo da arte grava a decisão e a OS fica no Atendimento", () => {
    const c = corpo("tg_os_atendimento_sem_atalho");
    expect(c).toContain("IF NEW.status IN ('aguardando_aprovacao_arte', 'arte_aprovada', 'arte_rejeitada') THEN");
    expect(c).toContain("NEW.status := OLD.status;");
  });

  it("o aceite devolve o status de verdade, e a tela diz que falta o gestor", () => {
    const c = corpo("registrar_aceite_da_arte");
    expect(c).toContain("SELECT status::text INTO v_status FROM public.ordens_servico WHERE id = p_os_id;");
    expect(c).not.toContain("v_status := 'arte_aprovada';");
    expect(c).toContain("'espera_validacao', public.os_espera_validacao_do_gestor(p_os_id)");
    expect(ACEITE).toContain("A OS continua no Atendimento: falta o gestor validar para ela seguir.");
  });

  it("as funções de dentro ficam fechadas ao navegador", () => {
    expect(SQL).toContain("REVOKE ALL ON FUNCTION public.tg_os_atendimento_sem_atalho() FROM PUBLIC, anon, authenticated;");
    expect(SQL).toContain("'public.os_espera_validacao_do_gestor(uuid)'");
  });
});

describe("a máquina, escolhida pelo operador na ficha do quadro", () => {
  it("pôr na fila da máquina: só operador (producao.start) ou gestor, só na fila, máquina ativa e com etapa", () => {
    const c = corpo("definir_maquina_da_os");
    expect(c).toContain("NOT (public.has_permission(v_uid, 'producao.start') OR public.eh_gestor(v_uid))");
    expect(c).toContain("IF public.etapa_da_os(v_os.status) <> 'fila_producao' THEN");
    expect(c).toContain("IF public.status_da_maquina(v_tipo) IS NULL THEN");
    expect(c).toContain("'maquina_definida'");
  });

  it("a ficha tem o bloco da máquina na fila e na produção, com o seletor do painel para começar", () => {
    expect(FICHA).toContain('{(etapaAtual === "fila_producao" || etapaAtual === "producao") && (');
    expect(FICHA).toContain("<MaquinaDaOs os={os} />");
    expect(MAQUINA).toContain("<SeletorDeMaquina");
    expect(MAQUINA).toContain('"definir_maquina_da_os"');
    expect(MAQUINA).toContain("Escolher a máquina e começar");
    expect(MAQUINA).toContain('const podeComecar = hasPermission("producao.start");');
  });
});

describe("quem faz o próximo passo", () => {
  const os = {
    vendedor_id: "maiara",
    responsavel_id: "raymison",
    designer_id: "jhesselem",
    operador_id: "fernando",
    finalidade: "venda",
  };

  it("cada etapa diz o passo e quem responde por ele", () => {
    expect(quemFazAgora({ ...os, status: "entrada" }, { travas: [{ codigo: "atendimento_nao_validado" }] })).toMatchObject({
      papel: "Atendimento",
      pessoaId: "maiara",
      passo: "Fechar o pacote e pedir a validação ao gestor",
    });
    expect(quemFazAgora({ ...os, status: "briefing_ok" })).toMatchObject({ papel: "Criação", pessoaId: "jhesselem" });
    expect(quemFazAgora({ ...os, status: "aguardando_aprovacao_arte" })).toMatchObject({ papel: "Atendimento", pessoaId: "maiara" });
    expect(quemFazAgora({ ...os, status: "aguardando_producao" })).toMatchObject({
      papel: "Operador",
      pessoaId: "fernando",
      passo: "Escolher a máquina e começar",
    });
    expect(quemFazAgora({ ...os, status: "em_impressao" })).toMatchObject({ papel: "Operador", pessoaId: "fernando" });
    expect(quemFazAgora({ ...os, status: "aguardando_retirada" })).toMatchObject({ papel: "Atendimento", pessoaId: "maiara" });
    expect(quemFazAgora({ ...os, status: "pausado" })).toBeNull();
  });

  it("sem pessoa na OS, o passo é escolher a pessoa (o gestor) ou fica dito que falta", () => {
    expect(quemFazAgora({ ...os, operador_id: null, status: "aguardando_producao" })).toMatchObject({
      papel: "Gestor",
      passo: "Escolher quem vai produzir",
    });
    const semDesigner = quemFazAgora({ ...os, designer_id: null, status: "design" })!;
    expect(semDesigner.semPessoa).toBe(true);
    expect(comQuem(semDesigner, () => null)).toBe("ainda sem alguém na criação");
  });

  it("pedido aberto ao gestor com a trava de pé: a OS está com o gestor", () => {
    const p = quemFazAgora(
      { ...os, status: "arte_aprovada" },
      { travas: [{ codigo: "sem_pagamento" }], pedidosAoGestor: ["saldo_devedor"] },
    );
    expect(p).toMatchObject({ papel: "Gestor", pessoaId: null });
    // A trava saiu (a entrada foi paga): o pedido não segura mais a OS.
    expect(quemFazAgora({ ...os, status: "arte_aprovada" }, { travas: [], pedidosAoGestor: ["saldo_devedor"] })).toMatchObject({
      papel: "Criação",
    });
  });

  it("em palavras, e o filtro Comigo", () => {
    const p = quemFazAgora({ ...os, status: "em_corte" })!;
    const nomes = new Map([["fernando", "Fernando"]]);
    expect(comQuem(p, (id) => nomes.get(id) ?? null)).toBe("com Fernando · operador");
    expect(comQuem(p, (id) => nomes.get(id) ?? null, "fernando")).toBe("com você");
    expect(ehComigo(p, "fernando", false)).toBe(true);
    expect(ehComigo(p, "maiara", false)).toBe(false);
    const doGestor = quemFazAgora({ ...os, operador_id: null, status: "aguardando_producao" })!;
    expect(comQuem(doGestor, () => null)).toBe("com o gestor");
    expect(ehComigo(doGestor, "raymison", true)).toBe(true);
  });

  it("toda etapa diz quem faz, no cabeçalho da coluna", () => {
    for (const e of ETAPAS) expect(QUEM_FAZ_A_ETAPA[e], e).toBeTruthy();
    expect(KANBAN).toContain("{QUEM_FAZ_A_ETAPA[etapa]}");
  });

  it("o quadro calcula e passa ao cartão; o filtro Comigo usa o mesmo cálculo", () => {
    expect(KANBAN).toContain("comigo: ehComigo(passo, user?.id, gestor)");
    expect(KANBAN).toContain("if (soComigo && !agoraPorOs.get(o.id)?.comigo) return false;");
    expect(KANBAN).toContain("<UserRound className=\"mr-1 h-4 w-4\" /> Comigo");
    expect(CARTAO).toContain("{agora.comQuem}");
    // O cartão segue sem hooks de login e de consulta (o teste do title o desenha sem provedores).
    expect(CARTAO).not.toContain("useAuth(");
    expect(CARTAO).not.toContain("usePedidosAoGestor(");
    expect(FICHA).toContain("<span className=\"font-medium text-foreground\">Agora: </span>");
  });
});

describe("a linha do tempo: quem levou a OS a cada etapa e quanto tempo ficou", () => {
  const trocas = [
    { status_anterior: null, status_novo: "entrada", mudou_em: "2026-11-10T17:00:00Z", mudou_por: "raymison" },
    { status_anterior: "entrada", status_novo: "briefing_ok", mudou_em: "2026-11-12T19:00:00Z", mudou_por: "raymison" },
    { status_anterior: "briefing_ok", status_novo: "design", mudou_em: "2026-11-12T19:45:00Z", mudou_por: "jhesselem" },
  ];

  it("o tempo de cada passo vai até a troca seguinte; o último conta até agora", () => {
    const l = linhaDoTempo(trocas, new Date("2026-11-13T00:45:00Z"));
    expect(l.map((p) => p.minutos)).toEqual([2 * 24 * 60 + 2 * 60, 45, 5 * 60]);
    expect(l[0].abertura).toBe(true);
    expect(l[2].atual).toBe(true);
    expect(l.map((p) => p.por)).toEqual(["raymison", "raymison", "jhesselem"]);
  });

  it("a duração em palavras", () => {
    expect(duracaoEmPalavras(45)).toBe("45 min");
    expect(duracaoEmPalavras(200)).toBe("3h 20min");
    expect(duracaoEmPalavras(12 * 60 + 5)).toBe("12h");
    expect(duracaoEmPalavras(2 * 24 * 60 + 2 * 60)).toBe("2d 2h");
  });

  it("a ficha mostra a linha do tempo", () => {
    expect(FICHA).toContain('<Bloco titulo="Quem fez o quê">');
    expect(FICHA).toContain("<LinhaDoTempoDaOs osId={os.id} />");
  });
});
