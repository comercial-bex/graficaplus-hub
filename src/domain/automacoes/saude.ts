/**
 * Por que a mensagem não sai — as três peças, cada uma com a prova que dá para
 * medir pela tela.
 *
 *   1. O WHATSAPP da gráfica conectado no Z-API (whatsapp_instancias).
 *   2. O DESPACHANTE rodando. Desde 06/10/2026 as duas filas — automação
 *      (automacao_execucoes) e avisos ao cliente (notificacoes_fila) — saem
 *      pelo MESMO consumidor (POST /api/whatsapp/enviar), chamado pelo
 *      navegador de quem atende e, com o job do pg_cron ligado, pelo próprio
 *      servidor a cada 2 minutos. A função process-automations deixou de ser
 *      o caminho. Pendente com horário vencido há mais de 15 minutos =
 *      ninguém consumiu. Sem pendente não dá para afirmar que roda — a tela
 *      diz isso, em vez de pintar de verde.
 *   3. O MOTOR enfileirando: a falha de `enqueue_automacoes` deixa rastro em
 *      logs_auditoria (acao 'motor_falhou'). Foi a falta desse rastro que
 *      escondeu, por meses, que o motor devolvia 0 para todo evento.
 *
 * Em 02/10/2026 as duas primeiras estavam vermelhas: instância "desconectada",
 * nunca pareada; 4 avisos ao cliente em notificacoes_fila desde 28/09 com 0
 * tentativas, e nenhum pg_cron ou pg_net no banco para chamar a função.
 */
import { situacaoDaConexao, type InstanciaResumo } from "@/domain/whatsapp/situacao-conexao";

export type EntradaSaude = {
  /** null = a consulta falhou; [] = nenhuma instância cadastrada. */
  instancias: InstanciaResumo[] | null;
  paradas: {
    automacoes: number;
    automacoesDesde: string | null;
    avisos: number;
    avisosDesde: string | null;
  } | null;
  falhasDoMotor: { total: number; ultimoErro: string | null; ultimoEm: string | null } | null;
};

export type ItemSaude = {
  chave: "whatsapp" | "processador" | "motor";
  estado: "ok" | "problema" | "desconhecido";
  titulo: string;
  detalhe: string;
};

const DATA = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function quando(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : DATA.format(d);
}

export function saudeDoEnvio(e: EntradaSaude): ItemSaude[] {
  const itens: ItemSaude[] = [];

  // 1. WhatsApp
  if (e.instancias === null) {
    itens.push({
      chave: "whatsapp",
      estado: "desconhecido",
      titulo: "WhatsApp: não deu para conferir",
      detalhe: "A consulta da conexão falhou. Isto não quer dizer que está conectado.",
    });
  } else {
    const ativas = e.instancias.filter((i) => i.ativa !== false);
    const conectada = ativas.find((i) => i.conectado === true);
    if (conectada) {
      itens.push({
        chave: "whatsapp",
        estado: "ok",
        titulo: "WhatsApp conectado",
        detalhe: "A instância do Z-API está pareada com o celular da gráfica.",
      });
    } else {
      const s = situacaoDaConexao(ativas[0] ?? null);
      itens.push({
        chave: "whatsapp",
        estado: "problema",
        titulo: `WhatsApp: ${s.rotulo.toLowerCase()}`,
        detalhe:
          `Nenhuma mensagem sai enquanto isto não for resolvido. ${s.proximoPasso ?? ""}`.trim(),
      });
    }
  }

  // 2. Processador
  if (e.paradas === null) {
    itens.push({
      chave: "processador",
      estado: "desconhecido",
      titulo: "Despachante: não deu para conferir",
      detalhe: "A consulta da fila falhou.",
    });
  } else {
    const p = e.paradas;
    if (p.automacoes + p.avisos > 0) {
      const frases: string[] = [];
      if (p.automacoes > 0) {
        const desde = quando(p.automacoesDesde);
        frases.push(
          `${p.automacoes} ${p.automacoes === 1 ? "mensagem de automação espera" : "mensagens de automação esperam"} há mais de 15 minutos${desde ? ` (desde ${desde})` : ""}. Automação sai pelo despachante do WhatsApp: alguém com permissão de responder precisa estar com o sistema aberto, ou o despachante do servidor (pg_cron) precisa estar ligado.`,
        );
      }
      if (p.avisos > 0) {
        const desde = quando(p.avisosDesde);
        frases.push(
          `${p.avisos} ${p.avisos === 1 ? "aviso ao cliente espera" : "avisos ao cliente esperam"} na fila${desde ? ` desde ${desde}` : ""}: o despachante não os pegou.${p.automacoes === 0 ? " Automação ligada hoje ficaria parada do mesmo jeito." : ""}`,
        );
      }
      frases.push("Quando o envio voltar, o que está na fila sai de uma vez.");
      itens.push({
        chave: "processador",
        estado: "problema",
        titulo: "Fila de envio parada",
        detalhe: frases.join(" "),
      });
    } else {
      itens.push({
        chave: "processador",
        estado: "desconhecido",
        titulo: "Despachante: sem mensagem esperando",
        detalhe:
          "Não há nada parado na fila, então não dá para provar daqui que o despachante está rodando.",
      });
    }
  }

  // 3. Motor
  if (e.falhasDoMotor === null) {
    itens.push({
      chave: "motor",
      estado: "desconhecido",
      titulo: "Motor: não deu para conferir",
      detalhe: "O registro de falhas fica em Logs & Auditoria, que só administrador e gestor leem.",
    });
  } else if (e.falhasDoMotor.total > 0) {
    itens.push({
      chave: "motor",
      estado: "problema",
      titulo: `Motor falhou ${e.falhasDoMotor.total} ${e.falhasDoMotor.total === 1 ? "vez" : "vezes"} ao enfileirar (7 dias)`,
      detalhe: `Última${e.falhasDoMotor.ultimoEm ? ` em ${quando(e.falhasDoMotor.ultimoEm)}` : ""}: ${e.falhasDoMotor.ultimoErro ?? "sem mensagem"}. A OS seguiu normalmente; só a automação não entrou na fila.`,
    });
  } else {
    itens.push({
      chave: "motor",
      estado: "ok",
      titulo: "Motor enfileirando sem falhas",
      detalhe: "Nenhuma falha ao enfileirar nos últimos 7 dias.",
    });
  }

  return itens;
}

/** Ligar já faz mensagem sair? Só com WhatsApp conectado e nada parado na fila. */
export function envioFunciona(itens: ItemSaude[]): boolean {
  const zap = itens.find((i) => i.chave === "whatsapp");
  const proc = itens.find((i) => i.chave === "processador");
  return zap?.estado === "ok" && proc?.estado !== "problema";
}
