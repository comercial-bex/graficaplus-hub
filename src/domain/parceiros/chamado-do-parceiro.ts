/**
 * Espelho puro da proposta docs/proposta-parceiro-sempre-atendido.sql (seções A/C).
 * O banco decide; isto só explica e testa a regra.
 */

/** Igual a normalize_whatsapp_phone: tira o 55 e põe o nono dígito em celular de 10 dígitos. */
export function normalizarTelefone(bruto: string | null | undefined): string | null {
  let d = (bruto ?? "").replace(/\D/g, "");
  if (!d) return null;
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
  if (d.length === 10 && d[2] >= "6" && d[2] <= "9") d = d.slice(0, 2) + "9" + d.slice(2);
  return d;
}

/** Celular válido: 11 dígitos (DDD + 9 + 8), já normalizado. */
export function celularValido(bruto: string | null | undefined): string | null {
  const n = normalizarTelefone(bruto);
  return n && /^[1-9][0-9]9[0-9]{8}$/.test(n) ? n : null;
}

/** As formas em que o mesmo celular pode aparecer numa conversa. */
export function variantesDoTelefone(bruto: string | null | undefined): string[] {
  const n = celularValido(bruto);
  if (!n) return [];
  const sem9 = n.slice(0, 2) + n.slice(3);
  return [n, sem9, "55" + n, "55" + sem9];
}

/** Telefone do parceiro: o da marca; senão o WhatsApp/telefone do cliente ligado. */
export function telefoneDoParceiro(p: {
  marca_telefone?: string | null;
  cliente_whatsapp?: string | null;
  cliente_telefone?: string | null;
}): string | null {
  for (const t of [p.marca_telefone, p.cliente_whatsapp, p.cliente_telefone]) {
    if (t && t.trim()) return celularValido(t);
  }
  return null;
}

type Estado = {
  status: string | null;
  responsavel_id: string | null;
  marca_telefone?: string | null;
};

/** Condição do gatilho: ativo + responsável; inclui redistribuição. Login não conta. */
export function deveGarantirChamado(antes: Estado | null, depois: Estado): boolean {
  if (depois.status !== "ativo" || !depois.responsavel_id) return false;
  if (!antes) return true;
  return (
    antes.status !== "ativo" ||
    !antes.responsavel_id ||
    antes.responsavel_id !== depois.responsavel_id ||
    (antes.marca_telefone ?? null) !== (depois.marca_telefone ?? null)
  );
}

/** Espelho da atualização condicional X -> Y; quem já assumiu e históricos ficam intactos. */
export function responsavelSincronizado(args: {
  anterior: string | null;
  novo: string | null;
  atual: string | null;
  aberto: boolean;
}): string | null {
  return args.aberto &&
    args.anterior !== null &&
    args.novo !== null &&
    args.anterior !== args.novo &&
    args.atual === args.anterior
    ? args.novo
    : args.atual;
}

/** Só orçamento aprovado/convertido do mesmo cliente conta; excluir o pedido em criação. */
export function temCompraRealAnterior(
  clienteId: string | null,
  orcamentos: { id: string; cliente_id: string | null; status: string }[],
  orcamentoAtual: string | null = null,
): boolean {
  return (
    clienteId !== null &&
    orcamentos.some(
      (o) =>
        o.cliente_id === clienteId &&
        o.id !== orcamentoAtual &&
        (o.status === "aprovado" || o.status === "convertido"),
    )
  );
}
