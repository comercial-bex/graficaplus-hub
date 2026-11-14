import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ETAPAS_QUADRO,
  ROTULO_ETAPA,
  etapaDe,
  faltaEmPalavras,
  rotuloBloqueio,
  rotuloDe,
  statusPadraoDaEtapa,
} from "../src/domain/os/etapas";
import {
  ehGestor,
  equipeParaEscolher,
  papeisEmTexto,
  primeiroNome,
  type PessoaDaProducao,
} from "../src/domain/os/equipe-da-producao";

/**
 * Pedido do dono, 14/11/2026:
 *  - "para chegar na criação, o gestor autoriza… ele bota assim ali, avançar, aí avança
 *    a criação. Só vamos usar a aba nova de atendimento validado";
 *  - "não marque sempre pelo papel da pessoa, pelo gestor" — quem faz a criação é
 *    escolha do gestor;
 *  - "dentro de um modal, eu seleciono um operador, o Fernando, para seguir para ele";
 *  - "cliente que vai ficar devendo… só quem pode autorizar é o gestor";
 *  - "e que chegue também" — hoje a aprovação é feita no grupo do WhatsApp.
 *
 * Ensaio no Postgres em 14/11/2026, com rollback: a OS 221 (Atendimento) foi barrada
 * por "Atendimento não validado pelo gestor"; a Maiara (vendedora) não validou
 * (42501) e pediu pelo grupo, citando o gestor; o Raymison (gestor) validou com a
 * Maiara na criação e a OS foi para briefing_ok; o saldo devedor só passou pelo
 * gestor; a fila com o Fernando e a troca de operador saíram no grupo citando cada um;
 * e a OS 170 ao ficar pronta citou o atendimento.
 */

const SQL = readFileSync(
  "supabase/migrations/20261114190000_atendimento_validado_operador_e_saldo_devedor.sql",
  "utf8",
);
const AVAL = readFileSync("src/components/kanban/aval-do-gestor.tsx", "utf8");
const FICHA = readFileSync("src/components/kanban/ficha-da-os.tsx", "utf8");
const KANBAN = readFileSync("src/routes/_authenticated/kanban.tsx", "utf8");
const OFICINA = readFileSync("src/components/painel/PainelProducao.tsx", "utf8");

/** O corpo de uma função da migração, entre os $$ do AS. */
function corpo(nome: string): string {
  const inicio = SQL.indexOf(`CREATE OR REPLACE FUNCTION public.${nome}(`);
  expect(inicio, `a migração define ${nome}`).toBeGreaterThan(-1);
  const m = /AS (\$\w*\$)([\s\S]*?)\1/.exec(SQL.slice(inicio));
  return m ? m[2] : "";
}

const pessoa = (nome: string, papeis: string[], tem_whatsapp = true): PessoaDaProducao => ({
  id: nome.toLowerCase(),
  nome,
  avatar_url: null,
  papeis,
  tem_whatsapp,
});

describe("a etapa nova: Atendimento validado", () => {
  it("fica entre o Atendimento e a Criação, e usa o status briefing_ok", () => {
    expect(ETAPAS_QUADRO.slice(0, 3)).toEqual(["entrada", "validado", "pre_impressao"]);
    expect(ROTULO_ETAPA.validado).toBe("Atendimento validado");
    expect(etapaDe("briefing_ok")).toBe("validado");
    expect(rotuloDe("briefing_ok")).toBe("Atendimento validado");
    expect(statusPadraoDaEtapa("validado")).toBe("briefing_ok");
    // entrada e aguardando_briefing continuam no Atendimento
    expect(etapaDe("aguardando_briefing")).toBe("entrada");
  });

  it("o banco diz o mesmo: etapa_da_os e o bloco da TV", () => {
    expect(SQL).toContain("WHEN p_status IN ('briefing_ok') THEN 'validado'");
    expect(SQL).toContain("WHEN 'validado' THEN 'entrada_arte'");
  });

  it("a trava tem nome na tela, por extenso e no cartão", () => {
    expect(rotuloBloqueio("atendimento_nao_validado")).toBe("Atendimento não validado pelo gestor");
    expect(
      faltaEmPalavras([
        { codigo: "atendimento_nao_validado", titulo: "Atendimento não validado pelo gestor" },
        { codigo: "sem_pagamento", titulo: "Nenhum pagamento registrado" },
      ]),
    ).toBe("validação do gestor · pagamento");
  });
});

describe("a trava, no banco", () => {
  const travas = corpo("os_bloqueios_para");

  it("sair do Atendimento para qualquer etapa adiante pede a validação (OS de venda, fora a de 3D)", () => {
    expect(travas).toContain("AND public.etapa_da_os(v_os.status) = 'entrada'");
    expect(travas).toContain("AND public.etapa_da_os(novo_status) NOT IN ('entrada', 'fora_do_fluxo')");
    expect(travas).toContain("AND NOT public.os_e_impressao_3d(os_bloqueios_para.os_id, v_os.orcamento_id)");
    expect(travas).toContain("au.tipo = 'atendimento_validado'");
    expect(travas).toContain("'codigo', 'atendimento_nao_validado'");
  });

  it("sem pagamento deixa de travar só com a autorização do gestor", () => {
    expect(travas).toContain("IF v_total_pago <= 0 AND v_os.finalidade = 'venda' AND NOT EXISTS (");
    expect(travas).toContain("au.tipo = 'saldo_devedor'");
    // As outras travas seguem como estavam.
    for (const codigo of ["sem_responsavel", "arte_nao_aprovada", "sem_arquivo_final", "material_insuficiente", "margem_baixa"]) {
      expect(travas, codigo).toContain(`'codigo', '${codigo}'`);
    }
  });
});

describe("só o gestor autoriza, e a autorização é registrada", () => {
  it("validar e autorizar conferem o papel de quem chama, e gravam quem foi", () => {
    for (const nome of ["validar_atendimento", "autorizar_saldo_devedor"]) {
      const c = corpo(nome);
      expect(c, nome).toContain("IF NOT public.eh_gestor(v_uid) THEN");
      expect(c, nome).toContain("USING ERRCODE = '42501'");
      expect(c, nome).toContain("INSERT INTO public.os_autorizacoes");
      expect(c, nome).toContain("INSERT INTO public.logs_auditoria");
    }
  });

  it("validar exige quem faz a criação e passa pela porta de sempre (as travas e o histórico)", () => {
    const c = corpo("validar_atendimento");
    expect(c).toContain("IF p_designer_id IS NULL OR NOT public.is_staff(p_designer_id) THEN");
    expect(c).toContain("UPDATE public.ordens_servico SET designer_id = p_designer_id");
    expect(c).toContain("PERFORM public.avancar_os_status(p_os_id, 'briefing_ok'::status_os);");
  });

  it("ficar devendo pede o motivo", () => {
    expect(corpo("autorizar_saldo_devedor")).toContain("IF v_motivo IS NULL OR length(v_motivo) < 5 THEN");
  });

  it("o operador e a fila vão juntos, numa transação só", () => {
    const c = corpo("mandar_para_fila_de_producao");
    expect(c).toContain("UPDATE public.ordens_servico SET operador_id = p_operador_id");
    expect(c).toContain("PERFORM public.avancar_os_status(p_os_id, 'aguardando_producao'::status_os);");
  });

  it("a tabela não aceita escrita do navegador e esconde o valor em aberto", () => {
    expect(SQL).toContain("REVOKE ALL ON public.os_autorizacoes FROM PUBLIC, anon, authenticated;");
    expect(SQL).toContain(
      "GRANT SELECT (id, os_id, tipo, autorizado_por, autorizado_em, motivo, designer_id)\n  ON public.os_autorizacoes TO authenticated;",
    );
    expect(AVAL).toContain('.select("id, tipo, autorizado_por, autorizado_em, motivo, designer_id")');
    expect(AVAL).not.toContain("valor_em_aberto");
  });
});

describe("as permissões das funções novas", () => {
  it("toda função nova é revogada de PUBLIC, anon e authenticated, e conferida", () => {
    const internas = ["eh_gestor(uuid)", "_mencao_whatsapp(uuid)", "_citacao_no_texto(uuid)", "tg_os_pronta_avisa_atendimento()"];
    const doNavegador = [
      "validar_atendimento(uuid, uuid, text)",
      "pedir_aval_do_gestor(uuid, text)",
      "autorizar_saldo_devedor(uuid, text)",
      "mandar_para_fila_de_producao(uuid, uuid)",
      "definir_operador_da_os(uuid, uuid)",
      "equipe_da_producao()",
    ];
    for (const f of [...internas, ...doNavegador]) expect(SQL, f).toContain(`'public.${f}'`);
    expect(SQL).toContain("'public._os_avisar_grupo(uuid, text, text, text, text[], text)'");
    expect(SQL).toContain("EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_funcao);");
    expect(SQL).toContain("IF has_function_privilege('anon', v_funcao, 'EXECUTE')");
    expect(SQL).toContain("OR has_function_privilege('authenticated', v_funcao, 'EXECUTE') THEN");
  });

  it("toda função que grava é SECURITY DEFINER com search_path fixo", () => {
    for (const nome of [
      "validar_atendimento",
      "pedir_aval_do_gestor",
      "autorizar_saldo_devedor",
      "mandar_para_fila_de_producao",
      "definir_operador_da_os",
      "_os_avisar_grupo",
      "tg_os_pronta_avisa_atendimento",
    ]) {
      const inicio = SQL.indexOf(`CREATE OR REPLACE FUNCTION public.${nome}(`);
      const cabecalho = SQL.slice(inicio, SQL.indexOf("AS $$", inicio));
      expect(cabecalho, nome).toContain("SECURITY DEFINER");
      expect(cabecalho, nome).toContain("SET search_path = public");
    }
  });
});

describe("o aviso no grupo da equipe", () => {
  it("vai pelo grupo da equipe, com o link que abre a ficha, sem cliente_id", () => {
    const c = corpo("_os_avisar_grupo");
    expect(c).toContain("public.grupo_equipe_destino()");
    expect(c).toContain("https://bexprint.com.br/kanban?os=%s");
    expect(c).toContain("public.enfileirar_notificacao('whatsapp', v_grupo, NULL, 'aviso_grupo_equipe',");
    expect(c).toContain("'mencionar', to_jsonb(");
  });

  it("cada passo cita quem tem de agir", () => {
    expect(corpo("pedir_aval_do_gestor")).toContain("WHERE u.ativo IS NOT FALSE AND public.eh_gestor(u.id)");
    expect(corpo("validar_atendimento")).toContain("ARRAY[public._mencao_whatsapp(p_designer_id)]");
    expect(corpo("mandar_para_fila_de_producao")).toContain("ARRAY[public._mencao_whatsapp(p_operador_id)]");
    expect(corpo("tg_os_pronta_avisa_atendimento")).toContain("unnest(ARRAY[NEW.vendedor_id, NEW.responsavel_id])");
  });

  it("o aviso nunca derruba o passo: falhou, fica o WARNING", () => {
    for (const nome of ["validar_atendimento", "autorizar_saldo_devedor", "mandar_para_fila_de_producao", "definir_operador_da_os", "tg_os_pronta_avisa_atendimento"]) {
      expect(corpo(nome), nome).toContain("EXCEPTION WHEN OTHERS THEN");
      expect(corpo(nome), nome).toContain("RAISE WARNING 'aviso no grupo da equipe falhou");
    }
  });

  it("pedir ao gestor não vira enxurrada: um pedido por OS e assunto a cada 15 minutos", () => {
    expect(corpo("pedir_aval_do_gestor")).toContain("floor(extract(epoch FROM now()) / 900)");
  });

  it("pronta = entrou na saída (retirada, entrega ou instalação), só OS de venda", () => {
    const c = corpo("tg_os_pronta_avisa_atendimento");
    expect(c).toContain("OR NEW.finalidade IS DISTINCT FROM 'venda'");
    expect(c).toContain("OR NEW.status NOT IN ('aguardando_retirada', 'aguardando_entrega', 'em_instalacao')");
    expect(c).toContain("OR public.etapa_da_os(OLD.status) IN ('saida', 'fora_do_fluxo') THEN");
    expect(SQL).toContain("AFTER UPDATE OF status ON public.ordens_servico");
  });

  it("o valor do saldo devedor não vai ao grupo (o operador lê o grupo e não vê preço)", () => {
    const c = corpo("autorizar_saldo_devedor");
    const aviso = c.slice(c.indexOf("_os_avisar_grupo"), c.indexOf("EXCEPTION WHEN OTHERS"));
    expect(aviso.length).toBeGreaterThan(50);
    expect(aviso).not.toContain("v_aberto");
  });

  it("o quadro não confunde o aviso do grupo com aviso ao cliente", () => {
    expect(KANBAN).toContain('.neq("evento", "aviso_grupo_equipe")');
  });
});

describe("quem faz: a equipe inteira, o papel só ordena", () => {
  const equipe = [
    pessoa("Raymison Saraiva", ["gestor", "vendedor"]),
    pessoa("Fernando Augusto", ["operador"]),
    pessoa("Maiara Brito", ["vendedor"]),
    pessoa("Jhesselem Medeiros", ["designer", "vendedor"]),
    pessoa("Cibele Oliveira", ["financeiro"], false),
  ];

  it("para a máquina, operadores primeiro; o resto da equipe continua escolhível", () => {
    const { sugeridos, outros } = equipeParaEscolher(equipe, "operador");
    expect(sugeridos.map((p) => p.nome)).toEqual(["Fernando Augusto"]);
    expect(outros.map((p) => p.nome)).toEqual(["Cibele Oliveira", "Jhesselem Medeiros", "Maiara Brito", "Raymison Saraiva"]);
  });

  it("para a criação, quem é da criação primeiro", () => {
    const { sugeridos, outros } = equipeParaEscolher(equipe, "criacao");
    expect(sugeridos.map((p) => p.nome)).toEqual(["Jhesselem Medeiros"]);
    expect(outros).toHaveLength(4);
  });

  it("gestor é gestor ou admin; os papéis em palavras", () => {
    expect(ehGestor(["gestor"])).toBe(true);
    expect(ehGestor(["admin"])).toBe(true);
    expect(ehGestor(["vendedor", "financeiro"])).toBe(false);
    expect(papeisEmTexto(["gestor", "vendedor"])).toBe("Gestor · Atendimento");
    expect(primeiroNome("Maiara Brito")).toBe("Maiara");
    expect(primeiroNome(null)).toBe("—");
  });
});

describe("as telas", () => {
  it("na ficha, o gestor valida e autoriza; quem não é gestor pede pelo grupo", () => {
    expect(FICHA).toContain('{ codigo: "atendimento_nao_validado", rotulo: "Atendimento validado pelo gestor", soVenda: true, soNaEntrada: true }');
    expect(FICHA).toContain("<ValidarAtendimento os={os} />");
    expect(FICHA).toContain('<PedirAoGestor osId={osId} assunto="atendimento" rotulo="Pedir a validação ao gestor" />');
    expect(FICHA).toContain("<AutorizarSaldoDevedor osId={osId} />");
    expect(FICHA).toContain('<PedirAoGestor osId={osId} assunto="saldo_devedor"');
    expect(FICHA).toContain("<AutorizacoesDaOs osId={os.id} />");
  });

  it("na ficha, escolher Atendimento validado ou a Fila no seletor abre a decisão, não muda só o status", () => {
    expect(FICHA).toContain('if (novo === "briefing_ok" && etapaAtual === "entrada") {');
    expect(FICHA).toContain('if (novo === "aguardando_producao") {');
    expect(FICHA).toContain("{podeTrocarOperador && <TrocarOperador os={os} />}");
  });

  it("no quadro, soltar em Atendimento validado ou na Fila abre a decisão", () => {
    expect(KANBAN).toContain('if (etapa === "validado" && etapaDe(atual.status) === "entrada") {');
    expect(KANBAN).toContain('if (etapa === "fila_producao") {');
    expect(KANBAN).toContain("<ValidarAtendimentoDialog os={validando}");
    expect(KANBAN).toContain("<EscolherOperadorDialog os={mandandoParaFila}");
  });

  it("o link do aviso abre a ficha no quadro", () => {
    expect(KANBAN).toContain("validateSearch: (busca: Record<string, unknown>): { os?: string } =>");
    expect(KANBAN).toContain("if (osDaUrl) setFichaId(osDaUrl);");
  });

  it("as telas chamam as funções do banco, nunca gravam a autorização direto", () => {
    for (const rpc of [
      '"validar_atendimento"',
      '"pedir_aval_do_gestor"',
      '"autorizar_saldo_devedor"',
      '"mandar_para_fila_de_producao"',
      '"definir_operador_da_os"',
      '"equipe_da_producao"',
    ]) {
      expect(AVAL, rpc).toContain(rpc);
    }
    expect(AVAL).not.toMatch(/from\("os_autorizacoes"\)\s*\.(insert|update|upsert|delete)/);
  });

  it("Minha oficina: o que foi mandado para quem está logado vem primeiro, com o selo", () => {
    expect(OFICINA).toContain("precisa_entrega, precisa_instalacao, operador_id");
    expect(OFICINA).toContain('{paraVoce && <StatusChip label="Para você" tone="lime" />}');
    expect(OFICINA).toContain("Number(b.operador_id === user?.id) - Number(a.operador_id === user?.id)");
  });
});
