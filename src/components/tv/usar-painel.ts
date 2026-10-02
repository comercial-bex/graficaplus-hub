import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CABECALHO_DO_TOKEN, ROTA_DO_PAINEL } from "@/domain/tv/pareamento";
import {
  esperaAteAProximaBuscaMs,
  interpretarResposta,
  valeTentarDeNovo,
  type RespostaDaBusca,
} from "@/domain/tv/busca";
import { desvioDoRelogio, type FalhaDaBusca } from "@/domain/tv/frescor";
import type { PainelDaOficina } from "@/domain/tv/painel";

/**
 * A busca do painel, com o react-query que o resto do app já usa (o provider
 * está no __root, fora do layout logado).
 *
 * O que o hook garante, na ordem do contrato (busca.ts):
 *   - GET /api/tv/painel a cada intervalo_s, SÓ com a aba visível
 *     (refetchIntervalInBackground: false — o react-query para o intervalo e
 *     busca de novo quando a aba volta);
 *   - nova tentativa 5 s e 15 s depois de falha de servidor/rede; recusa (401)
 *     e dado fora do contrato não repetem em laço — esperam a próxima rodada;
 *   - 401: `recusa` sai preenchida e quem chama apaga o crachá; o hook nunca
 *     apaga nada sozinho;
 *   - 503/rede: o último painel fica em `painel` (gcTime infinito) e `falha`
 *     diz desde quando — a tela esmaece e avisa, nunca zera;
 *   - o desvio do relógio da TV é recalculado a cada resposta cujo gerado_em
 *     avançou (frescor.ts).
 *
 * O crachá vai só no cabeçalho `x-tv-token`. Não entra na chave da consulta,
 * no log nem na URL.
 */

export class ErroDaBusca extends Error {
  constructor(
    public readonly tipo: Exclude<RespostaDaBusca["tipo"], "painel">,
    public readonly motivo: string,
  ) {
    super(motivo);
    this.name = "ErroDaBusca";
  }
}

export type Recusa = "tv_nao_pareada" | "tv_revogada";

export type ResultadoDaBusca = {
  painel: PainelDaOficina;
  geradoEmMs: number;
  /** relógio do aparelho quando a resposta chegou */
  recebidoEmMs: number;
};

async function buscarPainel(
  token: string,
  signal: AbortSignal | undefined,
): Promise<ResultadoDaBusca> {
  let resposta: Response;
  try {
    resposta = await fetch(ROTA_DO_PAINEL, {
      method: "GET",
      headers: { [CABECALHO_DO_TOKEN]: token, accept: "application/json" },
      cache: "no-store",
      credentials: "omit",
      signal,
    });
  } catch (erro) {
    if (signal?.aborted) throw erro;
    throw new ErroDaBusca("servidor", "sem rede");
  }
  let corpo: unknown;
  try {
    corpo = await resposta.json();
  } catch {
    corpo = undefined;
  }
  const lido = interpretarResposta(resposta.status, corpo);
  if (lido.tipo === "painel") {
    return {
      painel: lido.painel,
      geradoEmMs: Date.parse(lido.painel.gerado_em),
      recebidoEmMs: Date.now(),
    };
  }
  throw new ErroDaBusca(lido.tipo, lido.motivo);
}

function tipoDoErro(erro: unknown): Exclude<RespostaDaBusca["tipo"], "painel"> {
  return erro instanceof ErroDaBusca ? erro.tipo : "servidor";
}

export type EstadoDoPainel = {
  /** o último painel bom, mesmo depois de uma falha */
  painel: PainelDaOficina | null;
  geradoEmMs: number | null;
  /** correção do relógio do aparelho; 0 até a primeira resposta */
  desvioMs: number;
  /** a última busca falhou? como? */
  falha: FalhaDaBusca;
  /** o motivo em texto (para a faixa), quando falhou */
  detalheDaFalha: string | null;
  /** relógio do aparelho na PRIMEIRA falha da sequência atual */
  falhaDesdeMs: number | null;
  /** 401: o crachá não vale mais — quem chama apaga e volta ao pareamento */
  recusa: Recusa | null;
  /** ainda não houve resposta nenhuma */
  carregando: boolean;
};

export function usePainel(token: string | null, geracao: number): EstadoDoPainel {
  const [relogio, setRelogio] = useState<{ geradoEmMs: number; desvioMs: number } | null>(null);
  const [falhaDesdeMs, setFalhaDesdeMs] = useState<number | null>(null);

  const consulta = useQuery({
    // a geração muda quando o crachá muda: a consulta recomeça limpa, sem o
    // token na chave (a chave aparece em ferramentas de depuração)
    queryKey: ["tv-painel", geracao],
    enabled: token !== null,
    queryFn: async ({ signal }) => {
      try {
        const resultado = await buscarPainel(token as string, signal);
        setFalhaDesdeMs(null);
        return resultado;
      } catch (erro) {
        if (!signal?.aborted) setFalhaDesdeMs((desde) => desde ?? Date.now());
        throw erro;
      }
    },
    retry: (falhas, erro) => valeTentarDeNovo(tipoDoErro(erro), falhas),
    retryDelay: (tentativa) => esperaAteAProximaBuscaMs(tentativa + 1, null),
    refetchInterval: (consulta) => (consulta.state.data?.painel.intervalo_s ?? 60) * 1000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    // 'online' (padrão) pausa a busca quando o navegador se diz offline, sem
    // erro — e a parede ficaria AO VIVO com dado velho. 'always' deixa falhar.
    networkMode: "always",
    staleTime: 0,
    gcTime: Number.POSITIVE_INFINITY,
    structuralSharing: false,
  });

  const dados = consulta.data;
  useEffect(() => {
    if (!dados) return;
    setRelogio((anterior) => desvioDoRelogio(anterior, dados.geradoEmMs, dados.recebidoEmMs));
  }, [dados]);

  const erro = consulta.error ?? consulta.failureReason;
  const falhou = consulta.isError || consulta.failureCount > 0;
  const tipo = falhou && erro ? tipoDoErro(erro) : null;
  const recusa: Recusa | null =
    tipo === "recusada" && erro instanceof ErroDaBusca
      ? erro.motivo === "tv_revogada"
        ? "tv_revogada"
        : "tv_nao_pareada"
      : null;

  return {
    painel: dados?.painel ?? null,
    geradoEmMs: dados?.geradoEmMs ?? null,
    desvioMs: relogio?.desvioMs ?? 0,
    falha:
      tipo === null || tipo === "recusada" ? null : tipo === "contrato" ? "contrato" : "servidor",
    detalheDaFalha:
      falhou && erro instanceof ErroDaBusca ? erro.motivo : falhou ? "falha na busca" : null,
    falhaDesdeMs: falhou ? falhaDesdeMs : null,
    recusa,
    carregando: token !== null && !dados && !falhou,
  };
}
