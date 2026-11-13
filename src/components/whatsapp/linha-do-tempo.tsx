import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, Loader2, Lock } from "lucide-react";
import { Dica } from "@/components/bex/Dica";
import { Button } from "@/components/ui/button";
import { BolhaDaMensagem } from "@/components/whatsapp/bolha-da-mensagem";
import { FalhaDeConsulta } from "@/components/whatsapp/falha-de-consulta";
import {
  autorDoBalao,
  fraseDoEvento,
  type MensagemDaCaixa,
} from "@/domain/whatsapp/caixa-de-entrada";
import { horaDaMensagem, type ItemDaLinha } from "@/domain/whatsapp/linha-do-tempo";
import { DICAS_WA_CONVERSA } from "@/lib/dicas";

/**
 * A linha do tempo da conversa: separador de dia, bolhas agrupadas, eventos da
 * equipe em pílula, nota interna em amarelo, divisor "Mensagens não lidas",
 * "Mensagens anteriores" e o botão de descer ao fim. Dono: CONVERSA (onda 1,
 * 12/11/2026). Quem monta os itens é `montarLinhaDoTempo` (domain, testada).
 *
 * É ESTA área que rola (a página não rola): `min-h-0 flex-1 overflow-y-auto`
 * dentro do cartão da conversa, que é coluna flex. A rolagem mora aqui dentro:
 * ficar no fim quando chega mensagem nova (só se a pessoa já estava no fim),
 * manter a posição ao carregar as anteriores, ir ao divisor de não lidas na
 * primeira vez e centralizar a ocorrência da busca.
 */

/** O que quem desenha a caixa de resposta pode pedir à linha do tempo. */
export type ControleDaLinha = { irParaOFim: () => void };

const TOLERANCIA_DO_FIM_PX = 80;

export function LinhaDoTempo({
  conversaId,
  itens,
  carregando,
  erro,
  onTentarCarregarDeNovo,
  temAnteriores,
  carregandoAnteriores,
  onCarregarAnteriores,
  nomes,
  setoresDaEquipe,
  meuId,
  podeResponder,
  liberado,
  tentando,
  fotos,
  realce,
  ocorrenciaAtualId,
  aoArquivar,
  onTentarDeNovo,
  onReescrever,
  controle,
}: {
  conversaId: string;
  itens: ItemDaLinha[];
  carregando: boolean;
  erro: unknown;
  onTentarCarregarDeNovo: () => void;
  temAnteriores: boolean;
  carregandoAnteriores: boolean;
  onCarregarAnteriores: () => void;
  nomes: Map<string, string>;
  setoresDaEquipe: Map<string, string>;
  meuId: string | null;
  podeResponder: boolean;
  liberado: boolean;
  tentando: boolean;
  fotos: readonly MensagemDaCaixa[];
  realce: string | null;
  ocorrenciaAtualId: string | null;
  aoArquivar: () => void;
  onTentarDeNovo: (m: MensagemDaCaixa) => void;
  onReescrever: (texto: string) => void;
  controle: { current: ControleDaLinha | null };
}) {
  const rolagem = useRef<HTMLDivElement>(null);
  const noFimRef = useRef(true);
  const alturaAntesRef = useRef<number | null>(null);
  const primeiraVezRef = useRef(true);
  const [noFim, setNoFim] = useState(true);

  const irParaOFim = useCallback(() => {
    const el = rolagem.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    noFimRef.current = true;
    setNoFim(true);
  }, []);
  useLayoutEffect(() => {
    controle.current = { irParaOFim };
    return () => {
      controle.current = null;
    };
  }, [controle, irParaOFim]);

  // Rola para o fim só se a pessoa já estava no fim; ao carregar anteriores,
  // mantém a posição de leitura; na primeira vez, vai ao divisor de não lidas
  // (se houver) em vez do fim, como o WhatsApp.
  useLayoutEffect(() => {
    const el = rolagem.current;
    if (!el || itens.length === 0) return;
    if (alturaAntesRef.current != null) {
      el.scrollTop = el.scrollHeight - alturaAntesRef.current;
      alturaAntesRef.current = null;
      return;
    }
    if (primeiraVezRef.current) {
      primeiraVezRef.current = false;
      const divisor = el.querySelector<HTMLElement>("#wa-divisor-nao-lidas");
      if (divisor) {
        el.scrollTop = Math.max(0, divisor.offsetTop - 56);
        noFimRef.current = false;
        setNoFim(el.scrollHeight - el.scrollTop - el.clientHeight < TOLERANCIA_DO_FIM_PX);
        return;
      }
    }
    if (noFimRef.current) el.scrollTop = el.scrollHeight;
  }, [itens.length]);

  useLayoutEffect(() => {
    noFimRef.current = true;
    primeiraVezRef.current = true;
  }, [conversaId]);

  // A ocorrência da busca que está marcada vai para o meio da área.
  useLayoutEffect(() => {
    if (!ocorrenciaAtualId) return;
    const el = rolagem.current?.querySelector<HTMLElement>(`#msg-${CSS.escape(ocorrenciaAtualId)}`);
    if (!el) return;
    noFimRef.current = false;
    el.scrollIntoView({ block: "center" });
  }, [ocorrenciaAtualId]);

  function aoRolar() {
    const el = rolagem.current;
    if (!el) return;
    const perto = el.scrollHeight - el.scrollTop - el.clientHeight < TOLERANCIA_DO_FIM_PX;
    noFimRef.current = perto;
    setNoFim((antes) => (antes === perto ? antes : perto));
  }

  // Foto, vídeo e áudio carregam depois de a bolha estar na tela e a fazem
  // crescer: quem estava no fim da conversa continua no fim.
  const manterNoFim = useCallback(() => {
    const el = rolagem.current;
    if (el && noFimRef.current) el.scrollTop = el.scrollHeight;
  }, []);

  function carregarAnteriores() {
    alturaAntesRef.current = rolagem.current?.scrollHeight ?? null;
    onCarregarAnteriores();
  }

  return (
    <div className="relative min-h-0 flex-1 bg-chat-fundo">
      <div
        ref={rolagem}
        onScroll={aoRolar}
        className="absolute inset-0 overflow-y-auto overscroll-contain py-3"
      >
        {erro ? (
          <div className="px-3">
            <FalhaDeConsulta
              titulo="Não foi possível carregar as mensagens"
              erro={erro}
              onTentarDeNovo={onTentarCarregarDeNovo}
            />
          </div>
        ) : carregando ? (
          <div className="flex items-center gap-2 px-4 py-8 text-base text-chat-texto">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> Carregando as mensagens…
          </div>
        ) : itens.length === 0 ? (
          <p className="px-4 py-8 text-center text-base text-chat-texto">
            Nenhuma mensagem gravada nesta conversa.
          </p>
        ) : (
          <div className="relative">
            {temAnteriores && (
              <div className="flex justify-center pb-2">
                <Button
                  type="button"
                  variant="secondary"
                  className="h-11 rounded-full px-4 text-sm"
                  onClick={carregarAnteriores}
                  disabled={carregandoAnteriores}
                >
                  {carregandoAnteriores && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                  Mensagens anteriores
                </Button>
              </div>
            )}
            {itens.map((item) => {
              switch (item.tipo) {
                case "dia":
                  return (
                    <div key={`dia-${item.chave}`} className="my-3 flex justify-center">
                      <span className="rounded-lg bg-chat-pilula px-3 py-1 text-sm font-medium text-chat-pilula-texto shadow-sm">
                        {item.rotulo}
                      </span>
                    </div>
                  );
                case "nao_lidas":
                  return (
                    <div
                      key="nao-lidas"
                      id="wa-divisor-nao-lidas"
                      className="my-3 flex justify-center"
                      role="separator"
                      aria-label="Mensagens não lidas começam aqui"
                    >
                      <span className="rounded-full bg-chat-pilula px-3 py-1 text-sm font-semibold text-chat-verde-texto shadow-sm">
                        Mensagens não lidas
                      </span>
                    </div>
                  );
                case "evento":
                  return (
                    <div key={item.id} className="my-1.5 flex justify-center px-3">
                      <span className="max-w-full rounded-full bg-chat-pilula px-3 py-1 text-center text-sm text-chat-pilula-texto shadow-sm">
                        {fraseDoEvento(item.e, nomes, setoresDaEquipe)} · {horaDaMensagem(item.quando)}
                      </span>
                    </div>
                  );
                case "nota":
                  return (
                    <div key={item.id} className="my-2 flex justify-center px-3">
                      <div className="max-w-[92%] rounded-lg bg-chat-nota px-3 py-2 text-base leading-6 text-chat-nota-texto shadow-sm @min-[600px]/conversa:max-w-[72%]">
                        <div className="mb-0.5 flex items-center gap-1 text-sm font-semibold">
                          <Lock className="h-3.5 w-3.5" aria-hidden />
                          Nota de {(item.e.de_usuario && nomes.get(item.e.de_usuario)) || "Equipe"}, só a
                          equipe vê
                        </div>
                        <div className="whitespace-pre-wrap break-words">
                          {fraseDoEvento(item.e, nomes, setoresDaEquipe)}
                        </div>
                        <div className="mt-0.5 text-right text-xs">{horaDaMensagem(item.quando)}</div>
                      </div>
                    </div>
                  );
                case "msg": {
                  const m = item.m;
                  const ehMinha = !!meuId && m.enviada_por === meuId;
                  const autor =
                    item.primeiraDoGrupo && !ehMinha ? autorDoBalao(m, nomes) : null;
                  return (
                    <BolhaDaMensagem
                      key={item.id}
                      m={m}
                      quando={item.quando}
                      autor={autor}
                      primeiraDoGrupo={item.primeiraDoGrupo}
                      ultimaDoGrupo={item.ultimaDoGrupo}
                      podeResponder={podeResponder}
                      liberado={liberado}
                      tentando={tentando}
                      ocorrenciaAtual={ocorrenciaAtualId === m.id}
                      realce={realce}
                      fotos={fotos}
                      aoMudarAltura={manterNoFim}
                      aoArquivar={aoArquivar}
                      onTentarDeNovo={onTentarDeNovo}
                      onReescrever={onReescrever}
                    />
                  );
                }
              }
            })}
          </div>
        )}
      </div>
      {!noFim && itens.length > 0 && (
        <div className="pointer-events-none absolute bottom-3 right-4">
          <Dica texto={DICAS_WA_CONVERSA.descer}>
            <Button
              type="button"
              size="icon"
              variant="secondary"
              className="pointer-events-auto size-11 rounded-full shadow-md"
              aria-label="Ir para as mensagens mais recentes"
              onClick={irParaOFim}
            >
              <ChevronDown className="h-5 w-5" />
            </Button>
          </Dica>
        </div>
      )}
    </div>
  );
}
