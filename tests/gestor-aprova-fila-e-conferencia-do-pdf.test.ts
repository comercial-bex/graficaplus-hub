import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { conferirMedidaDoPdf, pontosParaMm } from "../src/domain/os/arquivos-da-os";
import {
  ROTULO_DO_ASSUNTO,
  TRAVA_DO_ASSUNTO,
  esperandoValidacaoSemPedido,
  filaDoGestor,
  type PedidoAoGestor,
} from "../src/domain/os/fila-do-gestor";

/**
 * Decisão do dono (14/11/2026, depois do PR #467): "o administrador só visualiza a
 * empresa; quem trata a aprovação é o gestor. Vai pelos papéis de atendimento e de
 * gestor." E: "traga soluções para tudo que falta".
 *
 * Ensaio no Postgres em 14/11/2026, com rollback:
 *  - o Harison (admin) não valida (42501) e deixou de ser citado;
 *  - o pedido de validação da Maiara entrou na fila uma vez só (pedir de novo não
 *    duplica) e saiu da fila sozinho quando o Raymison validou;
 *  - margem forçada a 5% na OS 226: a Maiara viu "Margem abaixo do mínimo" sem o número,
 *    pediu; ela e o Harison não liberaram (42501); o Raymison viu "5.00%", liberou, a
 *    trava sumiu, o pedido fechou e pedir de novo foi recusado;
 *  - "OS pronta" (OS 170, vendedor Fernando/operador, responsável Raymison) citou só o
 *    Raymison: o atendimento pelo papel.
 */

const SQL = readFileSync("supabase/migrations/20261114210000_gestor_aprova_fila_do_gestor_e_margem.sql", "utf8");
const AVAL = readFileSync("src/components/kanban/aval-do-gestor.tsx", "utf8");
const FICHA = readFileSync("src/components/kanban/ficha-da-os.tsx", "utf8");
const KANBAN = readFileSync("src/routes/_authenticated/kanban.tsx", "utf8");
const MEDIR = readFileSync("src/lib/pdf/medir-pdf.ts", "utf8");

function corpo(nome: string): string {
  const inicio = SQL.indexOf(`CREATE OR REPLACE FUNCTION public.${nome}(`);
  expect(inicio, `a migração define ${nome}`).toBeGreaterThan(-1);
  const m = /AS (\$\w*\$)([\s\S]*?)\1/.exec(SQL.slice(inicio));
  return m ? m[2] : "";
}

describe("só o gestor aprova; o admin só acompanha", () => {
  it("eh_gestor é só o papel gestor", () => {
    const c = corpo("eh_gestor");
    expect(c).toContain("public.has_role(p_usuario, 'gestor'::app_role)");
    expect(c).not.toContain("'admin'");
  });

  it("OS pronta cita o atendimento pelo papel (vendedor ou gestor da OS; senão, todo o atendimento)", () => {
    const c = corpo("tg_os_pronta_avisa_atendimento");
    expect(c).toContain("AND (public.has_role(p, 'vendedor'::app_role) OR public.has_role(p, 'gestor'::app_role))");
    expect(c).toContain("IF coalesce(cardinality(v_pessoas), 0) = 0 THEN");
    expect(c).toContain("public.has_role(u.id, 'vendedor'::app_role)");
  });
});

describe("a fila do gestor, no banco", () => {
  it("o pedido fica registrado, um aberto por OS e assunto", () => {
    expect(SQL).toContain("CREATE TABLE IF NOT EXISTS public.os_pedidos_ao_gestor");
    expect(SQL).toContain("ON public.os_pedidos_ao_gestor (os_id, assunto) WHERE resolvido_em IS NULL;");
    expect(corpo("pedir_aval_do_gestor")).toContain("ON CONFLICT (os_id, assunto) WHERE resolvido_em IS NULL DO NOTHING;");
  });

  it("com o grupo desligado o pedido fica só na fila, sem falhar", () => {
    const c = corpo("pedir_aval_do_gestor");
    expect(c).toContain("v_grupo boolean := public.grupo_equipe_destino() IS NOT NULL;");
    expect(c).toContain("IF v_grupo THEN");
    expect(c).not.toContain("O aviso no grupo da equipe está desligado");
  });

  it("a autorização do gestor resolve o pedido do mesmo assunto", () => {
    const c = corpo("tg_os_autorizacao_resolve_pedido");
    expect(c).toContain("SET resolvido_em = now(), resolvido_por = NEW.autorizado_por");
    expect(c).toContain("CASE NEW.tipo WHEN 'atendimento_validado' THEN 'atendimento' ELSE NEW.tipo END");
    expect(SQL).toContain("AFTER INSERT ON public.os_autorizacoes");
  });

  it("a tabela é só de leitura para a equipe", () => {
    expect(SQL).toContain("REVOKE ALL ON public.os_pedidos_ao_gestor FROM PUBLIC, anon, authenticated;");
    expect(SQL).toContain("GRANT SELECT ON public.os_pedidos_ao_gestor TO authenticated;");
  });
});

describe("margem baixa: o aval do gestor", () => {
  it("só o gestor libera, com motivo, e fica em os_autorizacoes", () => {
    const c = corpo("autorizar_margem_baixa");
    expect(c).toContain("IF NOT public.eh_gestor(v_uid) THEN");
    expect(c).toContain("IF v_motivo IS NULL OR length(v_motivo) < 5 THEN");
    expect(c).toContain("VALUES (p_os_id, 'margem_baixa', v_uid, v_motivo)");
    expect(SQL).toContain("CHECK (tipo IN ('atendimento_validado', 'saldo_devedor', 'margem_baixa'))");
  });

  it("a trava aceita o aval novo e continua aceitando o antigo", () => {
    const c = corpo("os_bloqueios_para");
    expect(c).toContain("au.tipo = 'margem_baixa'");
    expect(c).toContain("a.tipo::text = 'margem_baixa' AND a.aprovado = true");
    // As outras travas seguem todas lá.
    for (const codigo of ["sem_responsavel", "atendimento_nao_validado", "sem_pagamento", "arte_nao_aprovada", "sem_arquivo_final", "material_insuficiente", "margem_baixa"]) {
      expect(c, codigo).toContain(`'codigo', '${codigo}'`);
    }
  });

  it("o número da margem não vai ao grupo (o operador lê o grupo)", () => {
    const aviso = corpo("pedir_aval_do_gestor");
    expect(aviso).toContain("'📉 Margem abaixo do mínimo'");
    expect(aviso).not.toContain("v_margem");
  });

  it("a ficha: o gestor libera, quem não é gestor pede", () => {
    expect(FICHA).toContain("<AutorizarMargemBaixa osId={osId} />");
    expect(FICHA).toContain('<PedirAoGestor osId={osId} assunto="margem_baixa"');
    expect(AVAL).toContain('rpc: "autorizar_margem_baixa"');
  });
});

describe("as permissões", () => {
  it("funções novas e de gatilho fechadas, e conferidas", () => {
    expect(SQL).toContain("REVOKE ALL ON FUNCTION public.tg_os_autorizacao_resolve_pedido() FROM PUBLIC, anon, authenticated;");
    expect(SQL).toContain("REVOKE ALL ON FUNCTION public.tg_os_pronta_avisa_atendimento() FROM PUBLIC, anon, authenticated;");
    expect(SQL).toContain("'public.autorizar_margem_baixa(uuid, text)'");
    expect(SQL).toContain("IF has_function_privilege('anon', v_funcao, 'EXECUTE') THEN");
  });
});

describe("a fila do gestor, na tela", () => {
  const travas = new Map<string, { codigo: string }[]>([
    ["os-1", [{ codigo: "atendimento_nao_validado" }]],
    ["os-2", [{ codigo: "sem_arquivo_final" }]],
    ["os-3", [{ codigo: "atendimento_nao_validado" }, { codigo: "margem_baixa" }]],
    ["os-4", [{ codigo: "atendimento_nao_validado" }]],
  ]);
  const pedido = (id: string, os_id: string, assunto: PedidoAoGestor["assunto"], pedido_em: string): PedidoAoGestor => ({
    id,
    os_id,
    assunto,
    pedido_por: "maiara",
    pedido_em,
  });
  const pedidos = [
    pedido("p1", "os-1", "atendimento", "2026-11-14T15:00:00Z"),
    pedido("p2", "os-2", "saldo_devedor", "2026-11-14T13:00:00Z"), // a entrada foi paga: a trava saiu
    pedido("p3", "os-3", "margem_baixa", "2026-11-14T12:00:00Z"),
  ];

  it("só mostra o pedido cuja trava continua, do mais antigo ao mais novo", () => {
    expect(filaDoGestor(pedidos, travas).map((p) => p.id)).toEqual(["p3", "p1"]);
  });

  it("conta as OS esperando validação que ninguém pediu ainda", () => {
    expect(esperandoValidacaoSemPedido(pedidos, travas).sort()).toEqual(["os-3", "os-4"]);
  });

  it("cada assunto tem a sua trava e o seu nome", () => {
    expect(TRAVA_DO_ASSUNTO).toEqual({
      atendimento: "atendimento_nao_validado",
      saldo_devedor: "sem_pagamento",
      margem_baixa: "margem_baixa",
    });
    expect(ROTULO_DO_ASSUNTO.margem_baixa).toBe("Margem abaixo do mínimo");
  });

  it("o quadro mostra a fila no topo, e o gestor valida dali", () => {
    expect(KANBAN).toContain("<EsperandoOGestor");
    expect(KANBAN).toContain("onValidar={(alvo) => setValidando(alvo)}");
    expect(AVAL).toContain('.from("os_pedidos_ao_gestor")');
    expect(AVAL).toContain('.is("resolvido_em", null)');
  });
});

describe("conferência do PDF de impressão: medida, sangria e escala", () => {
  const peca = { largura: 1.5, altura: 0.5 };

  it("pontos do PDF em milímetros", () => {
    expect(pontosParaMm(72)).toBeCloseTo(25.4, 5);
    expect(pontosParaMm(595.28)).toBeCloseTo(210, 0); // A4
  });

  it("na medida da peça, deitado ou em pé", () => {
    expect(conferirMedidaDoPdf({ largura: 1500, altura: 500 }, peca)?.situacao).toBe("bate");
    expect(conferirMedidaDoPdf({ largura: 500, altura: 1500.4 }, peca)?.situacao).toBe("bate");
  });

  it("com sangria em volta", () => {
    const r = conferirMedidaDoPdf({ largura: 1506, altura: 506 }, peca);
    expect(r?.situacao).toBe("sangria");
    expect(r?.texto).toContain("sangria de 3 mm");
    expect(r?.alerta).toBe(false);
  });

  it("em escala (arte de lona em 1:10)", () => {
    const r = conferirMedidaDoPdf({ largura: 150, altura: 50 }, peca);
    expect(r?.situacao).toBe("escala");
    expect(r?.texto).toContain("1:10");
  });

  it("proporção diferente: alerta", () => {
    const r = conferirMedidaDoPdf({ largura: 210, altura: 297 }, peca);
    expect(r?.situacao).toBe("diferente");
    expect(r?.alerta).toBe(true);
    expect(r?.texto).toContain("150 × 50 cm");
  });

  it("sem medida não conclui nada", () => {
    expect(conferirMedidaDoPdf({ largura: 0, altura: 500 }, peca)).toBeNull();
    expect(conferirMedidaDoPdf({ largura: 1500, altura: 500 }, { largura: 0, altura: 0.5 })).toBeNull();
  });

  it("lê só a 1ª página, sem baixar o PDF inteiro, e a ficha mostra o resultado", () => {
    expect(MEDIR).toContain("disableAutoFetch: true, disableStream: true");
    expect(MEDIR).toContain("pagina.getViewport({ scale: 1 })");
    expect(FICHA).toContain("conferirMedidaDoPdf(paginaPdf, medida)");
    expect(FICHA).toContain("{conferenciaPdf.texto}");
  });
});
