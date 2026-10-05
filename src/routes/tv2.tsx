import { createFileRoute, redirect } from "@tanstack/react-router";
import { modoDeExemplo, type ModoDeExemplo } from "@/domain/tv/exemplo";

/**
 * /tv2 — o endereço da TV2 da agência (Bex Lite), que é o que a equipe e o
 * dono já digitam. Na gráfica a parede mora em /tv/maquinas; sem este atalho,
 * bexprint.com.br/tv2 caía em "página não encontrada" (medido em 05/10/2026).
 *
 * Leva o `?demo=` junto, para o teste do aparelho continuar funcionando.
 */
export const Route = createFileRoute("/tv2")({
  validateSearch: (busca: Record<string, unknown>): { demo?: ModoDeExemplo } => {
    const demo = modoDeExemplo(busca.demo);
    return demo ? { demo } : {};
  },
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/tv/maquinas", search, replace: true });
  },
});
