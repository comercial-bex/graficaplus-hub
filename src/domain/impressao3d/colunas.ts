/**
 * As colunas das impressoras 3D e dos filamentos, separadas pelo que cada pessoa pode ler (onda C, 11/11/2026).
 *
 * `maquinas_3d_config` e `materiais_3d_filamento` eram lidas inteiras por toda a equipe: o custo por hora e a
 * depreciação de cada impressora e o custo por grama de cada filamento iam ao navegador de quem só vende ou
 * opera, embora a tela escondesse. Esconder só o valor de compra não esconde nada: custo por grama vezes o peso
 * do rolo é o preço pago. A migração de fechamento (C3) tira dessas duas tabelas a leitura das colunas de custo.
 * Quem vê custo de máquina (financeiro.read ou impressao3d.cost.read) lê a linha inteira pelas visões
 * `maquinas_3d_config_financeiro` e `materiais_3d_filamento_financeiro`; os demais leem a tabela, só com as
 * colunas abertas abaixo, e o preço da peça vem do servidor (`lib/api/orcamento-3d.functions.ts`).
 *
 * ATENÇÃO: coluna sem permissão de leitura derruba a consulta inteira de quem a cita, `select("*")` e filtro
 * inclusive, para todos os papéis, o admin também. Por isso `select("*")` nessas tabelas só vale nas visões.
 *
 * COLUNA NOVA nessas tabelas nasce sem leitura. Quem acrescentar uma decide na hora: entra na lista aberta e no
 * GRANT da migração (dado que qualquer pessoa da equipe pode ver) ou na lista de custo (só quem vê custo).
 * `tests/custo-3d-pela-visao.test.ts` confere que as duas listas, juntas, são todas as colunas.
 *
 * `config_precificacao_3d` (tarifa, mão de obra, markup, percentuais, embalagem) não entra aqui: a linha inteira
 * é custo e a C3 a fecha pela policy, não por coluna.
 */

/** Impressora 3D: o que qualquer pessoa da equipe lê (escolher a impressora pelo nome, potência e tamanho). */
export const COLUNAS_DA_IMPRESSORA_3D_SEM_CUSTO = [
  "maquina_id",
  "fabricante",
  "modelo",
  "serial",
  "tecnologia",
  "potencia_media_w",
  "potencia_aquecimento_w",
  "potencia_standby_w",
  "capacidade_x",
  "capacidade_y",
  "capacidade_z",
  "possui_ams",
  "quantidade_slots",
  "bico_padrao",
  "placa_padrao",
  "ativa",
  "created_at",
  "updated_at",
] as const;

/** Impressora 3D: a depreciação e o custo por hora. Só a visão `maquinas_3d_config_financeiro` entrega. */
export const COLUNAS_DE_CUSTO_DA_IMPRESSORA_3D = [
  "custo_aquisicao",
  "frete_aquisicao",
  "instalacao",
  "acessorios_capitalizados",
  "valor_residual",
  "vida_util_horas",
  "horas_acumuladas",
  "manutencao_por_hora",
  "consumiveis_por_hora",
  "infraestrutura_por_hora",
  "horas_produtivas_mensais",
  "metodo_custo_hora",
  "custo_hora_calculado",
  "custo_hora_manual",
  "motivo_custo_manual",
  "custo_hora_manual_usuario_id",
  "custo_hora_manual_at",
  "consumiveis_json",
] as const;

/** Filamento: o que qualquer pessoa da equipe lê (tipo, cor, marca, rolo e secagem). */
export const COLUNAS_DO_FILAMENTO_SEM_CUSTO = [
  "material_id",
  "tipo",
  "marca",
  "linha",
  "cor",
  "codigo",
  "diametro",
  "densidade",
  "peso_nominal",
  "peso_liquido",
  "tara_carretel",
  "fator_aproveitamento",
  "exige_secagem",
  "tempo_secagem",
  "potencia_secador",
  "temperatura_secagem",
  "armazenamento",
  "created_at",
  "updated_at",
] as const;

/** Filamento: a compra e o custo por grama. Só a visão `materiais_3d_filamento_financeiro` entrega. */
export const COLUNAS_DE_CUSTO_DO_FILAMENTO = [
  "custo_compra",
  "frete_rateado",
  "tributos_aquisicao",
  "descontos",
  "outros_custos",
  "custo_por_grama_calculado",
] as const;

/**
 * O `select(...)` de quem não vê custo, já com o nome do cadastro (`maquinas.nome` é coluna aberta da tabela
 * `maquinas`). O seletor da calculadora lê `maquinas?.nome`.
 */
export const SELECT_DA_IMPRESSORA_3D_SEM_CUSTO = `${COLUNAS_DA_IMPRESSORA_3D_SEM_CUSTO.join(", ")}, maquinas(nome)`;

/** O mesmo para o filamento: `materiais.nome` é aberto à equipe. O seletor lê `materiais?.nome`. */
export const SELECT_DO_FILAMENTO_SEM_CUSTO = `${COLUNAS_DO_FILAMENTO_SEM_CUSTO.join(", ")}, materiais(nome)`;
