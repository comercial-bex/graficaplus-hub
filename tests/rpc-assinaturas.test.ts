import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * O CONTRATO com as funções do banco.
 *
 * Terceira vez que a mesma armadilha morde neste projeto: a tela chama uma RPC
 * com nomes de parâmetro que a função não tem, o PostgREST responde
 * "Could not find the function ... in the schema cache", e o botão simplesmente
 * não funciona. Não é erro de compilação — `supabase.rpc as any` apaga o tipo —
 * e não é erro de banco, porque a chamada nunca chega lá.
 *
 * Casos reais:
 *   avancar_os_status  o Kanban mandava p_os_id/p_novo_status (corrigido antes)
 *   avancar_os_status  a tela da OS ainda mandava p_os_id/p_novo_status/
 *                      p_justificativa — trocar status pela tela da OS falhava
 *                      SEMPRE, e ninguém notou porque o Kanban funcionava
 *   fechar_os          `os_id` sem prefixo, ao contrário de quase todas
 *
 * A tabela abaixo foi lida do Postgres em 10/09/2026 com
 * `pg_get_function_identity_arguments`. Mudou a assinatura de alguma função?
 * Atualize aqui NA MESMA migração — o teste então aponta quais chamadas
 * ficaram para trás.
 *
 * A regra é uma só: TRÊS funções não usam o prefixo `p_`. Todas as outras usam.
 */
const ASSINATURAS: Record<string, string[]> = {
  abrir_aprovacao: ["p_token"],
  ajustar_estoque_material: ["p_material_id", "p_quantidade_contada", "p_motivo"],
  anexar_comprovante_parcela: ["p_conta_id", "p_comprovante_url"],
  aplicar_custo_hora_sugerido: ["p_maquina_id"],
  avancar_os_status: ["os_id", "novo_status"], // sem p_
  avisar_manualmente: ["p_id", "p_observacao"],
  baixar_estoque_os: ["p_os_id", "p_consumos"],
  baixar_parcela_compromisso: [
    "p_conta_id", "p_data_pagamento", "p_comprovante_url", "p_forma_pagamento", "p_lancar_caixa",
  ],
  breakdown_3d: ["p_inicio", "p_fim"],
  buscar_usuario_para_portal: ["p_busca"],
  cancelar_aviso: ["p_id", "p_motivo"],
  cancelar_avisos_orfaos: [],
  concluir_tarefa_os: ["p_tarefa_id", "p_concluir"],
  confirmar_pagamento_registrado: ["p_pagamento_id", "p_data", "p_referencia_externa"],
  converter_lead_em_cliente: ["p_lead_id", "p_dados", "p_criar_orcamento"],
  converter_orcamento_3d_em_os: ["p_orcamento_3d_id"],
  converter_orcamento_em_os: ["p_orcamento_id", "p_opcoes"],
  criar_link_aprovacao: ["p_arquivo_id", "p_dias"],
  custo_hora_sugerido: ["p_maquina_id"],
  custo_real_por_peca: ["p_os_id"],
  delete_filamento_3d: ["p_material_id"],
  delete_impressora_3d: ["p_maquina_id"],
  estornar_pagamento: ["p_pagamento_id", "p_motivo"],
  fechar_os: ["os_id"], // sem p_
  finalizar_apontamento: ["p_apontamento_id", "p_quantidade", "p_observacoes"],
  funil_comercial: ["p_inicio", "p_fim"],
  gerar_parcelas_compromisso: ["p_compromisso_id", "p_ate"],
  identificacao_legal_os: ["p_os_id"],
  importar_extrato: ["p_conta_id", "p_linhas"],
  iniciar_apontamento: ["p_os_id", "p_maquina_id", "p_etapa"],
  marcar_lead_perdido: ["p_lead_id", "p_motivo"],
  materiais_faltantes_os: ["p_os_id"],
  os_bloqueios_do_quadro: [],
  os_bloqueios_para: ["os_id", "novo_status"], // sem p_
  previsoes_desatualizadas: [],
  produtividade_3d: ["p_inicio", "p_fim"],
  quitar_parcelas_ate: ["p_compromisso_id", "p_ate"],
  recalcular_previsao_custos: ["p_os_id"],
  receber_item_compra: ["p_item_id", "p_quantidade", "p_custo_unitario", "p_nota"],
  registrar_decisao_aprovacao: ["p_token", "p_decisao", "p_comentario"],
  registrar_entrada_material: [
    "p_material_id", "p_quantidade", "p_custo_unitario", "p_fornecedor",
    "p_nota", "p_validade", "p_localizacao", "p_observacao",
  ],
  registrar_inspecao: [
    "p_os_id", "p_resultado", "p_respostas", "p_fotos", "p_observacao", "p_os_item_id", "p_checklist_id",
  ],
  reservar_materiais_os: ["p_os_id"],
  saldo_contas_bancarias: [],
  situacao_qualidade_os: ["p_os_id"],
  sugerir_compra_da_os: ["p_os_id"],
  vincular_usuario_ao_portal: ["p_usuario_id", "p_cliente_id"],
};

/** Funções com muitos parâmetros opcionais que a tela monta dinamicamente. */
const SEM_CONFERENCIA = new Set(["salvar_orcamento_3d", "upsert_filamento_3d", "upsert_impressora_3d"]);

function arquivosFonte(dir: string, acc: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    if (nome === "node_modules") continue;
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) arquivosFonte(caminho, acc);
    else if (/\.(ts|tsx)$/.test(nome) && !caminho.includes("types.ts")) acc.push(caminho);
  }
  return acc;
}

type Chamada = { arquivo: string; rpc: string; params: string[] };

/**
 * Acha `.rpc("nome", { ... })` e extrai as chaves do objeto.
 *
 * Duas armadilhas que este extrator já caiu e agora evita:
 *
 * 1. TERNÁRIO VIRANDO CHAVE. Em
 *    `p_comentario: decisao === "ajuste" ? comentario : null`
 *    o `? comentario :` parece par chave-valor se o regex aceitar espaço antes
 *    do nome. A chamada estava CERTA e o teste acusou. Uma trava que aponta o
 *    inocente é pior que trava nenhuma — ninguém confia nela depois. Agora a
 *    chave só conta quando vem logo após `{` ou `,`.
 *
 * 2. OBJETO ANINHADO. `{ p_dados: { nome } }` faria o bloco terminar no `}` de
 *    dentro e metade das chaves sumiria. Quando há aninhamento o extrator
 *    DESISTE dessa chamada em vez de julgar com informação parcial.
 */
export function extrairParams(bloco: string): string[] | null {
  if (bloco.includes("{")) return null; // aninhado: não dá para ler com regex
  return [...bloco.matchAll(/[,{]?\s*(?:^|(?<=[,{]))\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g)].map(
    (k) => k[1],
  );
}

function chamadasRpc(): Chamada[] {
  const achadas: Chamada[] = [];
  for (const arquivo of arquivosFonte("src")) {
    const texto = readFileSync(arquivo, "utf8");
    const re = /\.rpc\s*(?:as any\s*\))?\s*\(\s*["'`]([a-z0-9_]+)["'`]\s*,\s*\{([^}]*)\}/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(texto))) {
      const params = extrairParams(m[2]);
      if (params === null) continue;
      achadas.push({ arquivo: arquivo.replace(/\\/g, "/"), rpc: m[1], params });
    }
  }
  return achadas;
}

describe("o extrator não acusa inocente", () => {
  it("ternário no valor não vira chave", () => {
    // O caso real: aprovar.$token.tsx foi acusado de mandar `comentario`
    // quando manda `p_comentario`. A chamada estava certa; o extrator errou.
    expect(
      extrairParams(`
      p_token: token,
      p_decisao: decisao,
      p_comentario: decisao === "ajuste" ? comentario : null,
    `),
    ).toEqual(["p_token", "p_decisao", "p_comentario"]);
  });

  it("objeto aninhado faz desistir em vez de julgar pela metade", () => {
    expect(extrairParams(" p_lead_id: id, p_dados: { nome ")).toBeNull();
  });

  it("lê chaves em uma linha só", () => {
    expect(extrairParams(" os_id: osId, novo_status: novo ")).toEqual(["os_id", "novo_status"]);
  });
});

describe("toda chamada de RPC usa os nomes de parâmetro que a função tem", () => {
  const chamadas = chamadasRpc();

  it("encontra as chamadas do projeto — o teste não pode passar por não achar nada", () => {
    // Uma trava que não inspeciona nada passa sempre, e é pior que trava
    // nenhuma: dá a sensação de estar protegido.
    expect(chamadas.length).toBeGreaterThan(8);
  });

  it("nenhuma chamada inventa parâmetro", () => {
    const erros: string[] = [];
    for (const c of chamadas) {
      if (SEM_CONFERENCIA.has(c.rpc)) continue;
      const esperados = ASSINATURAS[c.rpc];
      if (!esperados) continue; // função fora da tabela: outro teste cuida
      const inventados = c.params.filter((p) => !esperados.includes(p));
      if (inventados.length > 0) {
        erros.push(
          `${c.arquivo}: ${c.rpc}(${inventados.join(", ")}) — a função aceita: ${esperados.join(", ") || "nenhum parâmetro"}`,
        );
      }
    }
    expect(
      erros,
      `Estas chamadas usam nomes que a função não tem. O PostgREST responde "Could not find the function" e o botão não funciona:\n  ${erros.join("\n  ")}`,
    ).toEqual([]);
  });

  it("as três funções sem prefixo p_ continuam sendo exatamente essas", () => {
    // Se alguém padronizar as assinaturas no banco, este teste avisa que a
    // tabela e as chamadas precisam mudar junto.
    const semPrefixo = Object.entries(ASSINATURAS)
      .filter(([, ps]) => ps.length > 0 && ps.every((p) => !p.startsWith("p_")))
      .map(([nome]) => nome)
      .sort();
    expect(semPrefixo).toEqual(["avancar_os_status", "fechar_os", "os_bloqueios_para"]);
  });

  it("a tela da OS e o Kanban chamam avancar_os_status do mesmo jeito", () => {
    const chamadasStatus = chamadas.filter((c) => c.rpc === "avancar_os_status");
    expect(chamadasStatus.length).toBeGreaterThanOrEqual(2);
    for (const c of chamadasStatus) {
      expect(c.params.sort(), `${c.arquivo} destoa`).toEqual(["novo_status", "os_id"]);
    }
  });
});
