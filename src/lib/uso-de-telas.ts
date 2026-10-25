/* eslint-disable @typescript-eslint/no-explicit-any -- tabela nova ainda fora de types.ts */
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Registro de uso dos assistentes em passos (25/10/2026): abriu, passo, fechou, concluiu.
 *
 * Serve para medir se os passos ganham tempo e onde as pessoas desistem. Guarda só a tela, o
 * evento e o número do passo, nunca o que foi digitado. Falha em silêncio: medir uso jamais pode
 * atrapalhar quem está trabalhando.
 */

export type EventoDeUso = "abriu" | "passo" | "fechou" | "concluiu";

const sessoes = new Map<string, string>();

const novaSessao = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

/** Grava um evento da abertura atual da tela; sem abertura em curso, não grava nada. */
export function registrarUso(tela: string, evento: EventoDeUso, passo?: number): void {
  const sessao = sessoes.get(tela);
  if (!sessao) return;
  try {
    void (supabase as any)
      .from("uso_de_telas")
      .insert({ tela, evento, passo: passo ?? null, sessao })
      .then(
        () => undefined,
        () => undefined,
      );
  } catch {
    /* medir uso nunca atrapalha */
  }
}

/**
 * Liga o registro a um assistente: abre a sessão quando o diálogo abre, anota cada passo e, ao
 * fechar, anota o fechamento. `concluiu` é anotado pela tela quando o cadastro dá certo.
 */
export function useUsoDoAssistente(
  tela: string | undefined,
  aberto: boolean,
  passo?: number,
): void {
  useEffect(() => {
    if (!tela || !aberto) return;
    sessoes.set(tela, novaSessao());
    registrarUso(tela, "abriu");
    return () => {
      registrarUso(tela, "fechou");
      sessoes.delete(tela);
    };
  }, [tela, aberto]);

  useEffect(() => {
    if (tela && aberto && passo) registrarUso(tela, "passo", passo);
  }, [tela, aberto, passo]);
}
