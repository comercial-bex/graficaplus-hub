import { lerSelect, type ItemDoSelect } from "./contrato-do-banco";

/**
 * Um Supabase de mentira com as REGRAS do banco de verdade para as relações
 * que o gerador de PDF lê: o que cada view tem e o que cada tabela libera por
 * coluna para `authenticated`.
 *
 * Retrato medido no banco em 05/10/2026 (information_schema.columns +
 * column_privileges), depois da migração 20261005233000; em 06/10/2026 a
 * 20261006230000 deu SELECT em `itens_os.especificacoes`. Pedir coluna que a
 * relação não tem devolve 42703; coluna que existe sem GRANT devolve 42501 —
 * e qualquer um dos dois derruba a consulta INTEIRA, como no PostgREST. Foi
 * exatamente o que a varredura achou na via de produção: 42501 em
 * orcamento_itens e 42703 (custo_previsto) em itens_os.
 *
 * Não é um teste (o nome não termina em .test.ts).
 */

const lista = (texto: string) =>
  texto
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

const ORCAMENTOS_OPERACIONAL =
  "id, numero, cliente_id, cliente_nome, contato_nome, contato_telefone, contato_email, vendedor_id, status, titulo, descricao, validade_dias, observacoes, enviado_em, aprovado_em, os_id, created_by, created_at, updated_at";
const ITENS_ORCAMENTO_OPERACIONAL =
  "id, orcamento_id, descricao, quantidade, unidade, ordem, created_at, largura, altura, area_unitaria, area_total, acabamento, arquivo_id, produto_id, area_minima, area_cobrada, tipo_produto, especificacao";
const OS_OPERACIONAL =
  "id, numero, cliente_id, cliente_nome, cliente_logo_url, orcamento_id, vendedor_id, responsavel_id, designer_id, operador_id, status, titulo, briefing, observacoes, prioridade, prazo_entrega, data_entrega_real, ordem_kanban, created_by, created_at, updated_at, estoque_baixado, maquina_id, produto_id, setor_atual, precisa_entrega, precisa_instalacao";
const ITENS_OS_OPERACIONAL =
  "id, os_id, descricao, quantidade, unidade, ordem, created_at, produto_id, largura, altura, area_unitaria, area_total, acabamento, arquivo_id, area_minima, area_cobrada";

/** O que cada relação deixa ler. */
export const LEGIVEL: Record<string, string[]> = {
  orcamentos: lista(
    "id, numero, cliente_id, vendedor_id, status, titulo, descricao, validade_dias, observacoes, enviado_em, aprovado_em, os_id, created_by, created_at, updated_at, prazo, condicao_pagamento, endereco_entrega, precisa_entrega, precisa_instalacao, observacao_interna, observacao_cliente, contato_nome, contato_telefone, contato_email, data_inicio, data_entrega_prometida",
  ),
  orcamentos_operacional: lista(ORCAMENTOS_OPERACIONAL),
  orcamentos_comercial: lista(
    `${ORCAMENTOS_OPERACIONAL}, desconto_percentual, valor_subtotal, valor_total`,
  ),
  orcamentos_financeiro: lista(
    `${ORCAMENTOS_OPERACIONAL}, desconto_percentual, valor_subtotal, valor_total, custo_estimado, margem_estimada`,
  ),
  orcamento_itens: lista(
    "id, orcamento_id, descricao, quantidade, unidade, ordem, created_at, produto_id, largura, altura, acabamento, arquivo_id, area_unitaria, area_total, area_minima, area_cobrada, tipo_produto, especificacao",
  ),
  orcamento_itens_operacional: lista(ITENS_ORCAMENTO_OPERACIONAL),
  orcamento_itens_comercial: lista(`${ITENS_ORCAMENTO_OPERACIONAL}, valor_unitario, valor_total`),
  orcamento_itens_financeiro: lista(
    `${ITENS_ORCAMENTO_OPERACIONAL}, valor_unitario, valor_total, custo_unitario`,
  ),
  ordens_servico: lista(
    "id, numero, cliente_id, orcamento_id, vendedor_id, responsavel_id, designer_id, operador_id, status, titulo, briefing, observacoes, prioridade, prazo_entrega, data_entrega_real, ordem_kanban, created_by, created_at, updated_at, estoque_baixado, produto_id, maquina_id, setor_atual, precisa_entrega, precisa_instalacao, endereco_entrega",
  ),
  ordens_servico_operacional: lista(OS_OPERACIONAL),
  ordens_servico_comercial: lista(`${OS_OPERACIONAL}, valor_total`),
  ordens_servico_financeiro: lista(
    `${OS_OPERACIONAL}, valor_total, custo_previsto, custo_real, margem_real`,
  ),
  itens_os: lista(`${ITENS_OS_OPERACIONAL}, especificacoes`),
  itens_os_operacional: lista(ITENS_OS_OPERACIONAL),
  itens_os_comercial: lista(`${ITENS_OS_OPERACIONAL}, valor_unitario, valor_total`),
  itens_os_financeiro: lista(
    `${ITENS_OS_OPERACIONAL}, valor_unitario, valor_total, custo_unitario`,
  ),
  clientes: lista(
    "id, tipo, nome, razao_social, documento, email, telefone, endereco, cidade, estado, cep, observacoes, vendedor_id, ativo, created_by, created_at, updated_at, logo_url, nome_fantasia, cpf_cnpj, whatsapp_principal, bairro, origem, tipo_cliente, status, ultima_interacao, telefone_normalizado, documento_normalizado",
  ),
  usuarios: lista(
    "id, nome, email, telefone, avatar_url, ativo, created_at, updated_at, cargo_pretendido, horas_semanais",
  ),
  empresa_config: lista(
    "id, nome, razao_social, cnpj, inscricao_estadual, slogan, endereco, bairro, cidade, estado, cep, telefones, email, site, logo_path, cor_primaria, condicoes_gerais, atualizado_por, updated_at",
  ),
  arquivos: lista(
    "id, os_id, cliente_id, nome, caminho, mime_type, tipo, status, ativo, bucket, created_at",
  ),
  orcamento_item_arquivos: lista("id, item_id, arquivo_id, capa, ordem, created_at, updated_at"),
  custos_mao_de_obra: lista(
    "id, funcao, custo_hora, encargos_pct, setor, ativo, observacoes, created_at, updated_at",
  ),
  config_precificacao_3d: lista(
    "id, tarifa_kwh_padrao, mo_custo_hora_padrao, mo_salario_mensal, mo_encargos_pct, mo_horas_mensais, markup_padrao, markup_atacado_padrao, pct_acabamento_padrao, pct_falha_padrao, custo_admin_padrao",
  ),
  contas_receber: lista("id, cliente_id, orcamento_id, os_id, valor_total, status, created_at"),
  parcelas_receber: lista("id, conta_id, parcela, valor, vencimento, status, created_at"),
  pagamentos: lista(
    "id, os_id, valor, data_vencimento, data_pagamento, status, forma_pagamento, parcela, parcela_id",
  ),
  os_resultados_financeiros: lista(
    "os_id, valor_total, custo_previsto, custo_real, margem_real, updated_at, desconto, status_financeiro",
  ),
  movimentacoes_estoque: lista(
    "id, material_id, tipo, quantidade, os_id, observacao, usuario_id, created_at, unidade, motivo",
  ),
  materiais: lista(
    "id, nome, unidade, estoque, created_at, estoque_minimo, localizacao, status, largura_bobina_m, comprimento_bobina_m",
  ),
  orcamentos_3d: lista(
    "id, orcamento_id, cliente_id, titulo, descricao, quantidade, prazo, status, validade, preco_comercial, created_by, created_at, contato_nome, contato_telefone, contato_email",
  ),
  orcamento_3d_calculos: lista(
    "id, orcamento_3d_id, versao, valor_unitario, custo_material, margem",
  ),
};

/** Colunas que EXISTEM na tabela mas sem SELECT para a equipe (pedir = 42501). */
export const SEM_GRANT: Record<string, string[]> = {
  orcamentos: lista(
    "desconto_percentual, valor_subtotal, valor_total, custo_estimado, margem_estimada, lead_id, contato_id, conversa_id, briefing, versao_aprovada_id, aprovado_por_nome, aprovado_ip, token_publico",
  ),
  orcamento_itens: lista(
    "valor_unitario, custo_unitario, valor_total, desconto, custo_previsto, margem_prevista, parametros, produto_snapshot, origem_calculo, preco_m2",
  ),
  ordens_servico: lista(
    "valor_total, custo_previsto, custo_real, margem_real, estoque_baixado_em, numero_os, contato_id, status_financeiro, status_arte, status_producao, prazo_cliente, prazo_interno, valor_venda, lucro_previsto, lucro_real, margem_prevista, status_comercial, status_logistica, status_geral, desconto, data_fechamento, condicao_pagamento",
  ),
  itens_os: lista(
    "valor_unitario, custo_unitario, valor_total, orcamento_item_id, produto_snapshot, parametros, custos_previstos, preco_snapshot, margem_prevista, planejamento, requer_qualidade, precisa_entrega, precisa_instalacao, preco_m2",
  ),
  materiais: lista("custo_unitario, fornecedor, custo_medio, estoque_maximo, updated_at"),
};

/** Embeds que o gerador usa: relação filha → coluna que aponta para o pai. */
const EMBEDS: Record<string, Record<string, string>> = {
  contas_receber: { parcelas_receber: "conta_id" },
};

type Linha = Record<string, unknown>;
type Erro = { code: string; message: string };
type Resposta = { data: unknown; error: Erro | null };

export type Leitura = { relacao: string; colunas: string };

export class BancoFalso {
  tabelas: Record<string, Linha[]> = {};
  rpcs: Record<string, (args: Record<string, unknown>) => unknown> = {};
  /** Relações que respondem com erro de verdade (rede, timeout). */
  falhas = new Set<string>();
  /** Caminhos de arquivo que o Storage se recusa a assinar. */
  semAssinatura = new Set<string>();
  leituras: Leitura[] = [];

  validar(relacao: string, itens: ItemDoSelect[]): Erro | null {
    const legiveis = LEGIVEL[relacao];
    if (!legiveis) return { code: "42P01", message: `relation "public.${relacao}" does not exist` };
    for (const item of itens) {
      if (item.tipo === "embed") {
        if (!EMBEDS[relacao]?.[item.relacao]) {
          return {
            code: "PGRST200",
            message: `Could not find a relationship between '${relacao}' and '${item.relacao}'`,
          };
        }
        const erro = this.validar(item.relacao, item.itens);
        if (erro) return erro;
        continue;
      }
      if (item.nome === "*") {
        // `*` numa tabela com coluna sem grant derruba a consulta inteira.
        if ((SEM_GRANT[relacao] ?? []).length > 0) {
          return { code: "42501", message: `permission denied for table ${relacao}` };
        }
        continue;
      }
      if (legiveis.includes(item.nome)) continue;
      if ((SEM_GRANT[relacao] ?? []).includes(item.nome)) {
        return { code: "42501", message: `permission denied for table ${relacao}` };
      }
      return { code: "42703", message: `column ${relacao}.${item.nome} does not exist` };
    }
    return null;
  }

  projetar(relacao: string, linha: Linha, itens: ItemDoSelect[]): Linha {
    const saida: Linha = {};
    for (const item of itens) {
      if (item.tipo === "embed") {
        const chave = EMBEDS[relacao][item.relacao];
        saida[item.relacao] = (this.tabelas[item.relacao] ?? [])
          .filter((filha) => filha[chave] === linha.id)
          .map((filha) => this.projetar(item.relacao, filha, item.itens));
      } else if (item.nome === "*") {
        // `*` traz só o que a relação TEM — uma view sem `prazo` não devolve
        // `prazo`, mesmo que a linha de teste tenha o campo.
        for (const coluna of LEGIVEL[relacao]) if (coluna in linha) saida[coluna] = linha[coluna];
      } else {
        saida[item.nome] = linha[item.nome] ?? null;
      }
    }
    return saida;
  }

  consulta(relacao: string) {
    return new Consulta(this, relacao);
  }

  /** O objeto que entra no lugar de `supabase`. */
  cliente() {
    return {
      from: (relacao: string) => this.consulta(relacao),
      rpc: async (nome: string, args: Record<string, unknown> = {}): Promise<Resposta> => {
        if (this.falhas.has(`rpc:${nome}`)) {
          return {
            data: null,
            error: { code: "57014", message: "canceling statement due to statement timeout" },
          };
        }
        const fn = this.rpcs[nome];
        if (!fn)
          return { data: null, error: { code: "PGRST202", message: `function ${nome} not found` } };
        return { data: fn(args), error: null };
      },
      storage: {
        from: (bucket: string) => ({
          createSignedUrl: async (caminho: string) =>
            this.semAssinatura.has(caminho)
              ? { data: null, error: { message: "Object not found" } }
              : {
                  data: { signedUrl: `https://storage.falso/${bucket}/${caminho}?token=x` },
                  error: null,
                },
          createSignedUrls: async (caminhos: string[]) => ({
            data: caminhos.map((caminho) =>
              this.semAssinatura.has(caminho)
                ? { path: caminho, signedUrl: null, error: "Object not found" }
                : {
                    path: caminho,
                    signedUrl: `https://storage.falso/${bucket}/${caminho}?token=x`,
                    error: null,
                  },
            ),
            error: null,
          }),
        }),
      },
      auth: { getUser: async () => ({ data: { user: { id: "u-teste" } }, error: null }) },
    };
  }
}

class Consulta implements PromiseLike<Resposta> {
  private filtros: ((l: Linha) => boolean)[] = [];
  private ordens: { coluna: string; asc: boolean }[] = [];
  private limite: number | null = null;
  private itens: ItemDoSelect[] = [{ tipo: "coluna", nome: "*" }];

  constructor(
    private banco: BancoFalso,
    private relacao: string,
  ) {}

  select(colunas = "*") {
    this.itens = lerSelect(colunas);
    this.banco.leituras.push({ relacao: this.relacao, colunas });
    return this;
  }
  eq(coluna: string, valor: unknown) {
    this.filtros.push((l) => l[coluna] === valor);
    return this;
  }
  in(coluna: string, valores: unknown[]) {
    this.filtros.push((l) => valores.includes(l[coluna]));
    return this;
  }
  order(coluna: string, opcoes?: { ascending?: boolean }) {
    this.ordens.push({ coluna, asc: opcoes?.ascending ?? true });
    return this;
  }
  limit(n: number) {
    this.limite = n;
    return this;
  }
  maybeSingle(): Promise<Resposta> {
    return this.executar().then((r) => {
      if (r.error) return r;
      const linhas = r.data as Linha[];
      if (linhas.length > 1) {
        return {
          data: null,
          error: { code: "PGRST116", message: "JSON object requested, multiple rows returned" },
        };
      }
      return { data: linhas[0] ?? null, error: null };
    });
  }
  single(): Promise<Resposta> {
    return this.executar().then((r) => {
      if (r.error) return r;
      const linhas = r.data as Linha[];
      if (linhas.length !== 1) {
        return {
          data: null,
          error: {
            code: "PGRST116",
            message: `JSON object requested, ${linhas.length} rows returned`,
          },
        };
      }
      return { data: linhas[0], error: null };
    });
  }
  then<A = Resposta, B = never>(
    ok?: ((r: Resposta) => A | PromiseLike<A>) | null,
    falha?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return this.executar().then(ok, falha);
  }

  private async executar(): Promise<Resposta> {
    const erro = this.banco.validar(this.relacao, this.itens);
    if (erro) return { data: null, error: erro };
    if (this.banco.falhas.has(this.relacao)) {
      return {
        data: null,
        error: { code: "57014", message: "canceling statement due to statement timeout" },
      };
    }
    let linhas = (this.banco.tabelas[this.relacao] ?? []).filter((l) =>
      this.filtros.every((f) => f(l)),
    );
    for (const { coluna, asc } of [...this.ordens].reverse()) {
      linhas = [...linhas].sort((a, b) => {
        const x = a[coluna] as number | string | boolean;
        const y = b[coluna] as number | string | boolean;
        return (x === y ? 0 : x > y ? 1 : -1) * (asc ? 1 : -1);
      });
    }
    if (this.limite != null) linhas = linhas.slice(0, this.limite);
    return {
      data: linhas.map((l) => this.banco.projetar(this.relacao, l, this.itens)),
      error: null,
    };
  }
}
