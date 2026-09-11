/**
 * Aviso órfão — o que a tela diz sobre cada tipo.
 *
 * A DEFINIÇÃO de órfão não mora aqui: ela é a coluna `motivo_orfao` de
 * `vw_avisos_pendentes`, e é por ela que `cancelar_avisos_orfaos` cancela. Este
 * módulo só traduz o código para a frase da tela.
 *
 * Por que a definição saiu da tela: a regra era `a.sem_vinculo` aqui e outra
 * coisa na função de limpeza, e as duas ficaram para trás de formas
 * diferentes. Conferido em 11/09/2026: 7 avisos pendentes falavam de OS e
 * orçamentos APAGADOS, com cliente existente. Como tinham cliente, a tela os
 * mostrava como "com cliente vinculado", cada um com o botão "Já avisei" — e
 * os 7 eram para o mesmo cliente. Seguir a tela era mandar a ele sete
 * mensagens sobre serviço que não existe.
 */

/** Os códigos que a view devolve em `motivo_orfao`. */
export const MOTIVOS_ORFAO = ["sem_cliente", "cliente_apagado", "registro_apagado"] as const;
export type MotivoOrfao = (typeof MOTIVOS_ORFAO)[number];

const ROTULO: Record<MotivoOrfao, { curto: string; explicacao: string }> = {
  sem_cliente: {
    curto: "sem cliente vinculado",
    explicacao: "O aviso não tem para quem ir.",
  },
  cliente_apagado: {
    curto: "cliente apagado",
    explicacao: "O cadastro do cliente não existe mais.",
  },
  registro_apagado: {
    curto: "OS ou orçamento apagado",
    explicacao:
      "O serviço de que este aviso fala foi apagado. Avisar o cliente seria falar de algo que não existe.",
  },
};

export function ehOrfao(motivo: string | null | undefined): boolean {
  // Código que esta tela ainda não conhece continua sendo órfão: quem decide é
  // a view. Tratar como aviso real faria um tipo novo de órfão voltar a
  // aparecer com o botão "Já avisei".
  return motivo != null && motivo !== "";
}

export function rotuloOrfao(motivo: string | null | undefined): { curto: string; explicacao: string } | null {
  if (!ehOrfao(motivo)) return null;
  return (
    ROTULO[motivo as MotivoOrfao] ?? {
      curto: "órfão",
      explicacao: `Marcado como órfão pelo banco (${motivo}).`,
    }
  );
}

/** A frase do toast depois da limpeza, contando cada tipo. */
export function resumoDaLimpeza(r: {
  cancelados?: number | null;
  sem_cliente?: number | null;
  cliente_apagado?: number | null;
  registro_apagado?: number | null;
} | null | undefined): string {
  const total = Number(r?.cancelados ?? 0);
  if (total === 0) return "Nenhum aviso órfão para limpar";
  const partes = [
    [Number(r?.registro_apagado ?? 0), "de serviço apagado"],
    [Number(r?.cliente_apagado ?? 0), "de cliente apagado"],
    [Number(r?.sem_cliente ?? 0), "sem cliente"],
  ]
    .filter(([n]) => (n as number) > 0)
    .map(([n, t]) => `${n} ${t}`);
  return `${total} aviso(s) cancelado(s): ${partes.join(", ")}`;
}
