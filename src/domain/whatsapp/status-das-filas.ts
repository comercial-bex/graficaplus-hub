/**
 * Os valores de status que o banco ACEITA em cada tabela que o envio grava.
 *
 * Existe porque o consumidor da fila gravava `status: "falha"` em
 * `notificacoes_fila`, cujo CHECK só aceita pendente|enviando|enviado|falhou|
 * cancelado. O Postgres recusava o UPDATE inteiro — e como ninguém lia o erro,
 * o aviso que deveria virar "falhou" (com o motivo em `ultimo_erro`) ficava
 * "pendente" para sempre, sem rastro nenhum. Nos tipos gerados a coluna é
 * `string`, então o tsc também não tinha como acusar.
 *
 * São três vocabulários diferentes para a mesma ideia de "não saiu", e trocar
 * um pelo outro é exatamente o erro que aconteceu:
 *
 *   notificacoes_fila.status   CHECK da tabela       → "falhou"
 *   whatsapp_mensagens.status  enum do Postgres      → "falha"
 *   whatsapp_fila_envio.status texto livre no banco  → "falha" (o Monitor lê assim)
 *
 * tests/whatsapp-consumidor-status.test.ts lê o CHECK e o enum nas migrações e
 * confere estas listas — e confere que o consumidor só grava valores daqui.
 */

/** `notificacoes_fila.status` — CHECK `notificacoes_fila_status_check` (migração 20260819130000). */
export const STATUS_AVISO = ["pendente", "enviando", "enviado", "falhou", "cancelado"] as const;
export type StatusAviso = (typeof STATUS_AVISO)[number];

/** `whatsapp_mensagens.status` — enum `whatsapp_mensagem_status` (migração 20260531210000). */
export const STATUS_MENSAGEM = [
  "recebida",
  "pendente",
  "enviada",
  "entregue",
  "lida",
  "falha",
] as const;
export type StatusMensagem = (typeof STATUS_MENSAGEM)[number];

/**
 * `whatsapp_fila_envio.status` — sem CHECK no banco (conferido em 02/10/2026).
 * A lista é a que o consumidor grava. "enviando" é a reserva (dura o tempo da
 * chamada ao Z-API); a tela de Monitor ainda não tem cor para ela e mostra
 * cinza — as outras três ela já colore.
 */
export const STATUS_FILA = ["pendente", "enviando", "enviada", "falha"] as const;
export type StatusFila = (typeof STATUS_FILA)[number];
