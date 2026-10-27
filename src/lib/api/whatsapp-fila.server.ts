/**
 * Enfileira uma mensagem de saída na conversa, na MESMA fila da caixa de entrada
 * (`whatsapp_fila_envio`): a ordem de saída é a de criação. Compartilhado entre o envio do
 * orçamento (usuário logado) e as respostas automáticas do webhook (sem autor, chave `auto:`).
 */
export async function enfileirarMensagem(
  db: any,
  a: {
    conversaId: string;
    /** quem mandou; null = resposta automática do sistema */
    usuarioId: string | null;
    texto: string;
    origem: string;
    /** campos extras do payload da fila (tipo "botoes", sem_assinatura…) */
    extra?: Record<string, unknown>;
  },
): Promise<string> {
  const { data: c } = await db.from("whatsapp_conversas").select("instancia_id").eq("id", a.conversaId).single();
  const { data: msg, error: erroMsg } = await db
    .from("whatsapp_mensagens")
    .insert({
      conversa_id: a.conversaId,
      instancia_id: c?.instancia_id,
      direcao: "saida",
      tipo: "texto",
      status: "pendente",
      texto: a.texto,
      enviada_por: a.usuarioId,
      origem: a.usuarioId ? "humano" : "automacao",
      payload: { origem: a.origem },
    })
    .select("id")
    .single();
  if (erroMsg) throw new Error(erroMsg.message);
  const { data: fila, error: erroFila } = await db
    .from("whatsapp_fila_envio")
    .insert({
      conversa_id: a.conversaId,
      mensagem_id: msg.id,
      payload: { tipo: "texto", texto: a.texto, ...(a.extra ?? {}) },
      status: "pendente",
      idempotency_key: `${a.usuarioId ? a.origem : "auto"}:${msg.id}`,
      created_by: a.usuarioId,
    })
    .select("id")
    .single();
  if (erroFila) throw new Error(erroFila.message);
  await db
    .from("whatsapp_conversas")
    .update({ ultima_mensagem: a.texto.slice(0, 500), ultima_mensagem_at: new Date().toISOString(), nao_lidas: 0 })
    .eq("id", a.conversaId);
  return fila.id as string;
}
