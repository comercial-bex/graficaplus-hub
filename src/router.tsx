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
    // Desempenho (21/10/2026): o código da próxima tela começa a baixar quando
    // o mouse passa ou o dedo encosta no link — o clique já encontra a tela
    // pronta. Os dados continuam com o React Query (staleTime 0 no preload).
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    // Troca de TELA com a transição nativa do navegador (View Transitions): um
    // esmaecer de 160 ms, sem mudar o layout. Só quando o caminho muda: abrir
    // uma conversa (?conversa=…) ou filtrar uma lista mexe só na busca do
    // endereço, e esmaecer a tela inteira a cada clique ou tecla pesaria.
    // Navegador sem suporte troca na hora.
    defaultViewTransition: {
      types: ({ pathChanged }) => (pathChanged ? ["troca-de-tela"] : false),
    },
  });

  return router;
};
