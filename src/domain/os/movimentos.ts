import { etapaDe, rotuloDe } from "./etapas";

/**
 * Quem mexeu na OS, quando, e se o cliente foi avisado.
 *
 * Decisão do dono (13/10/2026): "todos podem mover o Kanban, mas mostrar o
 * registro de quem fez e quando fez". O registro sempre existiu —
 * `os_status_historico` grava `mudou_por` e `mudou_em` em toda troca de
 * status, venha do quadro, do painel, da ficha, da conversão ou do fechamento
 * — e nenhuma tela o mostrava: a aba Histórico lia `logs_auditoria`, que só
 * recebe o que passa pelo quadro.
 */

export type MovimentoDaOs = {
  os_id: string;
  status_anterior?: string | null;
  status_novo: string | null;
  mudou_em: string;
  mudou_por: string | null;
};

/** O movimento mais recente de cada OS. */
export function ultimoMovimentoPorOs(movimentos: readonly MovimentoDaOs[] | null | undefined) {
  const mapa = new Map<string, MovimentoDaOs>();
  for (const m of movimentos ?? []) {
    const atual = mapa.get(m.os_id);
    if (!atual || m.mudou_em > atual.mudou_em) mapa.set(m.os_id, m);
  }
  return mapa;
}

const DATA_HORA = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Belem",
});

/** "13/10 09:47" no horário de Macapá. */
export function quandoCurto(iso: string) {
  return DATA_HORA.format(new Date(iso)).replace(",", "");
}

/** "Yvens · 13/10 09:47"; sem autor (gatilho do sistema), "Sistema · …". */
export function rotuloDoMovimento(m: Pick<MovimentoDaOs, "mudou_em" | "mudou_por">, nomes: Map<string, string>) {
  const quem = m.mudou_por ? primeiroNome(nomes.get(m.mudou_por)) : "Sistema";
  return `${quem} · ${quandoCurto(m.mudou_em)}`;
}

/** "Atendimento → Criação" (o primeiro registro é a OS nascendo: "Abriu em Atendimento"). */
export function passoDoMovimento(m: Pick<MovimentoDaOs, "status_anterior" | "status_novo">) {
  if (!m.status_anterior) return `Abriu em ${rotuloDe(m.status_novo)}`;
  return `${rotuloDe(m.status_anterior)} → ${rotuloDe(m.status_novo)}`;
}

function primeiroNome(nome: string | null | undefined) {
  return (nome ?? "").trim().split(/\s+/)[0] || "Equipe";
}

/* -------------------------------------------------------------------------- */
/* O aviso ao cliente de cada etapa — espelho de public.marco_notificavel_os   */
/* -------------------------------------------------------------------------- */

export const ROTULO_DO_AVISO: Record<string, string> = {
  os_arte_para_aprovar: "Arte para aprovar",
  os_em_producao: "Entrou em produção",
  os_pronta_retirada: "Pronto para retirar",
  os_pronta_entrega: "Pronto para entregar",
  os_saiu_entrega: "Saiu para entrega",
  os_concluida: "Pedido concluído",
};

/**
 * O evento de aviso que o banco enfileira quando a OS chega a este status, ou
 * null quando a etapa não avisa ninguém. A régua é a de
 * `marco_notificavel_os` (migração 20261013230000); o teste confere as duas.
 */
export function avisoDoStatus(status: string | null | undefined): string | null {
  if (!status) return null;
  if (status === "aguardando_aprovacao_arte") return "os_arte_para_aprovar";
  if (etapaDe(status) === "producao") return "os_em_producao";
  if (status === "aguardando_retirada") return "os_pronta_retirada";
  if (status === "aguardando_entrega") return "os_pronta_entrega";
  if (status === "em_entrega") return "os_saiu_entrega";
  if (status === "concluido") return "os_concluida";
  return null;
}

/**
 * O que dizer depois de mover: a tela dizia "Status atualizado" com aviso,
 * sem aviso, sem telefone ou com o aviso engolido — e ninguém sabia se o
 * cliente tinha sido avisado.
 */
export function fraseDoAviso(statusNovo: string, eventoEnfileirado: string | null) {
  if (eventoEnfileirado) {
    return {
      titulo: "Etapa atualizada · cliente avisado",
      descricao: `${ROTULO_DO_AVISO[eventoEnfileirado] ?? "Aviso"}: sai pelo WhatsApp em até 2 minutos.`,
    };
  }
  if (avisoDoStatus(statusNovo)) {
    return {
      titulo: "Etapa atualizada · sem aviso ao cliente",
      descricao:
        "Esta etapa avisa o cliente, mas o aviso não nasceu: o cliente não tem WhatsApp no cadastro ou já foi avisado desta etapa.",
    };
  }
  return { titulo: "Etapa atualizada", descricao: "Esta etapa não avisa o cliente." };
}
