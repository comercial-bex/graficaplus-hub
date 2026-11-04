import type { FotoGerada } from "@/lib/api/produtos-foto-ia.functions";

/**
 * O lote de "Gerar fotos que faltam": quem entra e quando para.
 *
 * Revisão de 03/11/2026 (o lote ainda não tinha gerado nenhuma foto de verdade):
 *   - serviço (Deslocamento, Ilhós na lona...) não leva foto gerada, então não entra
 *     na contagem nem no lote: o botão dizia 57 e eram 43 produtos;
 *   - o lote só parava para "sem IA", "sem saldo" e "limite". Com a sessão vencida ou
 *     o gateway fora do ar ele seguia pelos 57 produtos, um aviso vermelho por produto,
 *     e terminava com aviso verde. Agora para depois de 3 falhas seguidas e na hora
 *     quando o erro é de acesso;
 *   - "limite" (429) espera e tenta o mesmo produto de novo, em vez de encerrar o lote:
 *     o dono pediu "clicar e ir gerando até o fim";
 *   - quem já ganhou foto no meio do lote (outra pessoa enviou a real) é pulado pelo
 *     servidor sem gastar saldo, e não conta como falha.
 *
 * Segunda rodada, 04/11/2026 (revisão do PR 428):
 *   - resposta inesperada do servidor (nada, ou um estado novo de uma versão mais nova)
 *     vira falha daquele produto, não derruba o lote nem deixa a tela sem aviso;
 *   - a espera do 429 conta pelo relógio e não por sonecas encadeadas (aba escondida
 *     estica timer), e a tela é avisada quando a espera acaba;
 *   - "Faltam N" desconta também os pulados; "sair da tela" não se diz "a pedido";
 *   - uma chamada que nunca volta cai por tempo (4 minutos) em vez de prender a tela;
 *   - cada falha fica numa lista (nome e motivo) que a tela mantém até a pessoa dispensar:
 *     o toast some em 4 segundos e o lote roda 20 minutos em outra aba.
 */

/** Teto de segurança por clique: uma aba esquecida aberta não gasta saldo sem fim. */
export const LOTE_DE_FOTOS = 60;
/** Falhas seguidas (nenhuma foto no meio) que encerram o lote. */
export const FALHAS_SEGUIDAS_QUE_PARAM = 3;
/** Segundos de espera entre as tentativas quando o gateway diz "muitas chamadas" (429). */
export const ESPERAS_DO_LIMITE_S: readonly number[] = [30, 60];
/** Uma chamada ao servidor que passa disso é dada como perdida (o servidor limita 60 s por modelo, 3 modelos). */
export const TEMPO_LIMITE_DA_CHAMADA_MS = 4 * 60_000;

export type ProdutoDoLote = {
  id: string;
  nome: string;
  imagem_url?: string | null;
  ativo?: boolean | null;
  tipo?: string | null;
};

/** Ativo, que não é serviço e ainda sem foto. */
export function produtosSemFoto<P extends ProdutoDoLote>(produtos: readonly P[]): P[] {
  return produtos.filter((p) => p.ativo !== false && p.tipo !== "servico" && !(p.imagem_url ?? "").trim());
}

/**
 * Os que falharam neste navegador vão para o fim da fila do lote seguinte: sem isso, três produtos que
 * recusam sempre, no começo da lista, travavam todo clique no mesmo lugar e o lote nunca chegava ao quarto.
 */
export function filaDoLote<P extends ProdutoDoLote>(semFoto: readonly P[], jaFalharam: ReadonlySet<string>): P[] {
  return [...semFoto.filter((p) => !jaFalharam.has(p.id)), ...semFoto.filter((p) => jaFalharam.has(p.id))];
}

export type MotivoDaParada = "fim" | "pediu" | "saiu" | "sem_ia" | "sem_saldo" | "limite" | "acesso" | "falhas_seguidas";

export type FalhaDoLote = { id: string; nome: string; motivo: string };

export type SaidaDoLote = {
  geradas: number;
  puladas: number;
  /** Gerações pagas e jogadas fora porque a foto do produto mudou no meio (outra aba, outra pessoa). */
  descartadas: number;
  falhas: number;
  motivo: MotivoDaParada;
  /** Os que falharam, com o motivo: a tela mostra até a pessoa dispensar. */
  falhados: FalhaDoLote[];
};

/** Sessão vencida, perfil sem papel ou token inválido: insistir em outro produto não resolve. */
export function ehErroDeAcesso(e: unknown): boolean {
  const texto = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  return /sess[aã]o|unauthorized|invalid token|forbidden|administrador e ger[eê]ncia|conferir o seu perfil|n[aã]o autenticad/i.test(texto);
}

/** Dá a uma chamada um prazo: passou dele, vira erro (a promessa original segue por baixo, sem ninguém esperando). */
export function comTempoLimite<T>(promessa: Promise<T>, ms: number, mensagem: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const relogio = setTimeout(() => reject(new Error(mensagem)), ms);
    promessa.then(
      (v) => {
        clearTimeout(relogio);
        resolve(v);
      },
      (e) => {
        clearTimeout(relogio);
        reject(e);
      },
    );
  });
}

const ESTADOS_QUE_PARAM = new Set(["sem_ia", "sem_saldo", "limite"]);
const ESTADOS_QUE_PULAM = new Set(["ja_tem_foto", "servico", "em_andamento", "mudou_no_meio"]);

type Resultado = { resultado: FotoGerada } | { erro: unknown };

/** Texto curto do motivo de uma falha, para a lista que fica na tela. */
function motivoDaFalha(r: Resultado, traduzir: (e: unknown) => string): string {
  if ("erro" in r) return traduzir(r.erro);
  const x = r.resultado as { estado?: string; detalhe?: string };
  return x.estado === "falhou" ? String(x.detalhe ?? "falhou") : `resposta inesperada do servidor (${String(x.estado)})`;
}

export async function rodarLote(a: {
  produtos: readonly ProdutoDoLote[];
  /** Chama o servidor para um produto; lança quando a chamada falha (rede, sessão, perfil). */
  gerar: (produtoId: string) => Promise<FotoGerada>;
  /** Falso para seguir; "pediu" quando a pessoa clicou em Parar; "saiu" quando saiu da tela. */
  devePararAgora: () => false | "pediu" | "saiu";
  aoComecar: (feitas: number, p: ProdutoDoLote) => void;
  aoResultado: (p: ProdutoDoLote, r: Resultado) => void;
  aoEsperarLimite?: (segundos: number, p: ProdutoDoLote) => void;
  /** A espera do limite acabou e a nova tentativa vai começar. */
  aoRetomar?: (p: ProdutoDoLote) => void;
  dormir?: (ms: number) => Promise<void>;
  agora?: () => number;
  /** Como a falha de uma chamada que lançou vira texto na lista (por padrão, a mensagem do erro). */
  traduzirErro?: (e: unknown) => string;
  falhasQueParam?: number;
  esperasDoLimiteS?: readonly number[];
}): Promise<SaidaDoLote> {
  const dormir = a.dormir ?? ((ms: number) => new Promise<void>((ok) => setTimeout(ok, ms)));
  const agora = a.agora ?? (() => Date.now());
  const traduzir = a.traduzirErro ?? ((e: unknown) => (e instanceof Error ? e.message : String(e)));
  const maximoSeguidas = a.falhasQueParam ?? FALHAS_SEGUIDAS_QUE_PARAM;
  const esperas = a.esperasDoLimiteS ?? ESPERAS_DO_LIMITE_S;
  let geradas = 0;
  let puladas = 0;
  let descartadas = 0;
  let falhas = 0;
  let seguidas = 0;
  let motivo: MotivoDaParada = "fim";
  const falhados: FalhaDoLote[] = [];

  for (let i = 0; i < a.produtos.length; i++) {
    const p = a.produtos[i];
    const parar = a.devePararAgora();
    if (parar) {
      motivo = parar;
      break;
    }
    a.aoComecar(i, p);

    // Um produto: se o gateway diz 429, espera e tenta o MESMO produto de novo, até esgotar as esperas.
    let resultado: FotoGerada | null = null;
    let erro: unknown = null;
    let tentativa = 0;
    let paradoNaEspera: false | "pediu" | "saiu" = false;
    for (;;) {
      try {
        resultado = (await a.gerar(p.id)) ?? null;
        erro = null;
      } catch (e) {
        resultado = null;
        erro = e ?? new Error("falhou");
      }
      if (resultado?.estado === "limite" && tentativa < esperas.length) {
        const segundos = esperas[tentativa++];
        a.aoEsperarLimite?.(segundos, p);
        // Conta pelo relógio e confere o "Parar" a cada segundo: aba escondida estica timer, e a espera não pode virar meia hora.
        const fim = agora() + segundos * 1000;
        while (agora() < fim && !a.devePararAgora()) await dormir(1000);
        paradoNaEspera = a.devePararAgora();
        if (paradoNaEspera) break;
        a.aoRetomar?.(p);
        continue;
      }
      break;
    }
    if (paradoNaEspera) {
      motivo = paradoNaEspera;
      break;
    }

    // A chamada voltou sem nada, ou com um estado que esta versão da tela não conhece: é falha DESTE produto.
    const estado = resultado === null ? null : String((resultado as { estado?: unknown }).estado);
    if (resultado === null) {
      falhas += 1;
      seguidas += 1;
      falhados.push({ id: p.id, nome: p.nome, motivo: motivoDaFalha({ erro }, traduzir) });
      a.aoResultado(p, { erro });
      if (ehErroDeAcesso(erro)) {
        motivo = "acesso";
        break;
      }
    } else if (estado === "ok") {
      geradas += 1;
      seguidas = 0;
      a.aoResultado(p, { resultado });
    } else if (estado !== null && ESTADOS_QUE_PULAM.has(estado)) {
      // Nada deu errado: o produto só não precisa de foto agora (já tem, é serviço, outra aba está gerando).
      puladas += 1;
      if (estado === "mudou_no_meio") descartadas += 1;
      a.aoResultado(p, { resultado });
    } else if (estado !== null && ESTADOS_QUE_PARAM.has(estado)) {
      // sem_ia, sem_saldo ou limite que as esperas não resolveram: insistir só repete o erro.
      a.aoResultado(p, { resultado });
      motivo = estado as MotivoDaParada;
      break;
    } else {
      // "falhou" ou qualquer estado desconhecido.
      falhas += 1;
      seguidas += 1;
      falhados.push({ id: p.id, nome: p.nome, motivo: motivoDaFalha({ resultado }, traduzir) });
      a.aoResultado(p, { resultado });
    }
    if (seguidas >= maximoSeguidas) {
      motivo = "falhas_seguidas";
      break;
    }
  }
  return { geradas, puladas, descartadas, falhas, motivo, falhados };
}

/**
 * O aviso do fim do lote: verde só quando gerou foto; nunca verde para um lote que não gerou nada.
 * `semFotoAntes` é o que faltava no clique; os pulados saem da conta (já têm foto, ou outra aba gerou).
 */
export function resumoDoLote(s: SaidaDoLote, semFotoAntes: number): { nivel: "sucesso" | "aviso" | "info"; texto: string } {
  const fotos = (n: number) => `${n} ${n === 1 ? "foto gerada" : "fotos geradas"}`;
  const restantes = Math.max(semFotoAntes - s.geradas - s.puladas, 0);
  const faltam = restantes === 1 ? "Falta 1." : `Faltam ${restantes}.`;
  const lista =
    (s.falhados.length > 0 ? " Os que falharam estão listados abaixo." : "") +
    (s.descartadas > 0
      ? ` ${s.descartadas} ${s.descartadas === 1 ? "geração foi descartada" : "gerações foram descartadas"} porque a foto do produto mudou no meio (saldo gasto).`
      : "");
  switch (s.motivo) {
    case "fim":
      if (s.geradas > 0) {
        return {
          nivel: "sucesso",
          texto: `${fotos(s.geradas)}. ${restantes === 0 ? "Todos os produtos ativos que levam foto têm foto." : faltam}${lista}`,
        };
      }
      if (s.puladas > 0 && s.falhas === 0) return { nivel: "info", texto: "Nada a gerar: esses produtos já tinham foto, são serviços ou outra aba estava gerando." };
      return { nivel: "aviso", texto: `Nenhuma foto gerada desta vez.${lista}` };
    case "pediu":
      return { nivel: "info", texto: `Lote parado a pedido. ${fotos(s.geradas)}. ${faltam}${lista}` };
    case "saiu":
      return { nivel: "info", texto: `Você saiu da tela e o lote parou depois da foto em curso. ${fotos(s.geradas)}. ${faltam}${lista}` };
    case "sem_ia":
      return { nivel: "aviso", texto: `Lote parado: a IA não está ligada neste projeto. ${fotos(s.geradas)}.` };
    case "sem_saldo":
      return { nivel: "aviso", texto: `Lote parado: o saldo de IA do projeto acabou. ${fotos(s.geradas)}. ${faltam}` };
    case "limite":
      return { nivel: "aviso", texto: `Lote parado: a IA segue no limite de chamadas depois de esperar. ${fotos(s.geradas)}. Tente de novo em alguns minutos.` };
    case "acesso":
      return { nivel: "aviso", texto: `Lote parado: a sessão venceu ou a sua conta não pode gerar fotos. Entre de novo e tente. ${fotos(s.geradas)}.` };
    case "falhas_seguidas":
      return {
        nivel: "aviso",
        texto: `Lote parado depois de ${FALHAS_SEGUIDAS_QUE_PARAM} falhas seguidas, para não gastar saldo à toa.${lista} ${fotos(s.geradas)}.`,
      };
    default:
      // Um motivo que esta versão não conhece nunca pode deixar a tela sem aviso.
      return { nivel: "aviso", texto: `O lote terminou. ${fotos(s.geradas)}.${lista}` };
  }
}
