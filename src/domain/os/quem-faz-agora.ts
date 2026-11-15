/**
 * Quem faz o próximo passo da OS — e o que é esse passo (pedido do dono, 15/11/2026).
 *
 * "Colocar em cenários de processos e quem executa cada processo, facilitando cada
 * vez mais. E responsabilizando também por cada etapa."
 *
 * Cada status diz o passo que falta e o papel de quem o dá; a pessoa sai da própria
 * OS (o vendedor/responsável é o atendimento, o designer é a criação, o operador é a
 * máquina). Quando há um pedido aberto ao gestor (validação, saldo devedor, margem) e
 * a trava continua, o passo é do gestor — é ele quem segura a OS.
 *
 * O mesmo cálculo serve ao cartão ("com Fernando · operador"), à ficha ("Agora:
 * escolher a máquina e começar — com Fernando") e ao filtro "Comigo" do quadro.
 */

import { TRAVA_DO_ASSUNTO, type AssuntoDoGestor } from "./fila-do-gestor";

export type PapelDoPasso = "Atendimento" | "Gestor" | "Criação" | "Operador" | "Instalação" | "Financeiro";

export type PassoDaOs = {
  /** O que falta fazer, no infinitivo: "Escolher a máquina e começar". */
  passo: string;
  papel: PapelDoPasso;
  /** A pessoa da OS que responde pelo passo; nulo quando é o papel inteiro (o gestor) ou ninguém foi escolhido. */
  pessoaId: string | null;
  /** O papel tem gente definida na OS? Falso = "ainda sem operador", e o passo vira escolher a pessoa. */
  semPessoa?: boolean;
};

export type OsParaPasso = {
  status: string | null | undefined;
  finalidade?: string | null;
  vendedor_id?: string | null;
  responsavel_id?: string | null;
  designer_id?: string | null;
  operador_id?: string | null;
};

const ASSUNTOS: AssuntoDoGestor[] = ["atendimento", "saldo_devedor", "margem_baixa"];

const PASSO_DO_GESTOR: Record<AssuntoDoGestor, string> = {
  atendimento: "Validar o atendimento e escolher quem faz a criação",
  saldo_devedor: "Decidir se o cliente pode ficar devendo",
  margem_baixa: "Decidir se libera a margem abaixo do mínimo",
};

export function quemFazAgora(
  os: OsParaPasso,
  contexto: {
    /** As travas da OS (os_bloqueios_do_quadro). */
    travas?: readonly { codigo: string }[];
    /** Os assuntos com pedido aberto ao gestor nesta OS. */
    pedidosAoGestor?: readonly AssuntoDoGestor[];
  } = {},
): PassoDaOs | null {
  const travas = new Set((contexto.travas ?? []).map((t) => t.codigo));
  const atendimento = os.vendedor_id ?? os.responsavel_id ?? null;

  // Um pedido ao gestor cuja trava continua: a OS está nas mãos do gestor.
  for (const assunto of ASSUNTOS) {
    if (contexto.pedidosAoGestor?.includes(assunto) && travas.has(TRAVA_DO_ASSUNTO[assunto])) {
      return { passo: PASSO_DO_GESTOR[assunto], papel: "Gestor", pessoaId: null };
    }
  }

  const de = (papel: PapelDoPasso, pessoaId: string | null | undefined, passo: string): PassoDaOs =>
    pessoaId ? { passo, papel, pessoaId } : { passo, papel, pessoaId: null, semPessoa: papel !== "Gestor" };

  switch (os.status) {
    case "entrada":
    case "aguardando_briefing":
      return travas.has("atendimento_nao_validado")
        ? de("Atendimento", atendimento, "Fechar o pacote e pedir a validação ao gestor")
        : de("Atendimento", atendimento, "Fechar o pacote e mandar para a criação");
    case "briefing_ok":
      return os.designer_id
        ? de("Criação", os.designer_id, "Começar a criação")
        : de("Gestor", null, "Escolher quem faz a criação");
    case "design":
      return de("Criação", os.designer_id, "Fazer a arte e o arquivo de impressão");
    case "arte_rejeitada":
      return de("Criação", os.designer_id, "Ajustar a arte que o cliente pediu");
    case "aguardando_aprovacao_arte":
      return de("Atendimento", atendimento, "Conseguir o aceite do cliente");
    case "arte_aprovada":
      return de("Criação", os.designer_id, "Fechar o arquivo de impressão e mandar para a fila");
    case "aguardando_producao":
      return os.operador_id
        ? de("Operador", os.operador_id, "Escolher a máquina e começar")
        : de("Gestor", null, "Escolher quem vai produzir");
    case "em_impressao":
    case "em_corte":
    case "em_laser_cnc":
    case "em_3d":
    case "em_uv":
    case "em_producao":
    case "producao":
      return de("Operador", os.operador_id, "Produzir e mandar para o acabamento");
    case "em_acabamento":
    case "controle_qualidade":
      return de("Operador", os.operador_id, "Acabar, conferir e marcar como pronta");
    case "retrabalho":
      return de("Operador", os.operador_id, "Refazer o que a conferência reprovou");
    case "aguardando_retirada":
      return de("Atendimento", atendimento, "Combinar a retirada com o cliente");
    case "aguardando_entrega":
    case "em_entrega":
      return de("Atendimento", atendimento, "Combinar e fazer a entrega");
    case "em_instalacao":
      return de("Instalação", null, "Instalar no cliente");
    case "concluido":
      return de("Financeiro", null, "Faturar a OS");
    default:
      // faturado, pausado, cancelado: não há passo esperando ninguém.
      return null;
  }
}

/** "com Fernando · operador", "com você", "com o gestor", "ainda sem operador". */
export function comQuem(
  p: PassoDaOs,
  nomeDe: (id: string) => string | null,
  euId?: string | null,
): string {
  if (p.pessoaId && euId && p.pessoaId === euId) return "com você";
  if (p.pessoaId) {
    const nome = nomeDe(p.pessoaId);
    return nome ? `com ${nome} · ${p.papel.toLowerCase()}` : `com o ${p.papel.toLowerCase()}`;
  }
  if (p.papel === "Gestor") return "com o gestor";
  if (p.semPessoa) return `ainda sem ${p.papel === "Criação" ? "alguém na criação" : p.papel.toLowerCase()}`;
  return `com ${p.papel === "Instalação" ? "a instalação" : `o ${p.papel.toLowerCase()}`}`;
}

/** O passo é de quem está logado? (a pessoa da OS, ou o gestor quando o passo é do gestor) */
export function ehComigo(p: PassoDaOs | null, euId: string | null | undefined, souGestor: boolean): boolean {
  if (!p || !euId) return false;
  if (p.pessoaId) return p.pessoaId === euId;
  return p.papel === "Gestor" && souGestor;
}
