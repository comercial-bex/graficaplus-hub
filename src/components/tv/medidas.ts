import { useEffect, useMemo, useState } from "react";
import type { Medidor } from "@/domain/tv/partir-nome";

/**
 * Régua de texto para a parede: mede largura em px DO PALCO (1920×1080), com
 * a mesma pilha de fontes do CSS. Como o palco é fixo e só o `transform`
 * muda, a medida vale em qualquer TV.
 *
 * Usa um canvas fora da tela (`measureText`); no servidor não existe canvas e
 * o hook devolve null — a tela desenha sem partir nomes até montar.
 */
export const PILHA_DE_FONTES = 'Montserrat, system-ui, -apple-system, "Segoe UI", sans-serif';

/** As faces que a parede usa; esperar por elas antes de medir evita medir na fonte reserva. */
const FACES = ["500 24px", "600 28px", "700 24px", "800 24px", "800 26px", "800 28px"];

export function useFontesProntas(): boolean {
  const [prontas, setProntas] = useState(false);
  useEffect(() => {
    let vivo = true;
    const fontes = typeof document !== "undefined" ? document.fonts : undefined;
    if (!fontes || typeof fontes.load !== "function") {
      setProntas(true);
      return;
    }
    // Pede cada face de propósito: `fonts.ready` sozinho resolve antes de a face
    // ser requisitada. Face que não carrega (TV sem internet) resolve igual, e a
    // medida sai na fonte reserva — que é a que a tela desenha nesse caso.
    Promise.all(FACES.map((f) => fontes.load(`${f} Montserrat`).catch(() => [])))
      .then(() => fontes.ready)
      .catch(() => undefined)
      .then(() => {
        if (vivo) setProntas(true);
      });
    return () => {
      vivo = false;
    };
  }, []);
  return prontas;
}

const F_QUANDO = `800 24px ${PILHA_DE_FONTES}`;
const F_O_QUE = `800 26px ${PILHA_DE_FONTES}`;

/** Largura de um cartão do letreiro: tarja 5 + recuo 28 + borda 2 + o texto mais largo (o de cima tem letter-spacing .04em). */
export function larguraDoCartaoDeSaida(
  s: { quandoTexto: string; oQue: string },
  medir: Medidor,
): number {
  const quando = medir(s.quandoTexto, F_QUANDO) + 0.04 * 24 * s.quandoTexto.length;
  const oQue = medir(s.oQue, F_O_QUE);
  return Math.ceil(5 + 28 + 2 + Math.max(quando, oQue));
}

/** A régua. Troca quando as fontes ficam prontas, para a tela medir de novo. */
export function useMedidor(fontesProntas: boolean): Medidor | null {
  return useMemo<Medidor | null>(() => {
    if (typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    // `fontesProntas` entra só para a régua ser recriada quando as faces chegam
    void fontesProntas;
    return (texto, fonte) => {
      ctx.font = fonte;
      return ctx.measureText(texto).width;
    };
  }, [fontesProntas]);
}
