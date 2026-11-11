/**
 * As colunas da tabela `maquinas`, separadas pelo que cada pessoa pode ler (10/11/2026).
 *
 * `maquinas` é lida por toda a equipe. Até hoje isso entregava, direto do banco, o custo por hora, o valor de compra e o
 * texto de compra de cada máquina a quem só vende, opera ou desenha, embora as telas escondessem. A migração de
 * fechamento tira a leitura dessas colunas da tabela. Quem vê custo (financeiro.read ou impressao3d.cost.read) lê a máquina
 * inteira pela visão `maquinas_financeiro`; os demais leem a tabela, só com as colunas abaixo.
 *
 * ATENÇÃO: coluna sem permissão de leitura derruba a consulta inteira de quem a cita, `select("*")` e filtro inclusive,
 * para todos os papéis, o admin também. Por isso `select("*")` em `maquinas` só é válido na visão financeira.
 *
 * COLUNA NOVA em `maquinas` nasce sem leitura. Quem acrescentar uma decide na hora: entra em COLUNAS_DA_MAQUINA_SEM_CUSTO e
 * no GRANT da migração (dado que qualquer pessoa da equipe pode ver) ou em COLUNAS_DE_CUSTO_DA_MAQUINA (só quem vê custo).
 * `tests/custo-das-maquinas-pela-visao.test.ts` confere que as duas listas, juntas, são todas as colunas.
 */
export const COLUNAS_DA_MAQUINA_SEM_CUSTO = [
  "id",
  "nome",
  "tipo",
  "ativa",
  "created_at",
  "updated_at",
  "potencia_kw",
  "setup_min",
  "velocidade_m2_h",
  "disponibilidade_pct",
  "setor",
  "largura_util_m",
  "margem_lateral_m",
  "fabricante",
  "modelo",
  "numero_serie",
  "imagem_url",
  "especificacoes",
  "horas_produtivas_mensais",
  "base_cobranca",
  "tempo_minimo_min",
  "velocidade_mm_s",
  "avanco_m",
  "alimentacao",
  "comprimento_util_m",
] as const;

/** O que fica de fora do que a equipe lê: custo, compra e o texto comercial. Só `maquinas_financeiro` entrega. */
export const COLUNAS_DE_CUSTO_DA_MAQUINA = [
  "custo_hora",
  "vida_util_horas",
  "valor_residual",
  "forma_aquisicao",
  "valor_aquisicao",
  "data_aquisicao",
  "especificacoes_comerciais",
] as const;

/** A lista pronta para o `select(...)` de quem não vê custo. */
export const SELECT_DA_MAQUINA_SEM_CUSTO = COLUNAS_DA_MAQUINA_SEM_CUSTO.join(", ");

/**
 * As chaves de compra e de custo que moravam na ficha técnica (`especificacoes`, que toda a equipe lê) e foram para
 * `especificacoes_comerciais`. A ficha técnica não aceita mais chave assim.
 */
export const CHAVES_COMERCIAIS_DA_FICHA = [
  "compra",
  "custo_hora_base",
  "custo_hora_atualizado_em",
  "preco_referencia",
  "situacao",
  "custo_hora_provisorio",
] as const;
