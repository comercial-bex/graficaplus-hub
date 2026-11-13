import { useEffect, useLayoutEffect, useState, type RefObject } from "react";
import { modoPelaLargura, type ModoDaCaixa } from "@/domain/whatsapp/moldura";

// No servidor não há layout para medir (e o useLayoutEffect avisaria).
const useEfeitoDeLayout = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * O modo da caixa (estreito, médio, largo) pela LARGURA ÚTIL do contêiner
 * `@container/caixa`, não pela janela (onda 1, 12/11/2026). Dono: MOLDURA.
 *
 * O CSS (consulta de contêiner) já escolhe as colunas sozinho, sem piscar; o JS
 * sabe o modo porque quem desenha a gaveta (Sheet ou coluna encaixada) e o
 * botão Voltar decide por ele. Mede em `useLayoutEffect`, antes de pintar, e
 * depois acompanha o contêiner com um ResizeObserver (o menu lateral abre e
 * recolhe sem a janela mudar).
 *
 * O elemento tem de existir quando o hook roda a primeira vez: a tela mantém o
 * contêiner montado em todos os estados (carregando, falha, vazia).
 */
export function useModoDaCaixa(ref: RefObject<HTMLElement | null>): ModoDaCaixa {
  const [modo, setModo] = useState<ModoDaCaixa>("estreito");

  useEfeitoDeLayout(() => {
    const el = ref.current;
    if (!el) return;
    const medir = () => setModo(modoPelaLargura(el.getBoundingClientRect().width));
    medir();
    if (typeof ResizeObserver === "undefined") return;
    const obs = new ResizeObserver(medir);
    obs.observe(el);
    return () => obs.disconnect();
  }, [ref]);

  return modo;
}
