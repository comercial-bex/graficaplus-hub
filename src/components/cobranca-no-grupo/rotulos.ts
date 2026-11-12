/**
 * Palavras do cartão "Cobrança de orçamento no grupo", fora do componente para o teste ler sem
 * navegador. Sem travessão e sem seta em nada que aparece na tela; vírgula decimal.
 */

import { MAX_MINUTOS, MIN_MINUTOS, type ModoCobranca } from "@/domain/whatsapp/cobranca";

export const MODOS: { valor: ModoCobranca; rotulo: string; explica: string }[] = [
  { valor: "desligada", rotulo: "Desligada", explica: "Nada é anotado e nada vai ao grupo." },
  {
    valor: "ensaio",
    rotulo: "Ensaio",
    explica: "O sistema só anota o que teria mandado. Nada vai ao grupo.",
  },
  {
    valor: "ligada",
    rotulo: "Ligada",
    explica: "A cobrança vai para o grupo da equipe no WhatsApp. Nunca vai nada ao cliente.",
  },
];

export function rotuloDoModo(modo: string): string {
  return MODOS.find((m) => m.valor === modo)?.rotulo ?? "Desligada";
}

export function rotuloDoMotivo(motivo: string): string {
  if (motivo === "pedido_sem_orcamento") return "Pediu e não recebeu";
  if (motivo === "orcamento_parado") return "Orçamento parado";
  return "Outro motivo";
}

export function rotuloDoNivel(nivel: number): string {
  return nivel === 2 ? "2ª cobrança, com a gerência" : "1ª cobrança";
}

export type LinhaDaFila = { status: string | null; entregue_em: string | null; lido_em: string | null };

/**
 * Situação de uma cobrança na lista. No ensaio nada foi para a fila: "teria mandado". No modo
 * ligada, o que a fila de avisos diz (lido e entregue vêm do recibo do grupo).
 */
export function situacaoDaCobranca(
  modo: string,
  filaId: string | null,
  fila: LinhaDaFila | undefined,
): { rotulo: string; tom: "cyan" | "magenta" | "lime" | "amber" | "muted" } {
  if (modo === "ensaio") return { rotulo: "Teria mandado", tom: "muted" };
  if (!filaId) return { rotulo: "Sem aviso na fila", tom: "amber" };
  if (!fila) return { rotulo: "Sem notícia da fila", tom: "amber" };
  if (fila.lido_em) return { rotulo: "Lido", tom: "lime" };
  if (fila.entregue_em) return { rotulo: "Entregue", tom: "lime" };
  const s = fila.status ?? "";
  if (s === "enviado") return { rotulo: "Enviado", tom: "lime" };
  if (s === "falhou") return { rotulo: "Falhou", tom: "magenta" };
  if (s === "cancelado") return { rotulo: "Cancelado", tom: "muted" };
  if (s === "pendente") return { rotulo: "Na fila", tom: "cyan" };
  if (s === "enviando") return { rotulo: "Enviando", tom: "cyan" };
  return { rotulo: s || "Sem situação", tom: "muted" };
}

type CitadoGravado = { nome?: unknown; papel?: unknown; sem_telefone?: unknown; mencao?: unknown };

/** "Ana (responsável), Bruno (gerência)". Lista vazia: "ninguém". */
export function citadosPorExtenso(citados: unknown): string {
  if (!Array.isArray(citados) || citados.length === 0) return "ninguém";
  const papel: Record<string, string> = {
    responsavel: "responsável",
    vendedor: "vendedor",
    gerencia: "gerência",
  };
  return (citados as CitadoGravado[])
    .map((c) => {
      const nome = typeof c?.nome === "string" && c.nome.trim() ? c.nome.trim().split(/\s+/)[0] : "Sem nome";
      const p = typeof c?.papel === "string" ? papel[c.papel] : undefined;
      const semTelefone = c?.sem_telefone === true || c?.mencao === null ? ", sem telefone" : "";
      return p ? `${nome} (${p}${semTelefone})` : nome;
    })
    .join(", ");
}

/** Erro do campo de minutos, ou null quando vale. */
export function erroDosMinutos(valor: string): string | null {
  const t = valor.trim();
  if (!/^\d+$/.test(t)) return "Escreva só números, em minutos.";
  const n = Number(t);
  if (n < MIN_MINUTOS || n > MAX_MINUTOS) {
    return `Use de ${MIN_MINUTOS} a ${MAX_MINUTOS} minutos.`;
  }
  return null;
}

/** "12:00:00" vira "12:00". */
export const hhmm = (t: string | null | undefined) => (t ?? "").slice(0, 5);

/** Erro do fim do sábado, ou null: depois do início do expediente e até as 18h. */
export function erroDoSabadoFim(fim: string, inicio: string): string | null {
  const f = hhmm(fim);
  if (!/^\d{2}:\d{2}$/.test(f)) return "Escolha a hora em que o sábado termina.";
  if (f <= hhmm(inicio) || f <= "08:00") return "O sábado precisa terminar depois do início do expediente.";
  if (f > "18:00") return "O sábado termina no máximo às 18h.";
  return null;
}

/** Endereço da conversa dentro do sistema. */
export function caminhoDaConversa(conversaId: string): string {
  return `/whatsapp?conversa=${encodeURIComponent(conversaId)}`;
}

/** Texto da cobrança para a tela: o "@número" de colegas vira "@menção" (o telefone não aparece). */
export function textoSemTelefones(texto: string): string {
  return texto.replace(/@\d{10,}/g, "@menção");
}

/** Quanto tempo sem rodada é "a cobrança não está rodando": o job roda a cada 5 minutos. */
export const MINUTOS_PARA_RODADA_PARADA = 15;

/**
 * Como foi a última rodada da cobrança, para o cartão. Desligada: nada a dizer. Ensaio ou ligada
 * sem rodada, com a última falha ou parada há mais de 15 minutos: aparece como problema, em
 * destaque (o job usa net.http_post, e token errado ou rota fora do ar nunca chegam a gravar nada).
 */
export function situacaoDaRodada(
  modo: string,
  rodadaEm: string | null,
  ok: boolean | null,
  erro: string | null,
  agora: Date,
  corteEm: string | null = null,
): { problema: boolean; texto: string } | null {
  if (modo !== "ensaio" && modo !== "ligada") return null;
  const em = rodadaEm ? new Date(rodadaEm) : null;
  const valida = em !== null && !Number.isNaN(em.getTime());
  // Acabou de ligar (ou de passar para o ensaio): a primeira rodada vem em até 5 minutos.
  const corte = corteEm ? new Date(corteEm) : null;
  if (
    corte &&
    !Number.isNaN(corte.getTime()) &&
    agora.getTime() - corte.getTime() <= MINUTOS_PARA_RODADA_PARADA * 60000 &&
    (!valida || em.getTime() < corte.getTime())
  ) {
    return { problema: false, texto: "Aguardando a primeira rodada, que acontece a cada 5 minutos." };
  }
  if (!valida) {
    return { problema: true, texto: "A cobrança não está rodando: ainda nenhuma rodada foi anotada." };
  }
  const minutos = Math.floor((agora.getTime() - em.getTime()) / 60000);
  const hora = new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Belem",
  }).format(em);
  if (minutos > MINUTOS_PARA_RODADA_PARADA) {
    return {
      problema: true,
      texto: `A cobrança não está rodando: a última rodada foi às ${hora}, há mais de ${MINUTOS_PARA_RODADA_PARADA} minutos.`,
    };
  }
  if (ok === false) {
    return { problema: true, texto: `Última rodada às ${hora} falhou: ${erro?.trim() || "sem detalhe"}.` };
  }
  return { problema: false, texto: `Última rodada às ${hora}: ok.` };
}
