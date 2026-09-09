/**
 * Setores da produção, em um só lugar.
 *
 * A lista vivia dentro do card de tarefas. Ocorrências e perdas usavam campo de
 * texto livre, então "Impressão", "impressao" e "impressão" entravam como três
 * setores diferentes — e o relatório de retrabalho por setor dividia o mesmo
 * problema em três linhas, cada uma parecendo pequena.
 */
export const SETORES = [
  "Arte",
  "Impressão",
  "Acabamento",
  "Instalação",
  "Entrega",
  "Financeiro",
] as const;

export type Setor = (typeof SETORES)[number];

/**
 * Tipos de ocorrência. O relatório agrupa por aqui, então texto livre
 * transformaria cada digitação num tipo novo.
 */
export const TIPOS_OCORRENCIA = [
  "Erro de arte",
  "Falha de impressão",
  "Material defeituoso",
  "Medida errada",
  "Atraso de fornecedor",
  "Dano no transporte",
  "Reclamação do cliente",
  "Falha de equipamento",
  "Outro",
] as const;
