import { createFileRoute, redirect } from "@tanstack/react-router";
import { modoDeExemplo, type ModoDeExemplo } from "@/domain/tv/exemplo";

/**
 * /tv — atalho para a TV da Oficina (/tv/maquinas), pelo mesmo motivo de
 * /tv2: é o endereço curto que alguém digita no controle da TV.
 */
export const Route = createFileRoute("/tv/")({
  validateSearch: (busca: Record<string, unknown>): { demo?: ModoDeExemplo } => {
    const demo = modoDeExemplo(busca.demo);
    return demo ? { demo } : {};
  },
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/tv/maquinas", search, replace: true });
  },
});
