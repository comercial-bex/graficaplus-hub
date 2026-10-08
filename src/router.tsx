import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { refazerAoVoltar } from "./domain/acesso/sessao";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Voltar à aba refaz a consulta só se o dado tem mais de 1 minuto.
        // Com o padrão (staleTime 0), cada volta refazia TODAS as consultas
        // da tela, inclusive as lidas segundos antes — no celular, onde a
        // pessoa troca de aplicativo o tempo todo, era o sistema inteiro de
        // novo a cada troca. Abrir uma tela continua lendo do banco na hora.
        refetchOnWindowFocus: (consulta) =>
          refazerAoVoltar(consulta.state.dataUpdatedAt, Date.now()),
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
